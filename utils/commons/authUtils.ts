import { storage } from '../../lib/storage';

/**
 * Check if there's a local authentication session stored
 * This function checks for various Supabase authentication tokens/data
 * that would indicate a user was previously authenticated
 */
export const checkLocalAuthSession = async (): Promise<boolean> => {
  try {
    // Check for various Supabase auth tokens/session data
    const authTokenKeys = [
      'supabase.auth.token',
      'sb-xyz.myops.bigheads-auth-token',
      'sb-auth-token',
      // Add more potential keys that your app might use
    ];

    for (const key of authTokenKeys) {
      const authData = await storage.getItem(key);
      if (authData) {
        console.log(`[LocalAuth] Found local auth data for key: ${key}`);
        try {
          // Try to parse the auth data to see if it's valid
          const parsedData = JSON.parse(authData);
          if (parsedData && (parsedData.access_token || parsedData.refresh_token)) {
            return true;
          }
        } catch (parseError) {
          // If it's not JSON, it might still be a valid token string
          if (authData.length > 10) { // Basic check for a reasonable token length
            return true;
          }
        }
      }
    }

    // Also check for any user-related data that would indicate a previous login
    const userDataKeys = [
      'user_profile',
      'user_id',
      'current_user',
    ];

    for (const key of userDataKeys) {
      const userData = await storage.getItem(key);
      if (userData) {
        console.log(`[LocalAuth] Found local user data for key: ${key}`);
        return true;
      }
    }

    return false;
  } catch (error) {
    console.warn('[LocalAuth] Error checking local auth session:', error);
    return false;
  }
};

/**
 * Clear all local authentication data
 * Useful for logout or when auth state becomes inconsistent
 */
export const clearLocalAuthSession = async (): Promise<void> => {
  try {
    const keysToRemove = [
      'supabase.auth.token',
      'sb-xyz.myops.bigheads-auth-token', 
      'sb-auth-token',
      'user_profile',
      'user_id',
      'current_user',
    ];

    for (const key of keysToRemove) {
      await storage.removeItem(key);
    }

    console.log('[LocalAuth] Cleared local auth session');
  } catch (error) {
    console.warn('[LocalAuth] Error clearing local auth session:', error);
  }
};
