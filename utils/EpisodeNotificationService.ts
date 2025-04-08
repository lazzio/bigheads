import * as Notifications from 'expo-notifications';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Unique identifier for the episode checking task
const CHECK_NEW_EPISODES_TASK = 'xyz.myops.bigheads.check-new-episodes';

// Configure notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Time management functions (Paris)
/**
 * Converts a UTC time to Paris time accounting for daylight saving time
 */
function convertToParisTime(utcDate: Date): Date {
  // Create a date with Paris time
  const parisDate = new Date(utcDate.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  return parisDate;
}

/**
 * Converts Paris time to UTC for scheduling
 */
function getNextParisTime(hour: number, minute: number): Date {
  // Current date in UTC
  const now = new Date();
  
  // Convert to Paris time
  const parisNow = convertToParisTime(now);
  
  // Create the target time in Paris for today
  const targetParisTime = new Date(parisNow);
  targetParisTime.setHours(hour, minute, 0, 0);
  
  // If target time has already passed, add one day
  if (parisNow > targetParisTime) {
    targetParisTime.setDate(targetParisTime.getDate() + 1);
  }
  
  // Calculate the difference in milliseconds between now and the target time
  const parisTimeDiffMs = targetParisTime.getTime() - parisNow.getTime();
  
  // Add this difference to the current UTC date
  const targetUtcTime = new Date(now.getTime() + parisTimeDiffMs);
  
  return targetUtcTime;
}

// Define the episode checking task
TaskManager.defineTask(CHECK_NEW_EPISODES_TASK, async () => {
  try {
    const result = await checkForNewEpisodes();
    return result
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (error) {
    console.error('Error checking for new episodes:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// Function to check for new episodes
async function checkForNewEpisodes(): Promise<boolean> {
  try {
    // Get the current date in Paris time in YYYY-MM-DD format
    const parisToday = convertToParisTime(new Date());
    const formattedDate = parisToday.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Retrieve the last checked episode ID from storage
    const lastCheckedEpisodeId = await AsyncStorage.getItem('lastCheckedEpisodeId');
    
    console.log(`Checking for new episodes for date ${formattedDate} (Paris time)`);
    
    // Check if there's a new episode with today's publication date
    const { data, error } = await supabase
      .from('episodes')
      .select('id, title, description')
      .eq('publication_date', formattedDate)
      .order('id', { ascending: false })
      .limit(1);
    
    if (error) {
      console.error('Error in Supabase request:', error);
      return false;
    }
    
    // If there's a new episode and it's different from the last checked one
    if (data && data.length > 0 && data[0].id !== lastCheckedEpisodeId) {
      const newEpisode = data[0];
      
      // Save the new episode as last checked
      await AsyncStorage.setItem('lastCheckedEpisodeId', newEpisode.id);
      
      // Reset the retry counter since we found an episode
      await AsyncStorage.setItem('episodeCheckRetryCount', '0');
      
      // Send a notification
      await sendNewEpisodeNotification(newEpisode);
      
      console.log('New episode detected and notification sent:', newEpisode.title);
      return true;
    }
    
    // Check current time in Paris for potential rescheduling
    const parisCurrentHour = parisToday.getHours();
    const parisCurrentMinutes = parisToday.getMinutes();
    
    // If we're around 17:30, implement the retry logic
    if (parisCurrentHour === 17 && parisCurrentMinutes >= 25) {
      // Get the current retry count
      const retryCountStr = await AsyncStorage.getItem('episodeCheckRetryCount') || '0';
      const retryCount = parseInt(retryCountStr, 10);
      
      if (retryCount < 2) {
        // If we haven't reached our retry limit, schedule a check in 30 minutes
        console.log(`No episode found. Scheduling retry ${retryCount + 1} in 30 minutes`);
        await AsyncStorage.setItem('episodeCheckRetryCount', (retryCount + 1).toString());
        scheduleNextCheck(30); // Check again in 30 minutes
      } else {
        // Reset the counter after the last retry
        await AsyncStorage.setItem('episodeCheckRetryCount', '0');
        console.log('No episode found after 2 retries. Scheduling next regular check.');
        // After 2 retries, go back to regular hourly schedule
        scheduleNextCheck(60);
      }
    } else if ((parisCurrentHour === 17 && parisCurrentMinutes >= 30) || parisCurrentHour > 17) {
      // We're past 5:30 PM Paris time, schedule a new check in 1 hour
      scheduleNextCheck(60);
    }
    
    return false;
  } catch (error) {
    console.error('Error checking for new episodes:', error);
    return false;
  }
}

// Send notification for a new episode
async function sendNewEpisodeNotification(episode: { id: string, title: string, description: string }): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'New episode available!',
      body: episode.title,
      data: { episodeId: episode.id },
    },
    trigger: null, // Send immediately
  });
}

// Schedule the next check (in minutes)
function scheduleNextCheck(minutes: number): void {
  // Create a reminder to check again later
  setTimeout(() => {
    BackgroundFetch.registerTaskAsync(CHECK_NEW_EPISODES_TASK, {
      minimumInterval: 60 * minutes, // Convert to seconds
      stopOnTerminate: false,
      startOnBoot: true,
    }).catch(err => console.error('Error scheduling next check:', err));
  }, 1000); // Wait 1 second to avoid any conflicts
}

// Configure initial check at 5:30 PM Paris time
function configureInitialCheck(): void {
  // Get the next occurrence of 5:30 PM Paris time in UTC
  const nextCheckTimeUtc = getNextParisTime(17, 30);
  
  // Wait time in milliseconds
  const timeUntilCheck = nextCheckTimeUtc.getTime() - Date.now();
  
  console.log(`Next check scheduled for: ${nextCheckTimeUtc.toISOString()} (in ${Math.round(timeUntilCheck/1000/60)} minutes)`);
  
  // Schedule the check
  setTimeout(() => {
    checkForNewEpisodes().catch(err => 
      console.error('Error during initial check:', err)
    );
  }, timeUntilCheck);
}

// Initialize the notification service
export async function initEpisodeNotificationService(): Promise<void> {
  try {
    // Request notification permissions
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      console.warn('Notification permissions were not granted');
      return;
    }
    
    // Register the periodic checking task
    await BackgroundFetch.registerTaskAsync(CHECK_NEW_EPISODES_TASK, {
      minimumInterval: 60 * 60, // Check every hour (in seconds)
      stopOnTerminate: false,
      startOnBoot: true,
    });
    
    // Configure the first check
    configureInitialCheck();
    
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