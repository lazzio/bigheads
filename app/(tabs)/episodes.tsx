import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Play, CircleCheck as CheckCircle2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import { Episode } from '../../types/episode';

type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];
type WatchedEpisode = Database['public']['Tables']['watched_episodes']['Row'];

export default function EpisodesScreen() {
  const router = useRouter();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEpisodes();
    fetchWatchedEpisodes();
  }, []);

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
      setError(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  }

  async function fetchWatchedEpisodes() {
    try {
      const { data, error } = await supabase
        .from('watched_episodes')
        .select('episode_id');

      if (error) throw error;

      const watchedIds = new Set((data as WatchedEpisode[]).map(we => we.episode_id));
      setWatchedEpisodes(watchedIds);
    } catch (err) {
      console.error('Error fetching watched episodes:', err);
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Chargement des épisodes...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Episodes</Text>
      <FlatList
        data={episodes}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <TouchableOpacity
            style={styles.episodeItem}
            onPress={() => {
              router.push({
                pathname: '/player',
                params: { episodeIndex: index }
              });
            }}
          >
            <View style={styles.episodeInfo}>
              <Text style={styles.episodeTitle}>{item.title}</Text>
              <Text style={styles.episodeDate}>
                {formatDate(item.publicationDate)}
              </Text>
            </View>
            {watchedEpisodes.has(item.id) ? (
              <CheckCircle2 size={24} color="#0ea5e9" />
            ) : (
              <Play size={24} color="#fff" />
            )}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    padding: 20,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
  },
  episodeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    marginBottom: 10,
  },
  episodeInfo: {
    flex: 1,
  },
  episodeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  episodeDate: {
    fontSize: 14,
    color: '#888',
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
  errorText: {
    color: '#ff4444',
    fontSize: 16,
    textAlign: 'center',
  },
});