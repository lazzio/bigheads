import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import { supabase } from '../../lib/supabase';
import { Episode } from '../../types/episode';
import { formatTime } from '../../utils/commons/timeUtils';
import { parseDuration } from '../../utils/commons/timeUtils';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { theme } from '../../styles/global';
import { componentStyle, episodeStyle } from '../../styles/componentStyle';
import MusicEqualizer from '../../components/Equalizer';
import {
  EPISODES_CACHE_KEY,
  loadCachedEpisodes,
  getPositionLocally,
  getCurrentEpisodeId
} from '../../utils/cache/LocalStorageService';
import { getImageUrlFromDescription } from '../../components/GTPersons';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import MiniPlayerSpacer from '../../components/MiniPlayerSpacer';

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
  const panProgress = useSharedValue(0);
  const isPanning = useSharedValue(false);

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
        isPanning.value = true;
      }
    })
    .onUpdate((event) => {
      if (progressBarWidth > 0 && totalDurationSeconds && totalDurationSeconds > 0) {
        const x = event.x;
        const progress = Math.min(1, Math.max(0, x / progressBarWidth));
        panProgress.value = progress;
      }
    })
    .onEnd((event) => {
      if (progressBarWidth > 0 && totalDurationSeconds && totalDurationSeconds > 0) {
        const x = event.x;
        const progress = Math.min(1, Math.max(0, x / progressBarWidth));
        const totalDurationMillis = totalDurationSeconds * 1000;
        const seekToMillis = Math.round(progress * totalDurationMillis);
        const finalSeekMillis = Math.min(totalDurationMillis, Math.max(0, seekToMillis));
        // Utilise runOnJS pour naviguer côté JS
        runOnJS(router.push)({
          pathname: '/player/play',
          params: { episodeId: item.id, startPositionMillis: String(finalSeekMillis) },
        });
      }
      isPanning.value = false;
    })
    .shouldCancelWhenOutside(true),
    [progressBarWidth, totalDurationSeconds, router, item.id]
  );

  const animatedProgressStyle = useAnimatedStyle(() => {
    const progress = isPanning.value
      ? panProgress.value * 100
      : actualProgressPercentage;
    return { width: `${progress}%` };
  });

  return (
    <TouchableOpacity
      style={episodeStyle.episodeItem}
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
      <View style={episodeStyle.episodeInfo}>
        <Text style={episodeStyle.episodeTitle} numberOfLines={1}>{item.title.replace(/L'INTÉGRALE - /, '')}</Text>
        <Text style={episodeStyle.episodeDescription} numberOfLines={2}>
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
                if (progressBarWidth === 0 && e.nativeEvent.layout.width > 0) {
                  setProgressBarWidth(e.nativeEvent.layout.width);
                }
              }}
            >
              <Animated.View style={[styles.progressBarFilled, animatedProgressStyle]} />
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
        <MaterialIcons name="play-circle" size={48} color={theme.colors.playPauseButtonBackground} />
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

  function setWatchedEpisodesIfChanged(newSet: Set<string>) {
    setWatchedEpisodes(prev => {
      if (
        prev.size === newSet.size &&
        [...prev].every(id => newSet.has(id))
      ) {
        return prev; // Pas de changement, on garde l'ancien Set
      }
      return newSet; // Changement détecté, on met à jour
    });
  }

  async function fetchWatchedEpisodes() {
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        console.error('Error fetching session for watched episodes:', sessionError.message);
        setWatchedEpisodesIfChanged(new Set());
        return;
      }

      if (!sessionData.session || !sessionData.session.user) {
        console.log('Utilisateur non connecté (pas de session active ou utilisateur manquant dans la session), saut récupération épisodes vus');
        setWatchedEpisodesIfChanged(new Set());
        return;
      }
      const userId = sessionData.session.user.id;

      const { data, error } = await supabase
        .from('watched_episodes')
        .select('episode_id')
        .eq('user_id', userId)
        .eq('is_finished', true);

      if (error) throw error;

      const watchedIds = new Set((data as { episode_id: string }[]).map(we => we.episode_id));
      console.log(`Récupéré ${watchedIds.size} épisodes terminés`);
      setWatchedEpisodesIfChanged(watchedIds);
    } catch (err) {
      console.error('Erreur récupération épisodes vus:', err);
      setWatchedEpisodesIfChanged(new Set());
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
        <ActivityIndicator size="small" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={componentStyle.container}>
        <LinearGradient
          colors={[theme.colors.backgroundFirst, theme.colors.backgroundLast]}
          style={componentStyle.container}
        >
          <View style={componentStyle.header}>
            {/* <MaterialIcons name="library-music" size={32} color={theme.colors.text} style={{ marginRight: 8 }} />
          <Text style={componentStyle.headerTitle}>Episodes</Text> */}

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
          <MiniPlayerSpacer />
        </LinearGradient>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 15,
    paddingTop: 15,
    paddingBottom: 10,
    // backgroundColor: theme.colors.primaryBackground,
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderColor,
  },
  headerTitle: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    color: theme.colors.text,
  },
  offlineContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    // backgroundColor: theme.colors.borderColor,
    backgroundColor: 'transparent',
    marginLeft: 15,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 16,
  },
  offlineText: {
    fontFamily: 'Inter_400Regular',
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
    fontFamily: 'Inter_400Regular',
    color: theme.colors.error,
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    color: theme.colors.description,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 8,
  },
  hintText: {
    fontFamily: 'Inter_400Regular',
    color: theme.colors.secondaryDescription,
    fontSize: 14,
    textAlign: 'center',
  },
  durationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginRight: 10,
  },
  episodeDuration: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: theme.colors.description,
    marginRight: 5,
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
});