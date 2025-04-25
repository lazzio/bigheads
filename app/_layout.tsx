import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Slot, SplashScreen, useRouter } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { initEpisodeNotificationService, setupNotificationListener, syncPushTokenAfterLogin } from '../utils/EpisodeNotificationService';
import { triggerSync } from '../services/PlaybackSyncService';
import NetInfo from '@react-native-community/netinfo';
import * as Sentry from '@sentry/react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationProvider } from '../contexts/NavigationContext';
import TrackPlayer from 'react-native-track-player';
import { PlaybackService } from '../services/PlaybackService';

// Register the playback service right away
TrackPlayer.registerPlaybackService(() => PlaybackService);

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  const [isAppReady, setIsAppReady] = useState(false);
  const appMounted = useRef(true);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Auth state listener
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'SIGNED_IN') {
            await syncPushTokenAfterLogin();
            triggerSync();
          } else if (event === 'SIGNED_OUT') {
            router.replace('/auth/login');
          }
        });

        // Notification service
        try {
          await initEpisodeNotificationService();
          setupNotificationListener((episodeId) => {
            const navigateToPlayer = () => {
              router.navigate({
                pathname: '/(tabs)/player',
                params: {
                  episodeId,
                  source: 'notification',
                  timestamp: Date.now()
                }
              });
            };
            if (appMounted.current && isAppReady) {
              navigateToPlayer();
            } else {
              const readyCheckInterval = setInterval(() => {
                if (appMounted.current && isAppReady) {
                  clearInterval(readyCheckInterval);
                  navigateToPlayer();
                }
              }, 200);
              setTimeout(() => clearInterval(readyCheckInterval), 10000);
            }
          });
        } catch (notificationError) {
          Sentry.captureException(notificationError);
        }

        // Trigger initial sync after a delay
        setTimeout(triggerSync, 5000);

        // NetInfo listener for sync on reconnect
        const unsubscribeNetInfo = NetInfo.addEventListener(state => {
          if (state.isConnected && state.isInternetReachable) {
            triggerSync();
          }
        });

        // Hide splash screen
        try {
          await SplashScreen.hideAsync();
        } catch (error) {
          // Ignore
        }

        if (appMounted.current) setIsAppReady(true);

        // Cleanup
        return () => {
          appMounted.current = false;
          subscription?.unsubscribe?.();
          unsubscribeNetInfo?.();
        };
      } catch (error) {
        Sentry.captureException(error);
      }
    };

    initializeApp();

    // Cleanup on unmount
    return () => {
      appMounted.current = false;
    };
  }, [router]);

  // Sync on app foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState === 'active') {
        triggerSync();
      }
    });
    return () => subscription.remove();
  }, []);

  if (!isAppReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationProvider>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <Slot />
        </SafeAreaProvider>
      </NavigationProvider>
    </GestureHandlerRootView>
  );
}