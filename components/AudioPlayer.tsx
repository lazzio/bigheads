import { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator, BackHandler, Alert, PanResponder, GestureResponderEvent } from 'react-native';
import { Play, Pause, SkipBack, SkipForward, Moon, Rewind, FastForward, Forward } from 'lucide-react-native';
import { Episode } from '../types/episode';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { audioManager, formatTime } from '../utils/OptimizedAudioService';

interface AudioPlayerProps {
  episode: Episode;
  onNext?: () => void;
  onPrevious?: () => void;
  onComplete?: () => void;
}

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
    
    const setup = async () => {
      try {
        await audioManager.setupAudio();
        
        // Ajouter un écouteur pour les mises à jour d'état
        const unsubscribe = audioManager.addListener((data) => {
          if (!isMounted) return;
          
          if (data.type === 'loaded') {
            setDuration(data.duration);
            setIsLoading(false);
            setError(null);
          } else if (data.type === 'status') {
            if (!isSeeking) {
              setPosition(data.position);
            }
            setDuration(data.duration);
            setIsPlaying(data.isPlaying);
            setIsBuffering(data.isBuffering);
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
    };
  }, [onComplete, sleepTimerActive]);

  // Charger le nouvel épisode quand il change
  useEffect(() => {
    if (episode?.mp3Link || episode?.offline_path) {
      loadEpisode();
    }
  }, [episode]);

  // Mesurer la barre de progression après le rendu
  useEffect(() => {
    if (!isLoading) {
      setTimeout(() => {
        measureProgressBar();
      }, 300);
    }
  }, [isLoading]);

  // Charger l'épisode
  async function loadEpisode() {
    try {
      setIsLoading(true);
      setError(null);
      
      // Journalisation détaillée pour le débogage
      // console.log('========= CHARGEMENT ÉPISODE =========');
      // console.log('Titre:', episode?.title);
      // console.log('Mode hors-ligne:', isOffline ? 'OUI' : 'NON');
      // console.log('Chemin local:', episode?.offline_path || 'NON DISPONIBLE');
      // console.log('URL distante:', episode?.mp3Link || 'NON DISPONIBLE');
      
      // S'assurer que le chemin offline est prioritaire
      const episodeToLoad = {
        ...episode,
        mp3Link: episode.offline_path || episode.mp3Link
      };
      
      // Maintenant charger avec le chemin prioritaire
      await audioManager.loadEpisode(episodeToLoad);
      
    } catch (err) {
      console.error("Error loading episode:", err);
      setError(`Impossible de charger l'audio: ${err instanceof Error ? err.message : 'erreur inconnue'}`);
      setIsLoading(false);
    }
  }

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
      } else {
        await audioManager.play();
      }
    } catch (err) {
      console.error("Error toggling playback:", err);
      setError(`Erreur de lecture: ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    }
  }

  // Avancer ou reculer
  async function handleSeek(seconds: number) {
    try {
      await audioManager.seekRelative(seconds);
    } catch (err) {
      console.error("Error seeking:", err);
    }
  }

  // Fonction pour sauter 10 minutes (600 secondes)
  async function handleSkip10Minutes() {
    try {
      await audioManager.seekRelative(600);
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
  const progress = duration > 0 ? (position / duration) * 100 : 0;

  // Affichage pendant le chargement
  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0ea5e9" />
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
          onPress={loadEpisode}
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
          <Text style={styles.timeText}>{formatTime(position)}</Text>
          <Text style={styles.timeText}>-{formatTime(Math.max(0, duration - position))}</Text>
        </View>
      </View>

      {/* Contrôles de lecture */}
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
        {/* Bouton "Passer les auditeurs" */}
        <TouchableOpacity onPress={handleSkip10Minutes} style={styles.skipButton}>
          <Forward size={20} color="#fff" />
          <Text style={styles.skipText}>Passer les auditeurs</Text>
        </TouchableOpacity>

        {/* Bouton minuteur de sommeil */}
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
      
      {/* Indicateur de mise en mémoire tampon */}
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
    height: 20, // Plus grand pour faciliter le toucher
    justifyContent: 'center',
    backgroundColor: 'transparent', // Transparent pour capter les touches sur une plus grande surface
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