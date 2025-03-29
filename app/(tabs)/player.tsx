import { View, Text, StyleSheet, AppState, Platform, BackHandler } from 'react-native';
import { useEffect, useState, useRef } from 'react';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AudioPlayer from '../../components/AudioPlayer';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import { Episode } from '../../types/episode';
import { setupOptimalAudioMode } from '../../utils/audioUtils';

type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];

export default function PlayerScreen() {
  const { episodeId } = useLocalSearchParams<{ episodeId: string }>();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const router = useRouter();

  useEffect(() => {
    setupAudio();
    fetchEpisodes();

    // Gérer les changements d'état de l'application
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appStateRef.current === 'active' && nextAppState.match(/inactive|background/)) {
        // App passe en arrière-plan
        console.log('App is going to background');
      } else if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        // App revient au premier plan
        console.log('App is coming to foreground');
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
      subscription.remove();
      backHandler.remove();
    };
  }, [router]);

  useEffect(() => {
    if (episodeId && episodes.length > 0) {
      const index = episodes.findIndex(ep => ep.id === episodeId);
      if (index !== -1) {
        setCurrentIndex(index);
      }
    }
  }, [episodeId, episodes]);

  async function setupAudio() {
    try {
      console.log("Setting up audio mode in PlayerScreen");
      // Utiliser la fonction utilitaire pour configurer l'audio de manière cohérente
      await setupOptimalAudioMode();
    } catch (err) {
      console.error("Error setting audio mode:", err);
    }
  }

  async function fetchEpisodes() {
    try {
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
      
      // Vérification des épisodes
      if (validEpisodes.length > 0) {
        const firstEpisode = validEpisodes[0];
        console.log("Premier épisode:", {
          id: firstEpisode.id,
          title: firstEpisode.title,
          mp3Link: firstEpisode.mp3Link ? (firstEpisode.mp3Link.substring(0, 50) + '...') : 'manquant'
        });
      }

      setEpisodes(validEpisodes);
    } catch (err) {
      console.error('Error fetching episodes:', err);
      setError('Erreur lors du chargement des épisodes');
    } finally {
      setLoading(false);
    }
  }

  async function markEpisodeAsWatched(episodeId: string) {
    try {
      const { error } = await supabase
        .from('watched_episodes')
        .upsert({ 
          episode_id: episodeId,
          user_id: (await supabase.auth.getUser()).data.user?.id
        });

      if (error) throw error;
    } catch (err) {
      console.error('Error marking episode as watched:', err);
    }
  }

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % episodes.length);
  };

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev - 1 + episodes.length) % episodes.length);
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
      </View>
    );
  }

  // Vérifier si l'épisode courant est valide
  if (!episodes[currentIndex] || !episodes[currentIndex].mp3Link) {
    return (
      <View style={[styles.container, {alignItems: 'center', justifyContent: 'center'}]}>
        <Text style={{color: 'white'}}>Problème avec l'épisode actuel</Text>
        <Text style={{color: '#999', marginTop: 10}}>
          {!episodes[currentIndex] ? "Épisode introuvable" : "Lien audio manquant"}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AudioPlayer
        episode={episodes[currentIndex]}
        onNext={handleNext}
        onPrevious={handlePrevious}
        onComplete={() => markEpisodeAsWatched(episodes[currentIndex].id)}
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
});