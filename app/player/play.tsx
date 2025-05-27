import 'react-native-reanimated';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, AppState, AppStateStatus, BackHandler, Platform, Dimensions } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as FileSystem from 'expo-file-system';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  runOnJS,
  interpolate,
  Extrapolation
} from 'react-native-reanimated';
import { getImageUrlFromDescription } from '../../components/GTPersons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import { Episode } from '../../types/episode';
import { useAudio } from '../../components/AudioContext';
import { ErrorBanner, EmptyState, LoadingIndicator, RetryButton } from '../../components/SharedUI';
import { theme, gradientColors } from '../../styles/global';
import { parseDuration } from '../../utils/commons/timeUtils';
import { 
  EPISODES_CACHE_KEY, 
  PLAYBACK_POSITIONS_KEY, 
  getPositionLocally,
  savePositionLocally,
  loadCachedEpisodes,
  getLastPlayedEpisodeId,
  setLastPlayedEpisodeId,
  getLastPlayedPosition,
  setLastPlayedPosition,
  getWasPlaying,
  setWasPlaying,
  LocalPositions,
  setCurrentEpisodeId
} from '../../utils/cache/LocalStorageService';
import AudioPlayer from '../../components/AudioPlayer';

// --- Constants ---
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// --- Types ---
type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];
type WatchedEpisodeRow = Database['public']['Tables']['watched_episodes']['Row'];

export default function PlayerScreen() {
  const { episodeId, offlinePath, source, _retry, startPositionMillis: startPositionMillisParam } = useLocalSearchParams<{ episodeId?: string; offlinePath?: string; source?: string; _retry?: string, startPositionMillis?: string }>();
  const router = useRouter();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentGradientStart, setCurrentGradient] = useState<string>(theme.colors.gradientStart);
  const currentEpisodeIdRef = useRef<string | null>(null);
  const appState = useRef(AppState.currentState);
  const isSyncingRef = useRef(false);
  const netStateRef = useRef<NetInfoState | null>(null);
  const isLoadingEpisodeRef = useRef(false);
  const audioManager = useAudio();

  // Animated values pour le geste de fermeture
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);

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

      const upsertData = episodeIds.map(epId => {
        const localInfo = localPositions[epId];
        const episode = episodes.find(e => e.id === epId);
        const durationSeconds = episode?.duration ?? 0;
        const positionSeconds = localInfo.position;

        const isConsideredFinished = durationSeconds > 0 && positionSeconds >= durationSeconds * 0.98;

        return {
          user_id: user.id,
          episode_id: epId,
          playback_position: isConsideredFinished ? 0 : positionSeconds,
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
      } else {
        console.log(`[PlayerScreen] Successfully synced ${upsertData.length} positions.`);
      }

    } catch (error) {
      console.error("[PlayerScreen] Error during sync process:", error);
    } finally {
      isSyncingRef.current = false;
      console.log('[PlayerScreen] Sync process finished.');
    }
  }, [episodes]);

  const saveCurrentPlaybackState = useCallback(async () => {
    try {
      const episodeIdToSave = currentEpisodeIdRef.current;
      if (!episodeIdToSave) {
        console.log('[PlayerScreen] saveCurrentPlaybackState: No current episode ID, skipping.');
        return;
      }

      const status = await audioManager.getStatusAsync();
      if (!status.isLoaded || status.currentEpisodeId !== episodeIdToSave) {
         console.log(`[PlayerScreen] saveCurrentPlaybackState: Status not loaded or mismatch (Expected: ${episodeIdToSave}, Got: ${status.currentEpisodeId}, Loaded: ${status.isLoaded}), skipping save.`);
         return;
      }

      const currentTimeMillis = status.currentTime * 1000; // Convert seconds to milliseconds
      console.log(`[PlayerScreen] Saving complete playback state for ${episodeIdToSave} at position ${currentTimeMillis}ms, playing=${status.isPlaying}`);

      await savePositionLocally(episodeIdToSave, currentTimeMillis);
      await setLastPlayedEpisodeId(episodeIdToSave);
      await setLastPlayedPosition(String(currentTimeMillis));
      await setWasPlaying(status.isPlaying);

      syncAllLocalPositionsToSupabase().catch(err =>
        console.error('[PlayerScreen] Error syncing after saving state:', err)
      );
    } catch (error) {
      console.error('[PlayerScreen] Error saving current playback state:', error);
    }
  }, [savePositionLocally]);

  // Fonction de fermeture avec animation fluide
  const closePlayer = useCallback(() => {
    console.log('[PlayerScreen] Closing player with animation');
    saveCurrentPlaybackState().finally(() => {
      if (router.canGoBack()) {
        router.back();
      }
    });
  }, [router, saveCurrentPlaybackState]);

  // Geste de swipe vers le bas avec Reanimated
  const panGesture = Gesture.Pan()
    .activeOffsetY(10) // Require 10px vertical movement to activate
    .failOffsetX([-20, 20]) // Fail if horizontal movement exceeds 20px
    .onUpdate((event) => {
      // Limiter le mouvement vers le bas uniquement
      if (event.translationY > 0) {
        translateY.value = event.translationY;
        // Calculer l'opacité basée sur la translation
        opacity.value = interpolate(
          event.translationY,
          [0, SCREEN_HEIGHT * 0.3],
          [1, 0.7],
          Extrapolation.CLAMP
        );
      }
    })
    .onEnd((event) => {
      const shouldClose = event.translationY > 120 && event.velocityY > 500;
      
      if (shouldClose) {
        // Animation de fermeture avec callback
        translateY.value = withSpring(SCREEN_HEIGHT, {
          damping: 20,
          stiffness: 90,
        }, (finished) => {
          if (finished) {
            runOnJS(closePlayer)();
          }
        });
        opacity.value = withSpring(0);
      } else {
        // Revenir à la position initiale
        translateY.value = withSpring(0, {
          damping: 20,
          stiffness: 120,
        });
        opacity.value = withSpring(1);
      }
    });

  // Style animé pour le container principal
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const handlePositionUpdate = useCallback((positionSeconds: number) => {
    if (currentEpisodeIdRef.current) {
      console.log(`[PlayerScreen] Position update for ${currentEpisodeIdRef.current}: ${positionSeconds.toFixed(2)}s`);
      savePositionLocally(currentEpisodeIdRef.current, positionSeconds * 1000);
    }
  }, [savePositionLocally]);

  const getPlaybackPosition = useCallback(async (epId: string): Promise<number | null> => {
    const localPositionMillis = await getPositionLocally(epId);
    if (localPositionMillis !== null) {
      console.log(`[PlayerScreen] Using local position for ${epId}: ${localPositionMillis}ms`);
      return localPositionMillis;
    }

    const netInfoState = await NetInfo.fetch();
    if (netInfoState.isConnected && netInfoState.isInternetReachable) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          console.warn("[PlayerScreen] Cannot fetch remote position: no user logged in.");
          return null;
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
        } else if (data) {
          const remotePositionSeconds = data.is_finished ? 0 : data.playback_position;
          if (remotePositionSeconds !== null && isFinite(remotePositionSeconds)) {
            const remotePositionMillis = remotePositionSeconds * 1000;
            console.log(`[PlayerScreen] Found remote position for ${epId}: ${remotePositionSeconds}s (Finished: ${data.is_finished}). Saving locally.`);
            await savePositionLocally(epId, remotePositionMillis);
            return remotePositionMillis;
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

    console.log(`[PlayerScreen] No position found for ${epId}, starting from beginning.`);
    return null;
  }, [savePositionLocally]);

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
          mp3Link: filePath,
          publicationDate: metadata.downloadDate || new Date().toISOString(),
          duration: parseDuration(metadata.duration),
          offline_path: filePath,
          originalMp3Link: metadata.originalMp3Link,
          artwork: metadata.artwork || getImageUrlFromDescription(metadata.description || '') || undefined,
        };
      } return null;
    } catch (error) { console.error('Error getting offline episode details:', error); return null; }
  }, [parseDuration]);

  const loadEpisodeAndPosition = useCallback(async (index: number | null) => {
    if (isLoadingEpisodeRef.current) {
      console.log("[PlayerScreen] Already loading an episode, skipping request.");
      return;
    }
    
    if (index === null || episodes.length <= index) {
      console.log("[PlayerScreen] Invalid index or episodes not loaded, unloading.");
      await audioManager.unloadSound();
      currentEpisodeIdRef.current = null;
      await setCurrentEpisodeId(null);
      return;
    }

    const currentEp = episodes[index];
    const currentStatus = await audioManager.getStatusAsync();

    if (currentStatus.isLoaded && currentStatus.currentEpisodeId === currentEp.id) {
      console.log(`[PlayerScreen] Episode ${currentEp.id} already loaded, syncing UI only.`);
      setError(null);
      currentEpisodeIdRef.current = currentEp.id;
      await setCurrentEpisodeId(currentEp.id);
      setLoading(false);
      return;
    }

    if (currentStatus.isLoaded && currentStatus.currentEpisodeId && currentStatus.currentEpisodeId !== currentEp.id) {
      console.log(`[PlayerScreen] Saving position for previous episode ${currentStatus.currentEpisodeId} before loading ${currentEp.id}`);
      const currentTimeMillis = currentStatus.currentTime * 1000;
      await savePositionLocally(currentStatus.currentEpisodeId, currentTimeMillis);
      await audioManager.unloadSound();
    }

    currentEpisodeIdRef.current = currentEp.id;
    await setCurrentEpisodeId(currentEp.id);
    setError(null);
    console.log(`[PlayerScreen] Preparing to load: ${currentEp.title} (Index: ${index}, ID: ${currentEp.id})`);
    isLoadingEpisodeRef.current = true;

    try {
      let initialPosition: number | null = null;
      if (startPositionMillisParam) {
        const parsedStartPosition = Number(startPositionMillisParam);
        if (isFinite(parsedStartPosition) && parsedStartPosition >= 0) {
          initialPosition = parsedStartPosition;
          console.log(`[PlayerScreen] Using startPositionMillis from param for ${currentEp.id}: ${initialPosition}ms`);
        } else {
          console.warn(`[PlayerScreen] Invalid startPositionMillis param: ${startPositionMillisParam}`);
        }
      }
      if (initialPosition === null) {
        console.log(`[PlayerScreen] Getting playback position for ${currentEp.id}...`);
        initialPosition = await getPlaybackPosition(currentEp.id);
      }
      if (initialPosition === null) {
        const savedEpisodeId = await getLastPlayedEpisodeId();
        const savedPosition = await getLastPlayedPosition();
        if (savedEpisodeId === currentEp.id && savedPosition !== null) {
          initialPosition = Number(savedPosition);
          console.log(`[PlayerScreen] Using last globally saved position for ${currentEp.id}: ${initialPosition}ms`);
        }
      }
      if (initialPosition !== null) {
        console.log(`[PlayerScreen] Final initial position for ${currentEp.id}: ${(initialPosition/1000).toFixed(2)}s`);
      } else {
        console.log(`[PlayerScreen] No position found for ${currentEp.id}, starting from 0ms`);
        initialPosition = 0;
      }

      if (!currentEp.artwork && currentEp.description) {
        currentEp.artwork = getImageUrlFromDescription(currentEp.description) || undefined;
      }

      const episodeToLoad = { ...currentEp, mp3Link: currentEp.offline_path || currentEp.mp3Link };
      console.log(`[PlayerScreen] Calling audioManager.loadSound for ${episodeToLoad.id} with initialPosition: ${initialPosition}ms`);
      await audioManager.loadSound(episodeToLoad, initialPosition);
      console.log(`[PlayerScreen] Successfully loaded episode: ${currentEp.title}`);

      // ✅ CORRECTION : Attendre que l'événement loaded soit émis avant d'auto-resume
      const wasPlaying = await getWasPlaying();
      const lastPlayedId = await getLastPlayedEpisodeId();
      
      if (wasPlaying && lastPlayedId === currentEp.id) {
        console.log('[PlayerScreen] Auto-resuming playback - waiting for loaded event...');
        
        // ✅ Attendre que le player soit vraiment chargé
        let attempts = 0;
        const maxAttempts = 20; // 2 secondes max
        
        while (attempts < maxAttempts) {
          const status = await audioManager.getStatusAsync();
          if (status.isLoaded && status.currentEpisodeId === currentEp.id) {
            console.log('[PlayerScreen] Player is loaded, starting auto-resume');
            await setWasPlaying(false);
            await audioManager.play();
            break;
          }
          
          console.log(`[PlayerScreen] Waiting for player to load... attempt ${attempts + 1}`);
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }
        
        if (attempts >= maxAttempts) {
          console.warn('[PlayerScreen] Auto-resume timeout - player not loaded in time');
          await setWasPlaying(false);
        }
      }
      
    } catch (loadError: any) {
      console.error("[PlayerScreen] Error loading episode:", loadError);
      setError(`Error loading: ${loadError.message || 'Unknown'}`);
      await audioManager.unloadSound();
      currentEpisodeIdRef.current = null;
      await setCurrentEpisodeId(null);
    } finally {
      isLoadingEpisodeRef.current = false;
    }
  }, [episodes, savePositionLocally, source]);

  // --- Main Initialization Effect ---
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    const initializeAndLoad = async () => {
      try {
        await audioManager.setupAudio();

        const networkState = await NetInfo.fetch();
        netStateRef.current = networkState;

        let fetchedEpisodes: Episode[] = [];
        if (offlinePath) {
          console.log("[PlayerScreen] Loading single offline episode:", offlinePath);
          const offlineEpisode = await getOfflineEpisodeDetails(offlinePath);
          if (offlineEpisode) {
            fetchedEpisodes = [offlineEpisode];
          } else {
            throw new Error("Unable to load offline episode details.");
          }
        } else if (networkState.isConnected && networkState.isInternetReachable) {
          console.log("[PlayerScreen] Online, loading from Supabase...");
          const { data, error: apiError } = await supabase
            .from('episodes')
            .select('*')
            .order('publication_date', { ascending: false });

          if (apiError) throw apiError;

          fetchedEpisodes = (data as any[]).map(episode => ({
            id: episode.id,
            title: episode.title,
            description: episode.description,
            originalMp3Link: episode.original_mp3_link,
            mp3Link: episode.offline_path || episode.mp3_link,
            duration: parseDuration(episode.duration),
            publicationDate: episode.publication_date,
            offline_path: episode.offline_path,
            artwork: episode.artwork || getImageUrlFromDescription(episode.description) || undefined,
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
          if (episodeId) {
            const index = fetchedEpisodes.findIndex(ep => ep.id === episodeId);
            if (index !== -1) {
              initialIndex = index;
            } else {
              console.warn(`[PlayerScreen] Requested episode ID ${episodeId} not found in fetched list.`);
              setError("Requested episode not found.");
              initialIndex = 0;
            }
          } else if (offlinePath) {
            initialIndex = 0;
          } else {
            initialIndex = 0;
            console.log("[PlayerScreen] No specific episode requested, defaulting to first episode.");
          }
        } else {
          console.log("[PlayerScreen] No episodes available to load.");
        }

        const randomIndex = Math.floor(Math.random() * gradientColors.length);
        const selectedGradient = gradientColors[randomIndex];
        if (isMounted) {
            setCurrentGradient(selectedGradient.start);
        }

        setCurrentIndex(initialIndex);
        setLoading(false);

      } catch (err: any) {
        if (!isMounted) return;
        console.error('[PlayerScreen] Initialization error:', err);
        setError(`Initialization failed: ${err.message || 'Unknown error'}`);
        setLoading(false);
        if (!offlinePath && episodes.length === 0) {
            try {
                const cached = await loadCachedEpisodes();
                if (cached.length > 0) {
                    setEpisodes(cached);
                    const index = episodeId ? cached.findIndex(ep => ep.id === episodeId) : 0;
                    setCurrentIndex(index !== -1 ? index : 0);
                    console.warn("[PlayerScreen] Displaying cached data due to initialization error.");
                }
            } catch (cacheErr) {
                // Ignore cache error here, main error is already set
            }
        }
      }
    };

    initializeAndLoad();

    return () => {
      isMounted = false;
      console.log('[PlayerScreen] Unmounting, saving final playback state.');
      saveCurrentPlaybackState().finally(() => {
        // Consider if unloading is always desired
      });
    };
  }, [episodeId, offlinePath, source, getOfflineEpisodeDetails, saveCurrentPlaybackState, _retry]);

  useEffect(() => {
    if (!loading && episodes.length > 0 && currentIndex !== null && !isLoadingEpisodeRef.current) {
      loadEpisodeAndPosition(currentIndex);
    } else if (!loading && episodes.length === 0) {
        audioManager.unloadSound();
        currentEpisodeIdRef.current = null;
        setCurrentEpisodeId(null);
    }
  }, [currentIndex, loading, episodes]);

  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (appState.current.match(/active/) && nextAppState.match(/inactive|background/)) {
        console.log('[PlayerScreen] App entering background, saving complete playback state.');
        await saveCurrentPlaybackState();
      }
      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => { subscription.remove(); };
  }, [saveCurrentPlaybackState]);

   useEffect(() => {
     const unsubscribe = NetInfo.addEventListener(state => {
       const previousState = netStateRef.current;
       netStateRef.current = state;

       const justConnected = !previousState?.isConnected && state.isConnected;
       const typeChangedWhileConnected = previousState?.isConnected && state.isConnected && previousState?.type !== state.type;

       if (state.isConnected && state.isInternetReachable && (justConnected || typeChangedWhileConnected)) {
         console.log('[PlayerScreen] Network connection changed/established, triggering sync.');
         syncAllLocalPositionsToSupabase();
       } else if (!state.isConnected || !state.isInternetReachable) {
           console.log('[PlayerScreen] Network connection lost.');
       }
     });

     return () => { unsubscribe(); };
   }, [syncAllLocalPositionsToSupabase]);

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
  }, [episodeId, source]);

  const handlePlaybackComplete = useCallback(async () => {
    console.log('[PlayerScreen] Playback finished.');
    if (currentEpisodeIdRef.current) {
      let finalDurationMillis = 0;
      try {
        const status = await audioManager.getStatusAsync();
        finalDurationMillis = status.currentTime;
      } catch(e) {
          console.warn("[PlayerScreen] Could not get final duration on completion.");
          const currentEp = episodes.find(ep => ep.id === currentEpisodeIdRef.current);
          if (currentEp?.duration) {
              finalDurationMillis = currentEp.duration * 1000;
          }
      }
      await savePositionLocally(currentEpisodeIdRef.current, finalDurationMillis);
      await syncAllLocalPositionsToSupabase();
    }
  }, [episodes, savePositionLocally, syncAllLocalPositionsToSupabase, currentIndex]);

  const handleNext = useCallback(async () => {
    const status = await audioManager.getStatusAsync();
    if (status?.isLoaded && currentEpisodeIdRef.current) {
      const currentTimeMillis = status.currentTime * 1000;
      console.log(`[PlayerScreen] Saving position ${currentTimeMillis}ms for ${currentEpisodeIdRef.current} before going Next`);
      await savePositionLocally(currentEpisodeIdRef.current, currentTimeMillis);
      // --- STOP/UNLOAD audio before next
      await audioManager.unloadSound();
      audioManager.stopAllSounds();
    }
    if (currentIndex !== null && currentIndex < episodes.length - 1) {
      console.log("[PlayerScreen] Navigating to Next episode");
      setCurrentIndex(currentIndex - 1);
    } else { console.log("Already at the last episode"); }
  }, [currentIndex, episodes.length, savePositionLocally]);

  const handlePrevious = useCallback(async () => {
    const status = await audioManager.getStatusAsync();
    if (status?.isLoaded && currentEpisodeIdRef.current) {
      const currentTimeMillis = status.currentTime * 1000;
      console.log(`[PlayerScreen] Saving position ${currentTimeMillis}ms for ${currentEpisodeIdRef.current} before going Previous`);
      await savePositionLocally(currentEpisodeIdRef.current, currentTimeMillis);
      // --- STOP/UNLOAD audio before previous
      await audioManager.unloadSound();
      audioManager.stopAllSounds();
    }
    if (currentIndex !== null && currentIndex > 0) {
      console.log("[PlayerScreen] Navigating to Previous episode");
      setCurrentIndex(currentIndex + 1);
      audioManager.stopAllSounds();
    } else { console.log("Already at the first episode"); }
  }, [currentIndex, savePositionLocally]);

  const handleRetryLoad = useCallback(() => {
    console.log("[PlayerScreen] Retrying load...");
    router.replace({
        pathname: '/player/play',
        params: { episodeId, offlinePath, source, _retry: Date.now().toString() }
    });
  }, [episodeId, offlinePath, source, router]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const backAction = () => {
      console.log("[PlayerScreen] Back button pressed, saving state and navigating back.");
      saveCurrentPlaybackState().finally(() => {
        if (router.canGoBack()) {
            router.back();
        } else {
            console.log("[PlayerScreen] Cannot go back further.");
        }
      });
      return true;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [router, saveCurrentPlaybackState]);

  // --- Rendering Logic ---
  const currentEpisode = !loading && currentIndex !== null && episodes.length > currentIndex ? episodes[currentIndex] : null;

  // Error State
  if (error) {
    return (
      <EmptyState message={error}>
        <RetryButton onPress={handleRetryLoad} text="Retry" style={styles.retryButton} />
      </EmptyState>
    );
  }

  // No Episodes State
  if (!loading && !error && episodes.length === 0) {
    return (
      <EmptyState message="No episodes available">
        <RetryButton onPress={handleRetryLoad} text="Refresh" style={styles.retryButton} />
      </EmptyState>
    );
  }

  // Episode Not Found State
  if (!loading && !error && episodes.length > 0 && !currentEpisode) {
    return (
      <EmptyState message="Episode not found">
        <RetryButton onPress={() => router.back()} text="Go Back" style={styles.retryButton} />
      </EmptyState>
    );
  }

  // Loading State
  if (loading) {
    return <LoadingIndicator message="" style={styles.centerContent} />;
  }

  // Main Player View avec Reanimated Gesture
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[{ flex: 1 }, animatedStyle]}>
          <LinearGradient
            colors={[currentGradientStart, theme.colors.gradientEnd]}
            style={styles.container}
          >
            {error && currentEpisode && (
                <ErrorBanner message={error} />
            )}

            {currentEpisode && (
              <View style={styles.playerContainer}>
                <AudioPlayer
                  key={currentEpisode.id}
                  episode={currentEpisode}
                  onNext={currentIndex !== null && currentIndex < episodes.length - 1 ? handleNext : undefined}
                  onPrevious={currentIndex !== null && currentIndex > 0 ? handlePrevious : undefined}
                  onRetry={handleRetryLoad}
                  onComplete={handlePlaybackComplete}
                  onPositionUpdate={handlePositionUpdate}
                />
              </View>
            )}

            {!currentEpisode && !loading && !error && (
                 <View style={[styles.container, styles.centerContent]}>
                     <Text style={styles.statusText}>Unable to display player.</Text>
                 </View>
            )}

            {/* Bouton de fermeture avec meilleure visibilité */}
            <TouchableOpacity 
              style={styles.closeButton} 
              onPress={closePlayer}
              hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            >
              <MaterialIcons name="expand-more" size={36} color="white" />
            </TouchableOpacity>
          </LinearGradient>
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

// --- Styles ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  playerContainer: {
    flex: 1,
    zIndex: 1000,
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
  retryButton: {
    marginTop: 25,
    backgroundColor: theme.colors.borderColor,
    paddingVertical: 10,
    paddingHorizontal: 25,
    borderRadius: 20,
  },
  closeButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    padding: 15,
    zIndex: 1001,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 30,
  },
});