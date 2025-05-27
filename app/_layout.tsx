import 'react-native-reanimated';
import { useEffect, useRef, useState } from 'react';
import { SplashScreen, useRouter, Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../lib/supabase';
import { initEpisodeNotificationService, setupNotificationListener, syncPushTokenAfterLogin } from '../utils/notifications/EpisodeNotificationService';
import NetInfo from '@react-native-community/netinfo';
import * as Sentry from '@sentry/react-native';
import { cleanupStaleLocalPositions } from '../utils/cache/LocalPositionCleanupService';
import { getStringItem, removeStringItem } from '../utils/cache/LocalStorageService';
import { AudioProvider } from '../components/AudioContext';
import { theme } from '@/styles/global';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Main layout component
export default function RootLayout() {
  const router = useRouter();
  const [isAppReady, setIsAppReady] = useState(false);
  const [authCheckCompleted, setAuthCheckCompleted] = useState(false);
  const [initialRedirectPath, setInitialRedirectPath] = useState<'/auth/login' | '/(tabs)' | null>(null); // Corrected type
  const appMounted = useRef(true);
  const authSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const netInfoUnsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const initializeApp = async () => {
      let performedAuthenticatedInit = false;
      let redirectPath: '/auth/login' | '/(tabs)' = '/auth/login'; // Default redirect path with specific type

      try {
        // 1. Setup onAuthStateChange listener (always active)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          console.log('[RootLayout] Auth state changed:', event, !!session);
          if (!appMounted.current || !isAppReady) { // Guard with isAppReady
            console.log('[RootLayout] Auth state change ignored: app not ready or unmounted.');
            return;
          }

          if (event === 'SIGNED_IN') {
            console.log('[RootLayout] Auth event: SIGNED_IN. Syncing token.');
            await syncPushTokenAfterLogin();
            // Potentially navigate to tabs if coming from a login/register screen
            // Check current route to avoid unnecessary navigation if already in tabs
            // Conditional navigation to /(tabs)
            router.replace('/(tabs)');
          } else if (event === 'SIGNED_OUT') {
            console.log('[RootLayout] Auth event: SIGNED_OUT. Redirecting to login.');
            router.replace('/auth/login');
          }
        });
        authSubscriptionRef.current = subscription;

        // 2. Check initial session state for the very first load
        const { data: { session: initialSession }, error: sessionError } = await supabase.auth.getSession();

        if (!appMounted.current) return;

        if (sessionError) {
          console.error('[RootLayout] Error fetching initial session:', sessionError.message);
          Sentry.captureException(sessionError);
          redirectPath = '/auth/login';
        } else if (initialSession) {
          console.log('[RootLayout] Initial session found. Proceeding with authenticated app init.');
          await syncPushTokenAfterLogin(); // Sync for existing session
          redirectPath = '/(tabs)'; // Set redirect path for authenticated user

          // Initialiser le service de notification (et autres services authentifiés)
          try {
            await initEpisodeNotificationService();
            setupNotificationListener((episodeId) => {
              console.log(`[NotificationHandler] Received notification for episode ${episodeId}`);
              const navigateToPlayer = () => {
                if (!appMounted.current || !isAppReady) { // Guard with isAppReady
                  console.log('[NotificationHandler] Navigation to player ignored: app not ready or unmounted.');
                  return;
                }
                console.log('[NotificationHandler] Navigating to player tab');
                router.navigate({
                  pathname: '/player/play',
                  params: { episodeId: episodeId, source: 'notification', timestamp: Date.now() }
                });
              };

              if (appMounted.current && isAppReady) {
                navigateToPlayer();
              } else {
                console.log('[NotificationHandler] App not ready or component unmounted, queuing navigation...');
                const readyCheckInterval = setInterval(() => {
                  if (!appMounted.current) {
                    clearInterval(readyCheckInterval);
                    return;
                  }
                  if (isAppReady) {
                    console.log('[NotificationHandler] App now ready, navigating...');
                    clearInterval(readyCheckInterval);
                    navigateToPlayer();
                  }
                }, 200);
                setTimeout(() => {
                  if (appMounted.current) clearInterval(readyCheckInterval);
                }, 10000); // Timeout
              }
            });

            const checkLastRequestedEpisode = async () => {
              if (!appMounted.current || !isAppReady) return; // Guard with isAppReady
              try {
                const lastEpisodeId = await getStringItem('lastRequestedEpisodeId');
                if (lastEpisodeId) {
                  console.log(`[Layout] Found last requested episode ${lastEpisodeId}, clearing and navigating`);
                  await removeStringItem('lastRequestedEpisodeId');
                  router.navigate({
                    pathname: '/player/play',
                    params: { episodeId: lastEpisodeId, source: 'notification', timestamp: Date.now() }
                  });
                }
              } catch (error) { console.error('[Layout] Error checking last requested episode:', error); }
            };
            if (appMounted.current) setTimeout(checkLastRequestedEpisode, 1000);
            
            console.log('[RootLayout] Episode notification service initialized for authenticated user.');
          } catch (notificationError) {
            console.error('[RootLayout] Error initializing episode notification service:', notificationError);
            Sentry.captureException(notificationError);
          }

          netInfoUnsubscribeRef.current = NetInfo.addEventListener(state => {
            if (state.isConnected && state.isInternetReachable) {
              console.log('Device is online, syncing playback state...');
            }
          });
          performedAuthenticatedInit = true;
        } else {
          console.log('[RootLayout] No initial session. Setting redirect to login.');
          redirectPath = '/auth/login';
        }

      } catch (error) {
        console.error('[RootLayout] General initialization error:', error);
        Sentry.captureException(error);
        redirectPath = '/auth/login'; // Fallback redirect
      } finally {
        if (appMounted.current) {
          setInitialRedirectPath(redirectPath);
          setAuthCheckCompleted(true);
          console.log(`[RootLayout] Auth check completed. Initial redirect path set to: ${redirectPath}`);
          if (performedAuthenticatedInit) {
            console.log('[RootLayout] Authenticated app services initialized.');
          } else {
            console.log('[RootLayout] App will proceed to login or unauthenticated state.');
          }
        }
      }
    };

    initializeApp();
    cleanupStaleLocalPositions();

    return () => {
      appMounted.current = false;
      if (authSubscriptionRef.current) {
        console.log('[RootLayout] Unsubscribing from auth state changes.');
        authSubscriptionRef.current.unsubscribe();
      }
      if (netInfoUnsubscribeRef.current) {
        console.log('[RootLayout] Unsubscribing from NetInfo.');
        netInfoUnsubscribeRef.current();
      }
      console.log('[RootLayout] Unmounted.');
    };
  }, []); // Removed router from dependencies

  // Effect to mark app as ready once auth check is complete
  useEffect(() => {
    if (authCheckCompleted) {
      setIsAppReady(true);
      console.log('[RootLayout] App is marked as ready to render navigator.');
    }
  }, [authCheckCompleted]);

  // Effect to perform initial navigation and hide splash screen once app is ready and path is determined
  useEffect(() => {
    if (isAppReady && initialRedirectPath && appMounted.current) {
      console.log(`[RootLayout] App ready, performing initial navigation to: ${initialRedirectPath}`);
      try {
        router.replace(initialRedirectPath);
      } catch (e) {
        console.error(`[RootLayout] Router replace to ${initialRedirectPath} failed:`, e);
        if (initialRedirectPath !== '/auth/login') {
          try { router.replace('/auth/login'); } catch (e2) { console.error("[RootLayout] Fallback router replace to login failed", e2); }
        }
      } finally {
        SplashScreen.hideAsync().catch(e => console.warn('[RootLayout] SplashScreen.hideAsync failed:', e));
        console.log('[RootLayout] Splash screen hidden.');
      }
    }
  }, [isAppReady, initialRedirectPath, router]);

  if (!isAppReady) {
    console.log('[RootLayout] App not ready, rendering null.');
    return null; // Ou retourner un écran de chargement minimal si SplashScreen.hideAsync a échoué
  }

  console.log('[RootLayout] App is ready, rendering main navigator.');
  return (
    <AudioProvider>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: 'black' }}>
        <SafeAreaProvider>
          <StatusBar style="auto" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: {
                backgroundColor: theme.colors.darkBackground
              },
            }}>
            {/* <Slot /> removed as Stack navigator handles screen rendering */}
            <Stack.Screen
              name="(tabs)"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="player"
              options={{
                animation: 'slide_from_bottom',
                presentation: 'modal',
                gestureEnabled: true,
                headerShown: false,
              }}
            />
          </Stack>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </AudioProvider>
  );
}