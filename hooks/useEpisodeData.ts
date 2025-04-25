import { useState, useEffect, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../lib/supabase';
import { Episode } from '../types/episode';
import { Database } from '../types/supabase'; // Assuming this defines Supabase types
import { usePlayerState } from './usePlayerState';
import { loadCachedEpisodes, saveEpisodesToCache, getOfflineEpisodeDetails } from '../services/OfflineService';
import { triggerSync } from '../services/PlaybackSyncService';

type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];
type WatchedEpisodeRow = Database['public']['Tables']['watched_episodes']['Row'];

export const useEpisodeData = () => {
  const { actions } = usePlayerState()!;
  const [isLoadingData, setIsLoadingData] = useState(true); // Internal loading state for this hook

  const fetchOnlineData = useCallback(async () => {
    console.log('[useEpisodeData] Fetching online data...');
    setIsLoadingData(true);
    actions.setError(null);
    actions.setIsOffline(false);

    try {
      // Fetch Episodes
      const { data: episodeData, error: episodesError } = await supabase
        .from('episodes')
        .select('*')
        .order('publication_date', { ascending: false });

      if (episodesError) throw episodesError;

      const formattedEpisodes: Episode[] = (episodeData as SupabaseEpisode[]).map(episode => ({
        id: episode.id,
        title: episode.title,
        description: episode.description,
        originalMp3Link: episode.original_mp3_link,
        mp3Link: episode.mp3_link, // Assuming mp3_link is the one to use (e.g., GCP link)
        duration: episode.duration ?? 0, // Provide 0 as default if duration is null
        publicationDate: episode.publication_date,
        // artworkUrl: episode.artwork_url, // Add if available in DB
      }));

      // Basic URL validation/normalization (optional)
      const validEpisodes = formattedEpisodes.map(ep => {
          if (ep.mp3Link && !ep.mp3Link.startsWith('http')) {
              console.warn(`[useEpisodeData] Normalizing potentially invalid URL: ${ep.mp3Link}`);
              ep.mp3Link = `https://${ep.mp3Link}`; // Basic assumption
          }
          return ep;
      });

      actions.setEpisodes(validEpisodes);
      await saveEpisodesToCache(validEpisodes); // Update cache
      console.log(`[useEpisodeData] Fetched ${validEpisodes.length} episodes online.`);

      // Fetch Playback Positions
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: positionData, error: positionsError } = await supabase
          .from('watched_episodes')
          .select('episode_id, playback_position')
          .eq('user_id', user.id)
          .filter('is_finished', 'eq', false) // Only get positions for unfinished episodes
          .gt('playback_position', 0); // Position must be greater than 0

        if (positionsError) throw positionsError;

        const positionsMap = new Map<string, number>();
        if (positionData) {
          (positionData as WatchedEpisodeRow[]).forEach(row => {
            if (row.episode_id && row.playback_position !== null) {
              positionsMap.set(row.episode_id, row.playback_position);
            }
          });
        }
        actions.setPlaybackPositions(positionsMap);
        console.log(`[useEpisodeData] Fetched ${positionsMap.size} playback positions online.`);
      } else {
         actions.setPlaybackPositions(new Map()); // Clear positions if not logged in
      }

      // Trigger sync after successful online fetch (in case there was offline activity)
      triggerSync();

    } catch (error) {
      console.error('[useEpisodeData] Error fetching online data:', error);
      actions.setError('Erreur de récupération des données.');
      // Fallback to cache is handled by the main loadData function
      throw error; // Re-throw to indicate failure
    } finally {
      setIsLoadingData(false);
    }
  }, [actions]);

  const loadOfflineData = useCallback(async () => {
    console.log('[useEpisodeData] Loading offline data (cache)...');
    setIsLoadingData(true);
    actions.setError(null);
    actions.setIsOffline(true);

    try {
      const cachedEpisodes = await loadCachedEpisodes();
      if (cachedEpisodes.length > 0) {
        actions.setEpisodes(cachedEpisodes);
        // Note: Playback positions are not fetched offline, rely on context state / pending queue
        actions.setPlaybackPositions(new Map()); // Clear online positions when offline
        console.log(`[useEpisodeData] Loaded ${cachedEpisodes.length} episodes from cache.`);
      } else {
        console.log('[useEpisodeData] Cache is empty.');
        actions.setEpisodes([]);
        actions.setError('Aucun épisode en cache disponible hors ligne.');
      }
    } catch (error) {
      console.error('[useEpisodeData] Error loading offline data:', error);
      actions.setError('Erreur de chargement du cache.');
      actions.setEpisodes([]);
    } finally {
      setIsLoadingData(false);
    }
  }, [actions]);

  const loadData = useCallback(async () => {
    actions.setPlaybackState({ isLoading: true }); // Set global loading true
    try {
      const networkState = await NetInfo.fetch();
      if (networkState.isConnected) {
        await fetchOnlineData();
      } else {
        await loadOfflineData();
      }
    } catch (error) {
      // If online fetch failed, try cache as fallback
      console.log('[useEpisodeData] Online fetch failed, attempting cache fallback...');
      await loadOfflineData();
    } finally {
       actions.setPlaybackState({ isLoading: false }); // Set global loading false
    }
  }, [fetchOnlineData, loadOfflineData, actions]);

  // Effect to load data on mount and handle network changes
  useEffect(() => {
    loadData(); // Initial load

    const unsubscribe = NetInfo.addEventListener(state => {
      console.log('[useEpisodeData] Network state changed:', state.isConnected);
      if (state.isConnected) {
        actions.setIsOffline(false);
        // Optionally re-fetch data or trigger sync when connection returns
        triggerSync();
        // Consider if a full data refresh is needed vs just syncing
        // loadData(); // Uncomment to force refresh on reconnection
      } else {
        actions.setIsOffline(true);
        // No action needed, app should rely on cached data / offline state
      }
    });

    return () => unsubscribe();
  }, [loadData, actions]); // loadData is memoized

  return {
    loadData, // Expose loadData for manual refresh (e.g., pull-to-refresh)
    isLoadingData, // Expose internal loading state if needed
    getOfflineEpisodeDetails, // Expose helper for PlayerScreen
  };
};
