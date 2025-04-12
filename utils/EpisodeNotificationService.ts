import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Initialize the notification service
export async function initEpisodeNotificationService(): Promise<void> {
  try {
    // Get and save push token
    const token = await registerForPushNotificationsAsync();
    
    if (token) {
      await savePushTokenToSupabase(token);
    }
    
    // Request notification permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    // Only ask for permission if not already determined
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      console.warn('Notification permissions were not granted');
    }
    
    console.log('Episode notification service successfully initialized');
  } catch (error) {
    console.error('Error initializing notification service:', error);
  }
}

// Set up a handler for received notifications
export function setupNotificationListener(onNotificationReceived: (episodeId: string) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(response => {
    const episodeId = response.notification.request.content.data?.episodeId;
    if (episodeId) {
      onNotificationReceived(episodeId);
    }
  });
  
  return () => subscription.remove();
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
  const token = (await Notifications.getExpoPushTokenAsync({
    projectId: process.env.EXPO_PROJECT_ID, // Add this to your app.config.ts or app.json
  })).data;
  
  console.log('Push token:', token);
  
  // Store the token in AsyncStorage for later use
  await AsyncStorage.setItem('expoPushToken', token);
  
  // Return the token
  return token;
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