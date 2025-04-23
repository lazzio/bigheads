import { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, PanResponder, AppState } from 'react-native';
import { Episode } from '../types/episode';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { audioManager, formatTime, AudioStatus } from '../utils/OptimizedAudioService';
import MaterialIcons from '@react-native-vector-icons/material-icons';

interface AudioPlayerProps {
  episode: Episode;
  onNext?: () => void;
  onPrevious?: () => void;
  onComplete?: () => void;
  onRetry?: () => void;
}

export default function AudioPlayer({ episode, onNext, onPrevious, onComplete, onRetry }: AudioPlayerProps) {
  const initialDurationMs = episode.duration ? episode.duration * 1000 : 0;

  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(initialDurationMs);
  const [isLoading, setIsLoading] = useState(true); // Start as loading
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const [sleepTimerActive, setSleepTimerActive] = useState(false);
  const [seekPosition, setSeekPosition] = useState<number | null>(null);
  const [seek, setSeek] = useState<number | null>(null);
  const sleepTimerId = useRef<NodeJS.Timeout | null>(null);

  const progressBarRef = useRef<View>(null);
  const progressWidth = useRef(0);
  const actualPlayerPosition = useRef(0); // Keep track of actual position from service

  // --- Effect to Reset State on Episode Change ---
  useEffect(() => {
    console.log(`[AudioPlayer] Episode ID changed to ${episode.id}, resetting state.`);
    setIsLoading(true); // Set loading true when episode changes
    setError(null);
    setPosition(0);
    actualPlayerPosition.current = 0;
    setDuration(episode.duration ? episode.duration * 1000 : 0);
    setIsPlaying(false);
    setIsBuffering(false); // Reset buffering state
    // Assuming parent calls audioManager.loadSound which triggers 'loaded' or 'status'
  }, [episode.id, episode.duration]);

  // --- Stable Callback for Sleep Timer End ---
  const handleSleepTimerEnd = useCallback(() => {
    console.log('[AudioPlayer] Sleep timer ended, pausing playback.');
    audioManager.pause();
    setSleepTimerActive(false);
    if (sleepTimerId.current) {
      clearTimeout(sleepTimerId.current);
      sleepTimerId.current = null;
    }
  }, []);

  // --- Effect to Manage Audio Listener ---
  useEffect(() => {
    let isMounted = true;
    console.log(`[AudioPlayer] Setting up listener for episode ${episode.id}`);

    const unsubscribe = audioManager.addListener((data: any) => {
      if (!isMounted) return;
      // Ignore events for other episodes
      if (data.episode?.id && data.episode.id !== episode.id) {
          console.log(`[AudioPlayer] Ignoring event for different episode: ${data.episode.id}`);
          return;
      }

      switch (data.type) {
        case 'loaded':
          console.log(`[AudioPlayer] Received 'loaded' for ${episode.id}`);
          if (data.episode?.id === episode.id) {
            // Directly set state based on loaded data
            if (data.duration > 0) {
              setDuration(data.duration);
            }
            setError(null);
            setIsLoading(false); // Set loading false here
            console.log(`[AudioPlayer] 'loaded' processed, isLoading=false, duration=${data.duration}`);
          }
          break;
        case 'status':
          // Update actual position ref
          actualPlayerPosition.current = data.position;

          // Update UI position only if not seeking
          if (!isSeeking) {
            setPosition(data.position);
          }

          // Update duration if valid and different
          if (data.duration > 0 && data.duration !== duration) {
            setDuration(data.duration);
          }

          // Update playing and buffering states directly
          setIsPlaying(data.isPlaying);
          setIsBuffering(data.isBuffering);

          // Update loading state: if we are loading and receive a valid status, stop loading
          if (isLoading && data.isLoaded && (data.duration > 0 || initialDurationMs > 0)) {
             console.log(`[AudioPlayer] 'status' processed while loading, isLoading=false, duration=${data.duration}`);
             setIsLoading(false);
          }

          // Clear error on valid status
          if (error) setError(null);
          break;
        case 'error':
          console.error(`[AudioPlayer] Received 'error': ${data.error}`);
          setError(data.error);
          setIsLoading(false); // Stop loading on error
          setIsPlaying(false);
          setIsBuffering(false);
          break;
        case 'finished':
          console.log('[AudioPlayer] Received finished, calling onComplete');
          // Use current duration state to set final position
          setPosition(duration > 0 ? duration : 0);
          actualPlayerPosition.current = duration > 0 ? duration : 0;
          setIsPlaying(false);
          setIsBuffering(false);
          if (onComplete) onComplete();
          if (sleepTimerActive) handleSleepTimerEnd();
          break;
        // Remote events trigger callbacks
        case 'remote-next': if (onNext) onNext(); break;
        case 'remote-previous': if (onPrevious) onPrevious(); break;
      }
    });

    // Cleanup
    return () => {
      console.log(`[AudioPlayer] Cleaning up listener for episode ${episode.id}`);
      isMounted = false;
      unsubscribe();
      if (sleepTimerId.current) clearTimeout(sleepTimerId.current);
    };
    // Dependencies: episode.id (filtering), isSeeking (conditional logic),
    // stable callbacks, and duration/isLoading/error for reading inside status handler (though direct set is used)
  }, [episode.id, isSeeking, onComplete, onNext, onPrevious, sleepTimerActive, handleSleepTimerEnd, duration, isLoading, error, initialDurationMs]);


  // --- PanResponder for Seeking (Logique inchangée, dépend de isSeeking, setPosition, audioManager.seekTo) ---
  const measureProgressBar = useCallback(() => {
    if (progressBarRef.current) {
      progressBarRef.current.measure((fx, fy, width, height, px, py) => {
        progressWidth.current = width;
      });
    }
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        if (duration <= 0) return; // Prevent seeking if duration is unknown
        setIsSeeking(true);
        measureProgressBar(); // Ensure width is up-to-date
        const touchX = evt.nativeEvent.locationX;
        const totalWidth = progressWidth.current;
        if (totalWidth > 0) {
          const clampedX = Math.max(0, Math.min(touchX, totalWidth));
          const percentage = clampedX / totalWidth;
          setSeekPosition(percentage * duration); // Update visual seek position
        }
      },
      onPanResponderMove: (evt) => {
        if (!isSeeking || duration <= 0) return;
        const touchX = evt.nativeEvent.locationX;
        const totalWidth = progressWidth.current;
        if (totalWidth > 0) {
          const clampedX = Math.max(0, Math.min(touchX, totalWidth));
          const percentage = clampedX / totalWidth;
          setSeekPosition(percentage * duration); // Update visual seek position
        }
      },
      onPanResponderRelease: (evt) => {
        if (!isSeeking || duration <= 0) return;
        
        const touchX = evt.nativeEvent.locationX;
        const totalWidth = progressWidth.current;
        let newPositionMillis = actualPlayerPosition.current; // Default to current actual position
        
        if (totalWidth > 0) {
          const clampedX = Math.max(0, Math.min(touchX, totalWidth));
          const percentage = clampedX / totalWidth;
          newPositionMillis = percentage * duration;
        }

        console.log(`[AudioPlayer] PanResponderRelease: Seeking to ${newPositionMillis}ms`);
        audioManager.seekTo(newPositionMillis); // Request seek from AudioManager

        // Important: Do NOT setPosition(newPositionMillis) here.
        // Let the 'status' event from AudioManager update the position state
        // after the seek is processed by TrackPlayer.

        // Reset seeking state
        setIsSeeking(false);
        setSeekPosition(null); // Clear visual seek position
      },
      onPanResponderTerminate: () => {
        // Handle interruption (e.g., call, modal)
        if (isSeeking) {
            console.log('[AudioPlayer] PanResponderTerminate: Seek cancelled.');
            setIsSeeking(false);
            setSeekPosition(null);
        }
      },
    })
  ).current;

  // --- Effect to Measure Progress Bar (inchangé) ---
  useEffect(() => {
    const timeoutId = setTimeout(measureProgressBar, 100);
    return () => clearTimeout(timeoutId);
  }, [measureProgressBar]);

  // --- Effect for App State Changes (Logique inchangée, dépend de isSeeking, setPosition etc.) ---
  useEffect(() => {
    const appStateSubscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        console.log('[AudioPlayer] App returned to foreground, refreshing player state');
        setTimeout(measureProgressBar, 200);

        audioManager.getStatusAsync().then(status => {
          if (progressBarRef.current && status.currentEpisodeId === episode.id) {
            console.log('[AudioPlayer] Updating UI with current playback state');
            actualPlayerPosition.current = status.positionMillis; // Mettre à jour la position réelle
            if (!isSeeking) { // Mettre à jour l'UI seulement si pas en seek
              setPosition(status.positionMillis);
            }
            setIsPlaying(status.isPlaying);
            setIsBuffering(status.isBuffering);
            if (status.durationMillis > 0) {
              setDuration(status.durationMillis);
            }
          }
        }).catch(err => console.error('[AudioPlayer] Error refreshing status:', err));
      }
    });

    return () => {
      appStateSubscription.remove();
    };
  }, [episode.id, measureProgressBar, isSeeking]); // isSeeking est nécessaire ici aussi


  // --- Action Handlers ---
  const handlePlayPause = useCallback(async () => {
    // Log current state before action
    console.log(`[AudioPlayer] handlePlayPause called. isPlaying=${isPlaying}, isLoading=${isLoading}, duration=${duration}, error=${error}`);

    // Prevent action if loading or if duration is invalid (unless it's 0 initially and we can fetch it)
    if (isLoading) {
        console.warn('[AudioPlayer] Play/Pause ignored: Still loading.');
        return;
    }
     if (error) {
        console.warn('[AudioPlayer] Play/Pause ignored: Error state.');
        // Optionally trigger retry here if needed, or rely on user clicking retry button
        // if (onRetry) onRetry();
        return;
    }

    try {
      if (isPlaying) {
        console.log('[AudioPlayer] Pausing...');
        await audioManager.pause();
        // AudioManager listener should update isPlaying state
      } else {
        console.log('[AudioPlayer] Attempting to play...');
        // Ensure duration is valid before playing
        let currentDuration = duration;
        if (currentDuration <= 0) {
            console.warn("[AudioPlayer] Duration is 0 or invalid, attempting to fetch status before play.");
            const status = await audioManager.getStatusAsync();
            if (status.durationMillis > 0) {
                console.log(`[AudioPlayer] Fetched duration: ${status.durationMillis}`);
                setDuration(status.durationMillis); // Update state
                currentDuration = status.durationMillis;
            } else {
                 console.error("[AudioPlayer] Cannot play: Failed to get valid duration.");
                 setError("Impossible de déterminer la durée de l'épisode.");
                 return; // Stop if duration is still invalid
            }
        }

        // Proceed to play only if duration is valid
        if (currentDuration > 0) {
            console.log('[AudioPlayer] Calling audioManager.play()');
            await audioManager.play();
            // AudioManager listener should update isPlaying state
        } else {
             console.error("[AudioPlayer] Cannot play: Duration is still invalid after check.");
             setError("Impossible de déterminer la durée de l'épisode.");
        }
      }
    } catch (err) {
      console.error("[AudioPlayer] Error during play/pause action:", err);
      setError(`Erreur lors de la ${isPlaying ? 'pause' : 'lecture'}.`);
      // Ensure states reflect failure
      setIsPlaying(false);
      setIsBuffering(false);
    }
  }, [isPlaying, duration, isLoading, error, onRetry]); // Dependencies for handlePlayPause

  const handleSeek = useCallback(async (offsetSeconds: number) => {
    console.log(`[AudioPlayer] handleSeek: ${offsetSeconds}s`);
    // No need to check isLoading here, seeking should be possible even if loading? Or maybe disable?
    // Let's allow seeking for now.
    await audioManager.seekRelative(offsetSeconds);
  }, []); // Stable

  const handleSkipAuditors = useCallback(async () => {
    console.log('[AudioPlayer] handleSkipAuditors');
    await audioManager.seekRelative(480);
  }, []); // Stable

  const toggleSleepTimer = useCallback(() => {
    if (sleepTimerActive) {
      if (sleepTimerId.current) {
        clearTimeout(sleepTimerId.current);
        sleepTimerId.current = null;
      }
      setSleepTimerActive(false);
      console.log('[AudioPlayer] Sleep timer cancelled.');
    } else {
      const timerDuration = 30 * 60 * 1000;
      sleepTimerId.current = setTimeout(handleSleepTimerEnd, timerDuration);
      setSleepTimerActive(true);
      console.log('[AudioPlayer] Sleep timer set for 30 minutes.');
    }
  }, [sleepTimerActive, handleSleepTimerEnd]); // Depends on state and stable callback


  // --- Rendering ---
  const displayedPosition = isSeeking && seekPosition !== null ? seekPosition : position;
  const progress = duration > 0 ? (displayedPosition / duration) * 100 : 0;
  const elapsedTime = formatTime(displayedPosition);
  const remainingTimeValue = Math.max(0, duration - displayedPosition);
  const remainingTime = formatTime(remainingTimeValue);

  // Rendu du chargement/erreur
  // Afficher le chargement TANT QUE isLoading est true ET qu'il n'y a pas d'erreur
  if ((isLoading && !error) || error) {
    return (
      <View style={[styles.container, styles.centered]}>
        {isLoading && !error && <ActivityIndicator size="large" color="#0ea5e9" />}
        {isLoading && !error && <Text style={styles.loadingText}>Chargement...</Text>}
        {error && <Text style={styles.errorText}>{error}</Text>}
        {error && onRetry && (
            <TouchableOpacity
              style={styles.retryButton}
              // Wrap onRetry to potentially clear error state as well
              onPress={() => { setError(null); setIsLoading(true); onRetry(); }}
            >
              <Text style={styles.retryText}>Réessayer</Text>
            </TouchableOpacity>
        )}
      </View>
    );
  }

  // Rendu principal du lecteur (structure inchangée)
  return (
    <GestureHandlerRootView style={styles.container}>
       {/* ... Title, Description ... */}
        <Text style={styles.title}>{episode.title}</Text>
        <Text style={styles.description} numberOfLines={2} ellipsizeMode="tail">
            {episode.description}
        </Text>

      {/* Barre de progression et temps */}
      <View style={styles.progressContainer}>
        <View
          ref={progressBarRef}
          style={styles.progressBarContainer}
          onLayout={(e) => { setTimeout(measureProgressBar, 10); }}
          {...panResponder.panHandlers}
        >
            <View style={styles.progressBackground} />
            <View style={[styles.progressBar, { width: `${progress}%` }]} />
            <View
              style={[
                styles.progressKnob,
                { left: `${progress}%` },
                { transform: [{ translateX: -8 }] },
                isSeeking && styles.progressKnobActive
              ]}
            />
        </View>
        <View style={styles.timeContainer}>
          <Text style={styles.timeText}>{elapsedTime}</Text>
          <Text style={styles.timeText}>-{remainingTime}</Text>
        </View>
      </View>

      {/* Contrôles */}
      <View style={styles.controls}>
         <TouchableOpacity onPress={onPrevious} style={styles.button} disabled={!onPrevious || isLoading}>
           <MaterialIcons name="skip-previous" color={onPrevious && !isLoading ? "#fff" : "#555"} size={42} />
         </TouchableOpacity>
         <TouchableOpacity onPress={() => handleSeek(-30)} style={styles.button} disabled={isLoading}>
           <MaterialIcons name="replay-30" color={!isLoading ? "#fff" : "#555"} size={42} />
         </TouchableOpacity>
         {/* Play/Pause Button: Disable while loading */}
         <TouchableOpacity onPress={handlePlayPause} style={[styles.button, styles.playButton]} disabled={isLoading}>
           {isBuffering ? ( <ActivityIndicator size="large" color="#fff" /> ) // Show buffering even if loading? Maybe not. Show only if !isLoading && isBuffering
             : isPlaying ? ( <MaterialIcons name="pause" color="#fff" size={48} /> )
             : ( <MaterialIcons name="play-arrow" color="#fff" size={48} /> )}
         </TouchableOpacity>
         <TouchableOpacity onPress={() => handleSeek(30)} style={styles.button} disabled={isLoading}>
           <MaterialIcons name="forward-30" color={!isLoading ? "#fff" : "#555"} size={42} />
         </TouchableOpacity>
         <TouchableOpacity onPress={onNext} style={styles.button} disabled={!onNext || isLoading}>
           <MaterialIcons name="skip-next" color={onNext && !isLoading ? "#fff" : "#555"} size={42} />
         </TouchableOpacity>
      </View>

      {/* Contrôles additionnels */}
      <View style={styles.additionalControls}>
          <TouchableOpacity onPress={handleSkipAuditors} style={styles.button} disabled={isLoading}>
            <MaterialIcons name="fast-forward" color={!isLoading ? "#fff" : "#555"} size={28} />
            <Text style={[styles.additionalControlText, isLoading && {color: "#555"}]}>Skip Auditeurs</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleSleepTimer} style={styles.button} disabled={isLoading}>
            <MaterialIcons name="timer" color={isLoading ? "#555" : sleepTimerActive ? "#0ea5e9" : "#fff"} size={28} />
             <Text style={[styles.additionalControlText, isLoading && {color: "#555"}, sleepTimerActive && !isLoading && styles.sleepTimerActiveText]}>
                {sleepTimerActive ? "Timer Actif" : "Sleep Timer"}
             </Text>
          </TouchableOpacity>
      </View>
    </GestureHandlerRootView>
  );
}

// --- Styles --- (inchangés)
const styles = StyleSheet.create({ 
    container: {
    flex: 1,
    justifyContent: 'flex-end', // Aligner en bas
    alignItems: 'center',
    padding: 20,
    paddingBottom: 40, // Plus de marge en bas
    backgroundColor: '#121212', // Fond sombre
  },
  centered: { // Pour centrer le contenu (loading/error)
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1,
  },
  loadingText: {
    marginTop: 10,
    color: '#fff',
    fontSize: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 15,
  },
  retryButton: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#0ea5e9',
    borderRadius: 5,
  },
  retryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  debugContainer: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 3,
    borderRadius: 3,
  },
  debugUrl: {
    color: '#aaa',
    fontSize: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: '#b3b3b3',
    textAlign: 'center',
    marginBottom: 30,
  },
  progressContainer: {
    width: '100%',
    marginBottom: 20,
  },
  progressBarContainer: {
    height: 20,
    justifyContent: 'center',
    width: '100%',
    // backgroundColor: 'rgba(255,0,0,0.1)', // Décommenter pour visualiser la zone tactile
  },
  progressBackground: {
    height: 4,
    backgroundColor: '#404040',
    borderRadius: 2,
    width: '100%',
    position: 'absolute', // Placé derrière la barre de progression
  },
  progressBar: {
    height: 4,
    backgroundColor: '#fff',
    borderRadius: 2,
  },
  progressKnob: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8, // Rond
    backgroundColor: '#fff',
    top: 2, // Centré verticalement ((20 - 16) / 2)
  },
  progressKnobActive: {
     backgroundColor: '#0ea5e9',
     // Agrandir légèrement et garder centré
     transform: [{ scale: 1.2 }, { translateX: -8 }],
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 5,
  },
  timeText: {
    color: '#b3b3b3',
    fontSize: 12,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
  },
  button: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    backgroundColor: '#0ea5e9',
    borderRadius: 40,
    width: 75,
    height: 75,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  additionalControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '80%',
    marginTop: 5,
  },
  additionalControlText: {
    color: '#fff',
    fontSize: 10,
    marginTop: 2,
  },
  sleepTimerActiveText: {
    color: '#0ea5e9',
  },
});