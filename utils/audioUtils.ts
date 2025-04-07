import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as Notifications from 'expo-notifications';

// Configuration optimale du mode audio
export async function setupOptimalAudioMode() {
  try {
    await Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });
  } catch (err) {
    console.error('Error setting audio mode:', err);
    throw err;
  }
}

// Chargement audio avec retry et timeout
export async function loadSoundWithRetry(
  uri: string,
  maxRetries = 3,
  timeout = 15000
): Promise<Audio.Sound | null> {
  let attempts = 0;
  
  while (attempts < maxRetries) {
    try {
      const sound = new Audio.Sound();
      
      // Promise avec timeout
      const loadPromise = sound.loadAsync(
        { uri },
        { shouldPlay: false, progressUpdateIntervalMillis: 500 }
      );
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Loading timeout')), timeout);
      });
      
      await Promise.race([loadPromise, timeoutPromise]);
      
      const status = await sound.getStatusAsync();
      if (status.isLoaded) {
        return sound;
      }
      
      throw new Error('Sound not properly loaded');
    } catch (err) {
      attempts++;
      if (attempts === maxRetries) {
        console.error('Max retries reached for loading sound:', err);
        return null;
      }
      
      // Attente exponentielle entre les tentatives
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempts) * 1000));
    }
  }
  
  return null;
}

// Mise à jour de la notification de lecture
export async function updatePlaybackNotification(
  isPlaying: boolean,
  episodeTitle: string,
  episodeId: string
) {
  try {
    if (isPlaying) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Lecture en cours',
          body: episodeTitle,
          data: { episodeId },
        },
        trigger: null,
      });
    } else {
      await Notifications.dismissAllNotificationsAsync();
    }
  } catch (err) {
    console.warn('Error updating notification:', err);
  }
}

// Nettoyage des ressources audio
export async function cleanupAudioResources(sound: Audio.Sound | null) {
  if (!sound) return;
  
  try {
    const status = await sound.getStatusAsync();
    if (status.isLoaded) {
      await sound.stopAsync();
      await sound.unloadAsync();
    }
  } catch (err) {
    console.warn('Error cleaning up audio:', err);
  }
}