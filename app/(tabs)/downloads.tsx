import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ScrollView, Alert } from 'react-native';
import { supabase } from '../../lib/supabase';
import { Download, Trash2, Play, Trash } from 'lucide-react-native';
import * as FileSystem from 'expo-file-system';
import { useRouter } from 'expo-router';
import { Episode } from '../../types/episode';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

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
  }, []);

  useEffect(() => {
    if (episodes.length > 0) {
      checkDownloadedEpisodes();
    }
  }, [episodes]);

  useEffect(() => {
    const cleanupInterval = setInterval(cleanupOldDownloads, 7 * 24 * 60 * 60 * 1000);
    return () => clearInterval(cleanupInterval);
  }, []);

  async function fetchEpisodes() {
    try {
      const { data, error } = await supabase
        .from('episodes')
        .select('*')
        .order('publication_date', { ascending: false });

      if (error) throw error;

      setEpisodes(data as Episode[]);
    } catch (err) {
      setError('Erreur lors du chargement des épisodes');
      console.error('Error fetching episodes:', err);
    }
  }

  async function checkDownloadedEpisodes() {
    if (Platform.OS === 'web') return;

    try {
      const downloadDir = FileSystem.documentDirectory + 'downloads/';
      await FileSystem.makeDirectoryAsync(downloadDir, { intermediates: true })
        .catch(() => {});

      const downloads = await FileSystem.readDirectoryAsync(downloadDir)
        .catch(() => [] as string[]);

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
    } catch (err) {
      console.error('Error checking downloaded episodes:', err);
    }
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
      setError(null);
      const filename = getFilename(episode.mp3Link);
      const downloadDir = FileSystem.documentDirectory + 'downloads/';
      const fileUri = downloadDir + filename;

      await FileSystem.makeDirectoryAsync(downloadDir, { intermediates: true })
        .catch(() => {});

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
          if (!downloadProgress.totalBytesExpectedToWrite) return;
          
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

      const { uri } = await downloadResumable.downloadAsync();
      
      if (uri) {
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
      setError(null);
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

  async function deleteAllDownloads() {
    if (Platform.OS === 'web') return;

    try {
      const downloadDir = FileSystem.documentDirectory + 'downloads/';
      await FileSystem.deleteAsync(downloadDir);
      await FileSystem.makeDirectoryAsync(downloadDir, { intermediates: true });

      const newStatus: DownloadStatus = {};
      episodes.forEach(episode => {
        newStatus[episode.id] = {
          progress: 0,
          downloading: false,
          downloaded: false
        };
      });
      setDownloadStatus(newStatus);
    } catch (err) {
      console.error('Error deleting all downloads:', err);
      setError('Erreur lors de la suppression des téléchargements');
    }
  }

  function confirmDeleteAll() {
    Alert.alert(
      'Supprimer tous les téléchargements',
      'Êtes-vous sûr de vouloir supprimer tous les épisodes téléchargés ?',
      [
        {
          text: 'Annuler',
          style: 'cancel'
        },
        {
          text: 'Supprimer',
          onPress: deleteAllDownloads,
          style: 'destructive'
        }
      ]
    );
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

  function ProgressCircle({ progress }: { progress: number }) {
    const radius = 12;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference * (1 - progress);

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [{ rotate: '0deg' }] // Use supported property
    }));

    // Calculate stroke-dashoffset for the circle directly in render
    const dashOffset = progress ? circumference * (1 - progress) : circumference;

    return (
      <View style={styles.progressCircleContainer}>
        <Animated.View style={[styles.progressCircle, animatedStyle]}>
          <svg width={radius * 2 + 4} height={radius * 2 + 4}>
            <circle
              cx={radius + 2}
              cy={radius + 2}
              r={radius}
              stroke="#0ea5e9"
              strokeWidth="2"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${radius + 2} ${radius + 2})`}
            />
          </svg>
        </Animated.View>
        <Download size={16} color="#fff" style={styles.progressIcon} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Téléchargements</Text>
        {Platform.OS !== 'web' && (
          <TouchableOpacity
            style={styles.deleteAllButton}
            onPress={confirmDeleteAll}
          >
            <Trash size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
      
      {error && (
        <Text style={styles.error}>{error}</Text>
      )}

      <ScrollView style={styles.scrollView}>
        {episodes.map((episode, index) => (
          <View key={episode.id} style={styles.episodeCard}>
            <View style={styles.episodeInfo}>
              <Text style={styles.episodeTitle}>{episode.title}</Text>
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
                  {downloadStatus[episode.id]?.downloading ? (
                    <ProgressCircle progress={downloadStatus[episode.id]?.progress || 0} />
                  ) : (
                    <Download size={20} color="#fff" />
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  deleteAllButton: {
    padding: 8,
    backgroundColor: '#ef4444',
    borderRadius: 8,
  },
  scrollView: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  error: {
    color: '#ef4444',
    marginHorizontal: 20,
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
  progressCircleContainer: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressCircle: {
    position: 'absolute',
  },
  progressIcon: {
    position: 'absolute',
  },
});