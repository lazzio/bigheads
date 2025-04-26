import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Episode } from '../types/episode';
import { PendingPosition, OfflineWatched } from '../types/player';
import { EPISODES_CACHE_KEY, PENDING_POSITIONS_KEY, OFFLINE_WATCHED_KEY } from '../utils/constants';
import { supabase } from '../lib/supabase'; // Assuming supabase is initialized here

// --- Episode Cache ---

export const loadCachedEpisodes = async (): Promise<Episode[]> => {
  try {
    const cachedData = await AsyncStorage.getItem(EPISODES_CACHE_KEY);
    if (cachedData) {
      const episodes: Episode[] = JSON.parse(cachedData);
      console.log(`[OfflineService] Loaded ${episodes.length} episodes from cache.`);
      return episodes;
    }
  } catch (error) {
    console.error('[OfflineService] Error loading cached episodes:', error);
  }
  return [];
};

export const saveEpisodesToCache = async (episodes: Episode[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(episodes));
    console.log(`[OfflineService] Saved ${episodes.length} episodes to cache.`);
  } catch (error) {
    console.error('[OfflineService] Error saving episodes to cache:', error);
  }
};

// --- Offline Episode Details ---

export const getOfflineEpisodeDetails = async (filePath: string): Promise<Episode | null> => {
  try {
    const metaPath = filePath + '.meta';
    const fileExists = await FileSystem.getInfoAsync(metaPath);

    if (fileExists.exists) {
      const metaContent = await FileSystem.readAsStringAsync(metaPath);
      const metadata = JSON.parse(metaContent);

      // Construct the Episode object from metadata
      const episode: Episode = {
        id: metadata.id, // Crucial: ID must be stored in metadata
        title: metadata.title || 'Épisode téléchargé',
        description: metadata.description || '',
        mp3Link: filePath, // Use local path for playback
        duration: metadata.duration || 0, // Store duration in seconds if possible
        publicationDate: metadata.downloadDate || new Date().toISOString(), // Use download date as fallback
        offline_path: filePath,
        artworkUrl: metadata.artworkUrl, // Include artwork if available
      };
      console.log(`[OfflineService] Loaded details for offline episode: ${episode.title}`);
      return episode;
    } else {
      console.warn(`[OfflineService] Metadata file not found for: ${filePath}`);
      return null;
    }
  } catch (error) {
    console.error('[OfflineService] Error getting offline episode details:', error);
    return null;
  }
};

// --- Pending Positions Queue ---

export const getPendingPositions = async (): Promise<PendingPosition[]> => {
  try {
    const data = await AsyncStorage.getItem(PENDING_POSITIONS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('[OfflineService] Error getting pending positions:', error);
    return [];
  }
};

export const savePendingPosition = async (positionData: Omit<PendingPosition, 'userId' | 'timestamp'>): Promise<void> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[OfflineService] Cannot save pending position, no user logged in.');
      return;
    }
    const userId = user.id;
    const timestamp = new Date().toISOString();

    const pendingPositions = await getPendingPositions();
    const existingIndex = pendingPositions.findIndex(
      (p) => p.userId === userId && p.episodeId === positionData.episodeId
    );

    const newPositionEntry: PendingPosition = { ...positionData, userId, timestamp };

    if (existingIndex !== -1) {
      pendingPositions[existingIndex] = newPositionEntry;
    } else {
      pendingPositions.push(newPositionEntry);
    }

    // Optional: Limit queue size
    // const limitedPositions = pendingPositions.slice(-50);

    await AsyncStorage.setItem(PENDING_POSITIONS_KEY, JSON.stringify(pendingPositions));
    // console.log(`[OfflineService] Saved pending position for ${positionData.episodeId}: ${positionData.positionSeconds}s`);
  } catch (error) {
    console.error('[OfflineService] Error saving pending position:', error);
  }
};

export const clearPendingPositions = async (syncedPositions: PendingPosition[]): Promise<void> => {
  try {
    const currentPositions = await getPendingPositions();
    const syncedIds = new Set(syncedPositions.map(p => `${p.userId}-${p.episodeId}`));
    const remainingPositions = currentPositions.filter(p => !syncedIds.has(`${p.userId}-${p.episodeId}`));
    await AsyncStorage.setItem(PENDING_POSITIONS_KEY, JSON.stringify(remainingPositions));
    console.log(`[OfflineService] Cleared ${syncedPositions.length} synced positions. ${remainingPositions.length} remaining.`);
  } catch (error) {
    console.error('[OfflineService] Error clearing pending positions:', error);
  }
};

// --- Offline Watched Queue ---

export const getOfflineWatched = async (): Promise<OfflineWatched[]> => {
  try {
    const data = await AsyncStorage.getItem(OFFLINE_WATCHED_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('[OfflineService] Error getting offline watched:', error);
    return [];
  }
};

export const addOfflineWatched = async (episodeId: string): Promise<void> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[OfflineService] Cannot add offline watched, no user logged in.');
      return;
    }
    const userId = user.id;
    const timestamp = new Date().toISOString();

    const watchedList = await getOfflineWatched();
    const alreadyExists = watchedList.some(
      (w) => w.userId === userId && w.episodeId === episodeId
    );

    if (!alreadyExists) {
      watchedList.push({ episodeId, userId, timestamp });
      await AsyncStorage.setItem(OFFLINE_WATCHED_KEY, JSON.stringify(watchedList));
      console.log(`[OfflineService] Added episode ${episodeId} to offline watched queue.`);
    }
  } catch (error) {
    console.error('[OfflineService] Error adding offline watched:', error);
  }
};

export const clearOfflineWatched = async (syncedWatched: OfflineWatched[]): Promise<void> => {
  try {
    const currentWatched = await getOfflineWatched();
    const syncedIds = new Set(syncedWatched.map(w => `${w.userId}-${w.episodeId}`));
    const remainingWatched = currentWatched.filter(w => !syncedIds.has(`${w.userId}-${w.episodeId}`));
    await AsyncStorage.setItem(OFFLINE_WATCHED_KEY, JSON.stringify(remainingWatched));
    console.log(`[OfflineService] Cleared ${syncedWatched.length} synced watched episodes. ${remainingWatched.length} remaining.`);
  } catch (error) {
    console.error('[OfflineService] Error clearing offline watched:', error);
  }
};
