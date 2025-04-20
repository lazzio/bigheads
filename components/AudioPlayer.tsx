import { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator, BackHandler, Alert, PanResponder, GestureResponderEvent } from 'react-native';
import { Play, Pause, SkipBack, SkipForward, Moon, Rewind, FastForward, Forward } from 'lucide-react-native';
import { Episode } from '../types/episode';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { audioManager, formatTime, AudioStatus } from '../utils/OptimizedAudioService';

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
  const [isLoading, setIsLoading] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const [sleepTimerActive, setSleepTimerActive] = useState(false);
  const sleepTimerId = useRef<NodeJS.Timeout | null>(null);

  const progressBarRef = useRef<View>(null);
  const progressWidth = useRef(0);
  const progressPosition = useRef(0);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setError(null);

    const unsubscribe = audioManager.addListener((data: any) => {
      if (!isMounted) return;

      switch (data.type) {
        case 'loaded':
          if (duration === 0 && data.duration > 0) {
            setDuration(data.duration);
          }
          setError(null);
          break;
        case 'status':
          if (!isSeeking) {
            setPosition(data.position);
          }
          if (data.duration > 0 && data.duration !== duration) {
            setDuration(data.duration);
          }
          setIsPlaying(data.isPlaying);
          setIsBuffering(data.isBuffering);
          if (isLoading && data.isLoaded && data.duration > 0) {
            setIsLoading(false);
          } else if (isLoading && data.isLoaded && duration > 0) {
            setIsLoading(false);
          }
          setError(null);
          break;
        case 'error':
          setError(data.error);
          setIsLoading(false);
          setIsPlaying(false);
          setIsBuffering(false);
          break;
        case 'finished':
          console.log('Audio playback finished, calling onComplete');
          if (onComplete) onComplete();
          if (sleepTimerActive) handleSleepTimerEnd();
          break;
        case 'remote-next':
          if (onNext) onNext();
          break;
        case 'remote-previous':
          if (onPrevious) onPrevious();
          break;
      }
    });

    if (initialDurationMs > 0) {
    }

    return () => {
      isMounted = false;
      unsubscribe();
      if (sleepTimerId.current) {
        clearTimeout(sleepTimerId.current);
      }
    };
  }, [onComplete, onNext, onPrevious, isSeeking, sleepTimerActive]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setIsSeeking(true);
        measureProgressBar();
      },
      onPanResponderMove: (evt, gestureState) => {
        if (!isSeeking) return;
        const totalWidth = progressWidth.current;
        const startX = progressPosition.current;
        if (totalWidth > 0 && duration > 0) {
          const touchX = gestureState.moveX - startX;
          const clampedX = Math.max(0, Math.min(touchX, totalWidth));
          const percentage = clampedX / totalWidth;
          const newPosition = percentage * duration;
          setPosition(newPosition);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (!isSeeking) return;
        const totalWidth = progressWidth.current;
        const startX = progressPosition.current;
        if (totalWidth > 0 && duration > 0) {
          const touchX = gestureState.moveX - startX;
          const clampedX = Math.max(0, Math.min(touchX, totalWidth));
          const percentage = clampedX / totalWidth;
          const newPosition = percentage * duration;
          console.log(`[AudioPlayer] Seek to: ${newPosition}ms (${(percentage * 100).toFixed(1)}%)`);
          audioManager.seekTo(newPosition);
        }
        setTimeout(() => {
          setIsSeeking(false);
        }, 100);
      },
    })
  ).current;

  const measureProgressBar = () => {
    progressBarRef.current?.measure((x, y, width, height, pageX, pageY) => {
      progressWidth.current = width;
      progressPosition.current = pageX;
    });
  };

  async function handlePlayPause() {
    try {
      if (isPlaying) {
        await audioManager.pause();
      } else {
        if (duration <= 0) {
          console.warn("[AudioPlayer] Tentative de lecture avec durée 0. Re-vérification du statut.");
          const currentStatus = await audioManager.getStatusAsync();
          if (currentStatus.durationMillis > 0) {
            setDuration(currentStatus.durationMillis);
            await audioManager.play();
          } else {
            setError("Impossible de déterminer la durée de l'épisode.");
            setIsLoading(false);
          }
        } else {
          await audioManager.play();
        }
      }
    } catch (err) {
      console.error("Error playing/pausing:", err);
      setError('Erreur lors de la lecture/pause.');
    }
  }

  async function handleSeek(seconds: number) {
    try {
      await audioManager.seekRelative(seconds);
    } catch (err) {
      console.error("Error seeking relative:", err);
      setError('Erreur lors de l\'avance/recul.');
    }
  }

  async function handleSkip10Minutes() {
    await handleSeek(600);
  }

  function toggleSleepTimer() {
    if (sleepTimerActive) {
      if (sleepTimerId.current) {
        clearTimeout(sleepTimerId.current);
        sleepTimerId.current = null;
      }
      setSleepTimerActive(false);
      console.log('[AudioPlayer] Sleep timer désactivé.');
    } else {
      setSleepTimerActive(true);
      console.log('[AudioPlayer] Sleep timer activé pour 15 minutes.');
      sleepTimerId.current = setTimeout(handleSleepTimerEnd, 15 * 60 * 1000);
    }
  }

  async function handleSleepTimerEnd() {
    console.log('[AudioPlayer] Sleep timer terminé, mise en pause.');
    try {
      await audioManager.pause();
      setSleepTimerActive(false);
      sleepTimerId.current = null;
    } catch (err) {
      console.error("Error pausing on sleep timer end:", err);
    }
  }

  const progress = duration > 0 ? (position / duration) * 100 : 0;

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0ea5e9" />
        <Text style={styles.loadingText}>Chargement de l'épisode...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={onRetry}
        >
          <Text style={styles.retryText}>Réessayer</Text>
        </TouchableOpacity>
        <View style={styles.debugContainer}>
          <Text style={styles.debugUrl} numberOfLines={3} ellipsizeMode="middle">
            URL: {episode?.mp3Link || "Non définie"}
          </Text>
          {episode?.offline_path && (
            <Text style={styles.debugUrl} numberOfLines={3} ellipsizeMode="middle">
              Offline: {episode.offline_path}
            </Text>
          )}
          <Text style={styles.debugUrl}>
            Source: {episode?.offline_path ? "Fichier local" : "URL distante"}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <Text style={styles.title}>{episode.title}</Text>
      <Text style={styles.description} numberOfLines={2} ellipsizeMode="tail">
        {episode.description}
      </Text>
      
      <View style={styles.progressContainer}>
        <View 
          ref={progressBarRef}
          style={styles.progressBarContainer}
          {...panResponder.panHandlers}
        >
          <View style={styles.progressBackground} />
          <View style={[styles.progressBar, { width: `${progress}%` }]} />
          <View 
            style={[
              styles.progressKnob, 
              { left: `${progress}%` },
              isSeeking && styles.progressKnobActive
            ]} 
          />
        </View>
        
        <View style={styles.timeContainer}>
          <Text style={styles.timeText}>{formatTime(position)}</Text>
          <Text style={styles.timeText}>{formatTime(duration)}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity onPress={onPrevious} style={styles.button}>
          <SkipBack size={24} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => handleSeek(-30)} style={styles.button}>
          <Rewind size={24} color="#fff" />
        </TouchableOpacity>
        
        <TouchableOpacity onPress={handlePlayPause} style={[styles.button, styles.playButton]}>
          {isPlaying ? (
            <Pause size={32} color="#fff" />
          ) : (
            <Play size={32} color="#fff" />
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => handleSeek(30)} style={styles.button}>
          <FastForward size={24} color="#fff" />
        </TouchableOpacity>
        
        <TouchableOpacity onPress={onNext} style={styles.button}>
          <SkipForward size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.additionalControls}>
        <TouchableOpacity onPress={handleSkip10Minutes} style={styles.skipButton}>
          <Forward size={20} color="#fff" />
          <Text style={styles.skipText}>Passer les auditeurs</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          onPress={toggleSleepTimer} 
          style={[styles.sleepButton, sleepTimerActive && styles.sleepButtonActive]}
        >
          <Moon size={20} color={sleepTimerActive ? '#fff' : '#888'} />
          <Text style={[styles.sleepText, sleepTimerActive && styles.sleepTextActive]}>
            {sleepTimerActive ? 'Minuteur actif' : 'Arrêt après cet épisode'}
          </Text>
        </TouchableOpacity>
      </View>
      
      {isBuffering && (
        <View style={styles.bufferingContainer}>
          <ActivityIndicator size="small" color="#0ea5e9" />
          <Text style={styles.bufferingText}>Mise en mémoire tampon...</Text>
        </View>
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#1a1a1a',
    borderRadius: 15,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
      },
      android: {
        elevation: 5,
      },
      web: {
        boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
      },
    }),
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 16,
    color: '#888',
    marginBottom: 20,
    textAlign: 'center',
    width: '100%',
  },
  progressContainer: {
    width: '100%',
    marginBottom: 20,
  },
  progressBarContainer: {
    width: '100%',
    height: 20,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  progressBackground: {
    position: 'absolute',
    width: '100%',
    height: 8,
    backgroundColor: '#333',
    borderRadius: 4,
    top: '50%',
    marginTop: -4,
  },
  progressBar: {
    position: 'absolute',
    height: 8,
    backgroundColor: '#0ea5e9',
    borderRadius: 4,
    top: '50%',
    marginTop: -4,
  },
  progressKnob: {
    position: 'absolute',
    width: 16,
    height: 16,
    backgroundColor: '#0ea5e9',
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#fff',
    top: '50%',
    marginLeft: -8,
    marginTop: -8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  progressKnobActive: {
    transform: [{ scale: 1.2 }],
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 20,
  },
  timeText: {
    color: '#ccc',
    fontSize: 12,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginBottom: 20,
    gap: 8,
  },
  button: {
    padding: 10,
  },
  playButton: {
    backgroundColor: '#333',
    borderRadius: 50,
    padding: 15,
    marginHorizontal: 12,
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 10,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#333',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  retryText: {
    color: '#fff',
    fontSize: 14,
  },
  debugContainer: {
    marginTop: 10,
    padding: 8,
    backgroundColor: '#333',
    borderRadius: 4,
    width: '100%',
  },
  debugUrl: {
    color: '#888',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  additionalControls: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginBottom: 16,
  },
  skipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#333',
    padding: 10,
    borderRadius: 20,
    gap: 8,
    marginBottom: 10,
  },
  skipText: {
    color: '#fff',
    fontSize: 14,
  },
  sleepButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#333',
    gap: 8,
  },
  sleepButtonActive: {
    backgroundColor: '#333',
    borderColor: '#444',
  },
  sleepText: {
    color: '#888',
    fontSize: 14,
  },
  sleepTextActive: {
    color: '#fff',
  },
  bufferingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    position: 'absolute',
    bottom: 10,
  },
  bufferingText: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 6,
  }
});