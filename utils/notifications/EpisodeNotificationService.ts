import * as Notifications from 'expo-notifications';
import { supabase } from '../../lib/supabase';
import { Platform } from 'react-native';
import { setCurrentEpisodeId, getExpoPushToken, setExpoPushToken } from '../cache/LocalStorageService';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Initialize the notification service
export async function initEpisodeNotificationService(): Promise<void> {
  try {
    console.log('[EpisodeNotificationService] Initializing...');
    
    // Get and save push token (this function already handles permissions)
    const token = await registerForPushNotificationsAsync();

    if (token) {
      console.log('[EpisodeNotificationService] Token obtained:', token);
      // Attempt to save immediately (might have null user_id if not logged in yet)
      await savePushTokenToSupabase(token);
    } else {
      console.log('[EpisodeNotificationService] No push token obtained, skipping initial save.');
    }

    console.log('[EpisodeNotificationService] Initialization completed.');
  } catch (error) {
    console.error('[EpisodeNotificationService] Error initializing:', error);
    Sentry.captureException(error);
  }
}

// Set up a handler for received notifications
export function setupNotificationListener(onNotificationReceived: (episodeId: string) => void): () => void {
  console.log('[EpisodeNotificationService] Setting up notification listeners...');

  // Handle notifications when app is in foreground
  const foregroundSubscription = Notifications.addNotificationReceivedListener(notification => {
    console.log('[EpisodeNotificationService] Notification received in foreground:', notification);
    const episodeId = notification.request.content.data?.episodeId as string;
    if (episodeId && onNotificationReceived) {
      onNotificationReceived(episodeId);
    }
  });

  // Handle notification taps when app is in background/closed
  const backgroundSubscription = Notifications.addNotificationResponseReceivedListener(response => {
    console.log('[EpisodeNotificationService] Notification tapped:', response);
    const episodeId = response.notification.request.content.data?.episodeId as string;
    if (episodeId && onNotificationReceived) {
      onNotificationReceived(episodeId);
    }
  });

  // Return cleanup function
  return () => {
    console.log('[EpisodeNotificationService] Cleaning up notification listeners');
    foregroundSubscription.remove();
    backgroundSubscription.remove();
  };
}

// Test function for notifications
export async function testNotification(): Promise<void> {
  try {
    console.log('[EpisodeNotificationService] Sending test notification...');
    
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Test Notification 🧪',
        body: 'Ceci est un test de notification !',
        data: { episodeId: 'test-episode-id' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1 },
    });
    
    console.log('[EpisodeNotificationService] Test notification scheduled');
  } catch (error) {
    console.error('[EpisodeNotificationService] Error sending test notification:', error);
    Sentry.captureException(error);
  }
}

// Add this function to register for push notifications
async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    console.log('[EpisodeNotificationService] Requesting notification permissions...');
    
    // Check if running on physical device
    if (!Constants.isDevice) {
      console.warn('[EpisodeNotificationService] Must use physical device for push notifications');
      return null;
    }

    // Request permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      console.log('[EpisodeNotificationService] Failed to get push token for push notification!');
      return null;
    }

    // Get the project ID
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      console.error('[EpisodeNotificationService] EAS Project ID not found');
      Sentry.captureMessage('EAS Project ID not found for push notifications. Cannot get ExpoPushToken.');
      return null;
    }

    console.log('[EpisodeNotificationService] Getting Expo push token...');
    const token = (await Notifications.getExpoPushTokenAsync({
      projectId: projectId,
    })).data;
    
    console.log('[EpisodeNotificationService] Push token obtained:', token);
    
    // Store the token in AsyncStorage for later use
    await setExpoPushToken(token);
    
    return token;
  } catch (error) {
    console.error('[EpisodeNotificationService] Error getting push token:', error);
    Sentry.captureException(error);
    return null;
  }
}

// Add this function to store push tokens in Supabase
async function savePushTokenToSupabase(token: string): Promise<void> {
  try {
    console.log('[EpisodeNotificationService] Saving push token to Supabase...');
    
    // Get user ID from auth state if available
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id;
    
    console.log('[EpisodeNotificationService] User ID:', userId || 'null (not logged in)');
    
    // Store the token
    const { error } = await supabase
      .from('device_tokens')
      .upsert({
        token: token,
        user_id: userId || null,
        platform: Platform.OS,
        active: true,
        last_active: new Date().toISOString()
      }, {
        onConflict: 'token'
      });
      
    if (error) {
      console.error('[EpisodeNotificationService] Error saving push token:', error);
      Sentry.captureException(error);
    } else {
      console.log('[EpisodeNotificationService] Push token saved to Supabase successfully');
    }
  } catch (error) {
    console.error('[EpisodeNotificationService] Error in savePushTokenToSupabase:', error);
    Sentry.captureException(error);
  }
}

// --- NOUVELLE FONCTION EXPORTÉE ---
/**
 * Attempts to save the push token stored in AsyncStorage to Supabase.
 * Should be called after user login to ensure user_id is associated.
 */
export async function syncPushTokenAfterLogin(): Promise<void> {
  try {
    console.log('[EpisodeNotificationService] Syncing push token after login...');
    
    const token = await getExpoPushToken();
    if (token) {
      console.log('[EpisodeNotificationService] Found token in storage, attempting to sync with user ID.');
      await savePushTokenToSupabase(token); // This will now likely have the user ID
    } else {
      console.log('[EpisodeNotificationService] No token found in storage.');
    }
  } catch (error) {
    console.error('[EpisodeNotificationService] Error syncing push token:', error);
    Sentry.captureException(error);
  }
}