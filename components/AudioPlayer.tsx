import 'react-native-reanimated';
import { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, AppState } from 'react-native';
import { Episode } from '../types/episode';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAudio } from './AudioContext';
import { formatTime } from '../utils/commons/timeUtils';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { throttle } from 'lodash';
import { theme } from '../styles/global';
import { LoadingIndicator, EmptyState, RetryButton } from './SharedUI';
import Slider from '@react-native-community/slider';

interface AudioPlayerProps {
  episode: Episode;
  onNext?: () => void;
  onPrevious?: () => void;
  onComplete?: () => void;
  onRetry?: () => void;
  onPositionUpdate?: (positionSeconds: number) => void; // Changed to seconds
}

export default function AudioPlayer({ episode, onPrevious, onNext, onComplete, onRetry, onPositionUpdate }: AudioPlayerProps) {
  const audioManager = useAudio();

  const initialDurationSeconds = episode.duration ? episode.duration : 0;
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0); // Will be in seconds
  const [duration, setDuration] = useState(initialDurationSeconds); // Will be in seconds
  const [isLoading, setIsLoading] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sleepTimerActive, setSleepTimerActive] = useState(false);
  const sleepTimerId = useRef<NodeJS.Timeout | null>(null);

  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState<number | null>(null); // Value while dragging

  // --- Listener Setup Effect ---
  useEffect(() => {
    let isMounted = true;
    // Reset state when episode changes
    setIsLoading(true);
    setError(null);
    setPosition(0); // seconds
    setDuration(episode.duration ? episode.duration : 0); // seconds
    setIsPlaying(false);
    setIsBuffering(false);

    console.log(`[AudioPlayer] Setting up for episode ${episode.id}`);

    // Create a throttled function that will call onPositionUpdate
    // We set leading and trailing to true so that the first and last updates are always sent
    const throttledUpdate = onPositionUpdate 
      ? throttle((posSeconds: number) => { // Expecting seconds
          console.log(`[AudioPlayer] Throttled position update: ${posSeconds.toFixed(2)}s`);
          onPositionUpdate(posSeconds);
        }, 5000, { leading: true, trailing: true })
      : null;

    // Listen for audio events
    const unsubscribe = audioManager.addListener((data: any) => {
      if (!isMounted) return;

      switch (data.type) {
        case 'loaded':
          console.log(`[AudioPlayer] Received 'loaded' for ${data.episodeId}. Current episode: ${episode.id}`);
          if (data.episodeId === episode.id) {
            if (data.duration > 0) { // duration is in seconds from AudioManager
              setDuration(data.duration);
            }
            setError(null);
            setIsLoading(false);
            console.log(`[AudioPlayer] 'loaded' event processed, isLoading=false`);
          }
          break;
        case 'status':
          if (data.episodeId && data.episodeId !== episode.id) {
              console.log(`[AudioPlayer] Ignoring status for different episode: ${data.episodeId}`);
              break;
          }

          setPosition(data.position);
          
          if (throttledUpdate && data.isLoaded && data.position > 0) {
            throttledUpdate(data.position);
          }

          if (data.duration > 0 && data.duration !== duration) {
            setDuration(data.duration);
          }
          setIsPlaying(data.isPlaying);
          
          // Corrected buffering logic: data.position and data.duration are in seconds.
          // Consider buffering if near the end (e.g., last 0.5 seconds)
          const nearEnd = data.duration > 0 && data.position >= data.duration - 0.5;
          setIsBuffering(data.isBuffering || (data.isPlaying && nearEnd));

          if (isLoading && data.isLoaded && (data.duration > 0 || episode.duration)) {
            setIsLoading(false);
          }
          
          if (error) setError(null);
          break;
        case 'error':
          console.error(`[AudioPlayer] Received 'error': ${data.error}`);
          setIsLoading(false);
          setIsPlaying(false);
          setIsBuffering(false);
          break;
        case 'finished':
          if (data.episodeId === episode.id) {
            const finalPositionSeconds = duration > 0 ? duration : 0;
            setPosition(finalPositionSeconds);

            if (throttledUpdate) {
              throttledUpdate.cancel(); // Cancel any pending throttled updates
            }
            // Send final position immediately
            onPositionUpdate?.(finalPositionSeconds);

            setIsPlaying(false);
            onComplete?.();
          }
          break;
        case 'unloaded':
          console.log(`[AudioPlayer] Received 'unloaded' for episode ${data.episodeId}`);
          if (data.episodeId === episode.id) {
            setIsLoading(true);
            setIsPlaying(false);
            setPosition(0);
            // Optionally reset duration or set to initial, or show a specific message
            // setDuration(initialDurationSeconds); 
            if (throttledUpdate) {
              throttledUpdate.cancel();
            }
            console.log(`[AudioPlayer] State reset due to 'unloaded' event for current episode.`);
          }
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

  // --- Action Handlers (Wrapped in useCallback) ---
  const handlePlayPause = useCallback(async () => {
    try {
      let status = await audioManager.getStatusAsync();
      // If another episode is loaded, stop all sounds before loading new one
      if (status.isLoaded && status.currentEpisodeId && status.currentEpisodeId !== episode.id) {
        await audioManager.stopAllSounds();
        await audioManager.loadSound(episode, 0);
        status = await audioManager.getStatusAsync();
      }
      // On ne tente play que si le player est bien sur le bon épisode
      if (status.isLoaded && status.currentEpisodeId === episode.id) {
        if (isPlaying) {
          await audioManager.pause();
        } else {
          let currentDuration = duration;
          if (currentDuration <= 0) {
            console.warn("[AudioPlayer] Duration is 0, fetching status before play.");
            try {
              const s = await audioManager.getStatusAsync();
              if (s.isLoaded && s.currentEpisodeId === episode.id && s.duration > 0) {
                currentDuration = s.duration;
                if (duration !== currentDuration) {
                  setDuration(currentDuration);
                }
              }
            } catch (statusError) {
              console.error("[AudioPlayer] Error fetching status before play:", statusError);
            }
          }
          await audioManager.play();
        }
      } else if (!status.isLoaded) {
        // Si rien n'est chargé, on charge et on joue
        await audioManager.loadSound(episode, 0);
        await audioManager.play();
      }
    } catch (err) {
      console.error("[AudioPlayer] Error playing/pausing:", err);
      setError('Erreur lors de la lecture/pause.');
    }
  }, [isPlaying, duration, episode.id]);

  const handleSeek = useCallback(async (offsetSeconds: number) => {
    console.log(`[AudioPlayer] handleSeek: ${offsetSeconds}s`);
    const newPositionSeconds = await audioManager.seekRelative(offsetSeconds); // Returns seconds or undefined
    // Immediately update local state and save locally after seek
    if (typeof newPositionSeconds === 'number') {
        setPosition(newPositionSeconds);
        if (onPositionUpdate) {
          onPositionUpdate(newPositionSeconds); 
        }
    }
  }, [onPositionUpdate]);

  const handleSkipAuditors = useCallback(async () => {
    console.log('[AudioPlayer] handleSkipAuditors');
    const newPositionSeconds = await audioManager.seekRelative(480); // Returns seconds or undefined
    // Immediately update local state and save locally after skip
    if (typeof newPositionSeconds === 'number') {
        setPosition(newPositionSeconds);
        if (onPositionUpdate) {
          onPositionUpdate(newPositionSeconds);
        }
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
        
        // Re-sync with audioManager state (expo-audio)
        audioManager.getStatusAsync().then(status => { // status returns currentTime and duration in seconds
          if (status.isLoaded && status.currentEpisodeId === episode.id) {
            console.log('[AudioPlayer] Updating UI with current playback state');
            setPosition(status.currentTime); // currentTime is in seconds
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

  // --- Slider Handlers ---
  const handleSlidingStart = useCallback(() => {
    setIsSeeking(true);
    setSeekValue(position); // Start from current position
  }, [position]);

  const handleValueChange = useCallback((value: number) => {
    setSeekValue(value);
  }, []);

  const handleSlidingComplete = useCallback((value: number) => {
    setIsSeeking(false);
    setSeekValue(null);
    setPosition(value); // Update UI immediately
    audioManager.seekTo(value * 1000); // Seek in ms
    if (onPositionUpdate) {
      onPositionUpdate(value);
    }
  }, [audioManager, onPositionUpdate]);

  // --- Rendering ---
  const progress = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;
  const remainingTime = duration > 0 && position >= 0 ? Math.max(0, duration - position) : 0;
  const sliderValue = isSeeking && seekValue !== null ? seekValue : position;

  // Loading State UI
  if (isLoading) {
    return <LoadingIndicator message="Chargement..." style={styles.container} />;
  }

  // Error State UI
  if (error) {
    return (
      <EmptyState message={error}>
        {onRetry && <RetryButton onPress={onRetry} text="Réessayer" style={styles.retryButton} />}
      </EmptyState>
    );
  }

  // Main Player UI
  return (
    <GestureHandlerRootView style={styles.container}>
      <Text style={styles.title}>{episode.title}</Text>
      <Text style={styles.description} numberOfLines={2} ellipsizeMode="tail">
        {episode.description}
      </Text>
      {/* Progress Slider and Time */}
      <View style={styles.progressContainer}>
        <Slider
          value={sliderValue}
          minimumValue={0}
          maximumValue={duration}
          step={1}
          minimumTrackTintColor={theme.colors.primary}
          maximumTrackTintColor={theme.colors.description}
          thumbTintColor={isSeeking ? theme.colors.text : theme.colors.primary}
          onSlidingStart={handleSlidingStart}
          onValueChange={handleValueChange}
          onSlidingComplete={handleSlidingComplete}
          style={{ width: '100%', height: 40 }}
        />
        <View style={styles.timeContainer}>
          <Text style={styles.timeText}>{formatTime(sliderValue)}</Text>
          <Text style={styles.timeText}>-{formatTime(remainingTime)}</Text>
        </View>
      </View>
      {/* Playback Controls */}
      <View style={styles.controls}>
         <TouchableOpacity onPress={onPrevious} style={styles.button} disabled={!onPrevious}>
          <MaterialIcons name="skip-previous" size={42} color={theme.colors.text} />
         </TouchableOpacity>

         <TouchableOpacity onPress={() => handleSeek(-30)} style={styles.button}>
          <MaterialIcons name="replay-30" size={42} color={theme.colors.text} />
         </TouchableOpacity>

         <TouchableOpacity onPress={handlePlayPause} style={[styles.button, styles.playButton]}>
          {isPlaying ? (
            <MaterialIcons name="pause" size={52} color={theme.colors.text} />
          ) : (
            <MaterialIcons name="play-arrow" size={52} color={theme.colors.text} />
          )}
         </TouchableOpacity>

         <TouchableOpacity onPress={() => handleSeek(30)} style={styles.button}>
          <MaterialIcons name="forward-30" size={42} color={theme.colors.text} />
         </TouchableOpacity>

         <TouchableOpacity onPress={onNext} style={styles.button} disabled={!onNext}>
          <MaterialIcons name="skip-next" size={42} color={theme.colors.text} />
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
        </View>
      )}
    </GestureHandlerRootView>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 20,
    justifyContent: 'flex-end',
    alignItems: 'center',
    width: '100%',
  },
  artwork: {
      width: 250,
      height: 250,
      borderRadius: 12,
      marginBottom: 30,
      backgroundColor: theme.colors.borderColor,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: theme.colors.description,
    marginBottom: 25,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  progressContainer: {
    width: '100%',
    marginBottom: 20,
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 8,
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
    marginBottom: 20,
  },
  button: {
    padding: 10,
  },
  playButton: {
    backgroundColor: theme.colors.buttonBackground,
    width: 76,
    height: 76,
    borderRadius: 38,
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
    bottom: 10,
    alignSelf: 'center',
    zIndex: 10,
  },
  retryButton: {
    backgroundColor: theme.colors.borderColor,
    paddingVertical: 10,
    paddingHorizontal: 25,
    borderRadius: 8,
  },
});