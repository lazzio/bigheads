import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import { Episode } from '../../types/episode';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatTime } from '../../utils/OptimizedAudioService'; // Import formatTime

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

  // Utiliser useFocusEffect pour rafraîchir la liste des épisodes vus à chaque fois que l'écran est affiché
  useFocusEffect(
    useCallback(() => {
      fetchWatchedEpisodes();
    }, [])
  );

  useEffect(() => {
    const initialize = async () => {
      await checkNetworkStatus();
      fetchEpisodes();
      fetchWatchedEpisodes();
    };
    
    initialize();
  }, []);

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
    try {
      // Vérifier d'abord si nous sommes hors-ligne
      const offline = await checkNetworkStatus();
      
      if (offline) {
        // En mode hors-ligne, essayer de charger depuis le cache
        const cachedEpisodes = await loadCachedEpisodes();
        if (cachedEpisodes.length > 0) {
          setEpisodes(cachedEpisodes);
          // Message informatif, pas d'erreur
          setError(null);
        } else {
          // Pas de cache disponible, afficher un message informatif
          setError(null); // Pas d'erreur, juste une info
        }
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('episodes')
        .select('*')
        .order('publication_date', { ascending: false });

      if (error) throw error;

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
      
      // Sauvegarder dans le cache
      try {
        await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(formattedEpisodes));
      } catch (cacheError) {
        console.error('Error saving episodes to cache:', cacheError);
      }
    } catch (err) {
      const offline = await checkNetworkStatus();
      
      if (offline) {
        // En mode hors-ligne, essayer d'abord de charger depuis le cache
        const cachedEpisodes = await loadCachedEpisodes();
        if (cachedEpisodes.length > 0) {
          setEpisodes(cachedEpisodes);
          setError(null); // Pas d'erreur en mode hors-ligne
        } else {
          // Message informatif pour le mode hors-ligne sans cache
          setError(null);
        }
      } else {
        // Une vraie erreur s'est produite alors qu'on est en ligne
        setError(err instanceof Error ? err.message : 'Une erreur est survenue');
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchWatchedEpisodes() {
    try {
      const userResponse = await supabase.auth.getUser();
      const userId = userResponse.data.user?.id;
      if (!userId) {
        // setWatchedEpisodes(new Set()); // S'assurer que c'est vide si non connecté
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

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Chargement des épisodes...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Episodes</Text>
      
      {isOffline && (
        <View style={styles.offlineContainer}>
          <MaterialIcons name="wifi-off" size={20} color="#888" />
          <Text style={styles.offlineText}>
            Mode hors-ligne - Seuls les épisodes en cache sont disponibles
          </Text>
        </View>
      )}
      
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      
      {episodes.length === 0 ? (
        <View style={styles.emptyContainer}>
          {isOffline ? (
            <>
              <Text style={styles.emptyText}>Aucun épisode disponible en mode hors-ligne</Text>
              <Text style={styles.hintText}>Connectez-vous à Internet pour accéder aux épisodes</Text>
            </>
          ) : (
            <Text style={styles.emptyText}>Aucun épisode disponible</Text>
          )}
        </View>
      ) : (
        <FlatList
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
                <MaterialIcons name="check-circle" size={24} color="#0ea5e9" />
              ) : (
                <MaterialIcons name="play-arrow" size={24} color="#fff" />
              )}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    padding: 20,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
    marginTop: 20,
  },
  offlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#333',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  offlineText: {
    color: '#aaa',
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    padding: 12,
    marginBottom: 16,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#ef4444',
  },
  errorText: {
    color: '#ff4444',
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 8,
  },
  hintText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
  },
  episodeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    marginBottom: 10,
  },
  episodeInfo: {
    flex: 1,
  },
  episodeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  episodeDescription: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
  },
  episodeDuration: {
    fontSize: 12,
    color: '#666',
    marginTop: 4, // Added margin for spacing
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
});