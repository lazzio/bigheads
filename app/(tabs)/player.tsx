import { View, Text, StyleSheet, AppState, BackHandler, AppStateStatus, ActivityIndicator } from 'react-native';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router'; // Importer useFocusEffect
import AudioPlayer from '../../components/AudioPlayer';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import { Episode } from '../../types/episode';
import { audioManager, AudioStatus } from '../../utils/OptimizedAudioService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';
import { syncPlaybackPositions } from '../../utils/PlaybackSyncService';

type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];

const EPISODES_CACHE_KEY = 'cached_episodes';
const PENDING_POSITIONS_KEY = 'pendingPlaybackPositions';

interface PendingPosition {
  episodeId: string;
  positionSeconds: number;
  userId: string;
  timestamp: string;
}

function parseDuration(durationStr: string | number | null): number | null {
  if (typeof durationStr === 'number') return durationStr;
  if (typeof durationStr !== 'string' || !durationStr) return null;
  const parts = durationStr.split(':').map(Number);
  let seconds = 0;
  if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
  else if (parts.length === 1 && !isNaN(parts[0])) seconds = parts[0];
  return isNaN(seconds) ? null : seconds;
}

export default function PlayerScreen() {
  const { episodeId, offlinePath } = useLocalSearchParams<{ episodeId?: string; offlinePath?: string }>();
  const router = useRouter();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true); // Chargement initial de la liste d'épisodes
  const [error, setError] = useState<string | null>(null);
  // const [isOffline, setIsOffline] = useState(false); // Moins critique pour la logique principale
  const currentEpisodeIdRef = useRef<string | null>(null);
  const appState = useRef(AppState.currentState);
  const isSavingRef = useRef(false);
  // const [isLoadingSound, setIsLoadingSound] = useState(false); // Supprimé, géré par AudioPlayer
  // const episodeDurationRef = useRef<number | null>(null); // Supprimé, géré par AudioPlayer/audioManager

  // --- Helpers pour sauvegarde/nettoyage local (inchangés) ---
  const savePositionLocally = useCallback(async (epId: string, positionSeconds: number, userId: string) => {
    // ... (code existant)
     console.log(`[PlayerScreen] Saving position locally for ${epId}`);
     try {
       const existingPendingString = await AsyncStorage.getItem(PENDING_POSITIONS_KEY);
       let pendingPositions: PendingPosition[] = existingPendingString ? JSON.parse(existingPendingString) : [];
       pendingPositions = pendingPositions.filter(p => !(p.userId === userId && p.episodeId === epId));
       pendingPositions.push({ episodeId: epId, positionSeconds, userId, timestamp: new Date().toISOString() });
       await AsyncStorage.setItem(PENDING_POSITIONS_KEY, JSON.stringify(pendingPositions));
       console.log(`[PlayerScreen] Position for ${epId} saved locally.`);
     } catch (error) {
       console.error("[PlayerScreen] Error saving position locally:", error);
     }
  }, []);

   const clearPendingPosition = useCallback(async (episodeId: string, userId: string) => {
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
   }, []);

  // --- Fonction pour SAUVEGARDER la position (Hybride) ---
  const savePlaybackPosition = useCallback(async (
    epId: string | null,
    positionMillis: number | null,
    markAsFinished: boolean = false
  ) => {
    // ... (code existant, incluant récupération de durée via getStatusAsync) ...
     if (isSavingRef.current) return;
     if (!epId || positionMillis === null) return;
     isSavingRef.current = true; // Mettre le flag au début

     let durationSeconds = 0;
     try {
       const currentStatus = await audioManager.getStatusAsync();
       if (currentStatus.isLoaded) {
         durationSeconds = currentStatus.durationMillis / 1000;
       }
     } catch (e) { console.warn("[PlayerScreen] Impossible d'obtenir la durée actuelle pour la sauvegarde."); }

     const positionSeconds = positionMillis / 1000;
     const isConsideredFinished = markAsFinished || (durationSeconds > 0 && positionSeconds >= durationSeconds * 0.98);

     if (!isConsideredFinished && positionSeconds < 5) {
       isSavingRef.current = false; // Ne pas oublier de remettre le flag
       return;
     }

     const { data: { user } } = await supabase.auth.getUser();
     if (!user) {
       console.warn('[PlayerScreen] Impossible de sauvegarder la position, utilisateur non connecté.');
       isSavingRef.current = false; // Ne pas oublier de remettre le flag
       return;
     }

     console.log(`[PlayerScreen] Tentative de sauvegarde pour ${epId}: ${positionSeconds}s, Terminé: ${isConsideredFinished}`);
     const netInfoState = await NetInfo.fetch();
     const positionData = { /* ... */ user_id: user.id, episode_id: epId, playback_position: isConsideredFinished ? 0 : positionSeconds, watched_at: new Date().toISOString(), is_finished: isConsideredFinished };

     if (netInfoState.isConnected && netInfoState.isInternetReachable) {
       try {
         const { error: upsertError } = await supabase.from('watched_episodes').upsert(positionData, { onConflict: 'user_id, episode_id' });
         if (upsertError) {
           console.error("[PlayerScreen] Erreur de sauvegarde sur Supabase:", upsertError.message);
           if (!isConsideredFinished) await savePositionLocally(epId, positionSeconds, user.id);
         } else {
           console.log(`[PlayerScreen] Position/Statut pour ${epId} sauvegardé sur Supabase.`);
           await clearPendingPosition(epId, user.id);
           syncPlaybackPositions(); // Déclencher la synchro générale
         }
       } catch (err) {
         console.error("[PlayerScreen] Exception de sauvegarde sur Supabase:", err);
         if (!isConsideredFinished) await savePositionLocally(epId, positionSeconds, user.id);
       }
     } else {
       if (!isConsideredFinished) {
         console.log(`[PlayerScreen] Hors ligne: Sauvegarde de la position pour ${epId} localement.`);
         await savePositionLocally(epId, positionSeconds, user.id);
       } else {
         console.log(`[PlayerScreen] Hors ligne: Impossible de marquer ${epId} comme terminé.`);
       }
     }
     isSavingRef.current = false; // Remettre le flag à la fin
  }, [savePositionLocally, clearPendingPosition]); // Ajouter les dépendances

  // --- Fonction pour RÉCUPÉRER la position (Hybride) ---
  const getPlaybackPosition = useCallback(async (epId: string): Promise<number | null> => {
    // ... (code existant) ...
     const { data: { user } } = await supabase.auth.getUser();
     if (!user) return null;
     let supabasePositionMillis: number | null = null;
     let localPositionMillis: number | null = null;
     const netInfoState = await NetInfo.fetch();

     if (netInfoState.isConnected && netInfoState.isInternetReachable) {
       try { /* ... fetch supabase ... */
         const { data, error } = await supabase.from('watched_episodes').select('playback_position').eq('user_id', user.id).eq('episode_id', epId).maybeSingle();
         if (error) console.error("[PlayerScreen] Erreur de récupération depuis Supabase:", error.message);
         else if (data?.playback_position) supabasePositionMillis = data.playback_position * 1000;
       } catch (err) { console.error("[PlayerScreen] Exception de récupération depuis Supabase:", err); }
     }
     try { /* ... fetch local ... */
       const existingPendingString = await AsyncStorage.getItem(PENDING_POSITIONS_KEY);
       if (existingPendingString) {
         const pendingPositions: PendingPosition[] = JSON.parse(existingPendingString);
         const pending = pendingPositions.find(p => p.userId === user.id && p.episodeId === epId);
         if (pending) localPositionMillis = pending.positionSeconds * 1000;
       }
     } catch (error) { console.error("[PlayerScreen] Erreur de récupération depuis le stockage local:", error); }

     const finalPosition = localPositionMillis ?? supabasePositionMillis; // Priorité au local
     console.log(`[PlayerScreen] Position initiale finale pour ${epId}: ${finalPosition}ms`);
     return finalPosition;
  }, []); // Pas de dépendances externes nécessaires ici

  // --- Fonction pour charger les épisodes depuis le cache ---
  const loadCachedEpisodes = useCallback(async (): Promise<Episode[]> => {
    // ... (code existant) ...
     try {
       const cachedData = await AsyncStorage.getItem(EPISODES_CACHE_KEY);
       if (cachedData) {
         const episodes: Episode[] = JSON.parse(cachedData);
         // Normaliser la durée
         const normalizedEpisodes = episodes.map(ep => ({ ...ep, duration: parseDuration(ep.duration) }));
         console.log(`Loaded ${normalizedEpisodes.length} episodes from cache for player`);
         return normalizedEpisodes;
       }
     } catch (error) { console.error('Error loading cached episodes:', error); }
     return [];
  }, []); // Pas de dépendances

  // --- Fonction pour récupérer les détails d'un épisode hors ligne ---
  const getOfflineEpisodeDetails = useCallback(async (filePath: string): Promise<Episode | null> => {
    // ... (code existant avec parseDuration) ...
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
           duration: parseDuration(metadata.duration),
           offline_path: filePath,
           originalMp3Link: metadata.originalMp3Link
         };
       } return null;
     } catch (error) { console.error('Error getting offline episode details:', error); return null; }
  }, []); // Pas de dépendances

  // --- Fonction pour charger l'épisode et sa position ---
  const loadEpisodeAndPosition = useCallback(async (index: number | null) => {
    if (index === null || episodes.length <= index) {
      console.log("[PlayerScreen] Index invalide ou épisodes non chargés, déchargement.");
      await audioManager.unloadSound();
      currentEpisodeIdRef.current = null;
      return;
    }

    const currentEp = episodes[index];
    // Vérifier si l'épisode à charger est déjà celui en cours
    if (currentEpisodeIdRef.current === currentEp.id && (await audioManager.getStatusAsync()).isLoaded) {
        console.log(`[PlayerScreen] Episode ${currentEp.title} est déjà chargé.`);
        // Optionnel: forcer la mise à jour de l'état dans AudioPlayer si nécessaire
        // audioManager.notifyListeners({ type: 'status', ...(await audioManager.getStatusAsync()) });
        return; // Ne pas recharger si c'est le même épisode et qu'il est chargé
    }


    currentEpisodeIdRef.current = currentEp.id;
    // setIsLoadingSound(true); // Supprimé
    setError(null); // Réinitialiser l'erreur avant le chargement
    console.log(`[PlayerScreen] Préparation chargement: ${currentEp.title} (Index: ${index})`);

    try {
      const initialPosition = await getPlaybackPosition(currentEp.id);
      console.log(`[PlayerScreen] Position initiale pour ${currentEp.id}: ${initialPosition}ms`);
      await audioManager.loadSound(currentEp, initialPosition ?? 0);
      console.log(`[PlayerScreen] Chargé avec succès: ${currentEp.title}`);
    } catch (loadError: any) {
      console.error("[PlayerScreen] Erreur chargement épisode:", loadError);
      setError(`Erreur chargement: ${loadError.message || 'Inconnue'}`);
      await audioManager.unloadSound(); // Décharger en cas d'erreur
      currentEpisodeIdRef.current = null; // Réinitialiser l'ID en cas d'erreur
    } finally {
      // setIsLoadingSound(false); // Supprimé
    }
  }, [episodes, getPlaybackPosition]); // Dépend de episodes et getPlaybackPosition

  // --- Effet Principal d'Initialisation et de Chargement ---
  useEffect(() => {
    let isMounted = true;
    setLoading(true); // Indiquer le chargement initial de l'écran

    const initializeAndLoad = async () => {
      try {
        // 1. Configurer le service audio (une seule fois)
        await audioManager.setupAudio();

        // 2. Déterminer la source des épisodes (API ou Cache)
        const networkState = await NetInfo.fetch();
        let fetchedEpisodes: Episode[] = [];

        if (offlinePath) {
          // Priorité au chargement hors ligne si spécifié
          console.log("[PlayerScreen] Chargement épisode hors ligne demandé:", offlinePath);
          const offlineEpisode = await getOfflineEpisodeDetails(offlinePath);
          if (offlineEpisode) {
            fetchedEpisodes = [offlineEpisode];
          } else {
            throw new Error("Impossible de charger les détails de l'épisode hors ligne.");
          }
        } else if (networkState.isConnected) {
          // En ligne: Charger depuis Supabase
          console.log("[PlayerScreen] En ligne, chargement depuis Supabase...");
          const { data, error: apiError } = await supabase
            .from('episodes')
            .select('*')
            .order('publication_date', { ascending: false });

          if (apiError) throw apiError;

          fetchedEpisodes = (data as SupabaseEpisode[]).map(episode => ({
            id: episode.id,
            title: episode.title,
            description: episode.description,
            originalMp3Link: episode.original_mp3_link ?? undefined,
            mp3Link: episode.mp3_link ?? '',
            duration: parseDuration(episode.duration),
            publicationDate: episode.publication_date,
            offline_path: episode.offline_path ?? undefined,
          }));
          // Sauvegarder dans le cache après fetch API réussi
          await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(fetchedEpisodes));
        } else {
          // Hors ligne (et pas d'offlinePath spécifié): Charger depuis le cache
          console.log("[PlayerScreen] Hors ligne, chargement depuis le cache...");
          fetchedEpisodes = await loadCachedEpisodes();
          if (fetchedEpisodes.length === 0) {
            setError("Mode hors ligne et aucun épisode en cache.");
          }
        }

        if (!isMounted) return; // Vérifier si le composant est toujours monté

        // 3. Mettre à jour l'état des épisodes (une seule fois)
        setEpisodes(fetchedEpisodes);

        // 4. Déterminer l'index initial (après que `episodes` soit défini)
        let initialIndex: number | null = null;
        if (fetchedEpisodes.length > 0) {
            if (offlinePath) {
                // Si chargé depuis offlinePath, l'index est 0
                initialIndex = 0;
            } else if (episodeId) {
                // Chercher l'index par ID
                const index = fetchedEpisodes.findIndex(ep => ep.id === episodeId);
                if (index !== -1) {
                    initialIndex = index;
                } else {
                    console.warn(`[PlayerScreen] Episode ID ${episodeId} non trouvé dans la liste chargée.`);
                    // Optionnel: définir sur le premier épisode? Ou afficher une erreur?
                    // initialIndex = 0; // Charger le premier par défaut?
                    setError("L'épisode demandé n'a pas été trouvé.");
                }
            } else {
                // Aucun ID/chemin spécifié, charger le premier épisode par défaut
                initialIndex = 0;
                console.log("[PlayerScreen] Aucun épisode spécifié, chargement du premier.");
            }
        } else {
            console.log("[PlayerScreen] Aucun épisode à charger.");
            // setError("Aucun épisode disponible."); // Géré par le rendu conditionnel
        }

        // 5. Mettre à jour l'index et arrêter le chargement initial
        setCurrentIndex(initialIndex);
        setLoading(false); // Fin du chargement initial de l'écran

      } catch (err: any) {
        if (!isMounted) return;
        console.error('[PlayerScreen] Erreur d\'initialisation:', err);
        setError(`Erreur: ${err.message || 'Inconnue'}`);
        setLoading(false); // Arrêter le chargement même en cas d'erreur
        // Essayer de charger depuis le cache en dernier recours si l'API a échoué
        if (!offlinePath) {
            try {
                const cached = await loadCachedEpisodes();
                if (cached.length > 0) {
                    setEpisodes(cached);
                    // Essayer de trouver l'index dans le cache
                    if (episodeId) {
                        const index = cached.findIndex(ep => ep.id === episodeId);
                        setCurrentIndex(index !== -1 ? index : 0); // Fallback au premier
                    } else {
                        setCurrentIndex(0);
                    }
                    setError("Affichage des données en cache suite à une erreur réseau."); // Info plutôt qu'erreur bloquante
                }
            } catch (cacheErr) {
                // Ignorer l'erreur de cache ici, l'erreur principale est déjà définie
            }
        }
      }
    };

    initializeAndLoad();

    // Nettoyage au démontage
    return () => {
      isMounted = false;
      console.log('[PlayerScreen] Démontage, déchargement audio.');
      // Pas besoin de sauvegarder ici, l'effet AppState s'en charge
      audioManager.unloadSound(); // Décharger le son au démontage
    };
  // Exécuter seulement au montage initial ou si les paramètres de route changent
  }, [episodeId, offlinePath, loadCachedEpisodes, getOfflineEpisodeDetails]);


  // --- Effet pour charger le son quand l'index change ---
  useEffect(() => {
    // Ne charger que si le chargement initial est terminé et qu'on a un index valide
    if (!loading && currentIndex !== null) {
      loadEpisodeAndPosition(currentIndex);
    } else if (!loading && episodes.length > 0 && currentIndex === null) {
        // Cas où les épisodes sont chargés mais aucun index n'a pu être déterminé (ex: ID invalide)
        // On pourrait choisir de charger le premier épisode ici ou laisser l'état tel quel
        console.log("[PlayerScreen] Episodes chargés mais index non défini, chargement du premier.");
        setCurrentIndex(0); // Tentative de charger le premier
        // loadEpisodeAndPosition(0); // Ou appeler directement si setCurrentIndex ne suffit pas
    } else if (!loading && episodes.length === 0) {
        // Cas où aucun épisode n'est disponible après chargement
        audioManager.unloadSound(); // S'assurer que rien n'est chargé
    }
  }, [currentIndex, loading, loadEpisodeAndPosition, episodes.length]); // Ajouter episodes.length pour le cas 0 épisode


  // --- Effet pour sauvegarder en arrière-plan ---
  useEffect(() => {
    const saveOnBackground = async () => {
      const status = await audioManager.getStatusAsync();
      if (status.isLoaded && currentEpisodeIdRef.current) {
        await savePlaybackPosition(currentEpisodeIdRef.current, status.positionMillis, false);
      }
    };

    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (appState.current.match(/active/) && nextAppState.match(/inactive|background/)) {
        console.log('[PlayerScreen] App en arrière-plan, sauvegarde position.');
        saveOnBackground();
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [savePlaybackPosition]); // Dépend de savePlaybackPosition

  // --- Handler pour la fin de lecture ---
  const handlePlaybackComplete = useCallback(async () => {
    // ... (code existant) ...
     console.log('[PlayerScreen] Lecture terminée détectée.');
     if (currentEpisodeIdRef.current) {
       let finalDurationMillis = 0;
       try { finalDurationMillis = (await audioManager.getStatusAsync()).durationMillis; } catch(e) {}
       await savePlaybackPosition(currentEpisodeIdRef.current, finalDurationMillis, true);
       // Optionnel: passer au suivant?
       // handleNext();
     }
  }, [savePlaybackPosition]);

  // --- Fonctions de navigation (Next/Previous) ---
  const handleNext = useCallback(async () => {
    // Sauvegarder la position actuelle d'abord
    const status = await audioManager.getStatusAsync();
    if (status?.isLoaded && currentEpisodeIdRef.current) {
      await savePlaybackPosition(currentEpisodeIdRef.current, status.positionMillis);
    }
    // Passer au suivant
    if (currentIndex !== null && currentIndex < episodes.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else { console.log("Déjà au dernier épisode"); }
  }, [currentIndex, episodes.length, savePlaybackPosition]);

  const handlePrevious = useCallback(async () => {
    // Sauvegarder la position actuelle d'abord
    const status = await audioManager.getStatusAsync();
    if (status?.isLoaded && currentEpisodeIdRef.current) {
      await savePlaybackPosition(currentEpisodeIdRef.current, status.positionMillis);
    }
    // Passer au précédent
    if (currentIndex !== null && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    } else { console.log("Déjà au premier épisode"); }
  }, [currentIndex, savePlaybackPosition]);

  // --- Fonction de Retry ---
  const handleRetryLoad = useCallback(() => {
    console.log("[PlayerScreen] Retrying episode load...");
    if (currentIndex !== null) {
      // Relancer le chargement pour l'index actuel
      loadEpisodeAndPosition(currentIndex);
    } else {
        // Si l'index est null, tenter de relancer l'initialisation complète ?
        // Ou simplement essayer de recharger la liste d'épisodes ?
        // Pour l'instant, on ne fait rien si l'index est null.
        console.warn("[PlayerScreen] Retry impossible, index courant inconnu.");
    }
  }, [currentIndex, loadEpisodeAndPosition]);

  // --- Gérer le bouton back Android ---
  useEffect(() => {
    const backAction = () => {
      // Optionnel: Sauvegarder la position avant de quitter?
      // savePlaybackPosition(...)
      router.back(); // Comportement par défaut: retour
      return true; // Indique qu'on a géré l'événement
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [router]); // Dépend de router

  // --- Rendu JSX ---
  const currentEpisode = !loading && currentIndex !== null && episodes.length > currentIndex ? episodes[currentIndex] : null;

  return (
    <View style={styles.container}>
      {/* Affichage pendant le chargement initial de l'écran */}
      {loading && (
          <View style={styles.centered}>
              <ActivityIndicator size="large" color="#0ea5e9" />
              <Text style={{ color: 'white', marginTop: 10 }}>Chargement...</Text>
          </View>
      )}
      {/* Affichage si erreur majeure pendant l'initialisation */}
      {!loading && error && !currentEpisode && ( // Afficher l'erreur seulement si aucun épisode n'a pu être chargé
           <View style={styles.centered}>
               <Text style={{ color: 'red', marginBottom: 10 }}>{error}</Text>
           </View>
       )}
       {/* Affichage si aucun épisode disponible après chargement */}
       {!loading && !error && episodes.length === 0 && (
           <View style={styles.centered}>
               <Text style={{ color: 'white' }}>Aucun épisode disponible.</Text>
           </View>
       )}

      {/* Afficher le lecteur si le chargement est terminé, pas d'erreur bloquante, et un épisode est prêt */}
      {!loading && currentEpisode && (
        <AudioPlayer
          key={currentEpisode.id} // Clé importante pour forcer le re-rendu si l'épisode change
          episode={currentEpisode}
          onNext={handlePrevious}
          onPrevious={handleNext}
          onRetry={handleRetryLoad} // handleRetryLoad gère maintenant la logique
          onComplete={handlePlaybackComplete}
        />
      )}

      {/* Affichage si chargement terminé mais épisode non trouvé (ex: ID invalide) */}
      {!loading && !error && episodes.length > 0 && !currentEpisode && (
        <View style={styles.centered}>
          <Text style={{ color: 'white' }}>Épisode non trouvé.</Text>
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
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
});