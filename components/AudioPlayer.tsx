import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  BackHandler,
  Alert,
  PanResponder,
  GestureResponderEvent,
  AppState } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { Episode } from '../types/episode';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { audioManager, formatTime } from '../utils/OptimizedAudioService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PENDING_POSITIONS_KEY } from '../utils/PlaybackSyncService';
import { supabase } from '../lib/supabase';
import throttle from 'lodash/throttle';
import { theme, generalData } from '../styles/global';

interface AudioPlayerProps {
  episode: Episode;
  onNext?: () => void;
  onPrevious?: () => void;
  onComplete?: () => void;
}

// Define PendingPosition interface locally or import if shared
interface PendingPosition {
  episodeId: string;
  positionSeconds: number;
  userId: string;
  timestamp: string;
}

// Throttle the save function to run at most once every 5 seconds
const savePositionThrottled = throttle(async (episodeId: string, positionSeconds: number) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !episodeId) return; // Need user and episode ID

    const userId = user.id;
    const timestamp = new Date().toISOString();

    const pendingPositionsJSON = await AsyncStorage.getItem(PENDING_POSITIONS_KEY);
    let pendingPositions: PendingPosition[] = pendingPositionsJSON ? JSON.parse(pendingPositionsJSON) : [];

    // Find existing entry for this user and episode
    const existingIndex = pendingPositions.findIndex(p => p.userId === userId && p.episodeId === episodeId);

    const newPositionData: PendingPosition = { episodeId, positionSeconds, userId, timestamp };

    if (existingIndex !== -1) {
      // Update existing entry
      pendingPositions[existingIndex] = newPositionData;
    } else {
      // Add new entry
      pendingPositions.push(newPositionData);
    }

    // Limit the number of stored positions if necessary (optional)
    // pendingPositions = pendingPositions.slice(-50); // Keep last 50 updates

    await AsyncStorage.setItem(PENDING_POSITIONS_KEY, JSON.stringify(pendingPositions));
    // console.log(`[AudioPlayer] Position saved for ${episodeId}: ${positionSeconds}s`);

  } catch (error) {
    console.error('[AudioPlayer] Error saving playback position:', error);
  }
}, 5000, { leading: false, trailing: true });


export default function AudioPlayer({ episode, onNext, onPrevious, onComplete }: AudioPlayerProps) {
  // État principal
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sleepTimerActive, setSleepTimerActive] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);

  // Références
  const progressBarRef = useRef<View>(null);
  const progressWidth = useRef(0);
  const progressPosition = useRef({ x: 0, y: 0 });

  // Configurer audio au montage, nettoyer au démontage
  useEffect(() => {
    let isMounted = true;
    let currentUserId: string | null = null;

    // Get user ID once
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (isMounted) {
        currentUserId = user?.id ?? null;
      }
    });
    
    const setup = async () => {
      try {
        await audioManager.setupAudio();
        
        // Ajouter un écouteur pour les mises à jour d'état
        const unsubscribe = audioManager.addListener((data) => {
          if (!isMounted) return;
          
          if (data.type === 'loaded') {
            setDuration(data.duration); // duration is in ms from listener
            setIsLoading(false);
            setError(null);
          } else if (data.type === 'status') {
            if (!isSeeking) {
              setPosition(data.position); // position is in ms from listener
            }
            setDuration(data.duration); // duration is in ms from listener
            setIsPlaying(data.isPlaying);
            setIsBuffering(data.isBuffering);

            // Save position periodically if playing and user is known
            if (data.isPlaying && currentUserId && episode?.id) {
              const positionSeconds = Math.floor(data.position / 1000);
              if (positionSeconds > 0) { // Avoid saving 0
                 savePositionThrottled(episode.id, positionSeconds);
              }
            }
          } else if (data.type === 'paused') {
            // Explicitly save position when paused
            if (currentUserId && episode?.id) {
              const positionSeconds = Math.floor(data.position / 1000);
              if (positionSeconds > 0) {
                console.log(`[AudioPlayer] Saving position on pause: ${positionSeconds}s`);
                savePositionThrottled.cancel(); // Cancel any pending throttled calls
                savePosition(episode.id, positionSeconds);
              }
            }
          } else if (data.type === 'error') {
            setError(data.error);
            setIsLoading(false);
          } else if (data.type === 'finished') {
            console.log('Audio playback finished, calling onComplete');
            
            if (onComplete) {
              onComplete();
            }
            
            if (sleepTimerActive) {
              handleSleepTimerEnd();
            }
          } else if (data.type === 'remote-next' && onNext) {
            onNext();
          } else if (data.type === 'remote-previous' && onPrevious) {
            onPrevious();
          }
        });
        
        return () => {
          unsubscribe();
          // Ensure the last position is saved when the component unmounts or episode changes
          if (episode?.id && currentUserId) {
            const currentPosition = Math.floor(position / 1000);
            if (currentPosition > 0) {
              console.log(`[AudioPlayer] Saving position on unmount: ${currentPosition}s`);
              savePosition(episode.id, currentPosition);
            }
          }
        };
      } catch (err) {
        console.error("Error in audio setup:", err);
        if (isMounted) {
          setError(`Erreur de configuration audio: ${err instanceof Error ? err.message : 'erreur inconnue'}`);
          setIsLoading(false);
        }
      }
    };
    
    setup();
    
    return () => {
      isMounted = false;
      savePositionThrottled.cancel(); // Cancel any pending throttled calls
    };
  }, [episode, onComplete, onNext, onPrevious, sleepTimerActive, isSeeking]); // Add episode and isSeeking dependencies

  // Add non-throttled save function for immediate saves
  const savePosition = async (episodeId: string, positionSeconds: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !episodeId) return; // Need user and episode ID

      const userId = user.id;
      const timestamp = new Date().toISOString();

      const pendingPositionsJSON = await AsyncStorage.getItem(PENDING_POSITIONS_KEY);
      let pendingPositions: PendingPosition[] = pendingPositionsJSON ? JSON.parse(pendingPositionsJSON) : [];

      // Find existing entry for this user and episode
      const existingIndex = pendingPositions.findIndex(p => p.userId === userId && p.episodeId === episodeId);

      const newPositionData: PendingPosition = { episodeId, positionSeconds, userId, timestamp };

      if (existingIndex !== -1) {
        // Update existing entry
        pendingPositions[existingIndex] = newPositionData;
      } else {
        // Add new entry
        pendingPositions.push(newPositionData);
      }

      await AsyncStorage.setItem(PENDING_POSITIONS_KEY, JSON.stringify(pendingPositions));
      console.log(`[AudioPlayer] Position saved immediately for ${episodeId}: ${positionSeconds}s`);

    } catch (error) {
      console.error('[AudioPlayer] Error saving immediate playback position:', error);
    }
  };

  // Mesurer la barre de progression après le rendu
  useEffect(() => {
    if (!isLoading) {
      setTimeout(() => {
        measureProgressBar();
      }, 300);
    }
  }, [isLoading]);

  // Gestionnaire de glissement pour le curseur de progression
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      setIsSeeking(true);
    },
    onPanResponderMove: (e: GestureResponderEvent) => {
      if (progressWidth.current <= 0) return;
      
      // Calculer la nouvelle position basée sur le toucher
      const touchX = e.nativeEvent.pageX - progressPosition.current.x;
      const percentage = Math.max(0, Math.min(touchX / progressWidth.current, 1));
      const newPosition = percentage * duration;
      
      // Mettre à jour uniquement la position visuelle pendant le glissement
      setPosition(newPosition);
    },
    onPanResponderRelease: async (e: GestureResponderEvent) => {
      if (progressWidth.current <= 0) {
        setIsSeeking(false);
        return;
      }
      
      try {
        // Calculer la position finale
        const touchX = e.nativeEvent.pageX - progressPosition.current.x;
        const percentage = Math.max(0, Math.min(touchX / progressWidth.current, 1));
        const newPosition = percentage * duration;
        
        // Appliquer la nouvelle position à l'audio
        await audioManager.seekTo(newPosition);
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

  // Mesurer les dimensions de la barre de progression
  const measureProgressBar = () => {
    if (progressBarRef.current) {
      progressBarRef.current.measure((x, y, width, height, pageX, pageY) => {
        progressWidth.current = width;
        progressPosition.current = { x: pageX, y: pageY };
      });
    }
  };

  // Gérer le bouton play/pause
  async function handlePlayPause() {
    try {
      if (isPlaying) {
        await audioManager.pause();
        // Position is now saved via the 'paused' event listener
      } else {
        await audioManager.play();
      }
    } catch (err) {
      console.error("Error toggling playback:", err);
      setError(`Erreur de lecture: ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    }
  }
  
  // Make a dedicated function to handle when paused to ensure position is always saved
  useEffect(() => {
    // If the episode changed or playback stopped, save the current position
    if (!isPlaying && episode?.id && position > 0) {
      // Delay slightly to ensure we have the latest position
      const timer = setTimeout(() => {
        const positionSeconds = Math.floor(position / 1000);
        if (positionSeconds > 0) {
          console.log(`[AudioPlayer] Saving position after pause: ${positionSeconds}s`);
          savePosition(episode.id, positionSeconds);
        }
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [isPlaying, episode?.id]);

  // Add useEffect to save position periodically more frequently
  useEffect(() => {
    if (!episode?.id || !isPlaying) return;
    
    // Save position more frequently (every 10 seconds)
    const saveInterval = setInterval(() => {
      const positionSeconds = Math.floor(position / 1000);
      if (positionSeconds > 0) {
        console.log(`[AudioPlayer] Saving position on interval: ${positionSeconds}s`);
        // Use the non-throttled version for more reliability
        savePosition(episode.id, positionSeconds);
      }
    }, 10000);
    
    return () => clearInterval(saveInterval);
  }, [episode?.id, isPlaying, position]);

  // Add useEffect to catch app background/foreground transitions
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        // App is going to background, save position immediately
        if (episode?.id && isPlaying) {
          const currentPosition = Math.floor(position / 1000);
          if (currentPosition > 0) {
            savePositionThrottled.flush(); // Execute any pending saves immediately
          }
        }
      }
    });
    
    return () => {
      subscription.remove();
    };
  }, [episode, isPlaying, position]);

  // Avancer ou reculer
  async function handleSeek(seconds: number) {
    try {
      await audioManager.seekRelative(seconds);
    } catch (err) {
      console.error("Error seeking:", err);
    }
  }

  // Skip auditeurs function
  async function handleSkipAuditors() {
    try {
      await audioManager.seekRelative(generalData.skipAudtorsTime);
      console.log("Skipped 10 minutes forward");
    } catch (err) {
      console.error("Error skipping 10 minutes:", err);
    }
  }

  // Fonction pour activer/désactiver le minuteur de sommeil
  function toggleSleepTimer() {
    setSleepTimerActive(prevState => !prevState);
    console.log(`Sleep timer ${!sleepTimerActive ? 'activated' : 'deactivated'}`);
  }

  // Fonction pour gérer la fin du minuteur de sommeil
  async function handleSleepTimerEnd() {
    try {
      await audioManager.stop();
      setSleepTimerActive(false);
      console.log("Sleep timer completed - closing app now");
      
      Alert.alert(
        "Minuteur de sommeil terminé",
        "L'application va se fermer dans 5 secondes...",
        [{ text: "OK" }]
      );
      
      setTimeout(() => {
        if (Platform.OS === 'android') {
          // Solution plus fiable pour quitter sur Android
          BackHandler.exitApp();
          // Forcer la fermeture avec une solution alternative
          setTimeout(() => {
            // Forcer l'arrêt de l'application si BackHandler.exitApp() ne fonctionne pas
            console.log("Forcing app exit with process.exit()");
            global.process.exit(0);
          }, 500);
        } else if (Platform.OS === 'ios') {
          // Code iOS inchangé
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

  // Calculer la progression en pourcentage
  // Note: position and duration state are in milliseconds here
  const progress = duration > 0 ? (position / duration) * 100 : 0;

  // Affichage pendant le chargement
  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.loadingText}>Chargement...</Text>
      </View>
    );
  }

  // Affichage en cas d'erreur
  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity 
          style={styles.retryButton} 
          onPress={() => {
            setError(null);
            setIsLoading(true);
            // Notify parent to reload instead
            if (onComplete) {
              onComplete(); // Use onComplete to trigger a reload from parent
            }
          }}
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
      {/* Titre et description */}
      <Text style={styles.title}>{episode.title}</Text>
      <Text style={styles.description} numberOfLines={2} ellipsizeMode="tail">
        {episode.description}
      </Text>
      
      {/* Barre de progression avec curseur */}
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
        
        {/* Affichage du temps */}
        <View style={styles.timeContainer}>
          {/* Convert ms state to seconds for formatTime */}
          <Text style={styles.timeText}>{formatTime(position / 1000)}</Text> 
          <Text style={styles.timeText}>-{formatTime(Math.max(0, (duration - position) / 1000))}</Text>
        </View>
      </View>

      {/* Contrôles de lecture */}
      <View style={styles.controls}>
        <TouchableOpacity onPress={onPrevious} style={styles.button}>
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
        
        <TouchableOpacity onPress={onNext} style={styles.button}>
          <MaterialIcons name="skip-next" size={32} color={theme.colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.additionalControls}>
        {/* Bouton "Passer les auditeurs" */}
        <TouchableOpacity onPress={handleSkipAuditors} style={styles.skipButton}>
          <MaterialIcons name="next-plan" size={20} color={theme.colors.text} />
          <Text style={styles.skipText}>Skip auditeurs</Text>
        </TouchableOpacity>

        {/* Bouton minuteur de sommeil */}
        <TouchableOpacity 
          onPress={toggleSleepTimer} 
          style={[styles.sleepButton, sleepTimerActive && styles.sleepButtonActive]}
        >
          <MaterialIcons name="timer" size={20} color={sleepTimerActive ? theme.colors.text : theme.colors.description} />
          <Text style={[styles.sleepText, sleepTimerActive && styles.sleepTextActive]}>
            {sleepTimerActive ? 'Sleep actif' : 'Sleep timer'}
          </Text>
        </TouchableOpacity>
      </View>
      
      {/* Indicateur de mise en mémoire tampon */}
      {isBuffering && (
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
    paddingHorizontal: 15,
    // backgroundColor: theme.colors.primaryBackground,
    flex: 1,
    justifyContent: 'flex-end', // Main content aligns to bottom
    alignItems: 'center', // Center children horizontally by default
    // ...Platform.select({
    //   ios: {
    //     shadowColor: theme.colors.shadowColor,
    //     shadowOffset: { width: 0, height: 2 },
    //     shadowOpacity: 0.25,
    //     shadowRadius: 3.84,
    //   },
    //   android: {
    //     elevation: 5,
    //   },
    //   web: {
    //     boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
    //   },
    // }),
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 16,
    color: theme.colors.description,
    marginBottom: 30,
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
    backgroundColor: 'transparent', // Transparent pour capter les touches sur une plus grande surface
  },
  progressBackground: {
    position: 'absolute',
    width: '100%',
    height: 8,
    backgroundColor: theme.colors.borderColor,
    borderRadius: 4,
    top: '50%',
    marginTop: -4,
  },
  progressBar: {
    position: 'absolute',
    height: 8,
    backgroundColor: theme.colors.primary,
    borderRadius: 4,
    top: '50%',
    marginTop: -4,
  },
  progressKnob: {
    position: 'absolute',
    width: 16,
    height: 16,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: theme.colors.text,
    top: '50%',
    marginLeft: -8,
    marginTop: -8,
    elevation: 2,
    shadowColor: theme.colors.shadowColor,
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
    color: theme.colors.text,
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
    backgroundColor: theme.colors.buttonBackground,
    width: 76,
    height: 76,
    borderRadius: 38, // Half of width/height for perfect circle
    marginHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: theme.colors.text,
    fontSize: 16,
    marginTop: 10,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: theme.colors.borderColor,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  retryText: {
    color: theme.colors.text,
    fontSize: 14,
  },
  debugContainer: {
    marginTop: 10,
    padding: 8,
    backgroundColor: theme.colors.borderColor,
    borderRadius: 4,
    width: '100%',
  },
  debugUrl: {
    color: theme.colors.description,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
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
    padding: 10,
    borderRadius: 30,
    gap: 8,
  },
  skipText: {
    color: theme.colors.text,
    fontSize: 14,
  },
  sleepButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: theme.colors.borderColor,
    padding: 10,
    borderRadius: 30,
    borderWidth: 1,
    gap: 8,
  },
  sleepButtonActive: {
    backgroundColor: theme.colors.borderColor,
    borderColor: theme.colors.borderColor,
  },
  sleepText: {
    color: theme.colors.description,
    fontSize: 14,
  },
  sleepTextActive: {
    color: theme.colors.text,
    fontSize: 14,
  },
  bufferingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
    zIndex: 10,
  },
  bufferingText: {
    color: theme.colors.text,
    fontSize: 12,
    marginLeft: 6,
  }
});