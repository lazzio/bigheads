import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Database } from '../types/supabase';
import { Platform } from 'react-native';
import { storage } from './storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      flowType: Platform.OS === 'web' ? 'implicit' : 'pkce',
      detectSessionInUrl: Platform.OS === 'web',
      autoRefreshToken: true,
      persistSession: true,
      storage: storage,
    },
  }
);