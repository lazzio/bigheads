import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, AppState, AppStateStatus, BackHandler } from 'react-native';
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
import { theme } from '../../styles/global';
import { parseDuration } from '../../utils/commons/timeUtils';

type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];
type WatchedEpisodeRow = Database['public']['Tables']['watched_episodes']['Row'];

const EPISODES_CACHE_KEY = 'cached_episodes';
const PLAYBACK_POSITIONS_KEY = 'playbackPositions';

// Structure for locally stored positions
interface LocalPositionInfo {
  position: number; // seconds
  timestamp: number; // ms since epoch
}
type LocalPositions = Record<string, LocalPositionInfo>;

export default function PlayerScreen() {
  const { episodeId, offlinePath, source } = useLocalSearchParams<{ episodeId?: string; offlinePath?: string; source?: string }>();
  const router = useRouter();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentEpisodeIdRef = useRef<string | null>(null);
  const appState = useRef(AppState.currentState);
  const isSyncingRef = useRef(false); // Ref to prevent concurrent syncs
  const netStateRef = useRef<NetInfoState | null>(null); // Store last network state

  // --- Local Storage Helpers ---
  const savePositionLocally = useCallback(async (epId: string, positionMillis: number) => {
    if (!epId) return;
    const positionSeconds = positionMillis / 1000;
    console.log(`[PlayerScreen] Saving position locally for ${epId}: ${positionSeconds.toFixed(2)}s`);
    try {
      const existingPositionsString = await AsyncStorage.getItem(PLAYBACK_POSITIONS_KEY);
      const positions: LocalPositions = existingPositionsString ? JSON.parse(existingPositionsString) : {};
      positions[epId] = {
        position: positionSeconds,
        timestamp: Date.now(),
      };
      await AsyncStorage.setItem(PLAYBACK_POSITIONS_KEY, JSON.stringify(positions));
    } catch (error) {
      console.error("[PlayerScreen] Error saving position locally:", error);
    }
  }, []);

  const getPositionLocally = useCallback(async (epId: string): Promise<number | null> => {
    if (!epId) return null;
    try {
      const existingPositionsString = await AsyncStorage.getItem(PLAYBACK_POSITIONS_KEY);
      const positions: LocalPositions = existingPositionsString ? JSON.parse(existingPositionsString) : {};
      if (positions[epId]) {
        console.log(`[PlayerScreen] Found local position for ${epId}: ${positions[epId].position}s`);
        return positions[epId].position * 1000; // Return in milliseconds
      }
    } catch (error) {
      console.error("[PlayerScreen] Error getting position locally:", error);
    }
    return null;
  }, []);

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
  }, [episodes]); // Depend on episodes array to get duration

  // --- Position Update Handler (from AudioPlayer) ---
  const handlePositionUpdate = useCallback((positionMillis: number) => {
    if (currentEpisodeIdRef.current) {
      savePositionLocally(currentEpisodeIdRef.current, positionMillis);
    }
  }, [savePositionLocally]);

  // --- Function to GET playback position (Local first, then Remote, save remote locally) ---
  const getPlaybackPosition = useCallback(async (epId: string): Promise<number | null> => {
    // 1. Try local storage
    const localPositionMillis = await getPositionLocally(epId);
    if (localPositionMillis !== null) {
      console.log(`[PlayerScreen] Using local position for ${epId}: ${localPositionMillis}ms`);
      return localPositionMillis;
    }

    // 2. Try remote storage (if online)
    const netInfoState = await NetInfo.fetch();
    if (netInfoState.isConnected && netInfoState.isInternetReachable) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;

        console.log(`[PlayerScreen] No local position for ${epId}, checking Supabase...`);
        const { data, error } = await supabase
          .from('watched_episodes')
          .select('playback_position, is_finished')
          .eq('user_id', user.id)
          .eq('episode_id', epId)
          .maybeSingle();

        if (error) {
          console.error("[PlayerScreen] Supabase fetch position error:", error.message);
        } else if (data) {
          // If marked finished remotely, start from beginning, otherwise use stored position
          const remotePositionSeconds = data.is_finished ? 0 : data.playback_position;
          if (remotePositionSeconds !== null) {
            const remotePositionMillis = remotePositionSeconds * 1000;
            console.log(`[PlayerScreen] Found remote position for ${epId}: ${remotePositionSeconds}s (Finished: ${data.is_finished}). Saving locally.`);
            // *** Save the fetched remote position locally ***
            await savePositionLocally(epId, remotePositionMillis);
            return remotePositionMillis; // Return in milliseconds
          }
        } else {
          console.log(`[PlayerScreen] No remote position found for ${epId} in Supabase.`);
        }
      } catch (err) {
        console.error("[PlayerScreen] Exception fetching remote position:", err);
      }
    } else {
        console.log(`[PlayerScreen] Offline, cannot check remote position for ${epId}.`);
    }

    // 3. Default to null (start from beginning) if not found locally or remotely
    console.log(`[PlayerScreen] No position found for ${epId}, starting from beginning.`);
    return null;
  }, [getPositionLocally, savePositionLocally]); // Add savePositionLocally dependency

  // --- Function to load episodes from cache ---
  const loadCachedEpisodes = useCallback(async (): Promise<Episode[]> => {
    // ... (existing code - no changes needed here) ...
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
    // ... (existing code - no changes needed here) ...
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

  // --- Function to load the episode and its position ---
  const loadEpisodeAndPosition = useCallback(async (index: number | null) => {
    if (index === null || episodes.length <= index) {
      console.log("[PlayerScreen] Invalid index or episodes not loaded, unloading.");
      await audioManager.unloadSound();
      currentEpisodeIdRef.current = null;
      return;
    }

    const currentEp = episodes[index];
    // Check if the episode to load is already the current one
    const currentStatus = await audioManager.getStatusAsync();
    if (currentEpisodeIdRef.current === currentEp.id && currentStatus.isLoaded) {
        console.log(`[PlayerScreen] Episode ${currentEp.title} is already loaded.`);
        return; // Don't reload if already loaded
    }

    currentEpisodeIdRef.current = currentEp.id;
    setError(null);
    console.log(`[PlayerScreen] Preparing to load: ${currentEp.title} (Index: ${index})`);

    try {
      // Get initial position (local first, then remote)
      const initialPosition = await getPlaybackPosition(currentEp.id);
      console.log(`[PlayerScreen] Initial position for ${currentEp.id}: ${initialPosition ?? 0}ms`);
      // Use offline_path if available, otherwise mp3Link
      const sourceUri = currentEp.offline_path || currentEp.mp3Link;
      if (!sourceUri) {
          throw new Error(`No valid audio source found for episode ${currentEp.id}`);
      }
      const episodeToLoad = { ...currentEp, mp3Link: sourceUri }; // Ensure mp3Link is correct

      await audioManager.loadSound(episodeToLoad, initialPosition ?? 0);
      console.log(`[PlayerScreen] Successfully loaded: ${currentEp.title}`);
    } catch (loadError: any) {
      console.error("[PlayerScreen] Error loading episode:", loadError);
      setError(`Error loading: ${loadError.message || 'Unknown'}`);
      await audioManager.unloadSound();
      currentEpisodeIdRef.current = null;
    }
  }, [episodes, getPlaybackPosition]); // Depend on episodes and getPlaybackPosition

  // --- Main Initialization Effect ---
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const initializeAndLoad = async () => {
      try {
        await audioManager.setupAudio();
        const networkState = await NetInfo.fetch();
        netStateRef.current = networkState; // Store initial network state
        let fetchedEpisodes: Episode[] = [];

        if (offlinePath) {
          console.log("[PlayerScreen] Loading offline episode:", offlinePath);
          const offlineEpisode = await getOfflineEpisodeDetails(offlinePath);
          if (offlineEpisode) {
            fetchedEpisodes = [offlineEpisode];
          } else {
            throw new Error("Unable to load offline episode details.");
          }
        } else if (networkState.isConnected) {
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
            duration: parseDuration(episode.duration),
            publicationDate: episode.publication_date,
            offline_path: episode.offline_path ?? undefined,
          }));
          await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(fetchedEpisodes));
        } else {
          console.log("[PlayerScreen] Offline, loading from cache...");
          fetchedEpisodes = await loadCachedEpisodes();
          if (fetchedEpisodes.length === 0) {
            setError("Offline mode and no cached episodes available.");
          }
        }

        if (!isMounted) return;

        setEpisodes(fetchedEpisodes);

        let initialIndex: number | null = null;
        if (fetchedEpisodes.length > 0) {
            if (offlinePath) {
                initialIndex = 0;
            } else if (episodeId) {
                const index = fetchedEpisodes.findIndex(ep => ep.id === episodeId);
                if (index !== -1) {
                    initialIndex = index;
                } else {
                    console.warn(`[PlayerScreen] Episode ID ${episodeId} not found.`);
                    setError("Requested episode not found.");
                    initialIndex = 0; // Fallback to first episode
                }
            } else {
                initialIndex = 0; // Default to first episode
                console.log("[PlayerScreen] No specific episode requested, loading first.");
            }
        } else {
            console.log("[PlayerScreen] No episodes to load.");
        }

        setCurrentIndex(initialIndex);
        setLoading(false);

      } catch (err: any) {
        if (!isMounted) return;
        console.error('[PlayerScreen] Initialization error:', err);
        setError(`Error: ${err.message || 'Unknown'}`);
        // Try loading from cache as a last resort if API failed
        if (!offlinePath) {
            try {
                const cached = await loadCachedEpisodes();
                if (cached.length > 0) {
                    setEpisodes(cached);
                    // Try to find index in cache
                    if (episodeId) {
                        const index = cached.findIndex(ep => ep.id === episodeId);
                        setCurrentIndex(index !== -1 ? index : 0);
                    } else {
                        setCurrentIndex(0);
                    }
                    // Keep the original error message, but at least show cached data
                }
            } catch (cacheErr) {
                // Ignore cache error here, main error is already set
            }
        }
        setLoading(false);
      }
    };

    initializeAndLoad();

    // Cleanup on unmount
    return () => {
      isMounted = false;
      console.log('[PlayerScreen] Unmounting, unloading audio.');
      // Save position one last time before unloading
      audioManager.getStatusAsync().then(status => {
          if (status.isLoaded && currentEpisodeIdRef.current) {
              savePositionLocally(currentEpisodeIdRef.current, status.positionMillis);
              // Optionally trigger sync here? AppState listener should handle it too.
              // syncAllLocalPositionsToSupabase();
          }
      }).finally(() => {
          audioManager.unloadSound();
      });
    };
  // Run only on initial mount or if route params change
  }, [episodeId, offlinePath, loadCachedEpisodes, getOfflineEpisodeDetails, savePositionLocally]);


  // --- Effect to load sound when index changes ---
  useEffect(() => {
    if (!loading && currentIndex !== null) {
      loadEpisodeAndPosition(currentIndex);
    } else if (!loading && episodes.length > 0 && currentIndex === null) {
        console.log("[PlayerScreen] Episodes loaded but index is null, loading first.");
        setCurrentIndex(0); // Attempt to load the first one
    } else if (!loading && episodes.length === 0) {
        audioManager.unloadSound();
    }
  }, [currentIndex, loading, loadEpisodeAndPosition, episodes.length]);


  // --- Effect for AppState changes (Background/Foreground) ---
  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (appState.current.match(/active/) && nextAppState.match(/inactive|background/)) {
        console.log('[PlayerScreen] App entering background, saving position and syncing.');
        const status = await audioManager.getStatusAsync();
        if (status.isLoaded && currentEpisodeIdRef.current) {
          await savePositionLocally(currentEpisodeIdRef.current, status.positionMillis);
        }
        // Trigger sync when app goes to background
        await syncAllLocalPositionsToSupabase();
      }
      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [savePositionLocally, syncAllLocalPositionsToSupabase]); // Add dependencies

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
   }, [syncAllLocalPositionsToSupabase]); // Add dependency


  // --- Effect to handle notification open ---
  useEffect(() => {
    // ... (existing code - no changes needed here) ...
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
  }, [episodeId, source]);

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
  }, [episodes, savePositionLocally, syncAllLocalPositionsToSupabase]); // Add dependencies

  // --- Navigation Handlers (Next/Previous) ---
  const handleNext = useCallback(async () => {
    const status = await audioManager.getStatusAsync();
    if (status?.isLoaded && currentEpisodeIdRef.current) {
      // Save current position before navigating
      await savePositionLocally(currentEpisodeIdRef.current, status.positionMillis);
    }
    if (currentIndex !== null && currentIndex < episodes.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else { console.log("Already at the last episode"); }
  }, [currentIndex, episodes.length, savePositionLocally]);

  const handlePrevious = useCallback(async () => {
    const status = await audioManager.getStatusAsync();
    if (status?.isLoaded && currentEpisodeIdRef.current) {
      // Save current position before navigating
      await savePositionLocally(currentEpisodeIdRef.current, status.positionMillis);
    }
    if (currentIndex !== null && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    } else { console.log("Already at the first episode"); }
  }, [currentIndex, savePositionLocally]);

  // --- Retry Handler ---
  const handleRetryLoad = useCallback(() => {
    console.log("[PlayerScreen] Retrying load...");
    setError(null); // Clear previous error
    if (currentIndex !== null) {
      setLoading(true); // Show loading indicator while retrying
      loadEpisodeAndPosition(currentIndex).finally(() => setLoading(false));
    } else {
      // If index is null, retry the initial load process
      setLoading(true);
      // Re-trigger the main initialization effect logic somehow?
      // Easiest might be to navigate to self with a timestamp to force re-run
      router.replace({
          pathname: '/player',
          params: { episodeId, offlinePath, source, _retry: Date.now().toString() }
      });
    }
  }, [currentIndex, loadEpisodeAndPosition, episodeId, offlinePath, source, router]);

  // --- Android Back Button Handler ---
  useEffect(() => {
    const backAction = () => {
      // Save position before going back
      audioManager.getStatusAsync().then(status => {
          if (status.isLoaded && currentEpisodeIdRef.current) {
              savePositionLocally(currentEpisodeIdRef.current, status.positionMillis);
          }
      }).finally(() => {
          router.back(); // Navigate back after attempting save
      });
      return true; // Indicate event was handled
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [router, savePositionLocally]); // Add savePositionLocally dependency

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

  // Error State (with Retry)
  if (error && !currentEpisode) { // Show full screen error only if no episode is loaded
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

  // No Episodes State (with Refresh/Retry)
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

  // Episode Not Found State (e.g., invalid index after load)
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
      colors={[theme.colors.gradientStart, theme.colors.gradientEnd]}
      style={styles.container}
    >
      {/* Display error as a banner if an episode is loaded but an error occurred (e.g., playback error) */}
      {error && currentEpisode && (
          <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{error}</Text>
          </View>
      )}
      {currentEpisode && (
        <AudioPlayer
          key={currentEpisode.id} // Ensure re-render on episode change
          episode={currentEpisode}
          onNext={handleNext} // Use corrected next handler
          onPrevious={handlePrevious} // Use corrected previous handler
          onRetry={handleRetryLoad}
          onComplete={handlePlaybackComplete}
          onPositionUpdate={handlePositionUpdate} // Pass the handler
        />
      )}
      {/* Fallback if somehow currentEpisode is null despite checks */}
      {!currentEpisode && !loading && !error && (
           <View style={[styles.container, styles.centerContent]}>
               <Text style={styles.statusText}>Unable to display player.</Text>
           </View>
      )}
    </LinearGradient>
  );
}

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