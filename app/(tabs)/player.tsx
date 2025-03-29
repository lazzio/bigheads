import { View, StyleSheet, AppState, Platform } from 'react-native';
import { useEffect, useState, useRef } from 'react';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { useLocalSearchParams } from 'expo-router';
import AudioPlayer from '../../components/AudioPlayer';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import { Episode } from '../../types/episode';

type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];

export default function PlayerScreen() {
  const { episodeId } = useLocalSearchParams<{ episodeId: string }>();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const appStateRef = useRef(AppState.currentState);

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
        // Rechargez l'audio si nécessaire
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (episodeId && episodes.length > 0) {
      const index = episodes.findIndex(ep => ep.id === episodeId);
      if (index !== -1) {
        setCurrentIndex(index);
      }
    }
  }, [episodeId, episodes]);

  async function setupAudio() {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      // Ajout de ces options pour réduire la consommation de batterie
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      playThroughEarpieceAndroid: false, // Utiliser le haut-parleur par défaut
    });
  }

  async function fetchEpisodes() {
    try {
      const { data, error } = await supabase
        .from('episodes')
        .select('*')
        .order('publication_date', { ascending: false });

      if (error) throw error;

      const formattedEpisodes: Episode[] = (data as SupabaseEpisode[]).map(episode => ({
        id: episode.id,
        title: episode.title,
        description: episode.description,
        originalMp3Link: episode.originalMp3Link,
        mp3Link: episode.mp3Link,
        duration: episode.duration,
        publicationDate: episode.publicationDate
      }));

      setEpisodes(formattedEpisodes);
    } catch (err) {
      console.error('Error fetching episodes:', err);
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

  if (loading || episodes.length === 0) {
    return null;
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