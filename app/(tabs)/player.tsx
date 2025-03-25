import { View, StyleSheet } from 'react-native';
import { useEffect, useState } from 'react';
import { Audio } from 'expo-av';
import { useLocalSearchParams } from 'expo-router';
import AudioPlayer from '../../components/AudioPlayer';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import { Episode } from '../../types/episode';

type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];

export default function PlayerScreen() {
  const { episodeIndex } = useLocalSearchParams<{ episodeIndex: string }>();
  const [currentIndex, setCurrentIndex] = useState(episodeIndex ? parseInt(episodeIndex) : 0);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setupAudio();
    fetchEpisodes();
  }, []);

  async function setupAudio() {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
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
        audioUrl: episode.audio_url,
        publicationDate: episode.publication_date,
        source: episode.source,
        sourceUrl: episode.source_url
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