import React, { useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, AppState, AppStateStatus, BackHandler, ActivityIndicator, Platform, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { PlayerProvider } from '../../contexts/PlayerContext';
import { usePlayerState } from '../../hooks/usePlayerState';
import { useEpisodeData } from '../../hooks/useEpisodeData';
import { useAudioManager } from '../../hooks/useAudioManager';
import { AudioPlayerUI } from '../../components/player/AudioPlayerUI';
import { Episode } from '../../types/episode';
import { theme } from '../../styles/global';
import { triggerSync } from '../../services/PlaybackSyncService';
import NetInfo from '@react-native-community/netinfo';
import TrackPlayer from 'react-native-track-player';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Main component wrapped with Provider
const PlayerScreenContent: React.FC = () => {
  const { episodeId, offlinePath, position: positionParam, autoplay } =
    useLocalSearchParams<{ 
      episodeId?: string; 
      offlinePath?: string; 
      position?: string;
      autoplay?: string; 
    }>();
  const router = useRouter();

  // Get state and actions from context
  const {
    currentEpisode,
    episodes,
    currentIndex,
    isPlaying,
    isBuffering,
    isLoading: isLoadingContext, // Renamed to avoid conflict
    position,
    duration,
    playbackPositions,
    isOffline,
    error,
    sleepTimerActive,
    actions,
  } = usePlayerState();

  // Hooks for data fetching and audio management
  const { loadData, isLoadingData, getOfflineEpisodeDetails } = useEpisodeData();
  const {
    loadTrack,
    playAudio,
    pauseAudio,
    seekTo,
    seekRelative,
    skipToNext,
    skipToPrevious,
    saveCurrentPosition, // Get save function
  } = useAudioManager();

  const appStateRef = useRef(AppState.currentState);
  const isInitialLoadRef = useRef(true);

  // Ajout d'un ref pour savoir si on a déjà traité les params de notification
  const notificationParamsConsumedRef = useRef(false);

  // 1. Sauvegarde l'épisode courant, la position et l'état de lecture à chaque changement
  useEffect(() => {
    if (currentEpisode && typeof position === 'number') {
      AsyncStorage.setItem('lastPlayedEpisodeId', currentEpisode.id);
      AsyncStorage.setItem('lastPlayedPosition', position.toString());
      AsyncStorage.setItem('wasPlaying', isPlaying ? 'true' : 'false');
    }
  }, [currentEpisode?.id, position, isPlaying]);

  // 2. Applique la position demandée par la notification (si différente de la position actuelle)
  useEffect(() => {
    if (
      !notificationParamsConsumedRef.current &&
      currentEpisode &&
      positionParam &&
      !isLoadingContext &&
      !isBuffering
    ) {
      const requestedPosition = Number(positionParam);
      if (
        !isNaN(requestedPosition) &&
        Math.abs(requestedPosition - position) > 1 // Tolérance 1s
      ) {
        seekTo(requestedPosition);
      }
    }
  }, [currentEpisode?.id, positionParam, isLoadingContext, isBuffering, seekTo, position]);

  // 3. Relance la lecture automatiquement si demandé par la notification
  useEffect(() => {
    if (
      !notificationParamsConsumedRef.current &&
      currentEpisode &&
      autoplay === '1' &&
      !isPlaying &&
      !isLoadingContext &&
      !isBuffering
    ) {
      playAudio();
    }
  }, [currentEpisode?.id, autoplay, isPlaying, isLoadingContext, isBuffering, playAudio]);

  // 4. Logique de sélection d'épisode : priorise l'ID passé en paramètre
  useEffect(() => {
    const determineAndLoad = async () => {
      let episodeToLoad = null;
      let targetIndex = -1;
      let initialPosition = 0;

      // Priority 1: Offline Path
      if (offlinePath) {
        const offlineEpisode = await getOfflineEpisodeDetails(offlinePath);
        if (offlineEpisode) {
          const existingIndex = episodes.findIndex((ep: Episode) => ep.id === offlineEpisode.id);
          if (existingIndex !== -1) {
            episodeToLoad = episodes[existingIndex];
            targetIndex = existingIndex;
            if (!episodeToLoad.offline_path) episodeToLoad.offline_path = offlinePath;
          } else {
            episodeToLoad = offlineEpisode;
            targetIndex = 0;
            actions.setEpisodes([offlineEpisode]);
          }
        }
      }

      // Priority 2: Episode ID from params (si pas d'offlinePath)
      if (!episodeToLoad && episodeId) {
        targetIndex = episodes.findIndex((ep: Episode) => ep.id === episodeId);
        if (targetIndex !== -1) {
          episodeToLoad = episodes[targetIndex];
        }
      }

      // Priority 3: Default to first episode (if list is not empty)
      if (!episodeToLoad && episodes.length > 0) {
        targetIndex = 0;
        episodeToLoad = episodes[0];
      }

      // Toujours charger l'épisode si episodeId ou offlinePath changent, même si currentEpisode est déjà défini
      if (episodeToLoad) {
        // Si on change d'épisode ou de offlinePath, on recharge
        const shouldForceChange =
          !currentEpisode ||
          currentEpisode.id !== episodeToLoad.id ||
          (offlinePath && episodeToLoad.offline_path !== offlinePath);

        if (shouldForceChange) {
          actions.setCurrentEpisode(episodeToLoad, targetIndex);
          // Si position demandée en paramètre, on la prend, sinon on prend la dernière connue
          initialPosition =
            positionParam && !isNaN(Number(positionParam))
              ? Number(positionParam)
              : playbackPositions.get(episodeToLoad.id) || 0;
          await loadTrack(episodeToLoad, initialPosition);

          // Marquer les params de notification comme "consommés" après le premier vrai chargement
          if (!notificationParamsConsumedRef.current && (episodeId || positionParam || autoplay)) {
            notificationParamsConsumedRef.current = true;
            // Optionnel : nettoyer l'URL pour éviter de repasser les params (si possible)
            // router.replace('/(tabs)/player');
          }
        } else {
          actions.setPlaybackState({ isLoading: false });
        }
      } else if (!isLoadingData) {
        if (!error) actions.setError("Aucun épisode à charger.");
        actions.setPlaybackState({ isLoading: false });
      }
    };

    determineAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    episodeId,
    offlinePath,
    episodes,
    playbackPositions,
    isLoadingData,
    loadTrack,
    actions,
    getOfflineEpisodeDetails,
    currentEpisode,
    error,
    positionParam, // Ajouté pour forcer le rechargement si la position change
    autoplay,
  ]);

   // --- Effect for Handling Episode Change via Context ---
   useEffect(() => {
       const loadChangedTrack = async () => {
           // If the currentEpisode in context changes (and it's not the initial load determination)
           // load the new track.
           const activeTrack = await TrackPlayer.getActiveTrack(); // Await the promise
           if (!isInitialLoadRef.current && currentEpisode && currentEpisode.id !== activeTrack?.id) {
               console.log(`[PlayerScreen] Context episode changed to: ${currentEpisode.title}. Loading track.`);
               const startPosition = playbackPositions.get(currentEpisode.id) || 0;
               await loadTrack(currentEpisode, startPosition); // Await loadTrack if it's async
           }
       };

       loadChangedTrack(); // Call the async function

   }, [currentEpisode, loadTrack, playbackPositions]);


  // --- App State Handling ---
  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        console.log('[PlayerScreen] App has come to the foreground.');
        // Check network status and trigger sync on returning
        const networkState = await NetInfo.fetch();
        actions.setIsOffline(!networkState.isConnected);
        if (networkState.isConnected) {
          triggerSync();
        }
      } else if (
        appStateRef.current === 'active' &&
        nextAppState.match(/inactive|background/)
      ) {
        console.log('[PlayerScreen] App is going to background.');
        // Save current position immediately
        if (currentEpisode && position > 0) {
          saveCurrentPosition(position); // Use the function from useAudioManager
        }
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
      // Save position on unmount as well
      if (currentEpisode && position > 0) {
         saveCurrentPosition(position);
      }
    };
  }, [actions, currentEpisode, position, saveCurrentPosition]); // Add dependencies

  // --- Back Button Handling ---
  useEffect(() => {
    const backAction = () => {
      // Navigate back, PlayerProvider might unmount, triggering position save via AppState effect
      router.back();
      return true; // Prevent default behavior (exiting app)
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction
    );

    return () => backHandler.remove();
  }, [router]);


  // --- UI Event Handlers ---
  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      pauseAudio();
    } else {
      playAudio();
    }
  }, [isPlaying, playAudio, pauseAudio]);

  const handleRetry = useCallback(() => {
      isInitialLoadRef.current = true; // Allow re-determination on retry
      actions.setError(null); // Clear error
      loadData(); // Reload all data
  }, [loadData, actions]);

  const handleNext = useCallback(async () => {
      // Save position before skipping
      if (currentEpisode && position > 0) {
          await saveCurrentPosition(position);
      }
      skipToNext(); // Let useAudioManager handle context update
  }, [skipToNext, currentEpisode, position, saveCurrentPosition]);

  const handlePrevious = useCallback(async () => {
      // Save position before skipping
      if (currentEpisode && position > 0) {
          await saveCurrentPosition(position);
      }
      skipToPrevious(); // Let useAudioManager handle context update
  }, [skipToPrevious, currentEpisode, position, saveCurrentPosition]);


  // --- Render Logic ---
  const showLoadingIndicator = isLoadingContext || (isLoadingData && isInitialLoadRef.current);

  if (showLoadingIndicator) {
    return (
      <View style={[styles.container, styles.centerContent, { backgroundColor: theme.colors.primaryBackground }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.statusText}>Chargement...</Text>
      </View>
    );
  }

  // Prioritize global error state from context
  if (error && !currentEpisode) { // Show global error only if no episode is loaded
    return (
      <View style={[styles.container, styles.centerContent]}>
        <MaterialIcons name="error-outline" size={48} color={theme.colors.error} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={handleRetry} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Handle case where loading finished but no episodes are available
  if (!currentEpisode && !showLoadingIndicator && !error) {
       return (
         <View style={[styles.container, styles.centerContent]}>
           <MaterialIcons name="hourglass-empty" size={48} color={theme.colors.description} />
           <Text style={styles.statusText}>Aucun épisode disponible</Text>
           {isOffline && (
             <Text style={styles.offlineText}>Mode hors ligne</Text>
           )}
           <TouchableOpacity onPress={handleRetry} style={styles.retryButton}>
             <Text style={styles.retryButtonText}>Actualiser</Text>
           </TouchableOpacity>
         </View>
       );
  }


  return (
    <LinearGradient
      colors={[theme.colors.gradientStart, theme.colors.gradientEnd]}
      style={styles.container}
    >
      {isOffline && (
        <View style={styles.offlineBanner}>
          <MaterialIcons name="signal-wifi-off" size={16} color={theme.colors.text} />
          <Text style={styles.offlineBannerText}>Mode hors ligne</Text>
        </View>
      )}
      {/* Pass necessary state and callbacks to the UI component */}
      <AudioPlayerUI
        episode={currentEpisode}
        isPlaying={isPlaying}
        isBuffering={isBuffering}
        isLoading={isLoadingContext} // Pass context loading state
        position={position}
        duration={duration}
        error={error} // Pass potential playback errors from context
        sleepTimerActive={sleepTimerActive}
        onPlayPause={handlePlayPause}
        onSeek={seekTo}
        onSeekRelative={seekRelative}
        onNext={handlePrevious}
        onPrevious={handleNext}
        onToggleSleepTimer={actions.toggleSleepTimer}
        onRetry={handleRetry} // Pass retry for UI-level errors
      />
    </LinearGradient>
  );
};

// Wrap the content component with the Provider
const PlayerScreen: React.FC = () => (
  <PlayerProvider>
    <PlayerScreenContent />
  </PlayerProvider>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // Padding is handled by AudioPlayerUI now
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  offlineBanner: {
    backgroundColor: theme.colors.borderColor,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20, // Adjust based on status bar height
    left: 20,
    right: 20,
    borderRadius: 8,
    zIndex: 10,
    gap: 6,
  },
  offlineBannerText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
  statusText: {
    color: theme.colors.description, // Use description color for status
    marginTop: 15,
    fontSize: 16,
  },
   offlineText: {
      color: theme.colors.secondaryDescription,
      marginTop: 8,
      fontSize: 14,
   },
  errorText: {
    color: theme.colors.error,
    marginTop: 15,
    textAlign: 'center',
    fontSize: 16,
    paddingHorizontal: 20,
  },
  retryButton: {
    marginTop: 25,
    backgroundColor: theme.colors.borderColor,
    paddingVertical: 10,
    paddingHorizontal: 25,
    borderRadius: 8,
  },
  retryButtonText: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
});

export default PlayerScreen;