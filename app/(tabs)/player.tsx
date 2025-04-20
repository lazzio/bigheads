import { View, Text, StyleSheet, AppState, Platform, BackHandler, AppStateStatus } from 'react-native';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AudioPlayer from '../../components/AudioPlayer';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import { Episode } from '../../types/episode';
import { audioManager, AudioStatus } from '../../utils/OptimizedAudioService'; // Importer AudioStatus
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo'; // Import NetInfo
import { syncPlaybackPositions } from '../../utils/PlaybackSyncService'; // Import sync function

type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];

const EPISODES_CACHE_KEY = 'cached_episodes';
const PENDING_POSITIONS_KEY = 'pendingPlaybackPositions'; // Clé pour le stockage local

// Interface for locally stored data
interface PendingPosition {
  episodeId: string;
  positionSeconds: number;
  userId: string;
  timestamp: string;
}

export default function PlayerScreen() {
  const { episodeId, offlinePath } = useLocalSearchParams<{ episodeId?: string; offlinePath?: string }>();
  const router = useRouter();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false); // Gardez ceci pour l'UI si nécessaire
  const currentEpisodeIdRef = useRef<string | null>(null);
  const appState = useRef(AppState.currentState);
  const isSavingRef = useRef(false); // Pour éviter sauvegarde concurrente locale/appstate
  const [isLoadingSound, setIsLoadingSound] = useState(false);
  const episodeDurationRef = useRef<number | null>(null); // Ref pour stocker la durée

  // --- Helper pour sauvegarder localement ---
  const savePositionLocally = async (epId: string, positionSeconds: number, userId: string) => {
    console.log(`[PlayerScreen] Saving position locally for ${epId}`);
    try {
      const existingPendingString = await AsyncStorage.getItem(PENDING_POSITIONS_KEY);
      let pendingPositions: PendingPosition[] = existingPendingString ? JSON.parse(existingPendingString) : [];

      // Filtrer pour enlever l'ancienne position pour ce user/episode
      pendingPositions = pendingPositions.filter(p => !(p.userId === userId && p.episodeId === epId));

      // Ajouter la nouvelle position
      pendingPositions.push({
        episodeId: epId,
        positionSeconds,
        userId,
        timestamp: new Date().toISOString(),
      });

      await AsyncStorage.setItem(PENDING_POSITIONS_KEY, JSON.stringify(pendingPositions));
      console.log(`[PlayerScreen] Position for ${epId} saved locally.`);
    } catch (error) {
      console.error("[PlayerScreen] Error saving position locally:", error);
    }
  };

  // --- Helper pour nettoyer une position locale (après synchro Supabase réussie) ---
   const clearPendingPosition = async (episodeId: string, userId: string) => {
     console.log(`[PlayerScreen] Clearing pending local position for ${episodeId}`);
     try {
       const existingPendingString = await AsyncStorage.getItem(PENDING_POSITIONS_KEY);
       if (!existingPendingString) return;

       let pendingPositions: PendingPosition[] = JSON.parse(existingPendingString);
       const initialLength = pendingPositions.length;

       pendingPositions = pendingPositions.filter(p => !(p.userId === userId && p.episodeId === episodeId));

       if (pendingPositions.length < initialLength) {
           if (pendingPositions.length === 0) {
               await AsyncStorage.removeItem(PENDING_POSITIONS_KEY);
           } else {
               await AsyncStorage.setItem(PENDING_POSITIONS_KEY, JSON.stringify(pendingPositions));
           }
           console.log(`[PlayerScreen] Cleared pending local position for ${episodeId}.`);
       }
     } catch (error) {
       console.error("[PlayerScreen] Error clearing pending position:", error);
     }
   };


  // --- Fonction pour SAUVEGARDER la position (Hybride) ---
  const savePlaybackPosition = useCallback(async (
    epId: string | null,
    positionMillis: number | null,
    // Nouveau paramètre optionnel pour forcer le statut 'terminé'
    markAsFinished: boolean = false
  ) => {
    if (isSavingRef.current) return;
    if (!epId || positionMillis === null) return; // Permettre position 0 si markAsFinished est true

    const positionSeconds = positionMillis / 1000;
    const durationSeconds = episodeDurationRef.current ? episodeDurationRef.current / 1000 : 0;

    // Déterminer si l'épisode est considéré comme terminé
    // Soit explicitement demandé (markAsFinished), soit si la position est très proche de la fin (>98%)
    const isConsideredFinished = markAsFinished || (durationSeconds > 0 && positionSeconds >= durationSeconds * 0.98);

    // Ne pas sauvegarder les positions très courtes, SAUF si on marque comme terminé
    if (!isConsideredFinished && positionSeconds < 5) {
      // console.log(`[PlayerScreen] Position ${positionSeconds}s trop courte, non sauvegardée.`);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[PlayerScreen] Impossible de sauvegarder la position, utilisateur non connecté.');
      return;
    }

    isSavingRef.current = true;
    console.log(`[PlayerScreen] Tentative de sauvegarde pour ${epId}: ${positionSeconds}s, Terminé: ${isConsideredFinished}`);

    const netInfoState = await NetInfo.fetch();
    const positionData = {
      user_id: user.id,
      episode_id: epId,
      // Sauvegarder 0 si marqué comme terminé, sinon la position actuelle
      playback_position: isConsideredFinished ? 0 : positionSeconds,
      watched_at: new Date().toISOString(),
      is_finished: isConsideredFinished // <<< Utiliser la nouvelle colonne
    };

    if (netInfoState.isConnected && netInfoState.isInternetReachable) {
      try {
        console.log(`[PlayerScreen] En ligne: Sauvegarde sur Supabase pour ${epId}.`);
        const { error: upsertError } = await supabase
          .from('watched_episodes')
          .upsert(positionData, { onConflict: 'user_id, episode_id' });

        if (upsertError) {
          console.error("[PlayerScreen] Erreur de sauvegarde sur Supabase:", upsertError.message);
          // Fallback local (ne stocke pas is_finished, juste la position)
          if (!isConsideredFinished) { // Ne pas sauvegarder localement si c'est juste pour marquer comme terminé
             await savePositionLocally(epId, positionSeconds, user.id);
          }
        } else {
          console.log(`[PlayerScreen] Position/Statut pour ${epId} sauvegardé sur Supabase.`);
          // Nettoyer la sauvegarde locale de position si elle existait
          await clearPendingPosition(epId, user.id);
          // Tenter une synchronisation générale
          syncPlaybackPositions();
        }
      } catch (err) {
        console.error("[PlayerScreen] Exception de sauvegarde sur Supabase:", err);
         if (!isConsideredFinished) {
            await savePositionLocally(epId, positionSeconds, user.id); // Fallback local
         }
      }
    } else {
      // Sauvegarde locale (position uniquement)
       if (!isConsideredFinished) {
          console.log(`[PlayerScreen] Hors ligne: Sauvegarde de la position pour ${epId} localement.`);
          await savePositionLocally(epId, positionSeconds, user.id);
       } else {
          console.log(`[PlayerScreen] Hors ligne: Impossible de marquer ${epId} comme terminé.`);
          // Optionnel: Stocker l'état 'terminé' hors ligne aussi ? Pour l'instant, non.
       }
    }
    isSavingRef.current = false;
  }, []); // Ajouter les dépendances si savePositionLocally/clearPendingPosition sont utilisées

  // --- Fonction pour RÉCUPÉRER la position (Hybride) ---
  const getPlaybackPosition = useCallback(async (epId: string): Promise<number | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    let supabasePositionMillis: number | null = null;
    let localPositionMillis: number | null = null;
    const netInfoState = await NetInfo.fetch();

    // 1. Essayer Supabase si en ligne
    if (netInfoState.isConnected && netInfoState.isInternetReachable) {
      try {
        const { data, error } = await supabase
          .from('watched_episodes')
          .select('playback_position')
          .eq('user_id', user.id)
          .eq('episode_id', epId)
          .maybeSingle();

        if (error) {
          console.error("[PlayerScreen] Erreur de récupération depuis Supabase:", error.message);
        } else if (data?.playback_position) {
          supabasePositionMillis = data.playback_position * 1000;
          console.log(`[PlayerScreen] Récupéré depuis Supabase pour ${epId}: ${supabasePositionMillis}ms`);
        }
      } catch (err) {
        console.error("[PlayerScreen] Exception de récupération depuis Supabase:", err);
      }
    }

    // 2. Vérifier le stockage local (pour les positions en attente/hors ligne)
    try {
      const existingPendingString = await AsyncStorage.getItem(PENDING_POSITIONS_KEY);
      if (existingPendingString) {
        const pendingPositions: PendingPosition[] = JSON.parse(existingPendingString);
        const pending = pendingPositions.find(p => p.userId === user.id && p.episodeId === epId);
        if (pending) {
          localPositionMillis = pending.positionSeconds * 1000;
          console.log(`[PlayerScreen] Position locale en attente trouvée pour ${epId}: ${localPositionMillis}ms`);
        }
      }
    } catch (error) {
      console.error("[PlayerScreen] Erreur de récupération depuis le stockage local:", error);
    }

    // 3. Prioriser la position locale si elle existe (car potentiellement plus récente), sinon Supabase
    const finalPosition = localPositionMillis ?? supabasePositionMillis;

    console.log(`[PlayerScreen] Position initiale finale pour ${epId}: ${finalPosition}ms`);
    return finalPosition;
  }, []); // Pas de dépendances externes

  // --- Effet pour charger l'épisode initial et sa position ---
  useEffect(() => {
    const loadEpisodeAndPosition = async () => {
      if (currentIndex !== null && episodes[currentIndex]) {
        const currentEp = episodes[currentIndex];
        currentEpisodeIdRef.current = currentEp.id;
        setIsLoadingSound(true);
        setError(null);
        console.log(`[PlayerScreen] Préparation chargement: ${currentEp.title}`);
        try {
          const initialPosition = await getPlaybackPosition(currentEp.id);
          console.log(`[PlayerScreen] Position initiale pour ${currentEp.id}: ${initialPosition}ms`);

          // Charger le son
          await audioManager.loadSound(currentEp, initialPosition ?? 0);

          // Récupérer et stocker la durée une fois chargé
          const status = await audioManager.getStatusAsync();
          if (status.isLoaded) {
            episodeDurationRef.current = status.durationMillis; // Stocker la durée
            console.log(`[PlayerScreen] Durée stockée pour ${currentEp.id}: ${status.durationMillis}ms`);
          }

          console.log(`[PlayerScreen] Chargé avec succès: ${currentEp.title}`);
        } catch (loadError: any) {
          console.error("[PlayerScreen] Erreur chargement épisode:", loadError);
          setError(`Erreur chargement: ${loadError.message || 'Inconnue'}`);
          await audioManager.unloadSound();
        } finally {
          setIsLoadingSound(false);
        }
      } else {
        await audioManager.unloadSound();
        episodeDurationRef.current = null; // Réinitialiser la durée
      }
    };
    loadEpisodeAndPosition();
  }, [currentIndex, episodes, getPlaybackPosition]); // Dépendances correctes

  // --- Effet pour sauvegarder en quittant l'écran ou en arrière-plan ---
  useEffect(() => {
    const saveCurrentPosition = async (isUnmounting: boolean = false) => {
      const status = await audioManager.getStatusAsync();
      // Mettre à jour la durée juste avant de sauvegarder
      if (status.isLoaded) {
          episodeDurationRef.current = status.durationMillis;
      }
      if (status.isLoaded && currentEpisodeIdRef.current) {
        // Ne pas marquer comme terminé juste en quittant, sauf si la position est déjà à la fin
        await savePlaybackPosition(currentEpisodeIdRef.current, status.positionMillis, false);
      }
      // Décharger seulement si l'écran est démonté
      if (isUnmounting) {
          await audioManager.unloadSound();
      }
    };

    const subscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/active/) && // Était active
        nextAppState.match(/inactive|background/) // Passe en arrière-plan/inactive
      ) {
        console.log('[PlayerScreen] App passant en arrière-plan, sauvegarde de la position.');
        await saveCurrentPosition(false); // Ne pas décharger
      }
      appState.current = nextAppState;
    });

    // Sauvegarde quand l'écran est quitté (démontage)
    return () => {
      console.log('[PlayerScreen] Démontage, sauvegarde de la position.');
      saveCurrentPosition(true); // Sauvegarder et décharger
      subscription.remove();
    };
  }, [savePlaybackPosition]); // Dépend de la fonction de sauvegarde

  // --- Handler pour la fin de lecture ---
  const handlePlaybackComplete = useCallback(async () => {
    console.log('[PlayerScreen] Lecture terminée détectée.');
    if (currentEpisodeIdRef.current) {
      // Appeler savePlaybackPosition en forçant le statut 'terminé'
      await savePlaybackPosition(currentEpisodeIdRef.current, episodeDurationRef.current ?? 0, true);
      // Optionnel: passer automatiquement à l'épisode suivant
      // handleNext();
    }
  }, [savePlaybackPosition]); // Dépend de savePlaybackPosition

  // --- Fonctions de navigation (Next/Previous) ---
  const handleNext = async () => {
    const status = await audioManager.getStatusAsync();
    // Sauvegarder la position de l'épisode actuel AVANT de changer
    if (status?.isLoaded && currentEpisodeIdRef.current) {
      await savePlaybackPosition(currentEpisodeIdRef.current, status.positionMillis);
    }
    // Logique pour passer au suivant
    if (currentIndex !== null && currentIndex < episodes.length - 1) {
      setCurrentIndex(currentIndex + 1); // Déclenchera l'useEffect pour charger le nouvel épisode
    } else {
      console.log("Déjà au dernier épisode");
      // Optionnel: arrêter la lecture ou boucler ?
    }
  };

  const handlePrevious = async () => {
    const status = await audioManager.getStatusAsync();
     // Sauvegarder la position de l'épisode actuel AVANT de changer
    if (status?.isLoaded && currentEpisodeIdRef.current) {
      await savePlaybackPosition(currentEpisodeIdRef.current, status.positionMillis);
    }
    // Logique pour passer au précédent
    if (currentIndex !== null && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1); // Déclenchera l'useEffect pour charger le nouvel épisode
    } else {
      console.log("Déjà au premier épisode");
    }
  };

  // --- Fonction pour charger l'épisode et sa position ---
  const loadEpisodeAndPosition = useCallback(async () => { // Utiliser useCallback pour la stabilité
    if (currentIndex !== null && episodes[currentIndex]) {
      const currentEp = episodes[currentIndex];
      currentEpisodeIdRef.current = currentEp.id;
      setIsLoadingSound(true);
      setError(null);
      console.log(`[PlayerScreen] Preparing to load episode: ${currentEp.title}`);

      try {
        const initialPosition = await getPlaybackPosition(currentEp.id);
        console.log(`[PlayerScreen] Got initial position for ${currentEp.id}: ${initialPosition}ms`);
        await audioManager.loadSound(currentEp, initialPosition ?? 0);
        console.log(`[PlayerScreen] Successfully loaded ${currentEp.title}`);
      } catch (loadError: any) {
        console.error("[PlayerScreen] Error loading episode:", loadError);
        setError(`Erreur chargement: ${loadError.message || 'Inconnue'}`);
        await audioManager.unloadSound();
      } finally {
        setIsLoadingSound(false);
      }
    } else {
      await audioManager.unloadSound();
    }
  // Ajouter les dépendances correctes
  }, [currentIndex, episodes, getPlaybackPosition]);

  // --- Effet pour charger l'épisode initial ---
  useEffect(() => {
    // Appeler la fonction de chargement lorsque l'index ou les épisodes changent
    loadEpisodeAndPosition();
  }, [loadEpisodeAndPosition]); // Dépend de la fonction de chargement

  // --- Fonction de Retry ---
  const handleRetryLoad = () => {
    console.log("[PlayerScreen] Retrying episode load...");
    // Relancer simplement la fonction de chargement
    loadEpisodeAndPosition();
  };

  // --- Fonction pour récupérer les épisodes ---
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
        publicationDate: episode.publication_date
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
    } catch (err) {
      console.error('Error fetching episodes:', err);
      
      // En cas d'erreur, essayer de charger depuis le cache
      const cachedEpisodes = await loadCachedEpisodes();
      if (cachedEpisodes.length > 0) {
        setEpisodes(cachedEpisodes);
        setError('Affichage des données en cache - Connexion limitée');
      } else {
        setError('Erreur lors du chargement des épisodes');
      }
    } finally {
      setLoading(false);
    }
  }

  // --- Fonction pour marquer un épisode comme vu ---
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
          watched_at: new Date().toISOString()
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

  // --- Fonction pour charger les épisodes depuis le cache ---
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

  // --- Fonction pour récupérer les détails d'un épisode hors ligne depuis son fichier méta ---
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
          duration: metadata.duration || '0',
          offline_path: filePath
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting offline episode details:', error);
      return null;
    }
  };

  // --- Effet pour définir l'épisode courant lorsque les épisodes sont chargés ---
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

  // --- Effet pour vérifier le statut du réseau ---
  useEffect(() => {
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
      if (appState.current === 'active' && nextAppState.match(/inactive|background/)) {
        // App passe en arrière-plan
        console.log('App is going to background');
      } else if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        // App revient au premier plan
        console.log('App is coming to foreground');
        checkNetworkStatus();
      }
      appState.current = nextAppState;
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

  // --- Affichage d'état de chargement ---
  if (loading) {
    return (
      <View style={[styles.container, {alignItems: 'center', justifyContent: 'center'}]}>
        <Text style={{color: 'white'}}>Chargement du lecteur...</Text>
      </View>
    );
  }

  // --- Erreur de chargement ---
  if (error) {
    return (
      <View style={[styles.container, {alignItems: 'center', justifyContent: 'center'}]}>
        <Text style={{color: '#ef4444'}}>{error}</Text>
      </View>
    );
  }

  // --- Aucun épisode disponible ---
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

  // --- Vérifier si l'épisode courant est valide ---
  const currentEpisode = episodes[currentIndex? currentIndex : 0];
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
      {loading && (
        <View style={styles.centered}>
          <Text style={{ color: 'white' }}>Chargement de l'épisode...</Text>
          {/* Peut-être ajouter un ActivityIndicator ici */}
        </View>
      )}
      {error && !loading && (
        <View style={styles.centered}>
          <Text style={{ color: 'red' }}>{error}</Text>
        </View>
      )}
      {!loading && !error && currentEpisode && (
        <AudioPlayer
          key={currentEpisode.id} // Clé pour forcer le re-rendu
          episode={currentEpisode}
          onNext={handleNext}
          onPrevious={handlePrevious}
          onRetry={handleRetryLoad} // <<< Passer la fonction de retry ici
          onComplete={handlePlaybackComplete} // <<< Passer le nouveau handler
          // AudioPlayer utilisera audioManager pour play/pause/seek
          // Il peut s'abonner aux mises à jour via audioManager.addListener
        />
      )}
      {!loading && !error && !currentEpisode && (
        <View style={styles.centered}>
          <Text style={{ color: 'white' }}>Aucun épisode sélectionné.</Text>
        </View>
      )}
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
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  }
});