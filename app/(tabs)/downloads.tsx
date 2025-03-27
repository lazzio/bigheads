import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { supabase } from '../../lib/supabase';
import { Download, Trash2, Play } from 'lucide-react-native';
import * as FileSystem from 'expo-file-system';
import { useRouter } from 'expo-router';
import { Episode } from '../../types/episode';

type DownloadStatus = {
  [key: string]: {
    progress: number;
    downloading: boolean;
    downloaded: boolean;
  };
};

export default function DownloadsScreen() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({});
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetchEpisodes();
    checkDownloadedEpisodes();
  }, []);

  // Weekly file cleanup
  useEffect(() => {
    const cleanupInterval = setInterval(cleanupOldDownloads, 7 * 24 * 60 * 60 * 1000); // 7 days
    return () => clearInterval(cleanupInterval);
  }, []);

  async function fetchEpisodes() {
    try {
      const { data, error } = await supabase
        .from('episodes')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;

      setEpisodes(data as Episode[]);
    } catch (err) {
      setError('Erreur lors du chargement des épisodes');
      console.error('Error fetching episodes:', err);
    }
  }

  async function checkDownloadedEpisodes() {
    if (Platform.OS === 'web') return;

    const downloads = await FileSystem.readDirectoryAsync(
      FileSystem.documentDirectory + 'downloads/'
    ).catch(() => [] as string[]);

    const status: DownloadStatus = {};
    episodes.forEach(episode => {
      const filename = getFilename(episode.mp3Link);
      status[episode.id] = {
        progress: 0,
        downloading: false,
        downloaded: downloads.includes(filename)
      };
    });

    setDownloadStatus(status);
  }

  function getFilename(url: string): string {
    return url.split('/').pop() || 'episode.mp3';
  }

  async function downloadEpisode(episode: Episode) {
    if (Platform.OS === 'web') {
      window.open(episode.mp3Link, '_blank');
      return;
    }

    try {
      const filename = getFilename(episode.mp3Link);
      const downloadDir = FileSystem.documentDirectory + 'downloads/';
      const fileUri = downloadDir + filename;

      // Create downloads folder if it doesn't exist
      await FileSystem.makeDirectoryAsync(downloadDir, { intermediates: true })
        .catch(() => {});

      // Update download status
      setDownloadStatus(prev => ({
        ...prev,
        [episode.id]: {
          progress: 0,
          downloading: true,
          downloaded: false
        }
      }));

      const downloadResumable = FileSystem.createDownloadResumable(
        episode.mp3Link,
        fileUri,
        {},
        (downloadProgress) => {
          const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
          setDownloadStatus(prev => ({
            ...prev,
            [episode.id]: {
              ...prev[episode.id],
              progress: progress
            }
          }));
        }
      );

      const result = await downloadResumable.downloadAsync();
      
      if (result) {
        const { uri } = result;
        // Save download date
        await FileSystem.writeAsStringAsync(
          fileUri + '.meta',
          JSON.stringify({ downloadDate: new Date().toISOString() })
        );

        setDownloadStatus(prev => ({
          ...prev,
          [episode.id]: {
            progress: 1,
            downloading: false,
            downloaded: true
          }
        }));
      }
    } catch (err) {
      console.error('Error downloading episode:', err);
      setError('Erreur lors du téléchargement');
      
      setDownloadStatus(prev => ({
        ...prev,
        [episode.id]: {
          progress: 0,
          downloading: false,
          downloaded: false
        }
      }));
    }
  }

  async function deleteDownload(episode: Episode) {
    if (Platform.OS === 'web') return;

    try {
      const filename = getFilename(episode.mp3Link);
      const fileUri = FileSystem.documentDirectory + 'downloads/' + filename;
      
      await FileSystem.deleteAsync(fileUri);
      await FileSystem.deleteAsync(fileUri + '.meta').catch(() => {});

      setDownloadStatus(prev => ({
        ...prev,
        [episode.id]: {
          progress: 0,
          downloading: false,
          downloaded: false
        }
      }));
    } catch (err) {
      console.error('Error deleting episode:', err);
      setError('Erreur lors de la suppression');
    }
  }

  async function cleanupOldDownloads() {
    if (Platform.OS === 'web') return;

    try {
      const downloadDir = FileSystem.documentDirectory + 'downloads/';
      const files = await FileSystem.readDirectoryAsync(downloadDir);

      for (const file of files) {
        if (!file.endsWith('.meta')) continue;

        const metaContent = await FileSystem.readAsStringAsync(downloadDir + file);
        const meta = JSON.parse(metaContent);
        const downloadDate = new Date(meta.downloadDate);
        const now = new Date();
        const diffDays = (now.getTime() - downloadDate.getTime()) / (1000 * 60 * 60 * 24);

        if (diffDays > 7) {
          const audioFile = file.replace('.meta', '');
          await FileSystem.deleteAsync(downloadDir + audioFile);
          await FileSystem.deleteAsync(downloadDir + file);
        }
      }

      // Update download statuses
      checkDownloadedEpisodes();
    } catch (err) {
      console.error('Error cleaning up downloads:', err);
    }
  }

  function playEpisode(episodeIndex: number) {
    router.push({
      pathname: '/player',
      params: { episodeIndex }
    });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Téléchargements</Text>
      
      {error && (
        <Text style={styles.error}>{error}</Text>
      )}

      {episodes.map((episode, index) => (
        <View key={episode.id} style={styles.episodeCard}>
          <View style={styles.episodeInfo}>
            <Text style={styles.episodeTitle}>{episode.title}</Text>
            
            {Platform.OS !== 'web' && downloadStatus[episode.id]?.downloading && (
              <View style={styles.progressBar}>
                <View 
                  style={[
                    styles.progressFill,
                    { width: `${downloadStatus[episode.id]?.progress * 100}%` }
                  ]} 
                />
              </View>
            )}
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => playEpisode(index)}
            >
              <Play size={20} color="#fff" />
            </TouchableOpacity>

            {Platform.OS !== 'web' && downloadStatus[episode.id]?.downloaded ? (
              <TouchableOpacity
                style={[styles.actionButton, styles.deleteButton]}
                onPress={() => deleteDownload(episode)}
              >
                <Trash2 size={20} color="#fff" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.actionButton, styles.downloadButton]}
                onPress={() => downloadEpisode(episode)}
                disabled={downloadStatus[episode.id]?.downloading}
              >
                <Download size={20} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
  },
  error: {
    color: '#ef4444',
    marginBottom: 10,
  },
  episodeCard: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 15,
    marginBottom: 10,
    alignItems: 'center',
  },
  episodeInfo: {
    flex: 1,
    marginRight: 10,
  },
  episodeTitle: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 5,
  },
  progressBar: {
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#0ea5e9',
    borderRadius: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#333',
  },
  downloadButton: {
    backgroundColor: '#0ea5e9',
  },
  deleteButton: {
    backgroundColor: '#ef4444',
  },
});