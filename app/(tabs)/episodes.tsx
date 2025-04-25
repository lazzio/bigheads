import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import { Episode } from '../../types/episode';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatTime } from '../../utils/OptimizedAudioService';
import { theme } from '../../styles/global';
import { componentStyle } from '../../styles/componentStyle';

type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];
type WatchedEpisodeRow = Database['public']['Tables']['watched_episodes']['Row'];

const EPISODES_CACHE_KEY = 'cached_episodes';

export default function EpisodesScreen() {
  const router = useRouter();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  // Vérifier l'état de la connexion
  const checkNetworkStatus = async () => {
    try {
      const state = await NetInfo.fetch();
      setIsOffline(!state.isConnected);
      return !state.isConnected;
    } catch (error) {
      console.warn('Error checking network status:', error);
      return false;
    }
  };

  // Utiliser useFocusEffect pour rafraîchir les données lorsque l'écran est affiché
  useFocusEffect(
    useCallback(() => {
      const loadScreenData = async () => {
        setLoading(true);
        setError(null); // Reset error on focus
        try {
          await checkNetworkStatus(); // Check network first
          await fetchEpisodes(); // Fetch episodes (handles cache internally)
          await fetchWatchedEpisodes(); // Fetch watched status
        } catch (err) {
           console.error('[EpisodesScreen] Error loading data on focus:', err);
           // Error state is likely already set by fetchEpisodes if it failed
           if (!error) { // Set a generic error if fetchEpisodes didn't set one
              setError(err instanceof Error ? err.message : 'Failed to load episodes');
           }
        } finally {
           setLoading(false);
        }
      };
      loadScreenData();

      // Optional: Return cleanup function if needed
      return () => {};
    }, []) // Empty dependency array means it runs on focus
  );

  // Charger les épisodes depuis le cache
  const loadCachedEpisodes = async (): Promise<Episode[]> => {
    try {
      const cachedData = await AsyncStorage.getItem(EPISODES_CACHE_KEY);
      if (cachedData) {
        const episodes = JSON.parse(cachedData);
        console.log(`Loaded ${episodes.length} episodes from cache for episodes tab`);
        return episodes;
      }
    } catch (error) {
      console.error('Error loading cached episodes:', error);
    }
    return [];
  };

  async function fetchEpisodes() {
    // setLoading(true); // Handled by useFocusEffect
    // setError(null); // Handled by useFocusEffect
    try {
      // Check network status again within fetch in case it changed
      const offline = await checkNetworkStatus();

      if (offline) {
        const cachedEpisodes = await loadCachedEpisodes();
        if (cachedEpisodes.length > 0) {
          setEpisodes(cachedEpisodes);
          // setError(null); // Don't clear potential existing errors, maybe just info?
        } else {
          setEpisodes([]); // Clear episodes if cache is empty
          // setError('Aucun épisode en cache disponible en mode hors-ligne'); // Informative message
        }
        // setLoading(false); // Handled by useFocusEffect
        return; // Return early in offline mode
      }

      // Online: Fetch from Supabase
      const { data, error: apiError } = await supabase
        .from('episodes')
        .select('*')
        .order('publication_date', { ascending: false });

      if (apiError) throw apiError; // Throw error to be caught by caller

      // ... existing episode formatting ...
      const formattedEpisodes: Episode[] = (data as SupabaseEpisode[]).map(episode => ({
        id: episode.id,
        title: episode.title,
        description: episode.description,
        originalMp3Link: episode.original_mp3_link,
        mp3Link: episode.mp3_link,
        offline_path: episode.offline_path,
        duration: episode.duration,
        publicationDate: episode.publication_date,
      }));

      setEpisodes(formattedEpisodes);

      // Save to cache
      try {
        await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(formattedEpisodes));
      } catch (cacheError) {
        console.error('Error saving episodes to cache:', cacheError);
        // Non-critical error, proceed
      }
    } catch (err) {
      console.error('[EpisodesScreen] fetchEpisodes failed:', err);
      // Try loading from cache as fallback ONLY if episodes aren't already set
      if (episodes.length === 0) {
         const cachedEpisodes = await loadCachedEpisodes();
         if (cachedEpisodes.length > 0) {
           setEpisodes(cachedEpisodes);
           setError('Affichage des données en cache - Erreur réseau'); // Informative error
         } else {
           setEpisodes([]); // Ensure episodes are empty on error
           setError(err instanceof Error ? err.message : 'Une erreur est survenue'); // Set specific error
         }
      } else {
         // If episodes are already loaded (e.g., from previous cache), keep them but show error
         setError(err instanceof Error ? err.message : 'Erreur lors de la mise à jour');
      }
      // Re-throw error to be caught by useFocusEffect if needed
      throw err;
    }
  }


  async function fetchWatchedEpisodes() {
    try {
      // ... existing fetch logic ...
      const userResponse = await supabase.auth.getUser();
      const userId = userResponse.data.user?.id;
      if (!userId) {
         setWatchedEpisodes(new Set()); // Clear watched if not logged in
         return;
      }

      const { data, error } = await supabase
        .from('watched_episodes')
        .select('episode_id')
        .eq('user_id', userId)
        .eq('is_finished', true);

      if (error) throw error;

      if (!data) {
        console.log('No watched episodes found');
        setWatchedEpisodes(new Set());
        return;
      }

      const watchedIds = new Set((data as WatchedEpisodeRow[]).map(we => we.episode_id));
      console.log(`Fetched ${watchedIds.size} watched episodes`);
      setWatchedEpisodes(watchedIds);

    } catch (err) {
      console.error('Erreur récupération épisodes vus:', err);
      setWatchedEpisodes(new Set()); // Réinitialiser en cas d'erreur
    }
  }

  // Loading state display
  if (loading) {
    return (
      <View style={[componentStyle.container, styles.centered]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.loadingText}>Chargement des épisodes...</Text>
      </View>
    );
  }

  // Error state display
  if (error && episodes.length === 0) { // Only show full screen error if no episodes are displayed
     return (
       <View style={[componentStyle.container, styles.centered]}>
         <MaterialIcons name="error-outline" size={48} color={theme.colors.error} />
         <Text style={styles.errorText}>{error}</Text>
          {/* Optional: Add a retry button */}
         <TouchableOpacity onPress={() => { /* Trigger reload via focus effect? Or call loadScreenData directly? */ }} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Réessayer</Text>
         </TouchableOpacity>
       </View>
     );
  }


  return (
    <View style={componentStyle.container}>
      {/* ... existing header ... */}
      <View style={componentStyle.header}>
        <Text style={componentStyle.headerTitle}>Episodes</Text>
      </View>

      {/* Display offline banner */}
      {isOffline && (
        <View style={styles.offlineContainer}>
          <MaterialIcons name="wifi-off" size={20} color={theme.colors.description} />
          <Text style={styles.offlineText}>
            Mode hors-ligne
            {episodes.length > 0 ? " - Affichage des épisodes en cache" : " - Aucun épisode en cache"}
          </Text>
        </View>
      )}

      {/* Display non-blocking error if episodes are already shown */}
      {error && episodes.length > 0 && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}

      {/* Empty state or FlatList */}
      {episodes.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="hourglass-empty" size={48} color={theme.colors.description} />
          <Text style={styles.emptyText}>
             {isOffline ? "Aucun épisode disponible en mode hors-ligne" : "Aucun épisode disponible"}
          </Text>
          {!isOffline && (
             <TouchableOpacity onPress={() => { /* Trigger reload */ }} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Actualiser</Text>
             </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          // ... existing FlatList props ...
          data={episodes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.episodeItem}
              onPress={() => {
                // Pass the episode ID instead of index
                router.push({
                  pathname: '/player',
                  params: { episodeId: item.id }
                });
              }}
            >
              <View style={styles.episodeInfo}>
                <Text style={styles.episodeTitle}>{item.title}</Text>
                <Text style={styles.episodeDescription} numberOfLines={2}>
                  {item.description}
                </Text>
                {/* Use formatTime with duration in seconds */}
                <Text style={styles.episodeDuration}>{formatTime(item.duration)}</Text> 
              </View>
              {watchedEpisodes.has(item.id) ? (
                <MaterialIcons name="check-circle" size={24} color={theme.colors.primary} />
              ) : (
                <MaterialIcons name="play-arrow" size={24} color={theme.colors.text} />
              )}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  offlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.borderColor,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  offlineText: {
    color: theme.colors.secondaryDescription,
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: theme.colors.description,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 8,
  },
  hintText: {
    color: theme.colors.secondaryDescription,
    fontSize: 14,
    textAlign: 'center',
  },
  episodeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    backgroundColor: theme.colors.secondaryBackground,
    borderRadius: 10,
    marginBottom: 10,
  },
  episodeInfo: {
    flex: 1,
  },
  episodeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 4,
  },
  episodeDescription: {
    fontSize: 14,
    color: theme.colors.description,
    marginBottom: 4,
  },
  episodeDuration: {
    fontSize: 12,
    color: theme.colors.secondaryDescription,
    marginTop: 4,
  },
  loadingText: {
    color: theme.colors.text,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 15,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 15,
    marginBottom: 20,
  },
  errorBanner: {
     backgroundColor: theme.colors.primaryBackground,
     padding: 10,
     marginHorizontal: 15,
     marginBottom: 10,
     borderRadius: 8,
     borderLeftWidth: 3,
     borderLeftColor: theme.colors.error,
  },
  errorBannerText: {
     color: theme.colors.error,
     fontSize: 14,
  },
  retryButton: {
    marginTop: 20,
    backgroundColor: theme.colors.borderColor,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  retryButtonText: {
    color: theme.colors.text,
    fontSize: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
});