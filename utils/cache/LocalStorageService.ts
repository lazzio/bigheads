import AsyncStorage from '@react-native-async-storage/async-storage';
import { Episode } from '../../types/episode';
import { normalizeEpisodes } from '../commons/episodeUtils';

// --- Constants ---
export const EPISODES_CACHE_KEY = 'cached_episodes';
export const PLAYBACK_POSITIONS_KEY = 'playbackPositions';
export const LAST_PLAYED_EPISODE_KEY = 'lastPlayedEpisodeId';
export const LAST_PLAYED_POSITION_KEY = 'lastPlayedPosition';
export const LAST_PLAYING_STATE_KEY = 'wasPlaying';
export const CURRENTLY_PLAYING_EPISODE_ID_KEY = 'currentlyPlayingEpisodeId';
export const CURRENT_EPISODE_ID_KEY = 'CURRENT_EPISODE_ID';

// --- Types ---
export interface LocalPositionInfo {
  position: number; // seconds
  timestamp: number; // ms since epoch
}
export type LocalPositions = Record<string, LocalPositionInfo>;

// --- Functions ---

/**
 * Sauvegarde la position de lecture pour un épisode localement.
 */
export async function savePositionLocally(epId: string, positionMillis: number) {
  if (!epId) return;
  const positionSeconds = positionMillis / 1000;
  if (isNaN(positionSeconds) || !isFinite(positionSeconds)) return;
  try {
    const existingPositionsString = await AsyncStorage.getItem(PLAYBACK_POSITIONS_KEY);
    const positions: LocalPositions = existingPositionsString ? JSON.parse(existingPositionsString) : {};
    positions[epId] = {
      position: positionSeconds,
      timestamp: Date.now(),
    };
    await AsyncStorage.setItem(PLAYBACK_POSITIONS_KEY, JSON.stringify(positions));
  } catch (error) {
    // Silent fail
  }
}

/**
 * Récupère la position de lecture pour un épisode donné.
 */
export const getPositionLocally = async (epId: string): Promise<number | null> => {
  if (!epId) return null;
  try {
    const existingPositionsString = await AsyncStorage.getItem(PLAYBACK_POSITIONS_KEY);
    const positions: LocalPositions = existingPositionsString ? JSON.parse(existingPositionsString) : {};
    if (positions[epId] && typeof positions[epId].position === 'number' && isFinite(positions[epId].position)) {
      return positions[epId].position * 1000; // Return in milliseconds
    }
  } catch (error) {
    // Silent fail
  }
  return null;
};

/**
 * Charge les épisodes depuis le cache local.
 */
export const loadCachedEpisodes = async (): Promise<Episode[]> => {
  try {
    const cachedData = await AsyncStorage.getItem(EPISODES_CACHE_KEY);
    if (cachedData) {
      const episodes: any[] = JSON.parse(cachedData);
      return normalizeEpisodes(episodes);
    }
  } catch (error) {}
  return [];
};

/**
 * Sauvegarde les épisodes dans le cache local.
 */
export const saveEpisodesToCache = async (episodes: Episode[]) => {
  try {
    await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(episodes));
  } catch (error) {}
};

/**
 * Sauvegarde l'ID de l'épisode en cours de lecture.
 */
export const saveCurrentlyPlayingEpisodeId = async (episodeId: string) => {
  try {
    await AsyncStorage.setItem(CURRENTLY_PLAYING_EPISODE_ID_KEY, episodeId);
  } catch (error) {
    await AsyncStorage.removeItem(CURRENTLY_PLAYING_EPISODE_ID_KEY);
  }
};

/**
 * Récupère l'ID de l'épisode en cours de lecture.
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

// Helpers génériques pour get/set/remove une clé string
export async function getStringItem(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}
export async function setStringItem(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {}
}
export async function removeStringItem(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {}
}

// Helpers spécifiques pour les clés courantes
export const getLastPlayedEpisodeId = () => getStringItem(LAST_PLAYED_EPISODE_KEY);
export const setLastPlayedEpisodeId = (id: string) => setStringItem(LAST_PLAYED_EPISODE_KEY, id);
export const getLastPlayedPosition = () => getStringItem(LAST_PLAYED_POSITION_KEY);
export const setLastPlayedPosition = (pos: string) => setStringItem(LAST_PLAYED_POSITION_KEY, pos);
export const getWasPlaying = () => getStringItem(LAST_PLAYING_STATE_KEY);
export const setWasPlaying = (val: boolean) => setStringItem(LAST_PLAYING_STATE_KEY, val.toString());
export const getExpoPushToken = () => getStringItem('expoPushToken');
export const setExpoPushToken = (token: string) => setStringItem('expoPushToken', token);