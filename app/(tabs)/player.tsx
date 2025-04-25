import { View, Text, StyleSheet, AppState, BackHandler, ActivityIndicator } from 'react-native';
import { useEffect, useState, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AudioPlayer from '../../components/AudioPlayer';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import { Episode } from '../../types/episode';
import { audioManager } from '../../utils/OptimizedAudioService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';
import { theme } from '../../styles/global';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native-gesture-handler';

type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];
type WatchedEpisodeRow = Database['public']['Tables']['watched_episodes']['Row'];

const EPISODES_CACHE_KEY = 'cached_episodes';
const PENDING_POSITIONS_KEY = 'pending_positions';

export default function PlayerScreen() {
  const { episodeId, offlinePath } = useLocalSearchParams<{ episodeId: string, offlinePath: string }>();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1); // Initialize to -1
  const [playbackPositions, setPlaybackPositions] = useState<Map<string, number>>(new Map()); // State for positions
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const router = useRouter();
  const currentEpisodeRef = useRef<Episode | null>(null); // Ref to track the episode being loaded

  useEffect(() => {
    // Verify network status on mount
    checkNetworkStatus();

    // Initialize audio manager
    const initAudio = async () => {
      try {
        await audioManager.setupAudio();
      } catch (err) {
        console.error("Error setting up audio:", err);
      }
    };

    initAudio();
    // Start initial data loading
    loadData();

    // Manage AppState changes
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appStateRef.current === 'active' && nextAppState.match(/inactive|background/)) {
        // App in background
        console.log('App is going to background');
      } else if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        // App is coming to foreground
        console.log('App is coming to foreground');
        checkNetworkStatus();
      }
      appStateRef.current = nextAppState;
    });

    // Handler pour le bouton back d'Android
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      // Back on previous screen and release audio resources
      router.back();
      return true;
    });

    return () => {
      // Release audio resources
      subscription.remove();
      backHandler.remove();
    };
  }, [router]); // Keep router dependency if needed for back handler

  // Separate useEffect for initial data loading
  useEffect(() => {
    loadData();
  }, []); // Run only once on mount

  // Effect to determine and load the *current* episode when relevant state changes
  useEffect(() => {
    // Only run if episodes are loaded and we have params or default target
    if (episodes.length > 0 || offlinePath) {
      determineAndLoadCurrentEpisode();
    }
  }, [episodeId, offlinePath, episodes, playbackPositions]); // Rerun when these change

  // Function for initial data loading
  const loadData = async () => {
    setLoading(true);
    setError(null); // Reset error on reload
    try {
      await checkNetworkStatus();
      await fetchEpisodes(); // Fetches episodes list and positions
    } catch (err) {
      console.error('[PlayerScreen] Error during initial data load:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
      // Try loading from cache as a fallback even if fetchEpisodes failed partially
      if (episodes.length === 0) {
        const cached = await loadCachedEpisodes();
        if (cached.length > 0) {
          setEpisodes(cached);
          setError('Affichage des données en cache - Erreur de chargement');
          // Still try to fetch positions if cache is loaded
          await fetchPlaybackPositions().catch(posError => {
             console.warn('[PlayerScreen] Failed to fetch positions after cache load:', posError);
          });
        } else {
           setError('Erreur de chargement des épisodes et cache vide');
        }
      }
    } finally {
      // Ensure loading is false only after all attempts
      setLoading(false);
    }
  };

  // Vérifier le statut du réseau
  const checkNetworkStatus = async () => {
    try {
      const state = await NetInfo.fetch();
      setIsOffline(!state.isConnected);
    } catch (error) {
      console.warn('Error checking network status:', error);
      // En cas d'erreur, supposer que nous sommes en ligne
      setIsOffline(false);
    }
  };

  // Charger les épisodes depuis le cache
  const loadCachedEpisodes = async (): Promise<Episode[]> => {
    try {
      const cachedData = await AsyncStorage.getItem(EPISODES_CACHE_KEY);
      if (cachedData) {
        const episodes = JSON.parse(cachedData);
        console.log(`Loaded ${episodes.length} episodes from cache for player`);
        return episodes;
      }
    } catch (error) {
      console.error('Error loading cached episodes:', error);
    }
    return [];
  };

  // This function is used to get the details of an offline episode
  const getOfflineEpisodeDetails = async (filePath: string): Promise<Episode | null> => {
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
          duration: metadata.duration || '0:00',
          offline_path: filePath
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting offline episode details:', error);
      return null;
    }
  };

  // Fetch playback positions for the user
  const fetchPlaybackPositions = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return; // Not logged in

      const { data, error } = await supabase
        .from('watched_episodes')
        .select('episode_id, playback_position')
        .eq('user_id', user.id)
        .filter('playback_position', 'gt', 0);

      if (error) throw error;

      const positionsMap = new Map<string, number>();
      if (data) {
        (data as WatchedEpisodeRow[]).forEach(row => {
          if (row.episode_id && row.playback_position !== null) {
            positionsMap.set(row.episode_id, row.playback_position);
          }
        });
      }
      console.log(`[PlayerScreen] Fetched ${positionsMap.size} playback positions.`);
      setPlaybackPositions(positionsMap);

    } catch (err) {
      console.error('[PlayerScreen] Error fetching playback positions:', err);
    }
  };

  // Load and seek episode using AudioManager
  const loadAndSeekEpisode = async (episode: Episode, initialPositionSeconds?: number) => {
     if (!episode || currentEpisodeRef.current?.id === episode.id) {
       // Avoid reloading the same episode unnecessarily
       // console.log("[PlayerScreen] Skipping load: Episode already loaded or invalid.");
       return;
     }
     
     console.log(`[PlayerScreen] Loading episode: ${episode.title} with initial position: ${initialPositionSeconds ?? 0}s`);
     currentEpisodeRef.current = episode; // Track the episode being loaded
     
     try {
       await audioManager.loadEpisode(episode, initialPositionSeconds);
     } catch (loadError) {
       console.error("[PlayerScreen] Error loading episode in AudioManager:", loadError);
       setError(`Failed to load audio: ${loadError instanceof Error ? loadError.message : 'Unknown error'}`);
       currentEpisodeRef.current = null; // Reset ref on error
     }
  };

  // Updated determineAndLoadCurrentEpisode with logging
  const determineAndLoadCurrentEpisode = async () => {
      console.log('[PlayerScreen] Determining episode to load...', { episodeId, offlinePath, numEpisodes: episodes.length, numPositions: playbackPositions.size });
      if (episodes.length === 0 && !offlinePath) {
        console.log("[PlayerScreen] No episodes loaded and no offline path, waiting...");
        // If fetchEpisodes failed completely, loading should be false and error shown.
        // If fetchEpisodes is still running, loading should be true.
        // If offlinePath is present, it will be handled below.
        return;
      }

      let targetIndex = -1;
      let episodeToLoad: Episode | null = null;
      let isStandaloneOffline = false; // Flag for offline episode not in main list

      if (offlinePath) {
        console.log(`[PlayerScreen] Trying to load offline path: ${offlinePath}`);
        // Prioritize offline path if provided
        const offlineEpisode = await getOfflineEpisodeDetails(offlinePath);
        if (offlineEpisode) {
           console.log(`[PlayerScreen] Loaded offline episode details: ${offlineEpisode.title}`);
           // Find if this offline episode exists in our main list by ID
           const existingIndex = episodes.findIndex(ep => ep.id === offlineEpisode.id);
           if (existingIndex !== -1) {
              console.log(`[PlayerScreen] Found offline episode in main list at index ${existingIndex}`);
              targetIndex = existingIndex;
              episodeToLoad = episodes[targetIndex];
              // Ensure offline path is set if we found it in the main list
              if (!episodeToLoad.offline_path) episodeToLoad.offline_path = offlinePath;
           } else {
              console.log(`[PlayerScreen] Offline episode ID ${offlineEpisode.id} not found in main list. Treating as standalone.`);
              // Treat as a standalone episode if not in the main list
              episodeToLoad = offlineEpisode;
              // Set a temporary index or handle outside the main list logic
              targetIndex = 0; // Use index 0 for the standalone episode
              isStandaloneOffline = true;
              // If episodes list was populated from online, replace it with just this one
              // If episodes list was empty (offline mode), this sets the first episode
              setEpisodes([offlineEpisode]);
           }
        } else {
           console.warn("[PlayerScreen] Could not load offline episode details. Attempting fallback...");
           // Fallback logic if offline details fail (similar to original code)
           // 1. Try using episodeId from params first
           if (episodeId) {
             const onlineIndex = episodes.findIndex(ep => ep.id === episodeId);
             if (onlineIndex !== -1) {
               targetIndex = onlineIndex;
               episodeToLoad = episodes[targetIndex];
               console.log(`[PlayerScreen] Fallback successful: Found online episode using provided episodeId: ${episodeId}`);
             } else {
               console.log(`[PlayerScreen] Provided episodeId ${episodeId} not found in online list. Trying metadata next.`);
             }
           } else {
             console.log("[PlayerScreen] No episodeId provided in params. Trying metadata next.");
           }
           
           // 2. If not found via episodeId, try extracting ID from metadata
           let fallbackIdFromMeta: string | null = null;
           if (offlinePath) {
             try {
               const metaPath = offlinePath + '.meta';
               const fileExists = await FileSystem.getInfoAsync(metaPath);
               if (fileExists.exists) {
                 const metaContent = await FileSystem.readAsStringAsync(metaPath);
                 const metadata = JSON.parse(metaContent);
                 if (metadata && metadata.id) {
                   fallbackIdFromMeta = metadata.id;
                   console.log(`[PlayerScreen] Extracted ID ${fallbackIdFromMeta} from metadata`);
                 }
               }
             } catch (metaError) {
               console.error("[PlayerScreen] Error extracting ID from meta:", metaError);
             }
           }
           
           if (fallbackIdFromMeta) {
             const onlineIndex = episodes.findIndex(ep => ep.id === fallbackIdFromMeta);
             if (onlineIndex !== -1) {
               targetIndex = onlineIndex;
               episodeToLoad = episodes[targetIndex];
               console.log(`[PlayerScreen] Fallback successful: Found online episode using metadata ID: ${fallbackIdFromMeta}`);
             } else {
               console.log(`[PlayerScreen] Metadata ID ${fallbackIdFromMeta} not found in online list.`);
             }
           }

           // 3. If still no fallback found, default to first episode or error
           if (targetIndex === -1) {
             if (episodes.length > 0) {
               targetIndex = 0;
               episodeToLoad = episodes[0];
               console.log("[PlayerScreen] Fallback failed. Defaulting to first available episode.");
             } else {
               setError("Could not load offline episode and no online fallback available.");
               setLoading(false);
               return;
             }
           }
        }
      } else if (episodeId) {
        console.log(`[PlayerScreen] Trying to find episode by ID: ${episodeId}`);
        // Find by episode ID if no offline path
        targetIndex = episodes.findIndex(ep => ep.id === episodeId);
        if (targetIndex !== -1) {
          episodeToLoad = episodes[targetIndex];
          console.log(`[PlayerScreen] Found episode by ID at index ${targetIndex}`);
        } else {
          console.warn(`[PlayerScreen] Episode ID ${episodeId} not found in loaded list.`);
          setError("Episode not found.");
          setLoading(false); // Ensure loading is off
          return;
        }
      } else if (episodes.length > 0) {
         // Default to the first episode if no specific ID/path provided
         console.log("[PlayerScreen] No specific episode requested, defaulting to first episode.");
         targetIndex = 0;
         episodeToLoad = episodes[0];
      } else {
         console.warn("[PlayerScreen] No episodes available and no specific one requested.");
         // This case should ideally be handled by the main loading/error state
         if (!loading) setError("No episodes available.");
         return;
      }

      if (targetIndex !== -1 && episodeToLoad) {
        console.log(`[PlayerScreen] Target index: ${targetIndex}, Episode to load: ${episodeToLoad.title}`);
        // Only update index if it's different or if it's a standalone offline case
        if (currentIndex !== targetIndex || isStandaloneOffline) {
           console.log(`[PlayerScreen] Setting current index to: ${targetIndex}`);
           setCurrentIndex(targetIndex);
        }
        // Retrieve initial position for this episode
        const initialPosition = playbackPositions.get(episodeToLoad.id);
        console.log(`[PlayerScreen] Found saved position for ${episodeToLoad.id}: ${initialPosition || 0}s`);

        // Load the episode with the initial position
        // Check if it's already loaded to prevent unnecessary reloads
        if (currentEpisodeRef.current?.id !== episodeToLoad.id) {
           console.log(`[PlayerScreen] Calling loadAndSeekEpisode for ${episodeToLoad.title}`);
           await loadAndSeekEpisode(episodeToLoad, initialPosition);
        } else {
           console.log(`[PlayerScreen] Episode ${episodeToLoad.title} already loaded, skipping loadAndSeekEpisode.`);
        }
      } else if (!loading) {
         // If loading is done but we couldn't determine an episode
         console.warn("[PlayerScreen] Could not determine episode to load after checks.");
         setError("Could not determine episode to load.");
      }

      // Ensure loading is false if we reached here and determined an episode or failed
      // It might already be false from loadData, but set again for safety
      if (loading) setLoading(false);
  };

  async function fetchEpisodes() {
    try {
      // Check network status before fetching
      const networkState = await NetInfo.fetch();
      const isConnected = networkState.isConnected;
      setIsOffline(!isConnected);

      // If offlinePath is provided, load that episode directly
      if (offlinePath && !isConnected) { // Only handle offlinePath here if offline initially
        const offlineEpisode = await getOfflineEpisodeDetails(offlinePath);
        if (offlineEpisode) {
          setEpisodes([offlineEpisode]);
          // setCurrentIndex(0); // Index is set by determineAndLoadCurrentEpisode
          // setLoading(false); // setLoading is handled by loadData
          // Fetch positions even for offline episode
          await fetchPlaybackPositions();
          return; // Return early as we only have the offline episode
        } else {
          throw new Error("Failed to load offline episode details");
        }
      }

      // If offline and no offlinePath, load from cache
      if (!isConnected) {
        const cachedEpisodes = await loadCachedEpisodes();
        if (cachedEpisodes.length > 0) {
          setEpisodes(cachedEpisodes);
          await fetchPlaybackPositions();
        } else {
          throw new Error('Aucun épisode disponible en mode hors ligne et cache vide');
        }
        return; // Return early as we are offline
      }

      // If we are online, load from Supabase
      const { data, error: apiError } = await supabase
        .from('episodes')
        .select('*')
        .order('publication_date', { ascending: false });

      if (apiError) throw apiError;

      const formattedEpisodes: Episode[] = (data as SupabaseEpisode[]).map(episode => ({
        id: episode.id,
        title: episode.title,
        description: episode.description,
        originalMp3Link: episode.original_mp3_link,
        mp3Link: episode.mp3_link,
        duration: episode.duration,
        publicationDate: episode.publication_date,
        offline_path: (episode as any).offline_path || undefined 
      }));

      console.log("Episodes chargés:", formattedEpisodes.length);
      
      // Verify and modify URLs if necessary
      const validEpisodes = formattedEpisodes.map(episode => {
        // Ensure mp3Link is a valid URL
        if (episode.mp3Link && !episode.mp3Link.startsWith('http')) {
          // Assuming the base URL is https
          episode.mp3Link = `https://${episode.mp3Link}`;
        }
        return episode;
      });
      
      // Save in AsyncStorage for offline access
      await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(validEpisodes));
      
      setEpisodes(validEpisodes);

      // Fetch playback positions AFTER episodes are loaded
      await fetchPlaybackPositions();

    } catch (err) {
      console.error('Error fetching episodes:', err);
      throw err; // Re-throw the error to be caught by loadData
    }
  }

  async function markEpisodeAsWatched(episodeId: string) {
    try {
      if (isOffline) {
        // Stocker localement pour synchroniser plus tard
        const watchedEpisodes = await AsyncStorage.getItem('offline_watched_episodes') || '[]';
        const watchedList = JSON.parse(watchedEpisodes);
        
        if (!watchedList.includes(episodeId)) {
          watchedList.push(episodeId);
          await AsyncStorage.setItem('offline_watched_episodes', JSON.stringify(watchedList));
        }
        return;
      }

      const userResponse = await supabase.auth.getUser();
      const userId = userResponse.data.user?.id;
      
      if (!userId) {
        console.warn("Utilisateur non connecté, impossible de marquer l'épisode comme vu");
        return;
      }
      
      const { error } = await supabase
        .from('watched_episodes')
        .upsert({ 
          episode_id: episodeId,
          user_id: userId,
          watched_at: new Date().toISOString(),
          is_finished: true,
          playback_position: null
        }, {
          onConflict: 'user_id, episode_id'
        });

      if (error) {
        console.error("Erreur lors de l'insertion:", error);
        throw error;
      }
      
      console.log("Épisode marqué comme vu:", episodeId);
    } catch (err) {
      console.error('Error marking episode as watched:', err);
    }
  }

  // Add helper function to save the current position
  const saveCurrentPosition = async (episodeId: string, positionSeconds: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const userId = user.id;
      const timestamp = new Date().toISOString();
      
      // Save to local state immediately to ensure we have the updated position
      // This is important so that we can resume properly when navigating
      const newPlaybackPositions = new Map(playbackPositions);
      newPlaybackPositions.set(episodeId, positionSeconds);
      setPlaybackPositions(newPlaybackPositions);
      
      // First, save to AsyncStorage for offline support
      const pendingPositionsJSON = await AsyncStorage.getItem(PENDING_POSITIONS_KEY);
      let pendingPositions = pendingPositionsJSON ? JSON.parse(pendingPositionsJSON) : [];
      
      const existingIndex = pendingPositions.findIndex(
        (p: any) => p.userId === userId && p.episodeId === episodeId
      );
      
      const newPositionData = { 
        episodeId, 
        positionSeconds, 
        userId, 
        timestamp 
      };
      
      if (existingIndex !== -1) {
        pendingPositions[existingIndex] = newPositionData;
      } else {
        pendingPositions.push(newPositionData);
      }
      
      await AsyncStorage.setItem(PENDING_POSITIONS_KEY, JSON.stringify(pendingPositions));
      console.log(`[PlayerScreen] Position saved for ${episodeId}: ${positionSeconds}s`);
      
      // Also try to update Supabase directly if online
      try {
        const netInfo = await NetInfo.fetch();
        if (netInfo.isConnected) {
          const { error } = await supabase
            .from('watched_episodes')
            .upsert({
              user_id: userId,
              episode_id: episodeId,
              playback_position: positionSeconds,
              watched_at: timestamp,
              is_finished: false
            }, {
              onConflict: 'user_id, episode_id'
            });
            
          if (error) {
            console.error('[PlayerScreen] Error updating position in Supabase:', error);
          } else {
            console.log(`[PlayerScreen] Position updated in Supabase: ${positionSeconds}s`);
          }
        }
      } catch (e) {
        console.error('[PlayerScreen] Error during direct Supabase update:', e);
      }
      
    } catch (error) {
      console.error('[PlayerScreen] Error saving position:', error);
    }
  };

  // Modify handleNext and handlePrevious to ensure position is saved synchronously
  const handleNext = () => {
    if (episodes.length === 0) return;
    
    // Save current position before switching episodes
    if (currentEpisodeRef.current?.id) {
      const currentState = audioManager.getState();
      if (currentState.position > 0) {
        // Save position and wait for it to complete before navigating
        saveCurrentPosition(currentEpisodeRef.current.id, currentState.position);
      }
    }
    
    // Short delay to ensure save completes
    setTimeout(() => {
      const nextIndex = (currentIndex + 1) % episodes.length;
      const nextEpisode = episodes[nextIndex];
      if (nextEpisode) {
        currentEpisodeRef.current = null; // Allow reloading
        router.setParams({ episodeId: nextEpisode.id, offlinePath: undefined });
      }
    }, 100);
  };

  const handlePrevious = () => {
    if (episodes.length === 0) return;
    
    // Save current position before switching episodes
    if (currentEpisodeRef.current?.id) {
      const currentState = audioManager.getState();
      if (currentState.position > 0) {
        // Save position and wait for it to complete before navigating
        saveCurrentPosition(currentEpisodeRef.current.id, currentState.position);
      }
    }
    
    // Short delay to ensure save completes
    setTimeout(() => {
      const prevIndex = (currentIndex - 1 + episodes.length) % episodes.length;
      const prevEpisode = episodes[prevIndex];
      if (prevEpisode) {
        currentEpisodeRef.current = null; // Allow reloading
        router.setParams({ episodeId: prevEpisode.id, offlinePath: undefined });
      }
    }, 100);
  };

  // Add an effect to listen for app state changes - Fix dependency array
  useEffect(() => {
    const currentEpisode = currentEpisodeRef.current;
    const episodeId = currentEpisode?.id;
    
    const subscription = AppState.addEventListener('change', nextAppState => {
      // When app is going to background, save position
      if (
        (appStateRef.current === 'active' && 
        (nextAppState === 'background' || nextAppState === 'inactive')) &&
        currentEpisode
      ) {
        const currentState = audioManager.getState();
        if (currentState.position > 0 && episodeId) {
          console.log(`[PlayerScreen] Saving position on app state change: ${currentState.position}s`);
          saveCurrentPosition(episodeId, currentState.position);
        }
      }
      
      appStateRef.current = nextAppState;
    });
    
    return () => {
      // Save position when component unmounts
      if (episodeId) {
        const currentState = audioManager.getState();
        if (currentState.position > 0) {
          console.log(`[PlayerScreen] Saving position on unmount: ${currentState.position}s`);
          saveCurrentPosition(episodeId, currentState.position);
        }
      }
      subscription.remove();
    };
  }, [currentEpisodeRef.current]); // Use the ref itself for tracking changes

  // Display loading state
  if (loading) {
    return (
      <View style={[styles.container, {alignItems: 'center', justifyContent: 'center'}]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={{color: 'white', marginTop: 10}}>Chargement du lecteur...</Text>
      </View>
    );
  }

  // Erreur de chargement - Display error clearly
  if (error) {
    return (
      <View style={[styles.container, {alignItems: 'center', justifyContent: 'center'}]}>
        <MaterialIcons name="error-outline" size={48} color={theme.colors.error} />
        <Text style={{color: theme.colors.error, marginTop: 15, textAlign: 'center' }}>{error}</Text>
        {/* Optional: Add a retry button */}
        <TouchableOpacity onPress={loadData} style={styles.retryButton}>
           <Text style={styles.retryButtonText}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Check if episodes are empty or currentIndex is invalid
  if (episodes.length === 0 || currentIndex === -1) {
    return (
      <View style={[styles.container, {alignItems: 'center', justifyContent: 'center'}]}>
        <MaterialIcons name="hourglass-empty" size={48} color={theme.colors.description} />
        <Text style={{color: 'white', marginTop: 15}}>Aucun épisode disponible</Text>
        {isOffline && (
          <Text style={{color: theme.colors.secondaryDescription, marginTop: 8}}>Mode hors ligne</Text>
        )}
         <TouchableOpacity onPress={loadData} style={styles.retryButton}>
           <Text style={styles.retryButtonText}>Actualiser</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentEpisode = episodes[currentIndex]; // Use state index
  if (!currentEpisode || (!currentEpisode.mp3Link && !currentEpisode.offline_path)) {
    console.error(`[PlayerScreen] Invalid current episode state: index=${currentIndex}`, currentEpisode);
    return (
      <View style={[styles.container, {alignItems: 'center', justifyContent: 'center'}]}>
         <MaterialIcons name="error-outline" size={48} color={theme.colors.error} />
        <Text style={{color: 'white', marginTop: 15}}>Problème avec l'épisode actuel</Text>
        <Text style={{color: theme.colors.secondaryDescription, marginTop: 10}}>
          {!currentEpisode ? "Épisode introuvable" : "Lien audio manquant"}
        </Text>
         <TouchableOpacity onPress={loadData} style={styles.retryButton}>
           <Text style={styles.retryButtonText}>Actualiser</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <LinearGradient
      colors={['#0b133b', '#000000']}
      style={styles.container}
    >
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>Mode hors ligne</Text>
        </View>
      )}
      <AudioPlayer
        episode={currentEpisode}
        onNext={handlePrevious}
        onPrevious={handleNext}
        onComplete={() => {
          markEpisodeAsWatched(currentEpisode.id);
          // Optionally auto-play next episode on completion
          // handlePrevious(); // Auto-play older episode after completion
        }}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // backgroundColor removed, LinearGradient handles it
    justifyContent: 'center',
    padding: 20,
  },
  offlineBanner: {
    backgroundColor: theme.colors.borderColor,
    padding: 8,
    alignItems: 'center',
    marginBottom: 16,
    borderRadius: 8,
  },
  offlineBannerText: {
    color: theme.colors.text,
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
});