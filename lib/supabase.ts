import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Database } from '../types/supabase';
import { Platform } from 'react-native';
import { storage } from './storage';
// Updated import for Sentry
import * as Sentry from '@sentry/react-native';

// Get environment variables with fallbacks
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Validate environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables!');
  // Updated Sentry API call
  Sentry.captureMessage('Missing Supabase environment variables', {
    level: 'error'
  });
}

// Add debug logging wrapper to storage
const debugStorage = {
  ...storage,
  getItem: async (key: string) => {
    try {
      const value = await storage.getItem(key);
      return value;
    } catch (error) {
      console.error(`[Storage] Error getting ${key}:`, error);
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      console.log(`[Storage] Set ${key}`);
      await storage.setItem(key, value);
    } catch (error) {
      console.error(`[Storage] Error setting ${key}:`, error);
    }
  },
  removeItem: async (key: string) => {
    try {
      console.log(`[Storage] Remove ${key}`);
      await storage.removeItem(key);
    } catch (error) {
      console.error(`[Storage] Error removing ${key}:`, error);
    }
  }
};

export const supabase = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      flowType: Platform.OS === 'web' ? 'implicit' : 'pkce',
      detectSessionInUrl: Platform.OS === 'web',
      autoRefreshToken: true,
      persistSession: true,
      storage: debugStorage,
      debug: __DEV__,
    },
    global: {
      headers: {
        'x-app-version': process.env.EAS_BUILD_PROFILE || 'development',
      },
    },
  }
);

// Add Sentry breadcrumb for Supabase initialization
Sentry.addBreadcrumb({
  category: 'supabase',
  message: `Supabase initialized: URL ${supabaseUrl ? 'valid' : 'missing'}, Auth flow: ${Platform.OS === 'web' ? 'implicit' : 'pkce'}`,
  level: 'info',
});

// Log Supabase initialization
console.log(`[Supabase] Initialized with URL: ${supabaseUrl ? 'Valid' : 'Missing'}`);
console.log(`[Supabase] Auth flow type: ${Platform.OS === 'web' ? 'implicit' : 'pkce'}`);