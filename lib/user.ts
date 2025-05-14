import { supabase } from './supabase';
import { User } from '@supabase/supabase-js';

export interface GoogleUserInfo {
  id: string;
  email?: string;
  fullName?: string;
  avatarUrl?: string;
  provider?: string;
}

/**
 * Retrieves user information, focusing on details available after a Google sign-in.
 * Assumes the user is already authenticated via Supabase.
 * @returns A promise that resolves to GoogleUserInfo or null if no user is found or an error occurs.
 */
export async function getGoogleUserInfo(): Promise<GoogleUserInfo | null> {
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error) {
    console.error('Error fetching user:', error.message);
    return null;
  }

  if (!user) {
    console.log('No user is currently logged in.');
    return null;
  }

  // Default provider if not available in app_metadata
  let provider = 'unknown';
  if (user.app_metadata?.provider) {
    provider = user.app_metadata.provider;
  } else if (user.identities && user.identities.length > 0) {
    // Fallback to checking identities if app_metadata.provider is not set
    provider = user.identities[0].provider || 'unknown';
  }

  // Information from Google is often in user_metadata.
  // The exact field names can vary based on Supabase project settings and Google's response.
  // Common fields include: name, full_name, picture, avatar_url.
  const fullName = user.user_metadata?.full_name || user.user_metadata?.name;
  const avatarUrl = user.user_metadata?.picture || user.user_metadata?.avatar_url;

  return {
    id: user.id,
    email: user.email,
    fullName,
    avatarUrl,
    provider,
  };
}
