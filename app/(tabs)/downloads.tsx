import { useEffect, useState, useCallback, useMemo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Platform, 
  ScrollView, 
  Alert, 
  ActivityIndicator 
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { Download, Trash2, Play, Trash } from 'lucide-react-native';
import * as FileSystem from 'expo-file-system';
import { useRouter } from 'expo-router';
import { Episode } from '../../types/episode';
import { Circle } from 'react-native-svg';
import Svg from 'react-native-svg';
import Animated, { 
  useAnimatedStyle, 
  useSharedValue, 
  withTiming 
} from 'react-native-reanimated';
import * as Sentry from '@sentry/react-native';

// Types
interface DownloadStatus {
  [key: string]: {
    progress: number;
    downloading: boolean;
    downloaded: boolean;
    filePath?: string;
  };
}

// Constants
const DOWNLOADS_DIR = FileSystem.documentDirectory + 'downloads/';
const CLEANUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_DOWNLOAD_AGE_DAYS = 7;

export default function DownloadsScreen() {
  // State
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // Hooks
  const router = useRouter();

  // Derived state
  const hasDownloadedEpisodes = useMemo(() => {
    return Object.values(downloadStatus).some(status => status.downloaded);
  }, [downloadStatus]);

  // Initialize
  useEffect(() => {
    if (Platform.OS === 'web') {
      setIsLoading(false);
      return;
    }
    
    async function initialize() {
      try {
        // Ensure downloads directory exists - ignorer les erreurs
        try {
          await ensureDownloadsDirectory();
        } catch (dirErr) {
          console.warn('Problème avec le répertoire de téléchargements:', dirErr);
          // Continuer malgré l'erreur
        }
        
        // Load episodes
        await fetchEpisodes();
        
        // Ne pas afficher d'erreur initiale
        setError(null);

        // Set up cleanup interval
        const cleanupInterval = setInterval(() => {
          cleanupOldDownloads().catch(err => {
            console.warn('Erreur lors du nettoyage automatique:', err);
          });
        }, CLEANUP_INTERVAL_MS);
        
        return () => clearInterval(cleanupInterval);
      } catch (err) {
        console.error('Erreur critique lors de l\'initialisation:', err);
        // N'afficher une erreur à l'utilisateur que si c'est critique
        if (err instanceof Error && err.message.includes('critical')) {
          setError('Erreur lors du chargement des épisodes');
        }
      } finally {
        // Toujours terminer le chargement
        setIsLoading(false);
      }
    }
    
    initialize();
  }, []);

  // Check downloaded episodes when episodes change
  useEffect(() => {
    if (episodes.length > 0 && Platform.OS !== 'web') {
      checkDownloadedEpisodes().catch(err => {
        // Ignorer les erreurs de vérification des téléchargements pendant l'initialisation
        console.warn('Erreur ignorée lors de la vérification des téléchargements:', err);
      });
    }
  }, [episodes]);

  // File system helpers
  const ensureDownloadsDirectory = async () => {
    if (Platform.OS === 'web') return;
    
    try {
      const dirInfo = await FileSystem.getInfoAsync(DOWNLOADS_DIR);
      
      if (!dirInfo.exists) {
        try {
          await FileSystem.makeDirectoryAsync(DOWNLOADS_DIR, { intermediates: true });
        } catch (mkdirErr) {
          console.warn('Erreur lors de la création du répertoire, tentative alternative...', mkdirErr);
          
          // Essayer de créer le répertoire parent
          const parentDir = DOWNLOADS_DIR.split('/').slice(0, -2).join('/') + '/';
          await FileSystem.makeDirectoryAsync(parentDir, { intermediates: true });
          
          // Puis réessayer le répertoire de téléchargements
          await FileSystem.makeDirectoryAsync(DOWNLOADS_DIR, { intermediates: true });
        }
      }
      
      return true;
    } catch (err) {
      console.error(`Impossible de créer le dossier de téléchargements:`, err);
      // Ne pas planter l'application, retourner false pour indiquer l'échec
      return false;
    }
  };

  const getFilename = (url: string | undefined): string => {
    if (!url) return `episode-${Date.now()}.mp3`;
    return url.split('/').pop() || `episode-${Date.now()}.mp3`;
  };

  const getFilePath = (episode: Episode): string => {
    const filename = getFilename(episode?.mp3Link);
    return DOWNLOADS_DIR + filename;
  };

  // Data loading functions
  const fetchEpisodes = async () => {
    setIsLoading(true);
    try {
      const { data, error: apiError } = await supabase
        .from('episodes')
        .select('*')
        .order('publication_date', { ascending: false });

      if (apiError) throw apiError;

      setEpisodes(data as Episode[]);
    } catch (err) {
      handleError(err, 'Erreur lors du chargement des épisodes');
    } finally {
      setIsLoading(false);
    }
  };

  const checkDownloadedEpisodes = async () => {
    if (Platform.OS === 'web') return;

    try {
      // Essayer de créer le répertoire, mais continuer même en cas d'échec
      const dirCreated = await ensureDownloadsDirectory();
      let files: string[] = [];
      
      // Ne tenter de lire le répertoire que s'il a été créé avec succès
      if (dirCreated) {
        try {
          files = await FileSystem.readDirectoryAsync(DOWNLOADS_DIR);
        } catch (readError) {
          console.warn('Impossible de lire le répertoire de téléchargements:', readError);
          // Continuer avec une liste vide de fichiers
        }
      }
      
      // Initialize status for all episodes
      const newStatus: DownloadStatus = { ...downloadStatus };
      
      // Update status for each episode
      for (const episode of episodes) {
        // Skip episodes without mp3Link
        if (!episode?.mp3Link) {
          console.warn(`Episode ${episode?.id || 'unknown'} does not have an mp3Link`);
          continue;
        }
        
        const filename = getFilename(episode.mp3Link);
        const isDownloaded = files.includes(filename);
        const filePath = isDownloaded ? DOWNLOADS_DIR + filename : undefined;
        
        newStatus[episode.id] = {
          ...newStatus[episode.id],
          progress: isDownloaded ? 1 : 0,
          downloading: newStatus[episode.id]?.downloading || false,
          downloaded: isDownloaded,
          filePath
        };
      }
      
      setDownloadStatus(newStatus);
    } catch (err) {
      console.warn('Erreur lors de la vérification des téléchargements:', err);
      // Ne pas afficher d'erreur à l'utilisateur, juste logger
    }
  };

  // Download management
  const downloadEpisode = async (episode: Episode) => {
    // Vérifier si l'épisode a un lien mp3 valide
    if (!episode?.mp3Link) {
      setError('Lien de téléchargement non disponible pour cet épisode');
      return;
    }
    
    if (Platform.OS === 'web') {
      window.open(episode.mp3Link, '_blank');
      return;
    }

    try {
      setError(null);
      await ensureDownloadsDirectory();
      
      const filename = getFilename(episode.mp3Link);
      const fileUri = DOWNLOADS_DIR + filename;

      // Update status to downloading
      setDownloadStatus(prev => ({
        ...prev,
        [episode.id]: {
          progress: 0,
          downloading: true,
          downloaded: false,
          filePath: fileUri
        }
      }));

      // Create download resumable
      const downloadResumable = FileSystem.createDownloadResumable(
        episode.mp3Link,
        fileUri,
        {},
        (downloadProgress) => {
          if (!downloadProgress.totalBytesExpectedToWrite) return;
          
          const progress = downloadProgress.totalBytesWritten / 
                          downloadProgress.totalBytesExpectedToWrite;
          
          setDownloadStatus(prev => ({
            ...prev,
            [episode.id]: {
              ...prev[episode.id],
              progress: progress
            }
          }));
        }
      );

      // Start download
      const result = await downloadResumable.downloadAsync();
      
      if (result?.uri) {
        // Save metadata
        const metadataUri = fileUri + '.meta';
        const metadata = {
          id: episode.id,
          title: episode.title,
          downloadDate: new Date().toISOString()
        };
        
        await FileSystem.writeAsStringAsync(
          metadataUri,
          JSON.stringify(metadata)
        );

        // Update status to downloaded
        setDownloadStatus(prev => ({
          ...prev,
          [episode.id]: {
            progress: 1,
            downloading: false,
            downloaded: true,
            filePath: result.uri
          }
        }));
      } else {
        throw new Error('Le téléchargement a échoué');
      }
    } catch (err) {
      handleDownloadError(err, episode);
    }
  };

  const handleDownloadError = (err: unknown, episode: Episode) => {
    console.error('Erreur de téléchargement:', err);
    
    let errorMessage = 'Erreur lors du téléchargement';
    
    if (err instanceof Error) {
      if (err.message.includes('ENOSPC')) {
        errorMessage = 'Espace de stockage insuffisant';
      } else if (err.message.includes('ENOENT')) {
        errorMessage = 'Impossible d\'accéder au stockage';
      } else if (err.message.includes('network')) {
        errorMessage = 'Erreur réseau';
      }
    }
    
    setError(errorMessage);
    
    // Reset download status
    setDownloadStatus(prev => ({
      ...prev,
      [episode.id]: {
        progress: 0,
        downloading: false,
        downloaded: false
      }
    }));
    
    // Log to Sentry if available
    if (typeof Sentry !== 'undefined') {
      Sentry.captureException(err);
    }
  };

  const deleteDownload = async (episode: Episode) => {
    if (Platform.OS === 'web') return;

    try {
      setError(null);
      const filePath = getFilePath(episode);
      const metadataPath = filePath + '.meta';
      
      // Delete file and metadata
      await Promise.all([
        FileSystem.deleteAsync(filePath, { idempotent: true }),
        FileSystem.deleteAsync(metadataPath, { idempotent: true }).catch(() => {})
      ]);

      // Update status
      setDownloadStatus(prev => ({
        ...prev,
        [episode.id]: {
          progress: 0,
          downloading: false,
          downloaded: false,
          filePath: undefined
        }
      }));
    } catch (err) {
      handleError(err, 'Erreur lors de la suppression');
    }
  };

  const deleteAllDownloads = async () => {
    if (Platform.OS === 'web') return;

    try {
      setError(null);
      
      // Delete and recreate downloads directory
      await FileSystem.deleteAsync(DOWNLOADS_DIR, { idempotent: true });
      await ensureDownloadsDirectory();

      // Reset all download statuses
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
      handleError(err, 'Erreur lors de la suppression des téléchargements');
    }
  };

  const cleanupOldDownloads = async () => {
    if (Platform.OS === 'web') return;

    try {
      await ensureDownloadsDirectory();
      
      const files = await FileSystem.readDirectoryAsync(DOWNLOADS_DIR);
      const metaFiles = files.filter(file => file.endsWith('.meta'));
      const now = new Date();
      
      for (const metaFile of metaFiles) {
        try {
          const metaPath = DOWNLOADS_DIR + metaFile;
          const metaContent = await FileSystem.readAsStringAsync(metaPath);
          const meta = JSON.parse(metaContent);
          
          if (!meta.downloadDate) continue;
          
          const downloadDate = new Date(meta.downloadDate);
          const diffDays = (now.getTime() - downloadDate.getTime()) / (1000 * 60 * 60 * 24);
          
          if (diffDays > MAX_DOWNLOAD_AGE_DAYS) {
            const audioFile = metaFile.replace('.meta', '');
            await FileSystem.deleteAsync(DOWNLOADS_DIR + audioFile, { idempotent: true });
            await FileSystem.deleteAsync(metaPath, { idempotent: true });
          }
        } catch (metaErr) {
          console.warn('Erreur lors du traitement du fichier méta:', metaFile, metaErr);
        }
      }
      
      // Refresh status
      await checkDownloadedEpisodes();
    } catch (err) {
      console.error('Erreur lors du nettoyage des téléchargements:', err);
    }
  };

  // UI helpers
  const confirmDeleteAll = useCallback(() => {
    if (!hasDownloadedEpisodes) {
      setError('Aucun épisode téléchargé à supprimer');
      return;
    }
    
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
  }, [hasDownloadedEpisodes]);

  const playEpisode = useCallback((episodeIndex: number) => {
    router.push({
      pathname: '/player',
      params: { episodeIndex }
    });
  }, [router]);

  const handleError = (err: any, message: string) => {
    console.error(`${message}:`, err);
    
    // Ne pas afficher d'erreurs pour des problèmes mineurs d'initialisation
    if (message.includes('vérification des téléchargements') || 
        message.includes('initialisation')) {
      // Juste logger sans afficher à l'utilisateur
      console.warn('Erreur silencieuse:', message);
    } else {
      setError(message);
    }
    
    // Log to Sentry if available
    if (typeof Sentry !== 'undefined') {
      Sentry.captureException(err);
    }
  };

  // Components
  const ProgressCircle = ({ progress }: { progress: number }) => {
    const radius = 12;
    const circumference = 2 * Math.PI * radius;
    const animatedProgress = useSharedValue(0);
    
    useEffect(() => {
      animatedProgress.value = withTiming(progress, { duration: 300 });
    }, [progress]);
    
    const animatedStyle = useAnimatedStyle(() => {
      const strokeDashoffset = circumference * (1 - animatedProgress.value);
      return {
        transform: [{ rotate: '-90deg' }],
        strokeDashoffset,
      };
    });

    return (
      <View style={styles.progressCircleContainer}>
        <Svg width={radius * 2 + 4} height={radius * 2 + 4}>
          {/* Background circle */}
          <Circle
            cx={radius + 2}
            cy={radius + 2}
            r={radius}
            stroke="#333333"
            strokeWidth="2"
            fill="none"
          />
          
          {/* Progress circle */}
          <Animated.View style={animatedStyle}>
            <Svg width={radius * 2 + 4} height={radius * 2 + 4}>
              <Circle
                cx={radius + 2}
                cy={radius + 2}
                r={radius}
                stroke="#0ea5e9"
                strokeWidth="2"
                fill="none"
                strokeDasharray={circumference}
                strokeLinecap="round"
              />
            </Svg>
          </Animated.View>
        </Svg>
        
        {/* Center icon or percentage */}
        <View style={styles.progressIcon}>
          <Text style={styles.progressText}>
            {Math.round(progress * 100)}%
          </Text>
        </View>
      </View>
    );
  };

  const NoEpisodesMessage = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>Aucun épisode disponible</Text>
    </View>
  );

  // Render
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0ea5e9" />
        <Text style={styles.loadingText}>Chargement des épisodes...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Téléchargements</Text>
        {Platform.OS !== 'web' && hasDownloadedEpisodes && (
          <TouchableOpacity
            style={styles.deleteAllButton}
            onPress={confirmDeleteAll}
          >
            <Trash size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
      
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={episodes.length === 0 ? styles.scrollViewEmpty : undefined}
      >
        {episodes.length === 0 ? (
          <NoEpisodesMessage />
        ) : (
          episodes.map((episode, index) => (
            <View key={episode.id} style={styles.episodeCard}>
              <View style={styles.episodeInfo}>
                <Text style={styles.episodeTitle}>{episode.title}</Text>
                {episode.publicationDate && (
                  <Text style={styles.episodeDate}>
                    {new Date(episode.publicationDate).toLocaleDateString()}
                  </Text>
                )}
              </View>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => playEpisode(index)}
                >
                  <Play size={20} color="#fff" />
                </TouchableOpacity>

                {Platform.OS !== 'web' ? (
                  downloadStatus[episode.id]?.downloaded ? (
                    <TouchableOpacity
                      style={[styles.actionButton, styles.deleteButton]}
                      onPress={() => deleteDownload(episode)}
                    >
                      <Trash2 size={20} color="#fff" />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[
                        styles.actionButton, 
                        styles.downloadButton,
                        downloadStatus[episode.id]?.downloading && styles.downloadingButton
                      ]}
                      onPress={() => downloadEpisode(episode)}
                      disabled={downloadStatus[episode.id]?.downloading}
                    >
                      {downloadStatus[episode.id]?.downloading ? (
                        <ProgressCircle progress={downloadStatus[episode.id]?.progress || 0} />
                      ) : (
                        <Download size={20} color="#fff" />
                      )}
                    </TouchableOpacity>
                  )
                ) : (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.downloadButton]}
                    onPress={() => downloadEpisode(episode)}
                  >
                    <Download size={20} color="#fff" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#121212',
  },
  loadingText: {
    color: '#fff',
    marginTop: 16,
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
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
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
  scrollViewEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#ef4444',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
  },
  episodeCard: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 15,
    marginBottom: 12,
    alignItems: 'center',
  },
  episodeInfo: {
    flex: 1,
    marginRight: 10,
  },
  episodeTitle: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 4,
  },
  episodeDate: {
    fontSize: 12,
    color: '#888',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  downloadButton: {
    backgroundColor: '#0ea5e9',
  },
  downloadingButton: {
    backgroundColor: '#1d4ed8',
  },
  deleteButton: {
    backgroundColor: '#ef4444',
  },
  progressCircleContainer: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressIcon: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: 'bold',
  },
});