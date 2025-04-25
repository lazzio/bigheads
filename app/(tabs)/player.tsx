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
  const { episodeId, offlinePath, source } = useLocalSearchParams<{ episodeId: string, offlinePath: string, source?: string }>();
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
    // Gestionnaire pour les interactions avec la notification et préservation de la lecture
    const checkPreservePlayback = async () => {
      try {
        // Vérifier si l'app a été ouverte depuis une notification
        const wasLaunchedFromNotification = await AsyncStorage.getItem('appIsRunning') === 'false';
        const shouldPreserve = await AsyncStorage.getItem('preservePlayback');
        
        if (wasLaunchedFromNotification || shouldPreserve === 'true') {
          // Effacer les flags
          await AsyncStorage.removeItem('preservePlayback');
          
          console.log('[PlayerScreen] Préservation de la lecture après ouverture via notification');
          
          // Vérifier si l'audio était en cours de lecture
          const currentState = audioManager.getState();
          if (currentState.currentEpisode) {
            console.log('[PlayerScreen] Épisode en cours trouvé, restauration de la lecture');
            
            // Important: s'assurer que la lecture continue sans réinitialiser
            if (!currentState.isPlaying) {
              setTimeout(() => {
                // Appeler handleAppReactivation si disponible, sinon play
                if (typeof audioManager.handleAppReactivation === 'function') {
                  audioManager.handleAppReactivation();
                } else {
                  audioManager.play().catch(err => 
                    console.error('[PlayerScreen] Erreur lors de la reprise de la lecture:', err)
                  );
                }
              }, 500);
            }
            
            // Vérifier si nous devons mettre à jour l'interface pour l'épisode actuel
            if (currentEpisodeRef.current?.id !== currentState.currentEpisode.id) {
              // Trouver l'index de l'épisode actuel dans notre liste
              const episodeIndex = episodes.findIndex(ep => 
                ep.id === currentState.currentEpisode?.id
              );
              
              if (episodeIndex !== -1 && episodeIndex !== currentIndex) {
                console.log(`[PlayerScreen] Mise à jour de l'index d'épisode: ${episodeIndex}`);
                setCurrentIndex(episodeIndex);
                // Ne pas recharger l'épisode - il est déjà chargé
                currentEpisodeRef.current = currentState.currentEpisode;
              }
            }
          }
        }
      } catch (error) {
        console.error('[PlayerScreen] Erreur lors de la préservation de la lecture:', error);
      }
    };
    
    // Vérifier si nous devons préserver la lecture au chargement du composant
    checkPreservePlayback();
    
    // Ajouter un écouteur spécifique pour détecter les événements du player
    const unsubscribe = audioManager.addListener((data) => {
      if (data.type === 'remote-play' || data.type === 'remote-pause' || 
          data.type === 'remote-next' || data.type === 'remote-previous') {
        // Marquer qu'une interaction avec la notification a eu lieu
        AsyncStorage.setItem('playerInteraction', 'true');
      }
    });
    
    return () => {
      unsubscribe();
    };
  }, [episodes, currentIndex]);
  
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
    // OR if audioManager already has an episode loaded (app coming to foreground)
    const audioState = audioManager.getState();
    if (episodes.length > 0 || offlinePath || audioState.currentEpisode) {
      determineAndLoadCurrentEpisode();
    }
  }, [episodeId, offlinePath, episodes, playbackPositions, source]); // Add source to dependencies

  // Function for initial data loading
  const loadData = async () => {
    console.log("[PlayerScreen] loadData started");
    setLoading(true); // Set loading true at the beginning of data fetching
    setError(null); // Reset error on reload
    try {
      await checkNetworkStatus();
      await fetchEpisodes(); // Fetches episodes list and positions
      console.log("[PlayerScreen] loadData fetchEpisodes completed");
    } catch (err) {
      console.error('[PlayerScreen] Error during initial data load:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load data';
      setError(errorMessage);
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
           // If loading cache also fails, ensure loading is false
           setLoading(false); // Set loading false here on complete failure
        }
      } else {
        // If episodes were already loaded but fetch failed, keep them but show error
        // Loading state will be handled by determineAndLoadCurrentEpisode
      }
    } finally {
      // REMOVED: setLoading(false); - Let determine/loadAndSeek handle the final loading state
      console.log("[PlayerScreen] loadData finished (finally block)");
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
     // Check if the episode we intend to load is *already* the one loaded in AudioManager
     const audioState = audioManager.getState();
     if (audioState.currentEpisode?.id === episode.id) {
       console.log(`[PlayerScreen] Skipping load: Episode ${episode.title} is already loaded in AudioManager.`);
       // Ensure UI reflects the current state even if we skip loading
       currentEpisodeRef.current = audioState.currentEpisode;
       // Find index for UI consistency
       const indexInList = episodes.findIndex(ep => ep.id === episode.id);
       if (indexInList !== -1 && currentIndex !== indexInList) {
         setCurrentIndex(indexInList);
       }
       console.log("[PlayerScreen] loadAndSeekEpisode: Skipping load, setting loading false.");
       setLoading(false); // Ensure loading is off
       return; 
     }
     
     // Original check to prevent unnecessary reloads if the ref matches
     if (!episode || currentEpisodeRef.current?.id === episode.id) {
       // console.log("[PlayerScreen] Skipping load: Episode already loaded or invalid.");
       // If the ref matches but AudioManager has nothing, we might need to load
       if (!audioState.currentEpisode) {
         console.log("[PlayerScreen] Ref matches but AudioManager empty, proceeding with load.");
       } else {
         console.log("[PlayerScreen] loadAndSeekEpisode: Skipping load (ref match), setting loading false.");
         setLoading(false); // Ensure loading is off if truly skipping
         return;
       }
     }
     
     console.log(`[PlayerScreen] loadAndSeekEpisode: Loading episode: ${episode.title} with initial position: ${initialPositionSeconds ?? 0}s`);
     currentEpisodeRef.current = episode; // Track the episode being loaded

     try {
       await audioManager.loadEpisode(episode, initialPositionSeconds);
       console.log("[PlayerScreen] loadAndSeekEpisode: audioManager.loadEpisode finished.");
     } catch (loadError) {
       console.error("[PlayerScreen] Error loading episode in AudioManager:", loadError);
       setError(`Failed to load audio: ${loadError instanceof Error ? loadError.message : 'Unknown error'}`);
       currentEpisodeRef.current = null; // Reset ref on error
     } finally {
       console.log("[PlayerScreen] loadAndSeekEpisode: Reached finally block, setting loading false.");
       setLoading(false); // Ensure loading is false after operation
     }
  };

  // Updated determineAndLoadCurrentEpisode with logging and AudioManager check
  const determineAndLoadCurrentEpisode = async () => {
      console.log('[PlayerScreen] Determining episode to load...', { episodeId, offlinePath, source, numEpisodes: episodes.length, numPositions: playbackPositions.size });
      // Only set loading to true if we aren't already loading AND not just syncing AudioManager state
      const audioState = audioManager.getState();
      let isSyncingAudioManagerState = false; // Flag to check if we are just syncing

      // --- PRIORITIZE AudioManager STATE ---
      if (audioState.currentEpisode) {
          console.log(`[PlayerScreen] AudioManager has active episode: ${audioState.currentEpisode.title}. Prioritizing.`);
          const activeEpisode = audioState.currentEpisode;
          const indexInList = episodes.findIndex(ep => ep.id === activeEpisode.id);

          if (indexInList !== -1) {
              console.log(`[PlayerScreen] Found active episode in list at index ${indexInList}. Setting index.`);
              setCurrentIndex(indexInList);
              currentEpisodeRef.current = episodes[indexInList]; // Update ref to match
              isSyncingAudioManagerState = true; // We are just syncing UI
              console.log("[PlayerScreen] determineAndLoadCurrentEpisode: Synced with AudioManager, setting loading false.");
              setLoading(false); // Loading finished, UI will sync
              return; // Stop further processing
          } else {
              // Handle case where active episode is not in the current list (e.g., offline standalone)
              console.log(`[PlayerScreen] Active episode ${activeEpisode.title} not in main list. Treating as standalone.`);
              if (activeEpisode.offline_path) {
                 setEpisodes([activeEpisode]); // Show only this episode
                 setCurrentIndex(0);
                 currentEpisodeRef.current = activeEpisode;
                 isSyncingAudioManagerState = true; // We are just syncing UI
                 console.log("[PlayerScreen] determineAndLoadCurrentEpisode: Synced with AudioManager (standalone offline), setting loading false.");
                 setLoading(false);
                 return;
              } else {
                 // If it's not offline and not in the list, something is inconsistent. Fallback.
                 console.warn("[PlayerScreen] Active episode not found and not offline. Falling back to param/default logic.");
                 // Let the rest of the function handle loading state
              }
          }
      }
      // --- END AudioManager Check ---

      // If AudioManager had no active episode, proceed with original logic
      if (episodes.length === 0 && !offlinePath) {
        console.log("[PlayerScreen] No episodes loaded and no offline path, waiting...");
        // If fetchEpisodes failed completely, loading should be false and error shown.
        // If fetchEpisodes is still running, loading should be true (from loadData).
        // If offlinePath is present, it will be handled below.
        // Ensure loading is set to false if we are returning here without an error state already set.
        if (!error) {
            console.log("[PlayerScreen] determineAndLoadCurrentEpisode: No episodes/offlinePath, no error, setting loading false.");
            setLoading(false);
        } else {
            console.log("[PlayerScreen] determineAndLoadCurrentEpisode: No episodes/offlinePath, but error exists, leaving loading state as is (likely false from loadData).");
            // If error is set, loading should already be false from loadData's catch block
            // Ensure it's false if somehow it wasn't set before
            if (loading) setLoading(false);
        }
        return;
      }

      let targetIndex = -1;
      let episodeToLoad: Episode | null = null;
      let isStandaloneOffline = false; // Flag for offline episode not in main list

      // 1. Prioritize offlinePath if provided
      if (offlinePath) {
        console.log(`[PlayerScreen] Trying to load offline path: ${offlinePath}`);
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
               console.log("[PlayerScreen] determineAndLoadCurrentEpisode: Offline load failed, no fallback, setting loading false.");
               setLoading(false); // Ensure loading is false on error return
               return;
             }
           }
        }
      // 2. Else, use episodeId if provided
      } else if (episodeId) {
        console.log(`[PlayerScreen] Trying to find episode by ID: ${episodeId}`);
        targetIndex = episodes.findIndex(ep => ep.id === episodeId);
        if (targetIndex !== -1) {
          episodeToLoad = episodes[targetIndex];
          console.log(`[PlayerScreen] Found episode by ID at index ${targetIndex}`);
        } else {
          console.warn(`[PlayerScreen] Episode ID ${episodeId} not found in loaded list. Attempting default.`);
          // Fall through to default case if ID not found
        }
      }

      // 3. Default / Fallback if no specific episode determined yet
      if (!episodeToLoad && episodes.length > 0) {
         console.log("[PlayerScreen] No specific episode determined, defaulting to first episode.");
         targetIndex = 0;
         episodeToLoad = episodes[0];
      }

      // Final check and load
      if (targetIndex !== -1 && episodeToLoad) {
        console.log(`[PlayerScreen] Target index: ${targetIndex}, Episode to load: ${episodeToLoad.title}`);
        if (currentIndex !== targetIndex || isStandaloneOffline) {
           console.log(`[PlayerScreen] Setting current index to: ${targetIndex}`);
           setCurrentIndex(targetIndex);
        }
        const initialPosition = playbackPositions.get(episodeToLoad.id);
        console.log(`[PlayerScreen] Found saved position for ${episodeToLoad.id}: ${initialPosition || 0}s`);

        // Call loadAndSeekEpisode (it now handles its own loading state internally)
        await loadAndSeekEpisode(episodeToLoad, initialPosition);

      } else {
         console.warn("[PlayerScreen] Could not determine episode to load after all checks.");
         // Only set error if not already loading (prevents overwriting initial load error)
         // setError("No episodes available or could not determine which to load."); // Avoid setting error if loadData already set one
         if (!error) { // Only set error if one doesn't exist from loadData
            setError("No episodes available or could not determine which to load.");
         }
         console.log("[PlayerScreen] determineAndLoadCurrentEpisode: Could not determine episode, setting loading false.");
         setLoading(false); // Ensure loading is off if we fail here
      }
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