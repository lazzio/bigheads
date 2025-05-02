import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';

// Initialize the notification service
export async function initEpisodeNotificationService(): Promise<void> {
  try {
    // Get and save push token (this function already handles permissions)
    const token = await registerForPushNotificationsAsync();

    if (token) {
      // Attempt to save immediately (might have null user_id if not logged in yet)
      await savePushTokenToSupabase(token);
    } else {
      console.log('No push token obtained, skipping initial save.');
      // No token means permissions likely denied or error occurred.
    }

    console.log('Episode notification service initialization attempt finished.');
  } catch (error) {
    console.error('Error initializing notification service:', error);
    Sentry.captureException(error); // Assurer la capture d'erreur
  }
}

// Set up a handler for received notifications
export function setupNotificationListener(onNotificationReceived: (episodeId: string) => void): () => void {
  // Make sure to set the correct behavior for foreground notifications
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      priority: Notifications.AndroidNotificationPriority.HIGH,
    }),
  });

  // Add this to ensure proper handling of notification taps
  const subscription = Notifications.addNotificationResponseReceivedListener(response => {
    console.log('[NotificationService] User tapped on notification', response);
    
    // Get episodeId from the notification
    const episodeId = response.notification.request.content.data?.episodeId;
    if (episodeId) {
      console.log(`[NotificationService] Processing notification tap for episode ${episodeId}`);
      
      // Save this as the last requested episode in case the app gets killed before loading
      try {
        AsyncStorage.setItem('lastRequestedEpisodeId', episodeId);
        console.log(`[NotificationService] Saved ${episodeId} as the last requested episode`);
      } catch (error) {
        console.error('[NotificationService] Error saving last requested episode:', error);
      }
      
      // Call the callback to handle navigation
      onNotificationReceived(episodeId);
    }
  });

  return () => {
    subscription.remove();
  };
}

// Test function for notifications
export async function testNotification(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Notification test',
      body: 'This is a notification test for BigHeads Integrals',
      data: { test: true },
    },
    trigger: null,
  });
  
  console.log('Test notification sent');
}

// Add this function to register for push notifications
async function registerForPushNotificationsAsync(): Promise<string | null> {
  // Request permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  if (finalStatus !== 'granted') {
    console.log('Failed to get push token for push notification!');
    return null;
  }
  
  // Get the token
  try {
    const token = (await Notifications.getExpoPushTokenAsync({
      projectId: process.env.EXPO_PROJECT_ID, // Add this to your app.config.ts or app.json
    })).data;
    
    console.log('Push token:', token);
    
    // Store the token in AsyncStorage for later use
    await AsyncStorage.setItem('expoPushToken', token);
    
    return token;
  }
  catch (error) {
    console.error('Error getting push token:', error);
    Sentry.captureException(error);

    return null;
  }
}

// Add this function to store push tokens in Supabase
async function savePushTokenToSupabase(token: string): Promise<void> {
  try {
    // Get user ID from auth state if available
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id;
    
    // Store the token
    const { error } = await supabase
      .from('device_tokens')
      .upsert({
        token: token,
        user_id: userId || null,
        platform: Platform.OS,
        last_active: new Date().toISOString()
      }, {
        onConflict: 'token'
      });
      
    if (error) {
      console.error('Error saving push token:', error);
    } else {
      console.log('Push token saved to Supabase');
    }
  } catch (error) {
    console.error('Error in savePushTokenToSupabase:', error);
  }
}

// --- NOUVELLE FONCTION EXPORTÉE ---
/**
 * Attempts to save the push token stored in AsyncStorage to Supabase.
 * Should be called after user login to ensure user_id is associated.
 */
export async function syncPushTokenAfterLogin(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem('expoPushToken');
    if (token) {
      console.log('[syncPushTokenAfterLogin] Found token in storage, attempting to sync with user ID.');
      await savePushTokenToSupabase(token); // This will now likely have the user ID
    } else {
      console.log('[syncPushTokenAfterLogin] No token found in storage.');
    }
  } catch (error) {
    console.error('[syncPushTokenAfterLogin] Error syncing push token:', error);
    Sentry.captureException(error);
  }
}