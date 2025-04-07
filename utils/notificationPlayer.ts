import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import { Episode } from '../types/episode';

// Configuration des notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
    presentationOptions: ['banner'],
  }),
});

interface PlaybackStatus {
  isPlaying: boolean;
  positionMillis: number;
  durationMillis: number;
}

export async function updatePlaybackNotification(
  episode: Episode,
  status: PlaybackStatus,
) {
  if (Platform.OS === 'web') return;

  try {
    const notification = {
      title: episode.title,
      body: episode.description,
      data: { episodeId: episode.id },
      android: {
        channelId: 'playback',
        ongoing: true,
        actions: [
          {
            title: status.isPlaying ? '⏸️ Pause' : '▶️ Play',
            identifier: 'PLAY_PAUSE'
          },
          {
            title: '⏭️ Suivant',
            identifier: 'NEXT'
          }
        ],
        smallIcon: 'ic_notification',
        largeIcon: 'ic_notification',
        color: '#b48d7b',
        autoCancel: false,
        sticky: true,
        category: 'transport',
        importance: Notifications.AndroidImportance.LOW,
        visibility: 'public',
      }
    };

    // Ne mettre à jour la notification que lors des changements d'état (play/pause)
    await Notifications.scheduleNotificationAsync({
      content: notification,
      trigger: null
    });
  } catch (error) {
    console.error('Error updating notification:', error);
  }
}

export async function removePlaybackNotification() {
  if (Platform.OS === 'web') return;
  
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch (error) {
    console.error('Error removing notification:', error);
  }
}

export async function setupNotificationChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('playback', {
      name: 'Lecture audio',
      importance: Notifications.AndroidImportance.LOW,
      vibrationPattern: [0, 0, 0],
      lightColor: '#b48d7b',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: false,
      enableLights: false,
      enableVibrate: false,
      bypassDnd: false,
    });
  }
}