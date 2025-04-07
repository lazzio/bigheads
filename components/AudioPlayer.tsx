import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator, BackHandler, Alert, PanResponder, GestureResponderEvent, AppState } from 'react-native';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { Play, Pause, SkipBack, SkipForward, Moon, Rewind, FastForward, Forward } from 'lucide-react-native';
import { Episode } from '../types/episode';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { updatePlaybackNotification, removePlaybackNotification, setupNotificationChannel } from '../utils/notificationPlayer';
import * as Notifications from 'expo-notifications';

interface AudioPlayerProps {
  episode: Episode;
  onNext?: () => void;
  onPrevious?: () => void;
  onComplete?: () => void;
}

export default function AudioPlayer({ episode, onNext, onPrevious, onComplete }: AudioPlayerProps) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sleepTimerActive, setSleepTimerActive] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);

  const soundRef = useRef<Audio.Sound | null>(null);
  const positionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressBarRef = useRef<View>(null);
  const progressWidth = useRef(0);
  const progressPosition = useRef({ x: 0, y: 0 });
  const appStateRef = useRef(AppState.currentState);
  const lastNotificationUpdate = useRef(0);

  useEffect(() => {
    setupAudio();
    setupNotificationChannel();
    
    const subscription = AppState.addEventListener('change', nextAppState => {
      appStateRef.current = nextAppState;
    });

    const notificationSubscription = Notifications.addNotificationResponseReceivedListener(response => {
      const actionId = response.actionIdentifier;
      switch (actionId) {
        case 'PLAY_PAUSE':
          handlePlayPause();
          break;
        case 'NEXT':
          onNext?.();
          break;
      }
    });
    
    return () => {
      subscription.remove();
      notificationSubscription.remove();
      removePlaybackNotification();
      
      if (positionTimerRef.current) {
        clearInterval(positionTimerRef.current);
      }
      
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(err => 
          console.warn("Error unloading sound:", err)
        );
        soundRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (episode?.mp3Link) {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
      loadAudio(episode.mp3Link);
    }
  }, [episode]);

  useEffect(() => {
    if (!isLoading) {
      setTimeout(() => {
        measureProgressBar();
      }, 300);
    }
  }, [isLoading]);

  // Mise à jour de la notification uniquement lors des changements d'état importants
  useEffect(() => {
    if (episode && !isLoading && Platform.OS === 'android') {
      const now = Date.now();
      // Limiter les mises à jour à une fois par seconde maximum
      if (now - lastNotificationUpdate.current >= 1000) {
        updatePlaybackNotification(
          episode,
          {
            isPlaying,
            positionMillis: position,
            durationMillis: duration
          }
        );
        lastNotificationUpdate.current = now;
      }
    }
  }, [isPlaying, episode, isLoading]);

  async function setupAudio() {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        interruptionModeIOS: 1,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        interruptionModeAndroid: 1,
        playThroughEarpieceAndroid: false
      });
    } catch (err) {
      console.warn("Failed to set audio mode:", err);
    }
  }

  useEffect(() => {
    return () => {
      removePlaybackNotification();
    };
  }, []);

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      setIsSeeking(true);
    },
    onPanResponderMove: (e: GestureResponderEvent) => {
      if (progressWidth.current <= 0) return;
      
      const touchX = e.nativeEvent.pageX - progressPosition.current.x;
      const percentage = Math.max(0, Math.min(touchX / progressWidth.current, 1));
      const newPosition = percentage * duration;
      
      setPosition(newPosition);
    },
    onPanResponderRelease: async (e: GestureResponderEvent) => {
      if (progressWidth.current <= 0 || !soundRef.current) {
        setIsSeeking(false);
        return;
      }
      
      try {
        const touchX = e.nativeEvent.pageX - progressPosition.current.x;
        const percentage = Math.max(0, Math.min(touchX / progressWidth.current, 1));
        const newPosition = percentage * duration;
        
        await soundRef.current.setPositionAsync(newPosition);
        setPosition(newPosition);
      } catch (err) {
        console.error("Error while seeking:", err);
      } finally {
        setIsSeeking(false);
      }
    },
    onPanResponderTerminate: () => {
      setIsSeeking(false);
    }
  });

  const measureProgressBar = () => {
    if (progressBarRef.current) {
      progressBarRef.current.measure((x, y, width, height, pageX, pageY) => {
        progressWidth.current = width;
        progressPosition.current = { x: pageX, y: pageY };
      });
    }
  };

  async function loadAudio(audioUrl: string) {
    try {
      setIsLoading(true);
      setError(null);
      setPosition(0);
      setDuration(0);
      
      const url = audioUrl.trim();
      if (!url) {
        throw new Error("URL audio invalide");
      }
      
      console.log(`Loading audio: ${url.substring(0, 50)}...`);
      
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: url },
        { 
          progressUpdateIntervalMillis: 1000,
          positionMillis: 0,
          shouldPlay: false
        },
        onPlaybackStatusUpdate
      );
      
      soundRef.current = newSound;
      setSound(newSound);
      
      const status = await newSound.getStatusAsync();
      if (status.isLoaded) {
        setDuration(status.durationMillis || 0);
      }
      
      setIsLoading(false);
    } catch (err) {
      console.error("Error loading audio:", err);
      setError(`Impossible de charger l'audio: ${err instanceof Error ? err.message : 'erreur inconnue'}`);
      setIsLoading(false);
    }
  }

  function onPlaybackStatusUpdate(status: AVPlaybackStatus) {
    if (!status.isLoaded) {
      if (status.error) {
        console.error(`Playback error: ${status.error}`);
        setError(`Erreur de lecture: ${status.error}`);
      }
      return;
    }
    
    if (!isSeeking) {
      setPosition(status.positionMillis);
    }
    
    setIsPlaying(status.isPlaying);
    
    if (status.didJustFinish) {
      setIsPlaying(false);
      onComplete?.();
      
      if (sleepTimerActive) {
        handleSleepTimerEnd();
      }
    }
  }

  async function handlePlayPause() {
    try {
      if (!soundRef.current) {
        console.warn("No sound loaded");
        return;
      }
      
      const status = await soundRef.current.getStatusAsync();
      
      if (!status.isLoaded) {
        console.warn("Sound not loaded");
        if (episode?.mp3Link) {
          loadAudio(episode.mp3Link);
        }
        return;
      }
      
      if (status.isPlaying) {
        await soundRef.current.pauseAsync();
      } else {
        await soundRef.current.playAsync();
      }
    } catch (err) {
      console.error("Error toggling playback:", err);
      setError(`Erreur de lecture: ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    }
  }

  async function handleSeek(seconds: number) {
    try {
      if (!soundRef.current) return;
      
      const status = await soundRef.current.getStatusAsync();
      if (!status.isLoaded) return;
      
      const newPosition = Math.max(0, Math.min(position + seconds * 1000, duration));
      await soundRef.current.setPositionAsync(newPosition);
      setPosition(newPosition);
    } catch (err) {
      console.error("Error seeking:", err);
    }
  }

  async function handleSkip10Minutes() {
    try {
      await handleSeek(600);
      console.log("Skipped 10 minutes forward");
    } catch (err) {
      console.error("Error skipping 10 minutes:", err);
    }
  }

  function toggleSleepTimer() {
    setSleepTimerActive(prevState => !prevState);
    console.log(`Sleep timer ${!sleepTimerActive ? 'activated' : 'deactivated'}`);
  }

  async function handleSleepTimerEnd() {
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync().catch(() => {});
      }
      
      setSleepTimerActive(false);
      console.log("Sleep timer completed - closing app now");
      
      Alert.alert(
        "Minuteur de sommeil terminé",
        "L'application va se fermer dans 5 secondes...",
        [{ text: "OK" }]
      );
      
      setTimeout(() => {
        if (Platform.OS === 'android') {
          BackHandler.exitApp();
        } else if (Platform.OS === 'ios') {
          try {
            IntentLauncher.startActivityAsync('com.apple.springboard');
          } catch (e) {
            console.log("Couldn't launch home screen, trying alternative method");
            
            Application.getIosApplicationReleaseTypeAsync().then(() => {
              setTimeout(() => {
                global.process.exit(0);
              }, 1000);
            });
          }
        }
      }, 5000);
    } catch (err) {
      console.error("Error in sleep timer end handling:", err);
    }
  }

  function formatTime(milliseconds: number) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  const progress = duration > 0 ? (position / duration) * 100 : 0;

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0ea5e9" />
        <Text style={styles.loadingText}>Chargement...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity 
          style={styles.retryButton} 
          onPress={() => episode?.mp3Link && loadAudio(episode.mp3Link)}
        >
          <Text style={styles.retryText}>Réessayer</Text>
        </TouchableOpacity>
        
        <View style={styles.debugContainer}>
          <Text style={styles.debugUrl} numberOfLines={3} ellipsizeMode="middle">
            URL: {episode?.mp3Link || "Non définie"}
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
          <Text style={styles.timeText}>-{formatTime(Math.max(0, duration - position))}</Text>
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
    width: '100%',
    marginTop: 8,
  },
  timeText: {
    color: '#fff',
    fontSize: 14,
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
  }
});