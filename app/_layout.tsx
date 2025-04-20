import { useEffect, useRef, useState } from 'react';
import { Slot, SplashScreen, useRouter } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { initEpisodeNotificationService, setupNotificationListener, syncPushTokenAfterLogin } from '../utils/EpisodeNotificationService';
import { initializePlaybackSync } from '../utils/PlaybackSyncService';
import NetInfo from '@react-native-community/netinfo';
import * as Sentry from '@sentry/react-native';
import { StatusBar } from 'expo-status-bar';

// Configuration Sentry (si pas déjà faite ailleurs)
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  debug: process.env.NODE_ENV === 'development',
});

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Main layout component
export default function RootLayout() {
  const router = useRouter();
  const [isAppReady, setIsAppReady] = useState(false);
  const appMounted = useRef(true); // Pour éviter les mises à jour après démontage

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
            if (appMounted.current) {
              console.log(`[RootLayout] Notification received, navigating to episode: ${episodeId}`);
              // --- MODIFICATION ICI ---
              router.push({
                pathname: '/player', // Chemin cible
                params: { episodeId: episodeId }, // Paramètres
              });
              // --- FIN MODIFICATION ---
            }
          });
          console.log('Episode notification service initialized');
        } catch (notificationError) {
          console.error('Error initializing episode notification service:', notificationError);
          Sentry.captureException(notificationError);
        }

        // Initialiser la synchronisation de la position de lecture
        const cleanupSync = initializePlaybackSync();

        // Configurer l'écouteur NetInfo pour la synchro hors ligne (si nécessaire)
        const unsubscribeNetInfo = NetInfo.addEventListener(state => {
          if (state.isConnected && state.isInternetReachable) {
            // syncOfflineWatchedEpisodes().catch(err => console.error('Failed to sync offline watched episodes:', err));
            // La synchro est déjà gérée par PlaybackSyncService, pas besoin ici a priori
          }
        });

        // Cacher l'écran de démarrage
        try {
          await SplashScreen.hideAsync();
        } catch (error) {
          console.log('SplashScreen hide failed (might be normal):', error);
        }

        // Marquer l'application comme prête
        if (appMounted.current) {
          setIsAppReady(true);
        }
      } catch (error) {
        console.error('Initialization error:', error);
        Sentry.captureException(error);
        // Gérer l'erreur d'initialisation si nécessaire
      }
    };

    initializeApp();

    // Nettoyage au démontage
    return () => {
      appMounted.current = false;
      // Désinscription des écouteurs (si nécessaire, géré par les services eux-mêmes?)
      // subscription?.unsubscribe(); // Supabase auth listener
      // unsubscribeNetInfo?.(); // NetInfo listener
      // cleanupSync(); // Playback sync listener
    };
  }, []); // Exécuter une seule fois au montage

  // Afficher Slot seulement quand l'app est prête pour éviter les flashs
  if (!isAppReady) {
    return null; // Ou retourner un écran de chargement minimal si SplashScreen.hideAsync a échoué
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Slot />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}