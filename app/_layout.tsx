import { useEffect, useRef, useState } from 'react';
import { Slot, SplashScreen, useRouter } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { initEpisodeNotificationService, setupNotificationListener, syncPushTokenAfterLogin } from '../utils/EpisodeNotificationService';
import NetInfo from '@react-native-community/netinfo';
import * as Sentry from '@sentry/react-native';
import { StatusBar } from 'expo-status-bar';
import { cleanupStaleLocalPositions } from '../utils/LocalPositionCleanupService';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Main layout component
export default function RootLayout() {
  const router = useRouter();
  const [isAppReady, setIsAppReady] = useState(false);
  const appMounted = useRef(true);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Écouter les changements d'état d'authentification
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          console.log('Auth state changed:', event);
          if (event === 'SIGNED_IN') {
            // Tenter de synchroniser le token push après connexion réussie
            await syncPushTokenAfterLogin();
            // Optionnel: rediriger si nécessaire, mais Tabs gère déjà cela
            // router.replace('/(tabs)');
          } else if (event === 'SIGNED_OUT') {
            // Rediriger vers l'écran de connexion
            router.replace('/auth/login');
          }
        });

        // Initialiser le service de notification
        try {
          await initEpisodeNotificationService();
          // Configurer l'écouteur pour la navigation
          setupNotificationListener((episodeId) => {
            console.log(`[NotificationHandler] Received notification for episode ${episodeId}`);
            
            // Navigation vers l'écran player
            const navigateToPlayer = () => {
              console.log('[NotificationHandler] Navigating to player tab');
              router.navigate({
                pathname: '/(tabs)/player',
                params: { 
                  episodeId: episodeId, 
                  source: 'notification',
                  timestamp: Date.now() // Add timestamp to force refresh
                }
              });
            };

            // Si l'app est prête, naviguer immédiatement
            if (appMounted.current && isAppReady) {
              navigateToPlayer();
            } else {
              // Sinon, attendre que l'app soit prête et naviguer ensuite
              console.log('[NotificationHandler] App not ready, waiting...');
              const readyCheckInterval = setInterval(() => {
                if (appMounted.current && isAppReady) {
                  console.log('[NotificationHandler] App now ready, navigating...');
                  clearInterval(readyCheckInterval);
                  navigateToPlayer();
                }
              }, 200);
              
              // Arrêter de vérifier après 10 secondes pour éviter une boucle infinie
              setTimeout(() => clearInterval(readyCheckInterval), 10000);
            }
          });

          // Check for last requested episode from killed state
          const checkLastRequestedEpisode = async () => {
            try {
              const lastEpisodeId = await AsyncStorage.getItem('lastRequestedEpisodeId');
              if (lastEpisodeId) {
                console.log(`[Layout] Found last requested episode ${lastEpisodeId}, clearing and navigating`);
                // Clear it so we don't keep reopening the same episode
                await AsyncStorage.removeItem('lastRequestedEpisodeId');
                
                // Navigate to player with this episode
                router.navigate({
                  pathname: '/(tabs)/player',
                  params: { 
                    episodeId: lastEpisodeId, 
                    source: 'notification',
                    timestamp: Date.now()
                  }
                });
              }
            } catch (error) {
              console.error('[Layout] Error checking last requested episode:', error);
            }
          };
          
          // Check after app is ready with a small delay
          setTimeout(checkLastRequestedEpisode, 1000);

          console.log('Episode notification service initialized');
        } catch (notificationError) {
          console.error('Error initializing episode notification service:', notificationError);
          Sentry.captureException(notificationError);
        }

        // Configurer l'écouteur NetInfo pour la synchro hors ligne (si nécessaire)
        const unsubscribeNetInfo = NetInfo.addEventListener(state => {
          if (state.isConnected && state.isInternetReachable) {
            console.log('Device is online, syncing playback state...');
          }
        });

        // Cacher l'écran de démarrage
        try {
          await SplashScreen.hideAsync();
        } catch (error) {
          console.warn('SplashScreen.hideAsync failed:', error);
        }

        // Marquer l'application comme prête
        if (appMounted.current) {
          console.log('[RootLayout] App is now ready.');
          setIsAppReady(true);
        }
      } catch (error) {
        console.error('Initialization error:', error);
        Sentry.captureException(error);
      }
    };

    initializeApp();

    // Cleanup remaining positions of episodes that are no longer available
    cleanupStaleLocalPositions();

    // Nettoyage au démontage
    return () => {
      appMounted.current = false;
    };
  }, []);

  // Afficher Slot seulement quand l'app est prête pour éviter les flashs
  if (!isAppReady) {
    console.log('[RootLayout] App not ready, rendering null.');
    return null; // Ou retourner un écran de chargement minimal si SplashScreen.hideAsync a échoué
  }

  console.log('[RootLayout] App is ready, rendering Slot.');
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: 'black' }}>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor="#000000" />
        <Slot />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}