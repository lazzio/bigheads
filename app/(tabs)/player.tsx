import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, AppState, AppStateStatus, BackHandler, Platform } from 'react-native'; // Added Platform
import { useRouter, useLocalSearchParams } from 'expo-router';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as FileSystem from 'expo-file-system';

import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import { Episode } from '../../types/episode';
import { audioManager } from '../../utils/OptimizedAudioService';
import AudioPlayer from '../../components/AudioPlayer';
import { theme, gradientColors } from '../../styles/global';
import { parseDuration } from '../../utils/commons/timeUtils';

// --- Types ---
type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];
type WatchedEpisodeRow = Database['public']['Tables']['watched_episodes']['Row'];

// Structure for locally stored positions
interface LocalPositionInfo {
  position: number; // seconds
  timestamp: number; // ms since epoch
}
type LocalPositions = Record<string, LocalPositionInfo>;

// --- Constants ---
const EPISODES_CACHE_KEY = 'cached_episodes';
const PLAYBACK_POSITIONS_KEY = 'playbackPositions';
const LAST_PLAYED_EPISODE_KEY = 'lastPlayedEpisodeId';
const LAST_PLAYED_POSITION_KEY = 'lastPlayedPosition';
const LAST_PLAYING_STATE_KEY = 'wasPlaying';


export default function PlayerScreen() {
  const { episodeId, offlinePath, source, _retry } = useLocalSearchParams<{ episodeId?: string; offlinePath?: string; source?: string; _retry?: string }>();
  const router = useRouter();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentGradientStart, setCurrentGradient] = useState<string>(theme.colors.gradientStart);
  const currentEpisodeIdRef = useRef<string | null>(null);
  const appState = useRef(AppState.currentState);
  const isSyncingRef = useRef(false); // Ref to prevent concurrent syncs
  const netStateRef = useRef<NetInfoState | null>(null); // Store last network state
  const isLoadingEpisodeRef = useRef(false); // Add ref to track loading state within loadEpisodeAndPosition

  // --- Remote Sync Function ---
  const syncAllLocalPositionsToSupabase = useCallback(async () => {
    if (isSyncingRef.current) {
      console.log('[PlayerScreen] Sync already in progress.');
      return;
    }
    const netInfoState = await NetInfo.fetch();
    if (!netInfoState.isConnected || !netInfoState.isInternetReachable) {
      console.log('[PlayerScreen] Sync skipped: No internet connection.');
      return;
    }

    isSyncingRef.current = true;
    console.log('[PlayerScreen] Starting remote sync...');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.warn('[PlayerScreen] Cannot sync, no user logged in.');
        isSyncingRef.current = false;
        return;
      }

      const existingPositionsString = await AsyncStorage.getItem(PLAYBACK_POSITIONS_KEY);
      const localPositions: LocalPositions = existingPositionsString ? JSON.parse(existingPositionsString) : {};
      const episodeIds = Object.keys(localPositions);

      if (episodeIds.length === 0) {
        console.log('[PlayerScreen] No local positions to sync.');
        isSyncingRef.current = false;
        return;
      }

      // Prepare data for upsert
      const upsertData = episodeIds.map(epId => {
        const localInfo = localPositions[epId];
        const episode = episodes.find(e => e.id === epId); // Find episode details for duration
        const durationSeconds = episode?.duration ?? 0;
        const positionSeconds = localInfo.position;

        const isConsideredFinished = durationSeconds > 0 && positionSeconds >= durationSeconds * 0.98;

        return {
          user_id: user.id,
          episode_id: epId,
          playback_position: isConsideredFinished ? 0 : positionSeconds, // Store 0 if finished
          watched_at: new Date(localInfo.timestamp).toISOString(),
          is_finished: isConsideredFinished,
        };
      });

      console.log(`[PlayerScreen] Syncing ${upsertData.length} positions to Supabase...`);
      const { error: upsertError } = await supabase
        .from('watched_episodes')
        .upsert(upsertData, { onConflict: 'user_id, episode_id' });

      if (upsertError) {
        console.error("[PlayerScreen] Supabase sync error:", upsertError.message);
        // Optionally: Decide whether to clear local cache on error or retry later
      } else {
        console.log(`[PlayerScreen] Successfully synced ${upsertData.length} positions.`);
        // Optionally: Clear local positions after successful sync? Or keep them? Let's keep them for faster loading.
        // await AsyncStorage.removeItem(PLAYBACK_POSITIONS_KEY);
      }

    } catch (error) {
      console.error("[PlayerScreen] Error during sync process:", error);
    } finally {
      isSyncingRef.current = false;
      console.log('[PlayerScreen] Sync process finished.');
    }
  }, [episodes]); // episodes needed for duration

  // --- Local Storage Helpers ---
  const savePositionLocally = useCallback(async (epId: string, positionMillis: number) => {
    if (!epId) return;
    const positionSeconds = positionMillis / 1000;
    // Prevent saving NaN or excessively large/small numbers
    if (isNaN(positionSeconds) || !isFinite(positionSeconds)) {
        console.warn(`[PlayerScreen] Attempted to save invalid position (${positionSeconds}s) for ${epId}. Skipping.`);
        return;
    }
    console.log(`[PlayerScreen] Saving position locally for ${epId}: ${positionSeconds.toFixed(2)}s`);
    try {
      const existingPositionsString = await AsyncStorage.getItem(PLAYBACK_POSITIONS_KEY);
      const positions: LocalPositions = existingPositionsString ? JSON.parse(existingPositionsString) : {};
      
      // Update only if position has actually changed
      const currentPos = positions[epId]?.position;
      if (currentPos === undefined || Math.abs(currentPos - positionSeconds) > 0.5) {
        positions[epId] = {
          position: positionSeconds,
          timestamp: Date.now(),
        };
        
        await AsyncStorage.setItem(PLAYBACK_POSITIONS_KEY, JSON.stringify(positions));
        console.log(`[PlayerScreen] Position for ${epId} updated in storage`);
      }
    } catch (error) {
      console.error("[PlayerScreen] Error saving position locally:", error);
    }
  }, []);

  const getPositionLocally = useCallback(async (epId: string): Promise<number | null> => {
    if (!epId) return null;
    try {
      const existingPositionsString = await AsyncStorage.getItem(PLAYBACK_POSITIONS_KEY);
      const positions: LocalPositions = existingPositionsString ? JSON.parse(existingPositionsString) : {};
      if (positions[epId] && typeof positions[epId].position === 'number' && isFinite(positions[epId].position)) {
        console.log(`[PlayerScreen] Found local position for ${epId}: ${positions[epId].position}s`);
        return positions[epId].position * 1000; // Return in milliseconds
      }
    } catch (error) {
      console.error("[PlayerScreen] Error getting position locally:", error);
    }
    return null;
  }, []);

  // --- Save Current Playback State (Position + Last Played Info) ---
  const saveCurrentPlaybackState = useCallback(async () => {
    try {
      const episodeIdToSave = currentEpisodeIdRef.current; // Capture ref value
      if (!episodeIdToSave) {
        console.log('[PlayerScreen] saveCurrentPlaybackState: No current episode ID, skipping.');
        return;
      }

      const status = await audioManager.getStatusAsync();
      // Also check if the status matches the episode we intend to save for
      if (!status.isLoaded || status.currentEpisodeId !== episodeIdToSave) {
         console.log(`[PlayerScreen] saveCurrentPlaybackState: Status not loaded or mismatch (Expected: ${episodeIdToSave}, Got: ${status.currentEpisodeId}, Loaded: ${status.isLoaded}), skipping save.`);
         return;
      }

      console.log(`[PlayerScreen] Saving complete playback state for ${episodeIdToSave} at position ${status.positionMillis}ms, playing=${status.isPlaying}`);

      // Save to local position storage (for episode-specific positions)
      await savePositionLocally(episodeIdToSave, status.positionMillis);

      // Save as the last played episode (for app resumption)
      await AsyncStorage.setItem(LAST_PLAYED_EPISODE_KEY, episodeIdToSave);
      await AsyncStorage.setItem(LAST_PLAYED_POSITION_KEY, String(status.positionMillis));
      await AsyncStorage.setItem(LAST_PLAYING_STATE_KEY, String(status.isPlaying));

      // Also sync to remote if possible (fire-and-forget)
      syncAllLocalPositionsToSupabase().catch(err =>
        console.error('[PlayerScreen] Error syncing after saving state:', err)
      );
    } catch (error) {
      console.error('[PlayerScreen] Error saving current playback state:', error);
    }
  // REMOVED syncAllLocalPositionsToSupabase from dependencies
  // It's called internally but doesn't affect the function's core logic/identity based on inputs
  }, [savePositionLocally]);

  // --- Position Update Handler (from AudioPlayer) ---
  const handlePositionUpdate = useCallback((positionMillis: number) => {
    if (currentEpisodeIdRef.current) {
      // Log every position update to help with debugging
      console.log(`[PlayerScreen] Position update for ${currentEpisodeIdRef.current}: ${(positionMillis/1000).toFixed(2)}s`);
      savePositionLocally(currentEpisodeIdRef.current, positionMillis);
    }
  }, [savePositionLocally]);

  // --- Function to GET playback position (Local -> Remote -> Default) ---
  const getPlaybackPosition = useCallback(async (epId: string): Promise<number | null> => {
    // 1. Try local storage first for speed
    const localPositionMillis = await getPositionLocally(epId);
    if (localPositionMillis !== null) {
      console.log(`[PlayerScreen] Using local position for ${epId}: ${localPositionMillis}ms`);
      return localPositionMillis;
    }

    // 2. If not found locally, try remote storage (if online)
    const netInfoState = await NetInfo.fetch();
    if (netInfoState.isConnected && netInfoState.isInternetReachable) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          console.warn("[PlayerScreen] Cannot fetch remote position: no user logged in.");
          return null; // No user, cannot check remote
        }

        console.log(`[PlayerScreen] No local position for ${epId}, checking Supabase...`);
        const { data, error } = await supabase
          .from('watched_episodes')
          .select('playback_position, is_finished')
          .eq('user_id', user.id)
          .eq('episode_id', epId)
          .maybeSingle();

        if (error) {
          console.error("[PlayerScreen] Supabase fetch position error:", error.message);
          // Don't throw, just proceed without remote position
        } else if (data) {
          // If marked finished remotely, start from 0, otherwise use stored position
          const remotePositionSeconds = data.is_finished ? 0 : data.playback_position;
          if (remotePositionSeconds !== null && isFinite(remotePositionSeconds)) {
            const remotePositionMillis = remotePositionSeconds * 1000;
            console.log(`[PlayerScreen] Found remote position for ${epId}: ${remotePositionSeconds}s (Finished: ${data.is_finished}). Saving locally.`);
            // Save the fetched remote position locally for next time
            await savePositionLocally(epId, remotePositionMillis);
            return remotePositionMillis;
          }
        } else {
          console.log(`[PlayerScreen] No remote position found for ${epId} in Supabase.`);
        }
      } catch (err) {
        console.error("[PlayerScreen] Exception fetching remote position:", err);
        // Don't throw, just proceed without remote position
      }
    } else {
        console.log(`[PlayerScreen] Offline, cannot check remote position for ${epId}.`);
    }

    // 3. Default to null (start from beginning) if not found locally or remotely
    console.log(`[PlayerScreen] No position found for ${epId}, starting from beginning.`);
    return null;
  }, [getPositionLocally, savePositionLocally]); // Dependencies are correct

  // --- Function to load episodes from cache ---
  const loadCachedEpisodes = useCallback(async (): Promise<Episode[]> => {
    try {
      const cachedData = await AsyncStorage.getItem(EPISODES_CACHE_KEY);
      if (cachedData) {
        const episodes: Episode[] = JSON.parse(cachedData);
        // Normaliser la durée
        const normalizedEpisodes = episodes.map(ep => ({ ...ep, duration: parseDuration(ep.duration) }));
        console.log(`Loaded ${normalizedEpisodes.length} episodes from cache for player`);
        return normalizedEpisodes;
      }
    } catch (error) { console.error('Error loading cached episodes:', error); }
    return [];
  }, []);

  // --- Function to get offline episode details ---
  const getOfflineEpisodeDetails = useCallback(async (filePath: string): Promise<Episode | null> => {
    try {
      const metaPath = filePath + '.meta';
      const fileExists = await FileSystem.getInfoAsync(metaPath);
      if (fileExists.exists) {
        const metaContent = await FileSystem.readAsStringAsync(metaPath);
        const metadata = JSON.parse(metaContent);
        return {
          id: metadata.id,
          title: metadata.title || 'Épisode téléchargé',
          description: metadata.description || '',
          mp3Link: filePath, // Use local path as mp3Link for offline
          publicationDate: metadata.downloadDate || new Date().toISOString(),
          duration: parseDuration(metadata.duration), // Ensure duration is parsed
          offline_path: filePath,
          originalMp3Link: metadata.originalMp3Link
        };
      } return null;
    } catch (error) { console.error('Error getting offline episode details:', error); return null; }
  }, []);

  // --- Function to load the episode sound and set initial position ---
  const loadEpisodeAndPosition = useCallback(async (index: number | null) => {
    if (isLoadingEpisodeRef.current) {
        console.log("[PlayerScreen] Already loading an episode, skipping request.");
        return;
    }
    if (index === null || episodes.length <= index) {
      console.log("[PlayerScreen] Invalid index or episodes not loaded, unloading.");
      await audioManager.unloadSound();
      currentEpisodeIdRef.current = null;
      return;
    }

    const currentEp = episodes[index];
    const currentStatus = await audioManager.getStatusAsync();

    // Check if the requested episode is already loaded and playing/paused
    // Use currentEpisodeIdRef as a secondary check in case getStatusAsync is stale
    if (currentStatus.currentEpisodeId === currentEp.id && currentStatus.isLoaded && currentEpisodeIdRef.current === currentEp.id) {
        console.log(`[PlayerScreen] Episode ${currentEp.title} (${currentEp.id}) is already loaded.`);
        // If loaded but source was notification, ensure it plays
        if (source === 'notification') {
            if (!currentStatus.isPlaying) {
                console.log('[PlayerScreen] Ensuring playback due to notification source.');
                audioManager.play().catch(e => console.error("Error playing on notification load:", e));
            }
        }
        // currentEpisodeIdRef.current = currentEp.id; // Already set
        return; // Don't reload if already loaded
    }

    // Save position of the *previous* episode before loading the new one
    if (currentStatus.isLoaded && currentStatus.currentEpisodeId && currentStatus.currentEpisodeId !== currentEp.id) {
        console.log(`[PlayerScreen] Saving position for previous episode ${currentStatus.currentEpisodeId} before loading ${currentEp.id}`);
        await savePositionLocally(currentStatus.currentEpisodeId, currentStatus.positionMillis);
    }

    // Set ref for the new episode *before* loading starts
    currentEpisodeIdRef.current = currentEp.id;
    setError(null); // Clear previous errors
    console.log(`[PlayerScreen] Preparing to load: ${currentEp.title} (Index: ${index}, ID: ${currentEp.id})`);
    isLoadingEpisodeRef.current = true; // Set loading flag

    try {
      // --- Determine Initial Position ---
      // 1. Get position specific to this episode (local or remote)
      console.log(`[PlayerScreen] Getting playback position for ${currentEp.id}...`);
      let initialPosition = await getPlaybackPosition(currentEp.id); // Uses the combined local/remote logic

      // 2. If no specific position, check if it was the *very last* played episode (app closed/reopened)
      if (initialPosition === null) {
        const savedEpisodeId = await AsyncStorage.getItem(LAST_PLAYED_EPISODE_KEY);
        const savedPositionStr = await AsyncStorage.getItem(LAST_PLAYED_POSITION_KEY);

        if (savedEpisodeId === currentEp.id && savedPositionStr) {
          const savedPosition = Number(savedPositionStr);
          if (isFinite(savedPosition)) {
            initialPosition = savedPosition;
            console.log(`[PlayerScreen] Using last globally saved position for ${currentEp.id}: ${initialPosition}ms`);
          }
        }
      }

      // Log the final position decision
      if (initialPosition !== null) {
        console.log(`[PlayerScreen] Final initial position for ${currentEp.id}: ${(initialPosition/1000).toFixed(2)}s`);
      } else {
        console.log(`[PlayerScreen] No position found for ${currentEp.id}, starting from 0ms`);
        initialPosition = 0; // Default to 0 if null
      }

      // --- Determine Audio Source URI ---
      const sourceUri = currentEp.offline_path || currentEp.mp3Link;
      if (!sourceUri) {
          throw new Error(`No valid audio source found for episode ${currentEp.id}`);
      }

      // --- Load Sound ---
      const episodeToLoad = { ...currentEp, mp3Link: sourceUri }; // Ensure mp3Link has the correct URI for the player
      console.log(`[PlayerScreen] Calling audioManager.loadSound for ${episodeToLoad.id} with initialPosition: ${initialPosition}ms`);
      await audioManager.loadSound(episodeToLoad, initialPosition);
      console.log(`[PlayerScreen] Successfully loaded episode: ${currentEp.title}`);

      // --- Auto-Resume Playback? ---
      // Check if this episode was the last one playing when the app was backgrounded/closed
      const wasPlayingStr = await AsyncStorage.getItem(LAST_PLAYING_STATE_KEY);
      const lastPlayedId = await AsyncStorage.getItem(LAST_PLAYED_EPISODE_KEY);
      if (wasPlayingStr === 'true' && lastPlayedId === currentEp.id) {
        console.log('[PlayerScreen] Auto-resuming playback as episode was playing before');
        // Clear the flag after using it
        await AsyncStorage.removeItem(LAST_PLAYING_STATE_KEY);
        await audioManager.play().catch(err =>
          console.error('[PlayerScreen] Error auto-resuming playback:', err)
        );
      }

    } catch (loadError: any) {
      console.error("[PlayerScreen] Error loading episode:", loadError);
      setError(`Error loading: ${loadError.message || 'Unknown'}`);
      await audioManager.unloadSound(); // Ensure cleanup on error
      currentEpisodeIdRef.current = null; // Clear ref on error
    } finally {
        isLoadingEpisodeRef.current = false; // Clear loading flag
    }
  }, [episodes, getPlaybackPosition, savePositionLocally, source]); // Dependencies look correct

  // --- Main Initialization Effect ---
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null); // Clear error on init/retry

    const initializeAndLoad = async () => {
      try {
        // 1. Setup Audio Service
        await audioManager.setupAudio();

        // 2. Check Network Status
        const networkState = await NetInfo.fetch();
        netStateRef.current = networkState; // Store initial network state

        // 3. Fetch Episodes List
        let fetchedEpisodes: Episode[] = [];
        if (offlinePath) {
          // Offline mode: Load only the specified offline episode
          console.log("[PlayerScreen] Loading single offline episode:", offlinePath);
          const offlineEpisode = await getOfflineEpisodeDetails(offlinePath);
          if (offlineEpisode) {
            fetchedEpisodes = [offlineEpisode];
          } else {
            throw new Error("Unable to load offline episode details.");
          }
        } else if (networkState.isConnected && networkState.isInternetReachable) {
          // Online mode: Fetch from Supabase
          console.log("[PlayerScreen] Online, loading from Supabase...");
          const { data, error: apiError } = await supabase
            .from('episodes')
            .select('*')
            .order('publication_date', { ascending: false });

          if (apiError) throw apiError;

          fetchedEpisodes = (data as SupabaseEpisode[]).map(episode => ({
            id: episode.id,
            title: episode.title,
            description: episode.description,
            originalMp3Link: episode.original_mp3_link ?? undefined,
            mp3Link: episode.mp3_link ?? '',
            duration: parseDuration(episode.duration), // Ensure duration is parsed correctly
            publicationDate: episode.publication_date,
            offline_path: episode.offline_path ?? undefined, // Ensure offline_path is handled
          }));
          // Cache fetched episodes
          await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(fetchedEpisodes));
        } else {
          // Offline mode (no specific path): Load from cache
          console.log("[PlayerScreen] Offline, loading from cache...");
          fetchedEpisodes = await loadCachedEpisodes();
          if (fetchedEpisodes.length === 0) {
            setError("Offline mode and no cached episodes available.");
            // Keep loading false, let UI show error/empty state
          }
        }

        if (!isMounted) return; // Check if component unmounted during async operations

        // 4. Update State with Episodes
        setEpisodes(fetchedEpisodes);

        // 5. Determine Initial Episode Index
        let initialIndex: number | null = null;
        if (fetchedEpisodes.length > 0) {
            if (offlinePath) {
                // If offline path provided, it's always the first (and only) episode
                initialIndex = 0;
            } else if (episodeId) {
                // If specific episode ID requested
                const index = fetchedEpisodes.findIndex(ep => ep.id === episodeId);
                if (index !== -1) {
                    initialIndex = index;
                } else {
                    console.warn(`[PlayerScreen] Requested episode ID ${episodeId} not found in fetched list.`);
                    setError("Requested episode not found.");
                    initialIndex = 0; // Fallback to first episode if ID not found
                }
            } else {
                // No specific episode requested, default to the first episode (latest)
                initialIndex = 0;
                console.log("[PlayerScreen] No specific episode requested, defaulting to first episode.");
            }
        } else {
            console.log("[PlayerScreen] No episodes available to load.");
            // initialIndex remains null
        }

        // 6. Select Random Gradient
        const randomIndex = Math.floor(Math.random() * gradientColors.length);
        const selectedGradient = gradientColors[randomIndex];
        if (isMounted) { // Check mount status again before setting state
            setCurrentGradient(selectedGradient.start);
        }

        // 7. Update State with Index and finish loading
        setCurrentIndex(initialIndex);
        setLoading(false);

      } catch (err: any) {
        if (!isMounted) return;
        console.error('[PlayerScreen] Initialization error:', err);
        setError(`Initialization failed: ${err.message || 'Unknown error'}`);
        setLoading(false); // Ensure loading is stopped on error
        // Optionally try loading cache as a fallback if API failed
        if (!offlinePath && episodes.length === 0) {
            try {
                const cached = await loadCachedEpisodes();
                if (cached.length > 0) {
                    setEpisodes(cached);
                    // Try to find index in cache
                    const index = episodeId ? cached.findIndex(ep => ep.id === episodeId) : 0;
                    setCurrentIndex(index !== -1 ? index : 0);
                    // Keep the error message, but show cached data
                    console.warn("[PlayerScreen] Displaying cached data due to initialization error.");
                }
            } catch (cacheErr) {
                // Ignore cache error here, main error is already set
            }
        }
      }
    };

    initializeAndLoad();

    // Cleanup on unmount
    return () => {
      isMounted = false;
      console.log('[PlayerScreen] Unmounting, saving final playback state.');
      // Save state before unloading sound
      saveCurrentPlaybackState().finally(() => {
        // Consider if unloading is always desired. Maybe only if not playing?
        // For simplicity now, unload always on unmount.
        // audioManager.unloadSound();
      });
    };
  // Dependencies: Check if saveCurrentPlaybackState is stable now
  }, [episodeId, offlinePath, source, loadCachedEpisodes, getOfflineEpisodeDetails, saveCurrentPlaybackState, _retry]);

  // --- Effect to load sound when index changes ---
  useEffect(() => {
    // Only load if not loading, episodes are available, and index is valid
    // AND check the loading ref
    if (!loading && episodes.length > 0 && currentIndex !== null && !isLoadingEpisodeRef.current) {
      loadEpisodeAndPosition(currentIndex);
    } else if (!loading && episodes.length === 0) {
        // If loading finished but no episodes, ensure sound is unloaded
        audioManager.unloadSound();
        currentEpisodeIdRef.current = null;
    }
    // Intentionally not depending on loadEpisodeAndPosition to avoid loops if it changes identity.
    // It's stable due to useCallback, but this pattern is safer.
  }, [currentIndex, loading, episodes]); // Rerun when index or loading state changes


  // --- Effect for AppState changes (Background/Foreground) ---
  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (appState.current.match(/active/) && nextAppState.match(/inactive|background/)) {
        console.log('[PlayerScreen] App entering background, saving complete playback state.');
        await saveCurrentPlaybackState();
      }
      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [saveCurrentPlaybackState]); // Dependency is correct

  // --- Effect for Network changes ---
   useEffect(() => {
     const unsubscribe = NetInfo.addEventListener(state => {
       const previousState = netStateRef.current;
       netStateRef.current = state; // Update current state

       // Trigger sync if connection status changes (especially becoming connected)
       // or if connection type changes while connected
       const justConnected = !previousState?.isConnected && state.isConnected;
       const typeChangedWhileConnected = previousState?.isConnected && state.isConnected && previousState?.type !== state.type;

       if (state.isConnected && state.isInternetReachable && (justConnected || typeChangedWhileConnected)) {
         console.log('[PlayerScreen] Network connection changed/established, triggering sync.');
         syncAllLocalPositionsToSupabase();
       } else if (!state.isConnected || !state.isInternetReachable) {
           console.log('[PlayerScreen] Network connection lost.');
           // No sync needed when offline
       }
     });

     return () => {
       unsubscribe();
     };
   }, [syncAllLocalPositionsToSupabase]); // Dependency is correct


  // --- Effect to handle notification open (ensure playback) ---
  useEffect(() => {
    if (source === 'notification' && episodeId && currentEpisodeIdRef.current === episodeId) {
      console.log('[PlayerScreen] Opened from notification with matching episode, ensuring playback');
      audioManager.getStatusAsync().then(status => {
        if (status.isLoaded && !status.isPlaying && currentEpisodeIdRef.current === episodeId) {
          console.log('[PlayerScreen] Resuming playback for already loaded episode');
          audioManager.play().catch(err =>
            console.error('[PlayerScreen] Error resuming playback:', err)
          );
        }
      }).catch(error => console.error('[PlayerScreen] Error checking audio status:', error));
    }
  }, [episodeId, source]); // Dependencies are correct

  // --- Handler for playback completion ---
  const handlePlaybackComplete = useCallback(async () => {
    console.log('[PlayerScreen] Playback finished.');
    if (currentEpisodeIdRef.current) {
      let finalDurationMillis = 0;
      try {
        // Get duration accurately one last time
        const status = await audioManager.getStatusAsync();
        finalDurationMillis = status.durationMillis;
      } catch(e) {
          console.warn("[PlayerScreen] Could not get final duration on completion.");
          // Fallback: use duration from episode object if available
          const currentEp = episodes.find(ep => ep.id === currentEpisodeIdRef.current);
          if (currentEp?.duration) {
              finalDurationMillis = currentEp.duration * 1000;
          }
      }
      // Save position as completed (near the end or actual end)
      await savePositionLocally(currentEpisodeIdRef.current, finalDurationMillis);
      // Trigger sync to mark as finished in DB
      await syncAllLocalPositionsToSupabase();
      // Optionally move to next episode
      // handleNext();
    }
  }, [episodes, savePositionLocally, syncAllLocalPositionsToSupabase, currentIndex]); // Added currentIndex for potential auto-next logic

  // --- Navigation Handlers (Next/Previous) ---
  const handleNext = useCallback(async () => {
    const status = await audioManager.getStatusAsync();
    // --- MODIFICATION START: Save position before changing index ---
    if (status?.isLoaded && currentEpisodeIdRef.current) {
      console.log(`[PlayerScreen] Saving position ${status.positionMillis}ms for ${currentEpisodeIdRef.current} before going Next`);
      await savePositionLocally(currentEpisodeIdRef.current, status.positionMillis);
    }
    // --- MODIFICATION END ---
    if (currentIndex !== null && currentIndex < episodes.length - 1) {
      console.log("[PlayerScreen] Navigating to Next episode");
      setCurrentIndex(currentIndex - 1); // This triggers the effect to load the new episode
    } else { console.log("Already at the last episode"); }
  }, [currentIndex, episodes.length, savePositionLocally]);

  const handlePrevious = useCallback(async () => {
    const status = await audioManager.getStatusAsync();
    // --- MODIFICATION START: Save position before changing index ---
    if (status?.isLoaded && currentEpisodeIdRef.current) {
      console.log(`[PlayerScreen] Saving position ${status.positionMillis}ms for ${currentEpisodeIdRef.current} before going Previous`);
      await savePositionLocally(currentEpisodeIdRef.current, status.positionMillis);
    }
    // --- MODIFICATION END ---
    if (currentIndex !== null && currentIndex > 0) {
      console.log("[PlayerScreen] Navigating to Previous episode");
      setCurrentIndex(currentIndex + 1); // This triggers the effect to load the new episode
    } else { console.log("Already at the first episode"); }
  }, [currentIndex, savePositionLocally]);

  // --- Retry Handler ---
  const handleRetryLoad = useCallback(() => {
    console.log("[PlayerScreen] Retrying load...");
    // Force re-run of the initialization effect by changing the _retry param
    router.replace({
        pathname: '/(tabs)/player', // Ensure it targets the correct route
        params: { episodeId, offlinePath, source, _retry: Date.now().toString() }
    });
  }, [episodeId, offlinePath, source, router]); // Dependencies are correct

  // --- Android Back Button Handler ---
  useEffect(() => {
    if (Platform.OS !== 'android') return; // Only for Android

    const backAction = () => {
      console.log("[PlayerScreen] Back button pressed, saving state and navigating back.");
      // Save state first, then navigate back once saved
      saveCurrentPlaybackState().finally(() => {
        if (router.canGoBack()) {
            router.back();
        } else {
            // If cannot go back (e.g., deep link entry), maybe exit app or go home?
            // For now, default back behavior might handle this.
            console.log("[PlayerScreen] Cannot go back further.");
            // Returning false allows default back behavior (exit app)
            // return false;
        }
      });
      return true; // Indicate event was handled
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [router, saveCurrentPlaybackState]); // Dependencies are correct

  // --- Rendering Logic ---
  const currentEpisode = !loading && currentIndex !== null && episodes.length > currentIndex ? episodes[currentIndex] : null;

  // Loading State
  if (loading) {
    return (
      <View style={[styles.container, styles.centerContent, { backgroundColor: theme.colors.primaryBackground }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.statusText}>Loading...</Text>
      </View>
    );
  }

  // Error State (Full screen error if loading failed and no episode is displayable)
  if (error && !currentEpisode && !loading) {
    return (
      <View style={[styles.container, styles.centerContent, { backgroundColor: theme.colors.primaryBackground }]}>
        <MaterialIcons name="error-outline" size={48} color={theme.colors.error} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={handleRetryLoad} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // No Episodes State
  if (!loading && !error && episodes.length === 0) {
    return (
      <View style={[styles.container, styles.centerContent, { backgroundColor: theme.colors.primaryBackground }]}>
        <MaterialIcons name="hourglass-empty" size={48} color={theme.colors.description} />
        <Text style={styles.statusText}>No episodes available</Text>
        <TouchableOpacity onPress={handleRetryLoad} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Refresh</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Episode Not Found State (Should ideally be covered by error state now)
  // This might occur if index is somehow invalid after loading finishes
  if (!loading && !error && episodes.length > 0 && !currentEpisode) {
    return (
      <View style={[styles.container, styles.centerContent, { backgroundColor: theme.colors.primaryBackground }]}>
        <MaterialIcons name="warning" size={48} color={theme.colors.description} />
        <Text style={styles.statusText}>Episode not found</Text>
         <TouchableOpacity onPress={() => router.back()} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Main Player View
  return (
    <LinearGradient
      colors={[currentGradientStart, theme.colors.gradientEnd]} // Use state for colors
      style={styles.container}
    >
      {/* Display error as a banner if an episode is loaded but a playback error occurred */}
      {error && currentEpisode && (
          <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{error}</Text>
              {/* Optionally add a dismiss button */}
          </View>
      )}

      {/* Render Player if an episode is ready */}
      {currentEpisode && (
        <AudioPlayer
          key={currentEpisode.id} // Key ensures component remounts on episode change
          episode={currentEpisode}
          onNext={currentIndex !== null && currentIndex < episodes.length - 1 ? handleNext : undefined} // Disable if last
          onPrevious={currentIndex !== null && currentIndex > 0 ? handlePrevious : undefined} // Disable if first
          onRetry={handleRetryLoad} // Allow retry from player errors
          onComplete={handlePlaybackComplete}
          onPositionUpdate={handlePositionUpdate} // Pass the handler
        />
      )}

      {/* Fallback if somehow currentEpisode is null despite checks (should be rare) */}
      {!currentEpisode && !loading && !error && (
           <View style={[styles.container, styles.centerContent]}>
               <Text style={styles.statusText}>Unable to display player.</Text>
               {/* Maybe add a retry button here too */}
           </View>
      )}
    </LinearGradient>
  );
}

// --- Styles ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  statusText: {
    color: theme.colors.description,
    marginTop: 15,
    fontSize: 16,
  },
  errorText: {
    color: theme.colors.error,
    marginTop: 15,
    textAlign: 'center',
    fontSize: 16,
    paddingHorizontal: 20,
  },
  retryButton: {
    marginTop: 25,
    backgroundColor: theme.colors.borderColor,
    paddingVertical: 10,
    paddingHorizontal: 25,
    borderRadius: 20,
  },
  retryButtonText: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
  errorBanner: {
      backgroundColor: theme.colors.modal,
      padding: 10,
      alignItems: 'center',
  },
  errorBannerText: {
      color: theme.colors.error,
      fontSize: 14,
      textAlign: 'center',
  }
});
