import { View, Text, StyleSheet, AppState, Platform, BackHandler, ActivityIndicator } from 'react-native'; // Added ActivityIndicator
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

type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];
type WatchedEpisodeRow = Database['public']['Tables']['watched_episodes']['Row']; // Added type

// Constante pour la clé de cache
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
    // Vérifier l'état de la connexion
    checkNetworkStatus();

    // Initialiser le service audio
    const initAudio = async () => {
      try {
        await audioManager.setupAudio();
      } catch (err) {
        console.error("Error setting up audio:", err);
      }
    };

    initAudio();
    fetchEpisodes();

    // Gérer les changements d'état de l'application
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appStateRef.current === 'active' && nextAppState.match(/inactive|background/)) {
        // App passe en arrière-plan
        console.log('App is going to background');
      } else if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        // App revient au premier plan
        console.log('App is coming to foreground');
        checkNetworkStatus();
      }
      appStateRef.current = nextAppState;
    });

    // Handler pour le bouton back d'Android
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      // Retourner sur la page précédente et libérer les ressources audio
      router.back();
      return true;
    });

    return () => {
      // Nettoyage au démontage
      subscription.remove();
      backHandler.remove();
    };
  }, [router]);

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

  // Récupérer les détails d'un épisode hors ligne depuis son fichier méta
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
          mp3Link: filePath, // Utiliser le chemin local
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
      // Don't set error state here, playback can continue from start
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

  // Lorsque les épisodes sont chargés, définir l'épisode courant
  useEffect(() => {
    const setCurrentEpisode = async () => {
      // Si nous avons un chemin hors ligne spécifié
      if (offlinePath && episodes.length === 0) {
        try {
          const offlineEpisode = await getOfflineEpisodeDetails(offlinePath);
          if (offlineEpisode) {
            setEpisodes([offlineEpisode]);
            setCurrentIndex(0);
            setLoading(false);
            return;
          }
        } catch (error) {
          console.error("Error loading offline episode:", error);
        }
      }
      
      // Sinon, chercher l'épisode par ID
      if (episodeId && episodes.length > 0) {
        const index = episodes.findIndex(ep => ep.id === episodeId);
        if (index !== -1) {
          setCurrentIndex(index);
          setLoading(false);
        }
      }
    };
    
    setCurrentEpisode();
  }, [episodeId, offlinePath, episodes]);

  // Effect to load episode data and positions
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await checkNetworkStatus();
      await fetchEpisodes(); // Fetches episodes list
      // Fetch positions after episodes are potentially loaded
      // We need episode IDs first if fetching positions relies on them
      // Let's fetch positions inside fetchEpisodes after data is available
      setLoading(false); // Set loading false after initial data fetch attempt
    };
    loadData();
  }, []); // Run only once on mount

  // Effect to determine and load the *current* episode when relevant state changes
  useEffect(() => {
    const determineAndLoadCurrentEpisode = async () => {
      if (episodes.length === 0) {
        // console.log("[PlayerScreen] Waiting for episodes list...");
        return; // Wait until episodes are loaded
      }

      let targetIndex = -1;
      let episodeToLoad: Episode | null = null;

      if (offlinePath) {
        // Prioritize offline path if provided
        const offlineEpisode = await getOfflineEpisodeDetails(offlinePath);
        if (offlineEpisode) {
           // Find if this offline episode exists in our main list, or treat it as a standalone
           const existingIndex = episodes.findIndex(ep => ep.id === offlineEpisode.id);
           if (existingIndex !== -1) {
              targetIndex = existingIndex;
              episodeToLoad = episodes[targetIndex];
              // Ensure offline path is set if we found it in the main list
              if (!episodeToLoad.offline_path) episodeToLoad.offline_path = offlinePath;
           } else {
              // Treat as a standalone episode if not in the main list
              episodeToLoad = offlineEpisode;
              // We might need to temporarily add it to the state or handle it separately
              // For simplicity, let's assume it should ideally be in the fetched list
              // If not found, maybe show an error or just play it standalone?
              // Let's find by path directly if ID match fails
              targetIndex = episodes.findIndex(ep => ep.offline_path === offlinePath);
              if (targetIndex !== -1) {
                 episodeToLoad = episodes[targetIndex];
              } else {
                 // Fallback: use the details fetched directly
                 console.warn("[PlayerScreen] Offline episode not found in main list, playing directly.");
                 // Set a temporary index or handle outside the main list logic if needed
                 targetIndex = 0; // Or some indicator?
                 setEpisodes([offlineEpisode]); // Overwrite list if playing standalone offline
              }
           }
        } else {
           console.log("[PlayerScreen] Could not load offline episode details. Attempting fallback...");
           
           let foundOnlineFallback = false;
           
           // 1. Try using episodeId from params first
           if (episodeId) {
             const onlineIndex = episodes.findIndex(ep => ep.id === episodeId);
             if (onlineIndex !== -1) {
               targetIndex = onlineIndex;
               episodeToLoad = episodes[targetIndex];
               console.log(`[PlayerScreen] Fallback successful: Found online episode using provided episodeId: ${episodeId}`);
               foundOnlineFallback = true;
             } else {
               console.log(`[PlayerScreen] Provided episodeId ${episodeId} not found in online list. Trying metadata next.`);
             }
           } else {
             console.log("[PlayerScreen] No episodeId provided in params. Trying metadata next.");
           }
           
           // 2. If not found via episodeId, try extracting ID from metadata
           if (!foundOnlineFallback) {
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
                 foundOnlineFallback = true;
               } else {
                 console.log(`[PlayerScreen] Metadata ID ${fallbackIdFromMeta} not found in online list.`);
               }
             }
           }
           
           // 3. If still no fallback found, default to first episode or error
           if (!foundOnlineFallback) {
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
        // Find by episode ID
        targetIndex = episodes.findIndex(ep => ep.id === episodeId);
        if (targetIndex !== -1) {
          episodeToLoad = episodes[targetIndex];
        } else {
          console.warn(`[PlayerScreen] Episode ID ${episodeId} not found in loaded list.`);
          // Optionally try fetching again or show error
          setError("Episode not found.");
          setLoading(false);
          return;
        }
      } else if (episodes.length > 0) {
         // Default to the first episode if no specific ID/path provided
         targetIndex = 0;
         episodeToLoad = episodes[0];
      }

      if (targetIndex !== -1 && episodeToLoad) {
        // Only update index and load if it's different or not set yet
        if (currentIndex !== targetIndex) {
           setCurrentIndex(targetIndex);
        }
        // Retrieve initial position for this episode
        const initialPosition = playbackPositions.get(episodeToLoad.id);
        console.log(`Found saved position for ${episodeToLoad.id}: ${initialPosition || 0}s`);
        
        // Load the episode with the initial position
        try {
          await audioManager.loadEpisode(episodeToLoad, initialPosition);
        } catch (error) {
          console.error('Error loading episode with saved position:', error);
          // Fallback to loading without position if there's an error
          await audioManager.loadEpisode(episodeToLoad);
        }
      } else if (!loading && episodes.length > 0) {
         // If loading is done but no episode determined, maybe default to first?
         // This case might indicate an issue if episodeId was expected but not found.
         console.warn("[PlayerScreen] Could not determine episode to load.");
         // setError("Could not determine episode to load.");
      }
      
      // Ensure loading is false if we reached here with episodes
      if (episodes.length > 0) setLoading(false);

    };

    determineAndLoadCurrentEpisode();

  }, [episodeId, offlinePath, episodes, playbackPositions]); // Rerun when these change

  async function fetchEpisodes() {
    try {
      setLoading(true);
      
      // Vérifier l'état du réseau
      const networkState = await NetInfo.fetch();
      const isConnected = networkState.isConnected;
      setIsOffline(!isConnected);
      
      // Si nous avons un chemin hors ligne spécifié, charger directement cet épisode
      if (offlinePath) {
        const offlineEpisode = await getOfflineEpisodeDetails(offlinePath);
        if (offlineEpisode) {
          setEpisodes([offlineEpisode]);
          setCurrentIndex(0);
          setLoading(false);
          return;
        }
      }
      
      // Si nous sommes hors ligne, essayer de charger depuis le cache
      if (!isConnected) {
        const cachedEpisodes = await loadCachedEpisodes();
        if (cachedEpisodes.length > 0) {
          setEpisodes(cachedEpisodes);
          setError(null);
          // Fetch positions even if offline, they might be relevant if synced before
          await fetchPlaybackPositions(); 
        } else {
          setError('Aucun épisode disponible en mode hors ligne');
        }
        setLoading(false);
        return;
      }
      
      // Si nous sommes en ligne, charger depuis Supabase
      const { data, error: apiError } = await supabase
        .from('episodes')
        .select('*')
        .order('publication_date', { ascending: false });

      if (apiError) throw apiError;

      // Correction du mapping des propriétés snake_case vers camelCase
      const formattedEpisodes: Episode[] = (data as SupabaseEpisode[]).map(episode => ({
        id: episode.id,
        title: episode.title,
        description: episode.description,
        originalMp3Link: episode.original_mp3_link,
        mp3Link: episode.mp3_link,
        duration: episode.duration,
        publicationDate: episode.publication_date,
        // Ensure offline_path is included if it exists in your DB schema/type
        offline_path: (episode as any).offline_path || undefined 
      }));

      console.log("Episodes chargés:", formattedEpisodes.length);
      
      // Vérification et modification des URL si nécessaire
      const validEpisodes = formattedEpisodes.map(episode => {
        // S'assurer que les URL sont valides
        if (episode.mp3Link && !episode.mp3Link.startsWith('http')) {
          // Ajouter le protocole si manquant
          episode.mp3Link = `https://${episode.mp3Link}`;
        }
        return episode;
      });
      
      // Sauvegarder dans le cache
      await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(validEpisodes));
      
      setEpisodes(validEpisodes);
      setError(null);

      // Fetch playback positions AFTER episodes are loaded
      await fetchPlaybackPositions();

    } catch (err) {
      console.error('Error fetching episodes:', err);
      
      // En cas d'erreur, essayer de charger depuis le cache
      const cachedEpisodes = await loadCachedEpisodes();
      if (cachedEpisodes.length > 0) {
        setEpisodes(cachedEpisodes);
        setError('Affichage des données en cache - Connexion limitée');
        // Fetch positions even if showing cache
        await fetchPlaybackPositions();
      } else {
        setError('Erreur lors du chargement des épisodes');
      }
    } finally {
      setLoading(false);
    }
  }

  async function markEpisodeAsWatched(episodeId: string) {
    try {
      // Vérifier si nous sommes en ligne
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

      // Si en ligne, marquer normalement
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
          is_finished: true, // Add this field with value true
          playback_position: null // Add this field with null value when marking as watched
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

  // Affichage d'état de chargement
  if (loading || currentIndex === -1 && episodes.length > 0) { // Show loading until an index is set
    return (
      <View style={[styles.container, {alignItems: 'center', justifyContent: 'center'}]}>
        <ActivityIndicator size="large" color="#0ea5e9" />
        <Text style={{color: 'white', marginTop: 10}}>Chargement du lecteur...</Text>
      </View>
    );
  }

  // Erreur de chargement
  if (error) {
    return (
      <View style={[styles.container, {alignItems: 'center', justifyContent: 'center'}]}>
        <Text style={{color: '#ef4444'}}>{error}</Text>
      </View>
    );
  }

  // Aucun épisode disponible
  if (episodes.length === 0) {
    return (
      <View style={[styles.container, {alignItems: 'center', justifyContent: 'center'}]}>
        <Text style={{color: 'white'}}>Aucun épisode disponible</Text>
        {isOffline && (
          <Text style={{color: '#888', marginTop: 8}}>Mode hors ligne - Connexion Internet requise</Text>
        )}
      </View>
    );
  }

  // Vérifier si l'épisode courant est valide
  const currentEpisode = episodes[currentIndex]; // Use state index
  if (!currentEpisode || (!currentEpisode.mp3Link && !currentEpisode.offline_path)) {
    return (
      <View style={[styles.container, {alignItems: 'center', justifyContent: 'center'}]}>
        <Text style={{color: 'white'}}>Problème avec l'épisode actuel</Text>
        <Text style={{color: '#999', marginTop: 10}}>
          {!currentEpisode ? "Épisode introuvable" : "Lien audio manquant"}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>Mode hors ligne</Text>
        </View>
      )}
      <AudioPlayer
        episode={currentEpisode}
        onNext={handlePrevious} // Corrected: Next button should go to previous date (older episode)
        onPrevious={handleNext} // Corrected: Previous button should go to next date (newer episode)
        onComplete={() => {
          markEpisodeAsWatched(currentEpisode.id);
          // Optionally auto-play next episode on completion
          // handlePrevious(); // Auto-play older episode after completion
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    justifyContent: 'center',
    padding: 20,
  },
  offlineBanner: {
    backgroundColor: '#333',
    padding: 8,
    alignItems: 'center',
    marginBottom: 16,
    borderRadius: 8,
  },
  offlineBannerText: {
    color: '#fff',
    fontSize: 14,
  }
});