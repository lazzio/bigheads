import AsyncStorage from '@react-native-async-storage/async-storage';
import { Episode } from '../types/episode';
import { parseDuration } from './commons/timeUtils';

// --- Constants ---
export const EPISODES_CACHE_KEY = 'cached_episodes';
export const PLAYBACK_POSITIONS_KEY = 'playbackPositions';
export const LAST_PLAYED_EPISODE_KEY = 'lastPlayedEpisodeId';
export const LAST_PLAYED_POSITION_KEY = 'lastPlayedPosition';
export const LAST_PLAYING_STATE_KEY = 'wasPlaying';
export const CURRENTLY_PLAYING_EPISODE_ID_KEY = 'currentlyPlayingEpisodeId';
export const CURRENT_EPISODE_ID_KEY = 'CURRENT_EPISODE_ID';

// --- Types ---
// Structure for locally stored positions
export interface LocalPositionInfo {
  position: number; // seconds
  timestamp: number; // ms since epoch
}
export type LocalPositions = Record<string, LocalPositionInfo>;

// --- Functions ---

/**
 * Retrieves the playback position for a given episode ID from local storage.
 * @param epId The ID of the episode.
 * @returns The position in milliseconds, or null if not found or an error occurs.
 */
export const getPositionLocally = async (epId: string): Promise<number | null> => {
  if (!epId) return null;
  try {
    const existingPositionsString = await AsyncStorage.getItem(PLAYBACK_POSITIONS_KEY);
    const positions: LocalPositions = existingPositionsString ? JSON.parse(existingPositionsString) : {};
    if (positions[epId] && typeof positions[epId].position === 'number' && isFinite(positions[epId].position)) {
      // console.log(`[storageService] Found local position for ${epId}: ${positions[epId].position}s`);
      return positions[epId].position * 1000; // Return in milliseconds
    }
  } catch (error) {
    console.error("[storageService] Error getting position locally:", error);
  }
  return null;
};

/**
 * Loads episodes from the local cache.
 * @returns A promise that resolves to an array of Episode objects.
 */
export const loadCachedEpisodes = async (): Promise<Episode[]> => {
  try {
    const cachedData = await AsyncStorage.getItem(EPISODES_CACHE_KEY);
    if (cachedData) {
      const episodes: Episode[] = JSON.parse(cachedData);
      // Normaliser la durée
      const normalizedEpisodes = episodes.map(ep => ({ ...ep, duration: parseDuration(ep.duration) }));
      console.log(`[storageService] Loaded ${normalizedEpisodes.length} episodes from cache`);
      return normalizedEpisodes;
    }
  } catch (error) { 
    console.error('[storageService] Error loading cached episodes:', error); 
  }
  return [];
};

/**
 * Saves episodeID of currently played episode to the local cache.
 * @param episodeId The ID of the episode.
 */
export const saveCurrentlyPlayingEpisodeId = async (episodeId: string) => {
  try {
    await AsyncStorage.setItem(CURRENTLY_PLAYING_EPISODE_ID_KEY, episodeId);
  } catch (error) {
    await AsyncStorage.removeItem(CURRENTLY_PLAYING_EPISODE_ID_KEY);
  }
};

/**
 * Get the ID of the currently played episode from the local cache.
 * @returns The ID of the currently played episode, or null if not found.
 */
export const getCurrentlyPlayingEpisodeId = async (): Promise<string | null> => {
  try {
    const episodeId = await AsyncStorage.getItem(CURRENTLY_PLAYING_EPISODE_ID_KEY);
    return episodeId;
  } catch (error) {
    return null;
  }
};

export async function setCurrentEpisodeId(episodeId: string | null) {
  if (episodeId) {
    await AsyncStorage.setItem(CURRENT_EPISODE_ID_KEY, episodeId);
  } else {
    await AsyncStorage.removeItem(CURRENT_EPISODE_ID_KEY);
  }
}

export async function getCurrentEpisodeId(): Promise<string | null> {
  return await AsyncStorage.getItem(CURRENT_EPISODE_ID_KEY);
}
