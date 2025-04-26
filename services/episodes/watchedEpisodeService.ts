import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';

type WatchedEpisodeRow = Database['public']['Tables']['watched_episodes']['Row'];

/**
 * Fetches the IDs of episodes marked as finished by the current user.
 * Returns an empty set if not logged in or on error.
 */
export async function fetchWatchedEpisodeIds(): Promise<Set<string>> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('[WatchedEpisodeService] User not logged in.');
      return new Set();
    }

    const { data, error } = await supabase
      .from('watched_episodes')
      .select('episode_id')
      .eq('user_id', user.id)
      .eq('is_finished', true); // Only fetch finished episodes

    if (error) {
      console.error('[WatchedEpisodeService] Error fetching watched episodes:', error);
      throw error; // Re-throw to be caught by the hook
    }

    if (!data) {
      return new Set();
    }

    const watchedIds = new Set((data as WatchedEpisodeRow[]).map(we => we.episode_id));
    console.log(`[WatchedEpisodeService] Fetched ${watchedIds.size} watched episode IDs.`);
    return watchedIds;

  } catch (err) {
    console.error('[WatchedEpisodeService] Exception fetching watched episodes:', err);
    return new Set(); // Return empty set on error
  }
}
