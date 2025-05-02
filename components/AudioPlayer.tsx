import { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, AppState } from 'react-native';
import { Episode } from '../types/episode';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { audioManager, formatTime, AudioStatus } from '../utils/OptimizedAudioService';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { throttle } from 'lodash';
import { theme } from '../styles/global';

interface AudioPlayerProps {
  episode: Episode;
  onNext?: () => void;
  onPrevious?: () => void;
  onComplete?: () => void;
  onRetry?: () => void;
  onPositionUpdate?: (positionMillis: number) => void; // New prop
}

export default function AudioPlayer({ episode, onPrevious, onNext, onComplete, onRetry, onPositionUpdate }: AudioPlayerProps) {
  const initialDurationMs = episode.duration ? episode.duration * 1000 : 0;

  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(initialDurationMs);
  const [isLoading, setIsLoading] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sleepTimerActive, setSleepTimerActive] = useState(false);
  const sleepTimerId = useRef<NodeJS.Timeout | null>(null);

  const progressBarRef = useRef<View>(null);
  const progressWidth = useRef(0);
  const progressPosition = useRef(0);

  // --- Listener Setup Effect ---
  useEffect(() => {
    let isMounted = true;
    // Reset state when episode changes
    setIsLoading(true);
    setError(null);
    setPosition(0);
    setDuration(episode.duration ? episode.duration * 1000 : 0);
    setIsPlaying(false);
    setIsBuffering(false);

    console.log(`[AudioPlayer] Setting up for episode ${episode.id}`);

    // Create a throttled function that will call onPositionUpdate
    // We set leading and trailing to true so that the first and last updates are always sent
    const throttledUpdate = onPositionUpdate 
      ? throttle((pos: number) => {
          console.log(`[AudioPlayer] Throttled position update: ${(pos/1000).toFixed(2)}s`);
          onPositionUpdate(pos);
        }, 5000, { leading: true, trailing: true })
      : null;

    // Listen for audio events
    const unsubscribe = audioManager.addListener((data: any) => {
      if (!isMounted) return;

      switch (data.type) {
        case 'loaded':
          console.log(`[AudioPlayer] Received 'loaded' for ${data.episode?.id}. Current episode: ${episode.id}`);
          // Ensure this 'loaded' event corresponds to the current episode
          if (data.episode?.id === episode.id) {
            if (data.duration > 0) {
              setDuration(data.duration);
            }
            setError(null);
            setIsLoading(false);
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

          // Update position in UI
          setPosition(data.position);
          
          // Call the throttled position update
          if (throttledUpdate && data.isLoaded && data.position > 0) {
            throttledUpdate(data.position);
          }

          // Update other state
          if (data.duration > 0 && data.duration !== duration) {
            setDuration(data.duration);
          }
          setIsPlaying(data.isPlaying);
          setIsBuffering(data.isBuffering || (data.isPlaying && data.duration > 0 && data.position >= data.duration - 500));

          // If still loading but we have data, stop loading
          if (isLoading && data.isLoaded && (data.duration > 0 || episode.duration)) {
            console.log(`[AudioPlayer] 'status' event processed while loading, setting isLoading=false`);
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
          // Set position to the end, ensure isPlaying is false
          const finalPosition = duration > 0 ? duration : 0;
          setPosition(finalPosition);
          // Ensure final position is reported before completion
          if (throttledUpdate) {
              throttledUpdate(finalPosition);
              // Cancel any pending throttled calls before finishing
              throttledUpdate.cancel();
          }

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
      
      // Make sure to flush any pending position updates
      if (throttledUpdate) {
        console.log(`[AudioPlayer] Flushing throttled position update`);
        throttledUpdate.flush(); // This should call onPositionUpdate with the latest position
      }
      
      // Clear timeouts
      if (sleepTimerId.current) {
        clearTimeout(sleepTimerId.current);
      }
    };
  }, [episode.id, onPositionUpdate]); // Add onPositionUpdate to dependencies

  useEffect(() => {
    // Re-measure when component mounts or duration changes
    if (progressBarRef.current) {
      progressBarRef.current.measure((fx, fy, width, height, px, py) => {
        console.log(`[AudioPlayer] Measured progress bar - Width: ${width}, X: ${px}`);
        progressWidth.current = width;
        progressPosition.current = px;
      });
    }
  }, [episode.id, duration]); // Add duration as dependency to remeasure when it changes

  const handleProgressBarTouch = useCallback((event: any) => {
    const touchX = event.nativeEvent.locationX;
    const barWidth = progressWidth.current;
    
    if (barWidth <= 0) {
      console.warn('[AudioPlayer] Cannot seek: progress bar width is zero');
      return;
    }
    
    // Calculate percentage of bar width
    const percentage = Math.max(0, Math.min(touchX / barWidth, 1));
    
    // Calculate position in milliseconds
    const seekPositionMs = percentage * duration;
    
    console.log(`[AudioPlayer] Touch position: ${touchX}px / ${barWidth}px = ${percentage.toFixed(2)} -> ${seekPositionMs.toFixed(0)}ms`);
    
    // Update UI immediately
    setPosition(seekPositionMs);
    
    // Perform the actual seek
    try {
      audioManager.seekTo(seekPositionMs);
      // Immediately report position after seek
      if (onPositionUpdate) {
        onPositionUpdate(seekPositionMs);
      }
    } catch (err) {
      console.error('[AudioPlayer] Error seeking:', err);
      setError('Erreur pendant la recherche de position');
    }
  }, [duration, onPositionUpdate]); // Add onPositionUpdate dependency

  // --- Action Handlers (Wrapped in useCallback) ---
  const handlePlayPause = useCallback(async () => {
    console.log(`[AudioPlayer] handlePlayPause. Current state: isPlaying=${isPlaying}`);
    try {
      if (isPlaying) {
        await audioManager.pause();
      } else {
        // Attempt to play even if duration is initially 0.
        // TrackPlayer might still be able to play or determine duration later.
        // We can also try fetching the status again to get a potentially updated duration.
        let currentDuration = duration;
        if (currentDuration <= 0) {
            console.warn("[AudioPlayer] Duration is 0, fetching status before play.");
            try {
                // Use getStatusAsync which now includes currentEpisodeId
                const status = await audioManager.getStatusAsync();
                // Check if the status is for the correct episode and has a valid duration
                if (status.isLoaded && status.currentEpisodeId === episode.id && status.durationMillis > 0) {
                    console.log(`[AudioPlayer] Got duration from status: ${status.durationMillis}ms`);
                    currentDuration = status.durationMillis;
                    // Update state if it changed and component is still mounted
                    if (duration !== currentDuration) {
                        setDuration(currentDuration);
                    }
                } else {
                    console.warn(`[AudioPlayer] Status fetch did not provide valid duration (Loaded: ${status.isLoaded}, EpisodeMatch: ${status.currentEpisodeId === episode.id}, Duration: ${status.durationMillis})`);
                }
            } catch (statusError) {
                console.error("[AudioPlayer] Error fetching status before play:", statusError);
            }
        }

        // Now, attempt to play. If duration is still 0, TrackPlayer might handle it.
        console.log(`[AudioPlayer] Attempting to play (duration known: ${currentDuration > 0})`);
        await audioManager.play();
        // --- MODIFICATION END ---
      }
    } catch (err) {
      console.error("[AudioPlayer] Error playing/pausing:", err);
      setError('Erreur lors de la lecture/pause.');
    }
  }, [isPlaying, duration, episode.id]);

  const handleSeek = useCallback(async (offsetSeconds: number) => {
    console.log(`[AudioPlayer] handleSeek: ${offsetSeconds}s`);
    const newPosition = await audioManager.seekRelative(offsetSeconds);
    // Immediately update local state and save locally after seek
    if (typeof newPosition === 'number' && onPositionUpdate) {
        setPosition(newPosition);
        onPositionUpdate(newPosition); 
    }
  }, [onPositionUpdate]);

  const handleSkipAuditors = useCallback(async () => {
    console.log('[AudioPlayer] handleSkipAuditors');
    const newPosition = await audioManager.seekRelative(480);
    // Immediately update local state and save locally after skip
    if (typeof newPosition === 'number' && onPositionUpdate) {
        setPosition(newPosition);
        onPositionUpdate(newPosition);
    }
  }, [onPositionUpdate]);

  // --- Sleep Timer (Wrapped in useCallback) ---
  const handleSleepTimerEnd = useCallback(() => {
    console.log('[AudioPlayer] Sleep timer ended, pausing playback.');
    audioManager.pause();
    setSleepTimerActive(false);
    if (sleepTimerId.current) {
      clearTimeout(sleepTimerId.current);
      sleepTimerId.current = null;
    }
  }, []);

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
  }, []);

  // Add an effect to handle app state changes
  useEffect(() => {
    const appStateSubscription = AppState.addEventListener('change', nextAppState => {
      // When app comes to foreground
      if (nextAppState === 'active') {
        console.log('[AudioPlayer] App returned to foreground, refreshing player state');
        
        // Force measurement update for progress bar
        setTimeout(() => {
          if (progressBarRef.current) {
            progressBarRef.current.measure((fx, fy, width, height, px, py) => {
              progressWidth.current = width;
              progressPosition.current = px;
              console.log(`[AudioPlayer] Progress bar measured: width=${width}, x=${px}`);
            });
          }
        }, 200);
        
        // Re-sync with TrackPlayer state
        audioManager.getStatusAsync().then(status => {
          if (status.isLoaded && status.currentEpisodeId === episode.id) {
            console.log('[AudioPlayer] Updating UI with current playback state');
            setPosition(status.positionMillis);
            setIsPlaying(status.isPlaying);
            setIsBuffering(status.isBuffering);
          }
        }).catch(err => console.error('[AudioPlayer] Error refreshing status:', err));
      }
    });
    
    return () => {
      appStateSubscription.remove();
    };
  }, [episode.id]);

  // --- Rendering ---
  const progress = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0; // Ensure progress is between 0 and 100
  const remainingTime = duration > 0 && position >= 0 ? Math.max(0, duration - position) : 0;

  // Loading State UI
  if (isLoading) {
    console.log('[AudioPlayer] Rendering Loading State');
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={theme.colors.primary}/>
        <Text style={styles.statusText}>Chargement de l'épisode...</Text>
      </View>
    );
  }

  // Error State UI
  if (error) {
    return (
      <View style={styles.container}>
        <MaterialIcons name="error-outline" size={48} color={theme.colors.error} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
          <Text style={styles.retryText}>Réessayer</Text>
        </TouchableOpacity>
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

      {/* Progress Bar and Time - Simplified touchable version */}
      <View style={styles.progressContainer}>
        <TouchableOpacity 
          activeOpacity={0.8}
          ref={progressBarRef}
          style={styles.progressContainer}
          onLayout={() => {
            // Measure on layout
            if (progressBarRef.current) {
              progressBarRef.current.measure((fx, fy, width, height, px, py) => {
                progressWidth.current = width;
                progressPosition.current = px;
                console.log(`[AudioPlayer] Progress bar measured: width=${width}, x=${px}`);
              });
            }
          }}
          onPress={handleProgressBarTouch}
        >
          <View style={styles.progressBackground} />
          <View style={[styles.progressBar, { width: `${progress}%` }]} />
          <View
            style={[
              styles.progressKnob,
              { left: `${progress}%` },
              { transform: [{ translateX: -8 }] }
            ]}
          />
        </TouchableOpacity>

        <View style={styles.timeContainer}>
          <Text style={styles.timeText}>{formatTime(position)}</Text>
          <Text style={styles.timeText}>-{formatTime(remainingTime)}</Text>
        </View>
      </View>

      {/* Playback Controls */}
      <View style={styles.controls}>
         <TouchableOpacity onPress={onPrevious} style={styles.button} disabled={!onPrevious}>
          <MaterialIcons name="skip-previous" size={32} color={theme.colors.text} />
         </TouchableOpacity>

         <TouchableOpacity onPress={() => handleSeek(-30)} style={styles.button}>
          <MaterialIcons name="replay-30" size={32} color={theme.colors.text} />
         </TouchableOpacity>

         <TouchableOpacity onPress={handlePlayPause} style={[styles.button, styles.playButton]}>
          {isPlaying ? (
            <MaterialIcons name="pause" size={52} color={theme.colors.text} />
          ) : (
            <MaterialIcons name="play-arrow" size={52} color={theme.colors.text} />
          )}
         </TouchableOpacity>

         <TouchableOpacity onPress={() => handleSeek(30)} style={styles.button}>
          <MaterialIcons name="forward-30" size={32} color={theme.colors.text} />
         </TouchableOpacity>

         <TouchableOpacity onPress={onNext} style={styles.button} disabled={!onNext}>
          <MaterialIcons name="skip-next" size={32} color={theme.colors.text} />
         </TouchableOpacity>
       </View>

      {/* Additional Controls */}
      <View style={styles.additionalControls}>
        <TouchableOpacity onPress={handleSkipAuditors} style={styles.skipButton}>
          <MaterialIcons name="fast-forward" size={20} color={theme.colors.text} />
          <Text style={styles.skipText}>Skip auditeurs</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={toggleSleepTimer}
          style={[styles.sleepButton, sleepTimerActive && styles.sleepButtonActive]}
          accessibilityLabel={sleepTimerActive ? "Désactiver le minuteur de sommeil" : "Activer le minuteur de sommeil"}
        >
          <MaterialIcons name="timer" size={20} color={sleepTimerActive ? theme.colors.text : theme.colors.description} />
          <Text style={[styles.sleepText, sleepTimerActive && styles.sleepTextActive]}>
            {sleepTimerActive ? 'Sleep actif' : 'Sleep timer'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Buffering Indicator */}
      {isBuffering && !isLoading && (
        <View style={styles.bufferingContainer}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <Text style={styles.bufferingText}>Mise en mémoire tampon...</Text>
        </View>
      )}
    </GestureHandlerRootView>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 20, // Add padding at the bottom
    justifyContent: 'flex-end', // Align content towards the bottom
    alignItems: 'center',
    width: '100%',
  },
  artwork: {
      width: 250,
      height: 250,
      borderRadius: 12,
      marginBottom: 30,
      backgroundColor: theme.colors.borderColor, // Placeholder background
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 14, // Slightly smaller description
    color: theme.colors.description,
    marginBottom: 25,
    textAlign: 'center',
    paddingHorizontal: 10, // Add horizontal padding
  },
  progressContainer: {
    width: '100%',
    marginBottom: 20,
  },
  progressBarTouchable: { // Renamed for clarity
    width: '100%',
    height: 24, // Increased touch area height
    justifyContent: 'center',
    // backgroundColor: 'rgba(255,0,0,0.1)', // Optional: Visualize touch area
  },
  progressBackground: {
    position: 'absolute',
    width: '100%',
    height: 6, // Slightly thinner bar
    backgroundColor: theme.colors.borderColor,
    borderRadius: 3,
    top: '50%',
    marginTop: -3, // Adjust vertical centering
  },
  progressBar: {
    position: 'absolute',
    height: 6,
    backgroundColor: theme.colors.primary,
    borderRadius: 3,
    top: '50%',
    marginTop: -3,
  },
  progressKnob: {
    position: 'absolute',
    width: 14, // Slightly smaller knob
    height: 14,
    backgroundColor: theme.colors.primary,
    borderRadius: 7,
    borderWidth: 2, // Thinner border
    borderColor: theme.colors.text,
    top: '50%',
    marginLeft: -7, // Adjust for knob size
    marginTop: -7, // Adjust for knob size
    elevation: 3,
    shadowColor: theme.colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
  },
  progressKnobActive: {
    transform: [{ scale: 1.3 }], // Slightly larger when active
    backgroundColor: theme.colors.text, // Change color when active
    borderColor: theme.colors.primary,
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 8, // Add margin top
  },
  timeText: {
    color: theme.colors.description,
    fontSize: 12,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    marginBottom: 20, // Add margin below main controls
  },
  button: {
    padding: 10, // Add padding for easier touch
  },
  playButton: {
    backgroundColor: theme.colors.buttonBackground,
    width: 76,
    height: 76,
    borderRadius: 38, // Half of width/height for perfect circle
    marginHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  additionalControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: 16,
  },
  skipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.borderColor,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    gap: 6,
  },
  skipText: {
    color: theme.colors.text,
    fontSize: 13,
  },
  sleepButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: theme.colors.borderColor,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  sleepButtonActive: {
    backgroundColor: theme.colors.borderColor,
  },
  sleepText: {
    color: theme.colors.description,
    fontSize: 13,
  },
  sleepTextActive: {
    color: theme.colors.text,
  },
  bufferingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    position: 'absolute',
    bottom: 10, // Position near bottom
    alignSelf: 'center',
    zIndex: 10,
  },
  bufferingText: {
    color: theme.colors.text,
    fontSize: 12,
    marginLeft: 6,
  },
  statusText: {
      color: theme.colors.description,
      marginTop: 15,
      fontSize: 16,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  retryButton: {
    backgroundColor: theme.colors.borderColor,
    paddingVertical: 10,
    paddingHorizontal: 25,
    borderRadius: 8,
  },
  retryText: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
});