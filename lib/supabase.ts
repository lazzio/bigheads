import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Database } from '../types/supabase';
import { Platform } from 'react-native';
import { storage } from './storage';
import pako from 'pako';
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
    try { // Outer try-catch for errors from storage.getItem() itself
      const storedValue = await storage.getItem(key);
      if (!storedValue) {
        return null;
      }

      // Attempt to treat as new, compressed, base64-encoded data
      try {
        const uint8Array = Uint8Array.from(atob(storedValue), c => c.charCodeAt(0));
        // If atob succeeded, storedValue was base64. Now try to decompress.
        try {
          const decompressedValue = pako.inflate(uint8Array, { to: 'string' });
          return decompressedValue;
        } catch (inflateError: any) {
          // atob succeeded, but pako.inflate failed. Data is base64 but not valid compressed data.
          console.error(`[Storage] Failed to decompress value for key '${key}' after base64 decoding. Error: ${inflateError.message}`);
          Sentry.captureException(inflateError, {
            extra: { key, operation: 'getItem', stage: 'decompression', originalValuePreview: storedValue.substring(0, 100) }, // Increased preview length
            level: 'error',
            fingerprint: ['storage-decompression-failure', key]
          });
          return null; // Data corruption or unexpected format
        }
      } catch (atobError: any) {
        // atob failed, assume storedValue is old, plain, unencoded data.
        console.warn(`[Storage] Value for key '${key}' is not valid base64. Assuming old format and returning raw value. Error: ${atobError.message}`);
        // It's important to return the raw string here as it's the pre-compression/encoding data.
        return storedValue;
      }

    } catch (storageError: any) { // Outer catch for errors from storage.getItem() itself
      console.error(`[Storage] Error getting ${key} from underlying storage:`, storageError);
      Sentry.captureException(storageError, {
        extra: { key, operation: 'getItem', stage: 'storageRead' },
        level: 'error'
      });
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      const compressedValue = pako.deflate(value);
      // Encode Uint8Array to base64 string for storage
      const base64CompressedValue = btoa(String.fromCharCode.apply(null, Array.from(compressedValue)));
      const valueSizeBytes = new TextEncoder().encode(base64CompressedValue).length;
      console.log(`[Storage] Set ${key}. Compressed value size: ${valueSizeBytes} bytes`);
      if (valueSizeBytes > 2048 && Platform.OS !== 'web') {
        // Log a specific warning if the size exceeds the SecureStore limit on native platforms
        console.warn(`[Storage] Value for key '${key}' is ${valueSizeBytes} bytes, which exceeds the 2048 byte limit for SecureStore on native platforms. This may lead to storage failure or errors in future SDKs.`);
        // Updated Sentry API call
        Sentry.captureMessage(`SecureStore size limit exceeded for key: ${key}`, {
          extra: { key, valueSizeBytes, operation: 'setItem' },
          level: 'warning'
        });
      }
      await storage.setItem(key, base64CompressedValue);
    } catch (error) {
      console.error(`[Storage] Error setting ${key}:`, error);
      // Updated Sentry API call
      Sentry.captureException(error, {
        extra: { key, operation: 'setItem' },
        level: 'error'
      });
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