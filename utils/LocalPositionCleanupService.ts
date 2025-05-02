import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../lib/supabase';
import { Episode } from '../types/episode';
import { Database } from '../types/supabase';
import { parseDuration } from './commons/timeUtils';

type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];

const EPISODES_CACHE_KEY = 'cached_episodes';
const PLAYBACK_POSITIONS_KEY = 'playbackPositions';

// Structure for locally stored positions (copied from player.tsx for consistency)
interface LocalPositionInfo {
  position: number; // seconds
  timestamp: number; // ms since epoch
}
type LocalPositions = Record<string, LocalPositionInfo>;

/**
 * Fetches the IDs of all currently available episodes, either from API or cache.
 * @returns A Set containing the IDs of available episodes, or null if fetching fails.
 */
async function fetchAvailableEpisodeIds(): Promise<Set<string> | null> {
    try {
        const networkState = await NetInfo.fetch();
        let episodes: Episode[] = [];

        if (networkState.isConnected && networkState.isInternetReachable) {
            console.log("[LocalPositionCleanup] Online, fetching episodes from Supabase...");
            const { data, error: apiError } = await supabase
                .from('episodes')
                .select('*')
                .order('publication_date', { ascending: false });

            if (apiError) {
                console.error("[LocalPositionCleanup] Error fetching episodes from Supabase:", apiError.message);
                // Fallback to cache if API fails
                console.log("[LocalPositionCleanup] Falling back to cache due to API error.");
                const cachedData = await AsyncStorage.getItem(EPISODES_CACHE_KEY);
                 if (cachedData) {
                    episodes = JSON.parse(cachedData);
                 } else {
                     console.error("[LocalPositionCleanup] API failed and no cache available.");
                     return null; // Cannot determine available episodes
                 }
            } else {
                 episodes = (data as any[]).map(episode => ({
                    id: episode.id,
                    title: episode.title,
                    description: episode.description,
                    originalMp3Link: episode.original_mp3_link ?? undefined,
                    mp3Link: episode.mp3_link ?? '',
                    duration: parseDuration(episode.duration),
                    publicationDate: episode.publication_date,
                    offline_path: episode.offline_path ?? undefined,
                }));
                // Update cache
                await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(episodes));
            }
        } else {
            console.log("[LocalPositionCleanup] Offline, fetching episodes from cache...");
            const cachedData = await AsyncStorage.getItem(EPISODES_CACHE_KEY);
            if (cachedData) {
                episodes = JSON.parse(cachedData);
            } else {
                console.warn("[LocalPositionCleanup] Offline and no cached episodes found. Cannot perform cleanup.");
                return null; // Cannot determine available episodes
            }
        }

        if (episodes.length === 0) {
            console.warn("[LocalPositionCleanup] No available episodes found (API or cache). Cannot perform cleanup.");
            return null;
        }

        // Extract IDs into a Set
        const availableIds = new Set(episodes.map(ep => ep.id));
        console.log(`[LocalPositionCleanup] Found ${availableIds.size} available episode IDs.`);
        return availableIds;

    } catch (error) {
        console.error("[LocalPositionCleanup] Error fetching available episode IDs:", error);
        return null;
    }
}

/**
 * Removes local playback position entries for episodes that are no longer available.
 */
export async function cleanupStaleLocalPositions(): Promise<void> {
    console.log("[LocalPositionCleanup] Starting cleanup of stale local positions...");

    const availableEpisodeIds = await fetchAvailableEpisodeIds();

    if (!availableEpisodeIds) {
        console.error("[LocalPositionCleanup] Failed to get available episode IDs. Aborting cleanup.");
        return;
    }

    if (availableEpisodeIds.size === 0) {
        console.warn("[LocalPositionCleanup] No available episodes found. Skipping cleanup, but this might indicate an issue.");
        return;
    }

    try {
        const existingPositionsString = await AsyncStorage.getItem(PLAYBACK_POSITIONS_KEY);
        if (!existingPositionsString) {
            console.log("[LocalPositionCleanup] No local positions found. Nothing to clean up.");
            return;
        }

        const localPositions: LocalPositions = JSON.parse(existingPositionsString);
        const originalCount = Object.keys(localPositions).length;
        let removedCount = 0;

        const cleanedPositions: LocalPositions = {};

        for (const episodeId in localPositions) {
            if (availableEpisodeIds.has(episodeId)) {
                cleanedPositions[episodeId] = localPositions[episodeId];
            } else {
                console.log(`[LocalPositionCleanup] Marking stale position for episode ID: ${episodeId}`);
                removedCount++;
            }
        }

        if (removedCount > 0) {
            await AsyncStorage.setItem(PLAYBACK_POSITIONS_KEY, JSON.stringify(cleanedPositions));
            console.log(`[LocalPositionCleanup] Removed ${removedCount} stale local position entries. ${Object.keys(cleanedPositions).length} entries remaining.`);
        } else {
            console.log("[LocalPositionCleanup] No stale local positions found. Cleanup complete.");
        }

    } catch (error) {
        console.error("[LocalPositionCleanup] Error during cleanup process:", error);
    }
}

// Example of how you might call this during app startup (e.g., in your main App component or a setup file)
// useEffect(() => {
//   cleanupStaleLocalPositions();
// }, []);
