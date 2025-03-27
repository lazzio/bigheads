import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Pressable } from 'react-native';
import { Audio } from 'expo-av';
import { Play, Pause, SkipBack, SkipForward, Moon, Rewind, FastForward, Forward as Forward10 } from 'lucide-react-native';
import { Episode } from '../types/episode';

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
  const [sleepTimerActive, setSleepTimerActive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressBarRef = useRef<View>(null);

  useEffect(() => {
    return () => {
      if (Platform.OS === 'web') {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = '';
        }
      } else if (sound) {
        sound.unloadAsync();
      }
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') {
      setupWebAudio();
    } else {
      setupNativeAudio();
    }
  }, [episode]);

  function setupWebAudio() {
    try {
      setIsLoading(true);
      setError(null);

      const audio = new window.Audio(episode.mp3Link);
      audioRef.current = audio;
      
      audio.addEventListener('loadedmetadata', () => {
        setDuration(audio.duration * 1000);
        setIsLoading(false);
      });

      audio.addEventListener('timeupdate', () => {
        if (!isSeeking) {
          setPosition(audio.currentTime * 1000);
        }
      });

      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        onComplete?.();
        if (sleepTimerActive) {
          handleSleepTimer();
        }
      });

      audio.addEventListener('error', () => {
        setError('Erreur lors du chargement de l\'audio');
        setIsLoading(false);
      });

      audio.load();
    } catch (err) {
      setError('Erreur lors du chargement de l\'audio');
      console.error('Error setting up web audio:', err);
      setIsLoading(false);
    }
  }

  async function setupNativeAudio() {
    try {
      setIsLoading(true);
      setError(null);

      if (sound) {
        await sound.unloadAsync();
      }

      await Audio.setAudioModeAsync({
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
      });

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: episode.mp3Link },
        { shouldPlay: false },
        onPlaybackStatusUpdate
      );

      setSound(newSound);

      const status = await newSound.getStatusAsync();
      if (status.isLoaded) {
        setDuration(status.durationMillis || 0);
      }
    } catch (err) {
      setError('Erreur lors du chargement de l\'audio');
      console.error('Error loading native audio:', err);
    } finally {
      setIsLoading(false);
    }
  }

  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      if (!isSeeking) {
        setPosition(status.positionMillis);
      }
      setIsPlaying(status.isPlaying);

      if (status.didJustFinish) {
        setIsPlaying(false);
        onComplete?.();
        if (sleepTimerActive) {
          handleSleepTimer();
        }
      }
    }
  };

  const handlePlayPause = async () => {
    try {
      if (Platform.OS === 'web' && audioRef.current) {
        if (isPlaying) {
          audioRef.current.pause();
        } else {
          await audioRef.current.play();
        }
        setIsPlaying(!isPlaying);
      } else if (sound) {
        if (isPlaying) {
          await sound.pauseAsync();
        } else {
          await sound.playAsync();
        }
      }
    } catch (err) {
      setError('Erreur lors de la lecture');
      console.error('Error playing/pausing:', err);
    }
  };

  const handleSleepTimer = () => {
    setSleepTimerActive(!sleepTimerActive);
  };

  const handleSeek = async (seconds: number) => {
    try {
      if (Platform.OS === 'web' && audioRef.current) {
        const newTime = Math.max(0, Math.min(audioRef.current.currentTime + seconds, audioRef.current.duration));
        audioRef.current.currentTime = newTime;
      } else if (sound) {
        const newPosition = Math.max(0, Math.min(position + seconds * 1000, duration));
        await sound.setPositionAsync(newPosition);
      }
    } catch (err) {
      setError('Erreur lors de la recherche');
      console.error('Error seeking:', err);
    }
  };

  const handleSkip10Minutes = async () => {
    await handleSeek(600); // 600 seconds = 10 minutes
  };

  const handleProgressBarPress = async (event: any) => {
    try {
      if (!progressBarRef.current) return;

      progressBarRef.current.measure((x, y, width, height, pageX, pageY) => {
        const touchX = event.nativeEvent.pageX - pageX;
        const percentage = Math.max(0, Math.min(touchX / width, 1));
        const newPosition = percentage * duration;

        setPosition(newPosition);
        
        if (Platform.OS === 'web' && audioRef.current) {
          audioRef.current.currentTime = newPosition / 1000;
        } else if (sound) {
          sound.setPositionAsync(newPosition);
        }
      });
    } catch (err) {
      console.error('Error seeking:', err);
    }
  };

  const formatTime = (milliseconds: number) => {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Chargement de l'audio...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity 
          style={styles.retryButton} 
          onPress={Platform.OS === 'web' ? setupWebAudio : setupNativeAudio}
        >
          <Text style={styles.retryText}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const progress = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{episode.title}</Text>
      <Text style={styles.description}>{episode.description}</Text>
      
      <View style={styles.progressContainer}>
        <Pressable 
          ref={progressBarRef}
          onPress={handleProgressBarPress}
          style={styles.progressBarContainer}
        >
          <View style={styles.progressBackground} />
          <View style={[styles.progressBar, { width: `${progress}%` }]} />
        </Pressable>
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

      <TouchableOpacity
        onPress={handleSkip10Minutes}
        style={styles.skipButton}
      >
        <Forward10 size={20} color="#fff" />
        <Text style={styles.skipText}>Passer les auditeurs</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={handleSleepTimer}
        style={[styles.sleepButton, sleepTimerActive && styles.sleepButtonActive]}
      >
        <Moon size={20} color={sleepTimerActive ? '#fff' : '#888'} />
        <Text style={[styles.sleepText, sleepTimerActive && styles.sleepTextActive]}>
          {sleepTimerActive ? 'Minuteur actif' : 'Arrêt après cet épisode'}
        </Text>
      </TouchableOpacity>
    </View>
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
  },
  progressContainer: {
    width: '100%',
    marginBottom: 20,
  },
  progressBarContainer: {
    width: '100%',
    height: 8,
    backgroundColor: '#333',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBackground: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundColor: '#333',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#0ea5e9',
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
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
  skipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#333',
    padding: 12,
    borderRadius: 20,
    marginBottom: 12,
    gap: 8,
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
  loadingText: {
    color: '#fff',
    fontSize: 16,
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
  },
  retryText: {
    color: '#fff',
    fontSize: 14,
  },
});