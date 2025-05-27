import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useEffect, useState, useCallback, useMemo } from 'react'; // Added useMemo
import { Image } from 'expo-image';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler'; // Added
import { supabase } from '../../lib/supabase';
import { Episode } from '../../types/episode';
import { formatTime } from '../../utils/commons/timeUtils';
import { parseDuration } from '../../utils/commons/timeUtils';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { theme } from '../../styles/global';
import { componentStyle } from '../../styles/componentStyle';
import MusicEqualizer from '../../components/Equalizer';
import { 
  EPISODES_CACHE_KEY,
  loadCachedEpisodes,
  getPositionLocally,
  getCurrentEpisodeId
} from '../../utils/cache/LocalStorageService';
import { getImageUrlFromDescription } from '../../components/GTPersons';

// Define Prop Types for EpisodeListItem
type EpisodeListItemProps = {
  item: Episode;
  episodeProgress: Record<string, number | null>;
  currentEpisodeId: string | null;
  watchedEpisodes: Set<string>;
  theme: typeof theme; // Assuming theme is an object with a known structure
  styles: typeof styles; // Type for styles object from StyleSheet.create
  router: ReturnType<typeof useRouter>;
  formatTime: (seconds: number) => string;
  MaterialIcons: any; // Or a more specific type if available
};

const EpisodeListItem = React.memo(({
  item,
  episodeProgress,
  currentEpisodeId,
  watchedEpisodes,
  theme,
  styles,
  router,
  formatTime,
  MaterialIcons,
}: EpisodeListItemProps) => {
  const [progressBarWidth, setProgressBarWidth] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [panProgress, setPanProgress] = useState(0); // Progress from 0 to 1, derived from pan

  const totalDurationSeconds = item.duration;
  const currentPositionMillis = episodeProgress[item.id] || 0;

  const actualProgressPercentage = useMemo(() => {
    if (totalDurationSeconds && totalDurationSeconds > 0 && currentPositionMillis !== null) {
      const totalDurationMillis = totalDurationSeconds * 1000;
      return Math.min(100, Math.max(0, (currentPositionMillis / totalDurationMillis) * 100));
    }
    return 0;
  }, [totalDurationSeconds, currentPositionMillis]);

  const panGesture = useMemo(() => Gesture.Pan()
    .onBegin(() => {
      if (totalDurationSeconds && totalDurationSeconds > 0) {
        setIsPanning(true);
      }
    })
    .onUpdate((event) => {
      if (progressBarWidth > 0 && totalDurationSeconds && totalDurationSeconds > 0) {
        const x = event.x;
        const progress = Math.min(1, Math.max(0, x / progressBarWidth));
        setPanProgress(progress);
      }
    })
    .onEnd((event) => {
      if (progressBarWidth > 0 && totalDurationSeconds && totalDurationSeconds > 0) {
        const x = event.x;
        const progress = Math.min(1, Math.max(0, x / progressBarWidth));
        
        const totalDurationMillis = totalDurationSeconds * 1000;
        const seekToMillis = Math.round(progress * totalDurationMillis);
        // Ensure seekToMillis is within bounds [0, totalDurationMillis]
        const finalSeekMillis = Math.min(totalDurationMillis, Math.max(0, seekToMillis));

        // Navigate to player with startPositionMillis
        // The player screen will need to handle this parameter
        router.push({
          pathname: '/player/play',
          params: { episodeId: item.id, startPositionMillis: String(finalSeekMillis) },
        });
      }
      setIsPanning(false);
      // panProgress will be ignored once isPanning is false, no need to reset explicitly
    })
    .shouldCancelWhenOutside(true), 
    [progressBarWidth, totalDurationSeconds, router, item.id]
  );

  // Display pan progress if panning, otherwise actual playback progress
  const displayProgressPercentage = isPanning ? panProgress * 100 : actualProgressPercentage;

  return (
    <TouchableOpacity
      style={styles.episodeItem}
      onPress={() => {
        // Default navigation if the item itself (not progress bar) is pressed
        router.push({
          pathname: '/player/play',
          params: { episodeId: item.id }, 
        });
      }}
    >
      <Image
        source={item.artwork} // Ensure item.artwork is a valid ImageSourcePropType
        cachePolicy="memory-disk"
        contentFit="cover"
        style={{ width: 50, height: 50, borderRadius: 5 }}
      />
      <View style={styles.episodeInfo}>
        <Text style={styles.episodeTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.episodeDescription} numberOfLines={2}>
          {item.description}
        </Text>
        <View style={styles.durationContainer}>
          <Text style={styles.episodeDuration}>
            {item.duration !== null ? formatTime(item.duration) : '--:--'}
          </Text>
          {/* GestureDetector wraps the visual progress bar area */}
          <GestureDetector gesture={panGesture}>
            <View
              style={styles.progressBarContainer}
              onLayout={(e) => {
                // Set width only once or if it changes significantly to avoid re-renders
                if (progressBarWidth === 0 && e.nativeEvent.layout.width > 0) {
                   setProgressBarWidth(e.nativeEvent.layout.width);
                }
              }}
            >
              {/* Display progress: uses panProgress during gesture, otherwise actual progress */}
              {(totalDurationSeconds && totalDurationSeconds > 0 && (currentPositionMillis >= 0 || isPanning)) ? (
                <View style={[styles.progressBarFilled, { width: `${displayProgressPercentage}%` }]} />
              ) : (
                <View style={[styles.progressBarFilled, { width: `0%` }]} />
              )}
            </View>
          </GestureDetector>
        </View>
      </View>
      {/* Icons indicating playback state or watched status */}
      {currentEpisodeId === item.id ? (
        <MusicEqualizer />
      ) : watchedEpisodes.has(item.id) ? (
        <MaterialIcons name="check-circle" size={30} color={theme.colors.primary} />
      ) : (
        <MaterialIcons name="play-circle" size={30} color={theme.colors.text} />
      )}
    </TouchableOpacity>
  );
}, (prevProps, nextProps) => {
  // Custom comparison pour éviter les re-renders inutiles
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.episodeProgress[prevProps.item.id] === nextProps.episodeProgress[nextProps.item.id] &&
    prevProps.currentEpisodeId === nextProps.currentEpisodeId &&
    prevProps.watchedEpisodes === nextProps.watchedEpisodes &&
    prevProps.item.title === nextProps.item.title &&
    prevProps.item.duration === nextProps.item.duration
  );
});

const ITEM_HEIGHT = 80; // Ajuste selon la hauteur réelle de tes items

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
            .select('*') // Fetches all columns
            .order('publication_date', { ascending: false });

          if (supabaseError) throw supabaseError;

          // Corrected mapping from SupabaseEpisode to Episode type
          // Assumes Supabase client returns camelCase properties matching SupabaseEpisode type
          // and Episode type defines properties as needed (e.g., offline_path as snake_case)
          const formattedEpisodes: Episode[] = (data as any[]).map(ep => ({
            id: ep.id,
            title: ep.title,
            description: ep.description,
            originalMp3Link: ep.original_mp3_link,
            mp3Link: ep.offline_path || ep.mp3_link,
            duration: parseDuration(ep.duration),
            publicationDate: ep.publication_date,
            offline_path: ep.offline_path,
            artwork: ep.artwork || getImageUrlFromDescription(ep.description) || undefined,
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

  // Mémorise les props statiques
  const staticProps = useMemo(() => ({
    theme,
    styles,
    formatTime,
    MaterialIcons,
  }), []);

  const renderItem = useCallback(
    ({ item }: { item: Episode }) => (
      <EpisodeListItem
        item={item}
        episodeProgress={episodeProgress}
        currentEpisodeId={currentEpisodeId}
        watchedEpisodes={watchedEpisodes}
        router={router}
        {...staticProps}
      />
    ),
    [episodeProgress, currentEpisodeId, watchedEpisodes, router, staticProps]
  );

  const getItemLayout = useCallback(
    (data: any, index: number) => ({
      length: ITEM_HEIGHT,
      offset: ITEM_HEIGHT * index,
      index,
    }),
    []
  );

  if (loading) {
    return (
      <View style={componentStyle.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                fetchEpisodes(true);
                fetchWatchedEpisodes();
              }}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
              progressBackgroundColor={theme.colors.secondaryBackground}
            />
          }
          // Optimisations supplémentaires
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          initialNumToRender={10}
          windowSize={10}
        />
      )}
    </View>
    </GestureHandlerRootView>
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
    alignItems: 'center',
  },
  episodeInfo: {
    flex: 1,
    marginLeft: 10,
    justifyContent: 'space-between',
  },
  episodeTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: 3,
  },
  episodeDescription: {
    fontSize: 12,
    color: theme.colors.description,
    marginBottom: 5,
    lineHeight: 16,
  },
  durationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  episodeDuration: {
    fontSize: 12,
    color: theme.colors.description,
    marginRight: 8,
  },
  progressBarContainer: {
    flex: 1,
    height: 3,
    backgroundColor: theme.colors.borderColor,
    borderRadius: 5,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  progressBarFilled: {
    height: '100%',
    backgroundColor: theme.colors.primary,
    borderRadius: 5,
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
});