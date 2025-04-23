import { useEffect, useState, useRef, useCallback } from 'react'; // Added useCallback
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator, BackHandler, Alert, PanResponder, GestureResponderEvent, LayoutChangeEvent, AppState } from 'react-native'; // Added LayoutChangeEvent and AppState
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
  const [isLoading, setIsLoading] = useState(true); // Start loading when component mounts or episode changes
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const [sleepTimerActive, setSleepTimerActive] = useState(false);
  const sleepTimerId = useRef<NodeJS.Timeout | null>(null);

  const progressBarRef = useRef<View>(null);
  const progressWidth = useRef(0);
  const progressPosition = useRef(0); // X position of the progress bar on screen

  // --- Listener Setup Effect ---
  useEffect(() => {
    let isMounted = true;
    // Set loading to true ONLY when the episode ID changes, indicating a new load sequence.
    setIsLoading(true);
    setError(null);
    setPosition(0); // Reset position when episode changes
    setDuration(episode.duration ? episode.duration * 1000 : 0); // Reset duration
    setIsPlaying(false); // Ensure not playing initially
    setIsBuffering(false); // Ensure not buffering initially

    console.log(`[AudioPlayer] useEffect for episode ${episode.id}, setting isLoading=true`);

    const unsubscribe = audioManager.addListener((data: any) => {
      if (!isMounted) return;

      // console.log('[AudioPlayer] Received data:', data.type, data); // Debugging

      switch (data.type) {
        case 'loaded':
          console.log(`[AudioPlayer] Received 'loaded' for ${data.episode?.id}. Current episode: ${episode.id}`);
          // Ensure this 'loaded' event corresponds to the current episode
          if (data.episode?.id === episode.id) {
            if (data.duration > 0) {
              setDuration(data.duration);
            }
            setError(null);
            setIsLoading(false); // Set loading false on successful load
            console.log(`[AudioPlayer] 'loaded' event processed, isLoading=false`);
          }
          break;
        case 'status':
          // Only process status if it's for the currently loaded episode
          // Check against the episode ID potentially included in the status data
          // Note: This assumes 'data.episode.id' is provided by audioManager in the 'status' event.
          // If not, this check might need adjustment or removal depending on audioManager's behavior.
          if (data.episode?.id && data.episode.id !== episode.id) {
              console.log(`[AudioPlayer] Ignoring status for different episode: ${data.episode.id}`);
              break;
          }

          // Update position only if not actively seeking
          if (!isSeeking) {
            setPosition(data.position);
          }
          // Update duration if it's valid and different
          if (data.duration > 0 && data.duration !== duration) {
            setDuration(data.duration);
          }
          // Update playing and buffering states
          setIsPlaying(data.isPlaying);
          // Make buffering check slightly more robust
          setIsBuffering(data.isBuffering || (data.isPlaying && data.duration > 0 && data.position >= data.duration - 500)); // Also consider buffering near the end

          // If still loading, check if we have enough info to stop loading
          // Check against data.duration OR the initialDurationMs from the episode prop
          if (isLoading && data.isLoaded && (data.duration > 0 || initialDurationMs > 0)) {
             console.log(`[AudioPlayer] 'status' event processed while loading, setting isLoading=false`);
             setIsLoading(false);
          }
          // Clear error on valid status update
          if (error) setError(null); // Clear error only if it was previously set
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
          // Set position to the end, ensure isPlaying is false
          setPosition(duration > 0 ? duration : 0);
          setIsPlaying(false);
          setIsBuffering(false);
          if (onComplete) onComplete();
          if (sleepTimerActive) handleSleepTimerEnd();
          break;
        // Remote events don't change internal state directly, they trigger actions
        case 'remote-next':
          if (onNext) onNext();
          break;
        case 'remote-previous':
          if (onPrevious) onPrevious();
          break;
      }
    });

    // Cleanup function
    return () => {
      console.log(`[AudioPlayer] Cleaning up effect for episode ${episode.id}`);
      isMounted = false;
      unsubscribe();
      if (sleepTimerId.current) {
        clearTimeout(sleepTimerId.current);
      }
    };
  // --- DEPENDENCY CHANGE: Only re-run when the episode ID changes ---
  }, [episode.id]); // Removed onComplete, onNext, onPrevious, isSeeking, sleepTimerActive

  // --- PanResponder for Seeking ---
  // Use useCallback to memoize measureProgressBar
  const measureProgressBar = useCallback(() => {
    if (progressBarRef.current) {
      progressBarRef.current.measure((fx, fy, width, height, px, py) => {
        console.log(`[AudioPlayer] Measured progress bar - Width: ${width}, X: ${px}`); // Debug measurement
        progressWidth.current = width;
        progressPosition.current = px; // Store the X offset of the bar itself
      });
    }
  }, []); // No dependencies needed

  // Enhance PanResponder with better touch coordinate handling
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true, // Allow seeking
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, gestureState) => {
        console.log('[AudioPlayer] PanResponder Grant: isSeeking=true');
        setIsSeeking(true);
        measureProgressBar(); // Force measurement update
        
        // Calculate position immediately on tap for instant feedback
        const touchX = evt.nativeEvent.pageX;
        setTimeout(() => {
          const totalWidth = progressWidth.current;
          if (totalWidth > 0) {
            const touchXRelativeToBar = touchX - progressPosition.current;
            const clampedX = Math.max(0, Math.min(touchXRelativeToBar, totalWidth));
            const percentage = clampedX / totalWidth;
            const newPosition = percentage * duration;
            setPosition(newPosition);
          }
        }, 50); // Small delay to ensure measurement completes
      },
      onPanResponderMove: (evt, gestureState) => {
        if (!isSeeking) return;
        
        const touchX = evt.nativeEvent.pageX;
        const totalWidth = progressWidth.current;
        
        // Only process if we have valid measurements
        if (totalWidth > 0 && duration > 0) {
          const touchXRelativeToBar = touchX - progressPosition.current;
          const clampedX = Math.max(0, Math.min(touchXRelativeToBar, totalWidth));
          const percentage = clampedX / totalWidth;
          const newPosition = percentage * duration;
          setPosition(newPosition);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (!isSeeking) return;
        console.log('[AudioPlayer] PanResponder Release');
        
        const touchX = evt.nativeEvent.pageX;
        const totalWidth = progressWidth.current;
        
        // Only seek if we have valid measurements
        if (totalWidth > 0 && duration > 0) {
          const touchXRelativeToBar = touchX - progressPosition.current;
          const clampedX = Math.max(0, Math.min(touchXRelativeToBar, totalWidth));
          const percentage = clampedX / totalWidth;
          const seekPositionMillis = percentage * duration;
          
          console.log(`[AudioPlayer] Seeking to ${seekPositionMillis}ms (${(percentage * 100).toFixed(1)}%)`);
          
          // Perform the actual seek
          audioManager.seekTo(seekPositionMillis);
        }
        
        // Reset seeking state after a short delay
        setTimeout(() => {
          if (isSeeking) {
            console.log('[AudioPlayer] Resetting isSeeking=false after release');
            setIsSeeking(false);
          }
        }, 50);
      },
      onPanResponderTerminate: (evt, gestureState) => {
        console.log('[AudioPlayer] PanResponder Terminate: Resetting isSeeking=false');
        setIsSeeking(false);
      },
    })
  ).current;

  // Ensure measurement happens on initial layout
  useEffect(() => {
    const timeoutId = setTimeout(measureProgressBar, 100);
    return () => clearTimeout(timeoutId);
  }, [measureProgressBar]);

  // --- Action Handlers (Wrapped in useCallback) ---
  const handlePlayPause = useCallback(async () => {
    console.log(`[AudioPlayer] handlePlayPause. Current state: isPlaying=${isPlaying}`);
    try {
      if (isPlaying) {
        await audioManager.pause();
      } else {
        let currentDuration = duration;
        if (currentDuration <= 0) {
            console.warn("[AudioPlayer] Duration is 0, fetching status before play.");
            const status = await audioManager.getStatusAsync();
            currentDuration = status.durationMillis;
            if (currentDuration > 0) setDuration(currentDuration);
        }

        if (currentDuration > 0) {
            await audioManager.play();
        } else {
            console.error("[AudioPlayer] Cannot play: Duration is still 0.");
            setError("Impossible de déterminer la durée de l'épisode.");
        }
      }
    } catch (err) {
      console.error("[AudioPlayer] Error playing/pausing:", err);
      setError('Erreur lors de la lecture/pause.');
    }
  }, [isPlaying, duration]); // Dependencies: isPlaying, duration

  const handleSeek = useCallback(async (offsetSeconds: number) => {
    console.log(`[AudioPlayer] handleSeek: ${offsetSeconds}s`);
    await audioManager.seekRelative(offsetSeconds);
  }, []); // No dependencies needed

  const handleSkipAuditors = useCallback(async () => {
    console.log('[AudioPlayer] handleSkipAuditors');
    await audioManager.seekRelative(480);
  }, []); // No dependencies needed

  // --- Sleep Timer (Wrapped in useCallback) ---
  const handleSleepTimerEnd = useCallback(() => {
    console.log('[AudioPlayer] Sleep timer ended, pausing playback.');
    audioManager.pause();
    setSleepTimerActive(false);
    if (sleepTimerId.current) {
      clearTimeout(sleepTimerId.current);
      sleepTimerId.current = null;
    }
  }, []); // No dependencies needed

  const toggleSleepTimer = useCallback(() => {
    setSleepTimerActive(prev => {
        const nextState = !prev;
        if (nextState) {
            console.log('[AudioPlayer] Sleep timer activated (pause at end of episode).');
            // No timeout needed, handled by 'finished' event
        } else {
            console.log('[AudioPlayer] Sleep timer cancelled.');
            if (sleepTimerId.current) {
                clearTimeout(sleepTimerId.current);
                sleepTimerId.current = null;
            }
        }
        return nextState;
    });
  }, []); // No dependencies needed

  // Add an effect to handle app state changes
  useEffect(() => {
    const appStateSubscription = AppState.addEventListener('change', nextAppState => {
      // When app comes to foreground
      if (nextAppState === 'active') {
        console.log('[AudioPlayer] App returned to foreground, refreshing player state');
        
        // Force measurement update for progress bar
        setTimeout(measureProgressBar, 200);
        
        // Re-sync with TrackPlayer state
        audioManager.getStatusAsync().then(status => {
          if (status.isLoaded && status.currentEpisodeId === episode.id) {
            console.log('[AudioPlayer] Updating UI with current playback state');
            if (!isSeeking) {
              setPosition(status.positionMillis);
            }
            setIsPlaying(status.isPlaying);
            setIsBuffering(status.isBuffering);
          }
        }).catch(err => console.error('[AudioPlayer] Error refreshing status:', err));
      }
    });
    
    return () => {
      appStateSubscription.remove();
    };
  }, [episode.id, measureProgressBar, isSeeking]);

  // --- Rendering ---
  const progress = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0; // Ensure progress is between 0 and 100
  const remainingTime = duration > 0 && position >= 0 ? Math.max(0, duration - position) : 0;

  // Loading State UI
  if (isLoading) {
    console.log('[AudioPlayer] Rendering Loading State');
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0ea5e9" />
        <Text style={styles.loadingText}>Chargement de l'épisode...</Text>
      </View>
    );
  }

  // Error State UI
  if (error) {
    console.log(`[AudioPlayer] Rendering Error State: ${error}`);
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
        {onRetry && (
            <TouchableOpacity
              style={styles.retryButton}
              onPress={onRetry}
            >
              <Text style={styles.retryText}>Réessayer</Text>
            </TouchableOpacity>
        )}
        <View style={styles.debugContainer}>
          <Text style={styles.debugUrl} numberOfLines={3} ellipsizeMode="middle">
            URL: {episode?.mp3Link || episode?.offline_path || "Non définie"}
          </Text>
          <Text style={styles.debugUrl}>
            Source: {episode?.offline_path ? "Fichier local" : "URL distante"}
          </Text>
        </View>
      </View>
    );
  }

  // Main Player UI
  return (
    <GestureHandlerRootView style={styles.container}>
      <Text style={styles.title}>{episode.title}</Text>
      <Text style={styles.description} numberOfLines={2} ellipsizeMode="tail">
        {episode.description}
      </Text>

      {/* Progress Bar and Time */}
      <View style={styles.progressContainer}>
        {/* Measure the bar on layout */}
        <View 
          ref={progressBarRef} 
          style={styles.progressBarContainer} 
          onLayout={(e) => {
            // Update measurements whenever layout changes
            setTimeout(measureProgressBar, 10);
          }}
          {...panResponder.panHandlers}
        >
            <View style={styles.progressBackground} />
            <View style={[styles.progressBar, { width: `${progress}%` }]} />
            <View
              style={[
                styles.progressKnob,
                // Calculate left position based on progress percentage
                { left: `${progress}%` },
                // Translate knob slightly left to center it on the progress line end
                { transform: [{ translateX: -8 }] }, // Half the knob width (16/2)
                isSeeking && styles.progressKnobActive // Apply seeking style
              ]}
            />
        </View>

        <View style={styles.timeContainer}>
          <Text style={styles.timeText}>{formatTime(position)}</Text>
          <Text style={styles.timeText}>-{formatTime(remainingTime)}</Text>
        </View>
      </View>

      {/* Playback Controls */}
      <View style={styles.controls}>
         <TouchableOpacity onPress={onPrevious} style={styles.button} disabled={!onPrevious}>
           <MaterialIcons name="skip-previous" color={onPrevious ? "#fff" : "#555"} size={42} />
         </TouchableOpacity>

         <TouchableOpacity onPress={() => handleSeek(-30)} style={styles.button}>
           <MaterialIcons name="replay-30" color="#fff" size={42} />
         </TouchableOpacity>

         <TouchableOpacity onPress={handlePlayPause} style={[styles.button, styles.playButton]}>
           {isPlaying ? (
             <MaterialIcons name="pause" color="#fff" size={48} />
           ) : (
             <MaterialIcons name="play-arrow" color="#fff" size={48} />
           )}
         </TouchableOpacity>

         <TouchableOpacity onPress={() => handleSeek(30)} style={styles.button}>
           <MaterialIcons name="forward-30" color="#fff" size={42} />
         </TouchableOpacity>

         <TouchableOpacity onPress={onNext} style={styles.button} disabled={!onNext}>
           <MaterialIcons name="skip-next" color={onNext ? "#fff" : "#555"} size={42} />
         </TouchableOpacity>
       </View>

      {/* Additional Controls */}
      <View style={styles.additionalControls}>
        <TouchableOpacity onPress={handleSkipAuditors} style={styles.skipButton}>
          <MaterialIcons name="fast-forward" color="#fff" size={24} />
          <Text style={styles.skipText}>Passer les auditeurs</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={toggleSleepTimer}
          style={[styles.sleepButton, sleepTimerActive && styles.sleepButtonActive]}
        >
          <MaterialIcons name="hotel" color={sleepTimerActive ? '#fff' : '#888'} size={24} />
          <Text style={[styles.sleepText, sleepTimerActive && styles.sleepTextActive]}>
            {sleepTimerActive ? 'Minuteur actif' : 'Arrêt après cet épisode'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Buffering Indicator */}
      {isBuffering && !isLoading && ( // Show buffering only if not in initial loading state
        <View style={styles.bufferingContainer}>
          <ActivityIndicator size="small" color="#0ea5e9" />
          <Text style={styles.bufferingText}>Mise en mémoire tampon...</Text>
        </View>
      )}
    </GestureHandlerRootView>
  );
}

// --- Styles --- (Add onLayout to progressBarContainer if needed, adjust knob transform)
const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#121212',
  },
  loadingText: {
    marginTop: 10,
    color: '#ccc',
  },
  errorText: {
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: 15,
    fontSize: 16,
  },
  retryButton: {
    backgroundColor: '#0ea5e9',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginBottom: 20,
  },
  retryText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  debugContainer: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#222',
    borderRadius: 5,
    alignSelf: 'stretch',
  },
  debugUrl: {
    color: '#888',
    fontSize: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 30,
  },
  progressContainer: {
    width: '100%',
    marginBottom: 20,
  },
  progressBarContainer: { // Container for background, progress, and knob
    width: '100%',
    height: 20, // Make touch target larger
    justifyContent: 'center',
    position: 'relative', // Needed for knob positioning
    marginBottom: 5,
  },
  progressBackground: {
    position: 'absolute',
    height: 4,
    width: '100%',
    backgroundColor: '#444',
    borderRadius: 2,
    top: 8, // Center the 4px bar vertically in the 20px container
  },
  progressBar: {
    position: 'absolute',
    height: 4,
    backgroundColor: '#0ea5e9',
    borderRadius: 2,
    top: 8, // Align with background
  },
  progressKnob: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#0ea5e9',
    top: 2, // Center the 16px knob vertically ( (20 - 16) / 2 )
    // transform is applied dynamically based on progress and seeking state
  },
  progressKnobActive: {
    backgroundColor: '#fff',
    // Scale applied dynamically
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    color: '#ccc',
    fontSize: 12,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    marginBottom: 30,
  },
  button: {
    // padding: 10,
  },
  playButton: {
    backgroundColor: '#0ea5e9',
    borderRadius: 40,
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  additionalControls: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: '80%',
    marginBottom: 20,
  },
  skipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 4,
    paddingHorizontal: 10,
    marginBottom: 15,
    backgroundColor: '#333',
    borderRadius: 30,
  },
  skipText: {
    color: '#fff',
    marginLeft: 5,
    fontSize: 12,
  },
  sleepButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 4,
    paddingHorizontal: 10,
    backgroundColor: '#333',
    borderRadius: 30,
  },
  sleepButtonActive: {
    backgroundColor: '#0ea5e9',
  },
  sleepText: {
    color: '#888',
    marginLeft: 5,
    fontSize: 12,
  },
  sleepTextActive: {
    color: '#fff',
  },
  bufferingContainer: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 5,
  },
  bufferingText: {
    color: '#ccc',
    marginLeft: 8,
    fontSize: 12,
  },
});