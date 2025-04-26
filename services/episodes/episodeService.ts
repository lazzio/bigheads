import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../../lib/supabase';
import { Episode } from '../../types/episode';
import { Database } from '../../types/supabase';

type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];
const EPISODES_CACHE_KEY = 'cached_episodes';

/**
 * Loads episodes from AsyncStorage cache.
 */
export async function loadEpisodesFromCache(): Promise<Episode[]> {
  try {
    const cachedData = await AsyncStorage.getItem(EPISODES_CACHE_KEY);
    if (cachedData) {
      const episodes: Episode[] = JSON.parse(cachedData);
      console.log(`[EpisodeService] Loaded ${episodes.length} episodes from cache.`);
      // Basic validation (optional)
      if (Array.isArray(episodes) && episodes.length > 0 && episodes[0]?.id && episodes[0]?.title) {
        return episodes;
      }
    }
  } catch (error) {
    console.error('[EpisodeService] Error loading cached episodes:', error);
  }
  return [];
}

/**
 * Saves episodes to AsyncStorage cache.
 */
export async function saveEpisodesToCache(episodes: Episode[]): Promise<void> {
  try {
    if (episodes && episodes.length > 0) {
      await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(episodes));
      console.log(`[EpisodeService] Saved ${episodes.length} episodes to cache.`);
    }
  } catch (error) {
    console.error('[EpisodeService] Error saving episodes to cache:', error);
  }
}

/**
 * Fetches episodes from the Supabase API.
 */
export async function fetchEpisodesFromAPI(): Promise<Episode[]> {
  console.log('[EpisodeService] Fetching episodes from API...');
  const { data, error } = await supabase
    .from('episodes')
    .select('*')
    .order('publication_date', { ascending: false });

  if (error) {
    console.error('[EpisodeService] API Error:', error);
    throw new Error(`Failed to fetch episodes: ${error.message}`);
  }

  if (!data) {
    return [];
  }

  // Format data and normalize URLs
  const formattedEpisodes: Episode[] = (data as SupabaseEpisode[]).map(episode => {
    let mp3Link = episode.mp3_link || '';
    // Basic URL normalization (ensure it starts with http/https)
    if (mp3Link && !mp3Link.startsWith('http') && !mp3Link.startsWith('file:')) {
       mp3Link = `https://${mp3Link}`;
    }

    return {
      id: episode.id,
      title: episode.title,
      description: episode.description || '',
      originalMp3Link: episode.original_mp3_link || undefined,
      mp3Link: mp3Link,
      duration: episode.duration ?? null, // Use null if undefined/null
      publicationDate: episode.publication_date,
      // offline_path is not directly fetched here, it's added later if needed
    };
  });

  console.log(`[EpisodeService] Fetched ${formattedEpisodes.length} episodes from API.`);
  return formattedEpisodes;
}

/**
 * Gets episodes, deciding whether to fetch from API or load from cache based on network status.
 * Also saves fetched episodes to cache.
 */
export async function getEpisodes(): Promise<{ episodes: Episode[]; isOffline: boolean }> {
  const networkState = await NetInfo.fetch();
  const isOffline = !networkState.isConnected || !networkState.isInternetReachable;

  try {
    if (isOffline) {
      console.log('[EpisodeService] Offline mode detected. Loading from cache.');
      const cachedEpisodes = await loadEpisodesFromCache();
      return { episodes: cachedEpisodes, isOffline: true };
    } else {
      console.log('[EpisodeService] Online mode. Fetching from API.');
      const apiEpisodes = await fetchEpisodesFromAPI();
      await saveEpisodesToCache(apiEpisodes); // Update cache
      return { episodes: apiEpisodes, isOffline: false };
    }
  } catch (error) {
    console.error('[EpisodeService] Error in getEpisodes:', error);
    // Fallback to cache even if API fetch failed while online
    console.log('[EpisodeService] API fetch failed, attempting fallback to cache.');
    const cachedEpisodes = await loadEpisodesFromCache();
    if (cachedEpisodes.length > 0) {
      console.log('[EpisodeService] Fallback successful: Loaded from cache.');
      // Return cached data but indicate potential issue by re-throwing
      throw new Error(`Network error, showing cached data. Original: ${error instanceof Error ? error.message : error}`);
      // Or return { episodes: cachedEpisodes, isOffline: isOffline }; // If you prefer not to throw
    } else {
      console.log('[EpisodeService] Fallback failed: Cache is empty.');
      throw error; // Re-throw original error if cache is also empty
    }
  }
}
