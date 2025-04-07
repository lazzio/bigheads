import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Episode } from '../types/episode';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldPresent: true,
  }),
});

interface PlaybackStatus {
  isPlaying: boolean;
  positionMillis: number;
  durationMillis: number;
}

let currentNotificationId: string | null = null;

export async function updatePlaybackNotification(
  episode: Episode,
  status: PlaybackStatus,
) {
  if (Platform.OS !== 'android') return;

  try {
    // Si une notification existe déjà, la supprimer
    if (currentNotificationId) {
      await Notifications.dismissNotificationAsync(currentNotificationId);
    }

    const notification = {
      title: episode.title,
      body: episode.description,
      data: { episodeId: episode.id },
      android: {
        channelId: 'playback',
        ongoing: true,
        actions: [
          {
            title: status.isPlaying ? '⏸️' : '▶️',
            identifier: 'PLAY_PAUSE'
          },
          {
            title: '⏭️',
            identifier: 'NEXT'
          }
        ],
        progress: {
          max: status.durationMillis,
          current: status.positionMillis,
          indeterminate: false
        },
        smallIcon: 'ic_notification',
        largeIcon: 'ic_notification',
        color: '#b48d7b',
        sticky: true,
        category: 'transport',
        importance: Notifications.AndroidImportance.LOW,
        visibility: 'public',
      }
    };

    const result = await Notifications.scheduleNotificationAsync({
      content: notification,
      trigger: null
    });

    currentNotificationId = result;
  } catch (error) {
    console.error('Error updating notification:', error);
  }
}

export async function removePlaybackNotification() {
  if (Platform.OS !== 'android') return;
  
  try {
    if (currentNotificationId) {
      await Notifications.dismissNotificationAsync(currentNotificationId);
      currentNotificationId = null;
    }
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
      bypassDnd: true,
    });
  }
}