import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useEffect, useState, useCallback } from 'react';
import { Image } from 'expo-image';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import { Episode } from '../../types/episode';
import { formatTime } from '../../utils/commons/timeUtils';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { theme } from '../../styles/global';
import { componentStyle } from '../../styles/componentStyle';
import { 
  EPISODES_CACHE_KEY,
  getPositionLocally,
  loadCachedEpisodes,
  getCurrentEpisodeId
} from '../../utils/LocalStorageService';
import { getImageUrlFromDescription } from '../../components/GTPersons';

type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];
type WatchedEpisodeRow = Database['public']['Tables']['watched_episodes']['Row'];

export default function EpisodesScreen() {
  const router = useRouter();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<string>>(new Set());
  const [episodeProgress, setEpisodeProgress] = useState<Record<string, number | null>>({}); // Store position in ms or null
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [currentEpisodeId, setCurrentEpisodeIdState] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false); // Ajout état pour le pull-to-refresh

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

  const fetchAllEpisodeProgress = useCallback(async (currentEpisodes: Episode[]) => {
    const progressMap: Record<string, number | null> = {};
    for (const episode of currentEpisodes) {
      progressMap[episode.id] = await getPositionLocally(episode.id); // Uses imported function
    }
    setEpisodeProgress(progressMap);
  }, []); // Removed getPositionLocally from here

  // Utiliser useFocusEffect pour rafraîchir la liste des épisodes vus à chaque fois que l'écran est affiché
  useFocusEffect(
    useCallback(() => {
      fetchWatchedEpisodes();
      if (episodes.length > 0) {
        fetchAllEpisodeProgress(episodes);
      }
      // Recharge l'ID de l'épisode courant à chaque focus
      getCurrentEpisodeId().then(setCurrentEpisodeIdState);
    }, [episodes, fetchAllEpisodeProgress])
  );

  useEffect(() => {
    const initialize = async () => {
      await checkNetworkStatus();
      await fetchEpisodes(); // fetchEpisodes will call fetchAllEpisodeProgress
      // fetchWatchedEpisodes is already in useFocusEffect
    };
    
    initialize();
  }, []); // Keep initial fetch logic

  async function fetchEpisodes(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const offline = await checkNetworkStatus();
      let episodesToSet: Episode[] = [];

      if (offline) {
        const cachedEpisodes = await loadCachedEpisodes();
        if (cachedEpisodes.length > 0) {
          let needsRecache = false;
          const augmentedEpisodes = cachedEpisodes.map(ep => {
            if (typeof ep.artwork === 'undefined' && ep.description) {
              needsRecache = true;
              return { ...ep, artwork: getImageUrlFromDescription(ep.description) };
            }
            return ep;
          });
          episodesToSet = augmentedEpisodes;

          if (needsRecache) {
            console.log('Augmenting offline cached episodes with artwork and re-saving...');
            try {
              await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(episodesToSet));
            } catch (cacheError) {
              console.error('Error re-saving augmented offline episodes to cache:', cacheError);
            }
          }
          setError(null);
        } else {
          setError(null); 
        }
      } else {
        // Try cache first even if online
        const cachedEpisodes = await loadCachedEpisodes(); // Uses imported function
        if (cachedEpisodes.length > 0) {
          console.log(`Loaded ${cachedEpisodes.length} episodes from cache for episodes tab (online mode)`);
          let needsRecache = false;
          const augmentedEpisodes = cachedEpisodes.map(ep => {
            if (typeof ep.artwork === 'undefined' && ep.description) { // Check if artwork is undefined and description exists
              needsRecache = true;
              return { ...ep, artwork: getImageUrlFromDescription(ep.description) };
            }
            return ep;
          });
          episodesToSet = augmentedEpisodes;

          if (needsRecache) {
            console.log('Augmenting cached episodes with artwork and re-saving...');
            try {
              await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(episodesToSet));
            } catch (cacheError) {
              console.error('Error re-saving augmented episodes to cache:', cacheError);
            }
          }
          // Uncomment to clear cache for testing
          // await AsyncStorage.removeItem(EPISODES_CACHE_KEY);
          // await AsyncStorage.clear();
          // console.log('Cache cleared');
          // console.log(JSON.stringify(episodesToSet, null, 2));
          setError(null);
        } else {
          // Fetch from Supabase if cache is empty
          const { data, error: supabaseError } = await supabase
            .from('episodes')
            .select('*')
            .order('publication_date', { ascending: false });

          if (supabaseError) throw supabaseError;

          const formattedEpisodes: Episode[] = (data as SupabaseEpisode[]).map(episode => ({
            id: episode.id,
            title: episode.title,
            description: episode.description,
            originalMp3Link: episode.original_mp3_link,
            original_mp3_link: episode.original_mp3_link,
            mp3Link: episode.mp3_link,
            mp3_link: episode.mp3_link,
            offline_path: episode.offline_path,
            duration: episode.duration,
            publicationDate: episode.publication_date,
            publication_date: episode.publication_date,
            artwork: getImageUrlFromDescription(episode.description)
          }));
          episodesToSet = formattedEpisodes;
          
          try {
            await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(formattedEpisodes));
          } catch (cacheError) {
            console.error('Error saving episodes to cache:', cacheError);
          }
        }
      }
      
      setEpisodes(episodesToSet);
      if (episodesToSet.length > 0) {
        await fetchAllEpisodeProgress(episodesToSet);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }

  async function fetchWatchedEpisodes() {
    try {
      // const userResponse = await supabase.auth.getUser(); // Old method
      // const userId = userResponse.data.user?.id; // Old method

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        console.error('Error fetching session for watched episodes:', sessionError.message);
        setWatchedEpisodes(new Set());
        return;
      }

      if (!sessionData.session || !sessionData.session.user) {
        console.log('Utilisateur non connecté (pas de session active ou utilisateur manquant dans la session), saut récupération épisodes vus');
        setWatchedEpisodes(new Set()); // S\'assurer que c\'est vide si non connecté
        return;
      }
      const userId = sessionData.session.user.id;

      const { data, error } = await supabase
        .from('watched_episodes')
        .select('episode_id')
        .eq('user_id', userId)
        .eq('is_finished', true);

      if (error) throw error;

      // Utiliser WatchedEpisodeRow si on sélectionne plus, sinon juste { episode_id: string }
      const watchedIds = new Set((data as { episode_id: string }[]).map(we => we.episode_id));
      console.log(`Récupéré ${watchedIds.size} épisodes terminés`);
      setWatchedEpisodes(watchedIds);
    } catch (err) {
      console.error('Erreur récupération épisodes vus:', err);
      setWatchedEpisodes(new Set()); // Réinitialiser en cas d'erreur
    }
  }

  if (loading) {
    return (
      <View style={componentStyle.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={componentStyle.container}>
      <View style={componentStyle.header}>
        <MaterialIcons name="library-music" size={32} color={theme.colors.text} style={{marginRight: 8}} />
        <Text style={componentStyle.headerTitle}>Episodes</Text>
      
      {isOffline && (
        <View style={styles.offlineContainer}>
          <MaterialIcons name="wifi-off" size={16} color={theme.colors.description} />
          <Text style={styles.offlineText}>
            Mode hors-ligne
          </Text>
        </View>
      )}
      </View>
      
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
          renderItem={({ item }) => {
            const currentPositionMillis = episodeProgress[item.id] || 0;
            const totalDurationSeconds = item.duration;
            let progressPercentage = 0;

            if (totalDurationSeconds && totalDurationSeconds > 0 && currentPositionMillis !== null) {
              const totalDurationMillis = totalDurationSeconds * 1000;
              progressPercentage = Math.min(100, Math.max(0, (currentPositionMillis / totalDurationMillis) * 100));
            }

            return (
              <TouchableOpacity
                style={styles.episodeItem}
                onPress={() => {
                  router.push({
                    pathname: '/player/player',
                    params: { episodeId: item.id },
                  });
                }}
              >
                <Image
                  source={ item.artwork }
                  cachePolicy="memory-disk"
                  contentFit="cover"
                  style={{ width: 50, height: 50, borderRadius: 5 }} 
                />
                <View style={styles.episodeInfo}>
                  <Text style={styles.episodeTitle}>{item.title}</Text>
                  <Text style={styles.episodeDescription} numberOfLines={2}>
                    {item.description}
                  </Text>
                  <View style={styles.durationContainer}>
                    <Text style={styles.episodeDuration}>
                      {item.duration !== null ? formatTime(item.duration) : '--:--'}
                    </Text>
                      <View style={styles.progressBarContainer}>
                      {totalDurationSeconds && totalDurationSeconds > 0 && currentPositionMillis !== null && currentPositionMillis > 0 ? (
                        <View style={[styles.progressBarFilled, { width: `${progressPercentage}%` }]} />
                        ) : (
                          <View style={[styles.progressBarFilled, { width: `0%` }]} />
                      )}
                    </View>
                  </View>
                </View>
                {currentEpisodeId === item.id ? (
                  <MaterialIcons name="equalizer" size={36} color={theme.colors.primary} />
                ) : watchedEpisodes.has(item.id) ? (
                  <MaterialIcons name="check-circle" size={36} color={theme.colors.primary} />
                ) : (
                  <MaterialIcons name="play-circle-outline" size={30} color={theme.colors.text} />
                )}
              </TouchableOpacity>
            );
          }}

          refreshControl={
            <RefreshControl
              refreshing={refreshing} // <-- Utilise refreshing ici
              onRefresh={() => {
                fetchEpisodes(true); // <-- Passe true pour indiquer un refresh
                fetchWatchedEpisodes();
              }}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
              progressBackgroundColor={theme.colors.secondaryBackground}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 15,
    paddingTop: 15,
    paddingBottom: 10,
    backgroundColor: theme.colors.primaryBackground,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderColor,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  offlineContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: theme.colors.borderColor,
    marginLeft: 15,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 16,
  },
  offlineText: {
    color: theme.colors.text,
    fontSize: 12,
    marginLeft: 4,
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    padding: 12,
    marginBottom: 16,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.error,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 16,
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
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: theme.colors.secondaryBackground,
    borderRadius: 10,
    marginBottom: 10,
    marginHorizontal: 10,
    alignItems: 'center',
  },
  episodeInfo: {
    flex: 1,
    marginRight: 10,
    paddingLeft: 10,
  },
  episodeTitle: {
    fontSize: 14,
    // fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 4,
  },
  episodeDescription: {
    fontSize: 12,
    color: theme.colors.description,
    marginBottom: 6,
    lineHeight: 18,
  },
  durationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  episodeDuration: {
    fontSize: 11,
    color: theme.colors.text,
    marginRight: 8,
  },
  progressBarContainer: {
    flex: 1,
    height: 3,
    backgroundColor: theme.colors.borderColor,
    borderRadius: 2.5,
    marginLeft: 5,
  },
  progressBarFilled: {
    height: '100%',
    backgroundColor: theme.colors.primary,
    borderRadius: 2.5,
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
});