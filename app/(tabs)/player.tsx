import { View, Text, StyleSheet, AppState, Platform, BackHandler } from 'react-native';
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

// Constante pour la clé de cache
const EPISODES_CACHE_KEY = 'cached_episodes';

export default function PlayerScreen() {
  const { episodeId, offlinePath } = useLocalSearchParams<{ episodeId: string, offlinePath: string }>();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const router = useRouter();

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

  const handleNext = () => {
    const nextIndex = (currentIndex + 1) % episodes.length;
    setCurrentIndex(nextIndex);
  };

  const handlePrevious = () => {
    const prevIndex = (currentIndex - 1 + episodes.length) % episodes.length;
    setCurrentIndex(prevIndex);
  };

  // Affichage d'état de chargement
  if (loading) {
    return (
      <View style={[styles.container, {alignItems: 'center', justifyContent: 'center'}]}>
        <Text style={{color: 'white'}}>Chargement du lecteur...</Text>
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
  const currentEpisode = episodes[currentIndex];
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
        onNext={handlePrevious}
        onPrevious={handleNext}
        onComplete={() => markEpisodeAsWatched(currentEpisode.id)}
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