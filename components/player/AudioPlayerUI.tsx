import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  PanResponder,
  GestureResponderEvent,
  Image,
} from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Episode } from '../../types/episode';
import { formatTime, durationToSeconds } from '../../utils/audioUtils';
import { theme } from '../../styles/global'; // Assuming global styles
import { SEEK_INTERVAL_SECONDS, SKIP_AUDITORS_SECONDS } from '../../utils/constants';

interface AudioPlayerUIProps {
  episode: Episode | null;
  isPlaying: boolean;
  isBuffering: boolean;
  isLoading: boolean; // Loading track state from AudioManager/Context
  position: number; // in seconds
  duration: number; // in seconds
  error: string | null;
  sleepTimerActive: boolean;

  onPlayPause: () => void;
  onSeek: (seconds: number) => void; // Absolute seek
  onSeekRelative: (deltaSeconds: number) => void; // Relative seek
  onNext: () => void;
  onPrevious: () => void;
  onToggleSleepTimer: () => void;
  onRetry: () => void; // Function to retry loading data/track
}

export const AudioPlayerUI: React.FC<AudioPlayerUIProps> = ({
  episode,
  isPlaying,
  isBuffering,
  isLoading,
  position,
  duration,
  error,
  sleepTimerActive,
  onPlayPause,
  onSeek,
  onSeekRelative,
  onNext,
  onPrevious,
  onToggleSleepTimer,
  onRetry,
}) => {
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPosition, setSeekPosition] = useState(0); // Position during seeking gesture

  // Refs for progress bar measurement
  const progressBarRef = useRef<View>(null);
  const progressWidth = useRef(0);
  const progressPosition = useRef({ x: 0, y: 0 });

  // Measure progress bar dimensions
  const measureProgressBar = useCallback(() => {
    if (progressBarRef.current) {
      progressBarRef.current.measure((x, y, width, height, pageX, pageY) => {
        progressWidth.current = width;
        progressPosition.current = { x: pageX, y: pageY };
      });
    }
  }, []);

  // Measure on layout changes or when loading finishes
  useEffect(() => {
    // Delay measurement slightly to ensure layout is stable
    const timeoutId = setTimeout(measureProgressBar, 300);
    return () => clearTimeout(timeoutId);
  }, [measureProgressBar, isLoading]); // Re-measure if loading state changes

  // PanResponder for seek bar interaction
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e, gestureState) => {
        setIsSeeking(true);
        // Calculate initial seek position based on touch
        const touchX = gestureState.x0 - progressPosition.current.x;
        const percentage = Math.max(0, Math.min(touchX / progressWidth.current, 1));
        setSeekPosition(percentage * duration);
      },
      onPanResponderMove: (e, gestureState) => {
        if (progressWidth.current <= 0) return;
        // Calculate new position based on touch movement
        const touchX = gestureState.moveX - progressPosition.current.x;
        const percentage = Math.max(0, Math.min(touchX / progressWidth.current, 1));
        setSeekPosition(percentage * duration);
      },
      onPanResponderRelease: () => {
        setIsSeeking(false);
        onSeek(seekPosition); // Trigger the actual seek action
      },
      onPanResponderTerminate: () => {
        // Handle interruption (e.g., call, alert)
        setIsSeeking(false);
        // Optionally revert or commit the seek position
        onSeek(seekPosition);
      },
    })
  ).current;

  // Calculate progress percentage
  const currentPosition = isSeeking ? seekPosition : position;
  const progressPercent = duration > 0 ? (currentPosition / duration) * 100 : 0;

  // --- Render Logic ---

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.statusText}>Chargement de l'épisode...</Text>
      </View>
    );
  }

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

  if (!episode) {
    return (
      <View style={styles.container}>
        <MaterialIcons name="hourglass-empty" size={48} color={theme.colors.description} />
        <Text style={styles.statusText}>Aucun épisode sélectionné</Text>
      </View>
    );
  }

  // Default artwork
  const artworkSource = episode.artworkUrl
    ? { uri: episode.artworkUrl }
    //: require('../../assets/images/bh_opti.png');
    : null;


  return (
    <GestureHandlerRootView style={styles.container}>
       {/* Artwork */}
       {/* <Image source={artworkSource} style={styles.artwork} /> */}

      {/* Titre et description */}
      <Text style={styles.title} numberOfLines={1}>{episode.title}</Text>
      <Text style={styles.description} numberOfLines={2} ellipsizeMode="tail">
        {episode.description}
      </Text>

      {/* Barre de progression avec curseur */}
      <View style={styles.progressContainer}>
        <View
          ref={progressBarRef}
          style={styles.progressBarTouchable}
          {...panResponder.panHandlers}
          onLayout={measureProgressBar} // Measure on layout
        >
          <View style={styles.progressBackground} />
          <View style={[styles.progressBar, { width: `${progressPercent}%` }]} />
          <View
            style={[
              styles.progressKnob,
              { left: `${progressPercent}%` },
              isSeeking && styles.progressKnobActive,
            ]}
          />
        </View>

        {/* Affichage du temps */}
        <View style={styles.timeContainer}>
          <Text style={styles.timeText}>{formatTime(currentPosition)}</Text>
          <Text style={styles.timeText}>-{formatTime(Math.max(0, duration - currentPosition))}</Text>
        </View>
      </View>

      {/* Contrôles de lecture */}
      <View style={styles.controls}>
        <TouchableOpacity onPress={onPrevious} style={styles.button} accessibilityLabel="Épisode précédent">
          <MaterialIcons name="skip-previous" size={32} color={theme.colors.text} />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => onSeekRelative(-SEEK_INTERVAL_SECONDS)} style={styles.button} accessibilityLabel={`Reculer de ${SEEK_INTERVAL_SECONDS} secondes`}>
          <MaterialIcons name="replay-30" size={32} color={theme.colors.text} />
        </TouchableOpacity>

        <TouchableOpacity onPress={onPlayPause} style={[styles.button, styles.playButton]} accessibilityLabel={isPlaying ? "Mettre en pause" : "Lire"}>
          {isPlaying ? (
            <MaterialIcons name="pause" size={52} color={theme.colors.text} />
          ) : (
            <MaterialIcons name="play-arrow" size={52} color={theme.colors.text} />
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => onSeekRelative(SEEK_INTERVAL_SECONDS)} style={styles.button} accessibilityLabel={`Avancer de ${SEEK_INTERVAL_SECONDS} secondes`}>
          <MaterialIcons name="forward-30" size={32} color={theme.colors.text} />
        </TouchableOpacity>

        <TouchableOpacity onPress={onNext} style={styles.button} accessibilityLabel="Épisode suivant">
          <MaterialIcons name="skip-next" size={32} color={theme.colors.text} />
        </TouchableOpacity>
      </View>

      {/* Contrôles additionnels */}
      <View style={styles.additionalControls}>
        <TouchableOpacity onPress={() => onSeekRelative(SKIP_AUDITORS_SECONDS)} style={styles.skipButton} accessibilityLabel={`Avancer de ${SKIP_AUDITORS_SECONDS / 60} minutes`}>
          <MaterialIcons name="fast-forward" size={20} color={theme.colors.text} />
          <Text style={styles.skipText}>Skip auditeurs</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onToggleSleepTimer}
          style={[styles.sleepButton, sleepTimerActive && styles.sleepButtonActive]}
          accessibilityLabel={sleepTimerActive ? "Désactiver le minuteur de sommeil" : "Activer le minuteur de sommeil"}
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
};

// Styles (garder les styles existants et adapter si nécessaire)
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
    // backgroundColor: theme.colors.primary, // Optional: highlight play button
    borderRadius: 40, // Make it circular
    padding: 15,
    marginHorizontal: 10, // Add horizontal margin
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
