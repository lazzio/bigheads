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
        .order('created_at', { ascending: true });

      if (error) throw error;

      const formattedEpisodes: Episode[] = (data as SupabaseEpisode[]).map(episode => ({
        id: episode.id,
        title: episode.title,
        description: episode.description,
        originalMp3Link: episode.originalMp3Link,
        mp3Link: episode.mp3Link,
        duration: episode.duration
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
              <Text style={styles.episodeDescription} numberOfLines={2}>
                {item.description}
              </Text>
              <Text style={styles.episodeDuration}>{item.duration}</Text>
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
  episodeDescription: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
  },
  episodeDuration: {
    fontSize: 12,
    color: '#666',
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