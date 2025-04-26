import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { Episode } from '../../types/episode';
import { getEpisodes } from '../../services/episodes/episodeService';
import { fetchWatchedEpisodeIds } from '../../services/episodes/watchedEpisodeService';

export function useEpisodes() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const loadData = useCallback(async (isRefreshing = false) => {
    if (!isRefreshing) {
      setLoading(true); // Show loading indicator only on initial load/focus
    }
    setError(null); // Reset error on new load attempt

    try {
      // Fetch episodes (handles network check and cache internally)
      const { episodes: fetchedEpisodes, isOffline: currentOfflineStatus } = await getEpisodes();
      setEpisodes(fetchedEpisodes);
      setIsOffline(currentOfflineStatus);

      // Fetch watched status only if online or if episodes were loaded from cache
      if (!currentOfflineStatus || fetchedEpisodes.length > 0) {
        const watchedIds = await fetchWatchedEpisodeIds();
        setWatchedEpisodes(watchedIds);
      } else {
        setWatchedEpisodes(new Set()); // Clear watched if offline and no cache
      }

    } catch (err) {
      console.error('[useEpisodes] Error loading data:', err);
      // If getEpisodes threw an error but provided cached data, the error message indicates this
      const errorMessage = err instanceof Error ? err.message : 'Failed to load episodes';
      setError(errorMessage);
      // Keep existing episodes if they were loaded before the error (e.g., cache fallback)
      if (episodes.length === 0) {
         setEpisodes([]); // Ensure empty if load completely failed
      }
      setWatchedEpisodes(new Set()); // Clear watched status on error
    } finally {
      setLoading(false);
    }
  }, [episodes.length]); // Include episodes.length to re-evaluate error message logic if needed

  // Load data when the screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadData();
      // No cleanup needed here, but you could add AbortController logic if fetches were complex
      return () => {};
    }, [loadData]) // Depend on loadData
  );

  // Expose a refresh function
  const refresh = useCallback(() => {
    loadData(true); // Pass true to indicate it's a refresh action
  }, [loadData]);

  return {
    episodes,
    watchedEpisodes,
    loading,
    error,
    isOffline,
    refresh, // Expose the refresh function
  };
}
