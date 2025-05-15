import React, { useEffect, useState, useRef, useCallback } from 'react';
import { 
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  FlatList,
  Alert,
  RefreshControl
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../../lib/supabase';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import * as FileSystem from 'expo-file-system';
import { useRouter } from 'expo-router';
import { Episode } from '../../types/episode';
import Svg, { Circle } from 'react-native-svg';
import { loadCachedEpisodes, saveEpisodesToCache, EPISODES_CACHE_KEY } from '../../utils/cache/LocalStorageService';
import { theme } from '../../styles/global';
import { componentStyle, episodeStyle } from '../../styles/componentStyle';
import { getUserAvatarUrl } from '../../lib/user';
import { Image } from 'expo-image';
import { normalizeEpisodes } from '../../utils/commons/episodeUtils';
import { getFilename, ensureDownloadsDirectory } from '../../utils/commons/fileUtils';
import { ErrorBanner, LoadingIndicator, EmptyState, OfflineIndicator, RetryButton } from '../../components/SharedUI';

/**
 * Écran Downloads : utilise les utilitaires factorisés pour la gestion du cache, la normalisation des épisodes,
 * la gestion des fichiers téléchargés, et l'accès à l'avatar utilisateur.
 * - Utilise loadCachedEpisodes, saveEpisodesToCache (LocalStorageService)
 * - Utilise normalizeEpisodes (episodeUtils)
 * - Utilise getFilename, ensureDownloadsDirectory (fileUtils)
 * - Utilise getUserAvatarUrl (user)
 */

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
const CLEANUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const MAX_DOWNLOAD_AGE_DAYS = 7;


export default function DownloadsScreen() {
  // Main state management
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');
  
  // References for optimization
  const isMounted = useRef(true);
  const router = useRouter();

  // Initialization and cleanup
  useEffect(() => {
    if (Platform.OS === 'web') {
      setIsLoading(false);
      return;
    }

    // Check connectivity
    checkNetworkStatus();

    // Initialize downloads
    setupDownloads();

    // Load user avatar
    getUserAvatarUrl().then(setAvatarUrl);

    // Cleanup function for component unmount
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Check network status
  const checkNetworkStatus = async () => {
    try {
      const state = await NetInfo.fetch();
      setIsOffline(!state.isConnected);
    } catch (error) {
      console.warn('Error checking network status:', error);
      // In case of error, assume we are online to attempt loading data
      setIsOffline(false);
    }
  };

  // Initialize downloads
  const setupDownloads = async () => {
    try {
      // Ensure download directory exists
      await ensureDownloadsDirectory(DOWNLOADS_DIR, FileSystem).catch(() => {});
      
      // Load episodes (first from cache, then from API if online)
      await loadEpisodesWithCache();
      
      // Set up automatic cleanup for old downloads
      const cleanupInterval = setInterval(() => {
        if (isMounted.current) {
          cleanupOldDownloads().catch(() => {});
        }
      }, CLEANUP_INTERVAL_MS);
      
      return () => clearInterval(cleanupInterval);
    } catch (error) {
      console.error('Error setting up downloads:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Load episodes with cache management
  const loadEpisodesWithCache = async () => {
    try {
      // Try to load from cache first
      const cachedEpisodes = await loadCachedEpisodes();
      
      if (cachedEpisodes.length > 0) {
        // Update state with cached data
        setEpisodes(cachedEpisodes);
        
        // If we're online, try to refresh data
        const networkState = await NetInfo.fetch();
        if (networkState.isConnected) {
          await fetchEpisodes();
        } else {
          setIsOffline(true);
        }
      } else {
        // No cache available, try to load from API
        await fetchEpisodes();
      }
    } catch (error) {
      console.error('Error loading episodes with cache:', error);
      // In case of error, try loading from API
      await fetchEpisodes();
    }
  };

  // Check downloads when episodes change
  useEffect(() => {
    if (episodes.length > 0 && Platform.OS !== 'web') {
      checkDownloadedEpisodes();
    }
  }, [episodes]);

  // Read metadata for downloaded episodes
  const loadDownloadedEpisodesMetadata = async () => {
    if (Platform.OS === 'web') return [];
    
    try {
      const files = await FileSystem.readDirectoryAsync(DOWNLOADS_DIR)
        .catch(() => [] as string[]);
      
      const metaFiles = files.filter(file => file.endsWith('.meta'));
      const episodesMetadata = [];
      
      for (const metaFile of metaFiles) {
        try {
          const metaPath = DOWNLOADS_DIR + metaFile;
          const metaContent = await FileSystem.readAsStringAsync(metaPath);
          const metadata = JSON.parse(metaContent);
          
          // Check if the corresponding audio file exists
          const audioFile = metaFile.replace('.meta', '');
          const audioPath = DOWNLOADS_DIR + audioFile;
          const audioExists = await FileSystem.getInfoAsync(audioPath);
          
          if (audioExists.exists) {
            episodesMetadata.push({
              ...metadata,
              filePath: audioPath
            });
          }
        } catch (error) {
          console.warn('Error reading metadata file:', error);
        }
      }
      
      return episodesMetadata;
    } catch (error) {
      console.error('Error loading downloaded episodes metadata:', error);
      return [];
    }
  };

  // Retrieve downloaded episodes (for offline mode)
  const getDownloadedEpisodes = async (): Promise<Episode[]> => {
    if (Platform.OS === 'web') return [];
    
    const metadata = await loadDownloadedEpisodesMetadata();
    
    // Merge with existing episodes or create minimal Episode objects
    if (episodes.length > 0) {
      // If we have episodes in memory, enrich with metadata
      return episodes.filter(episode => 
        metadata.some(meta => meta.id === episode.id)
      ).map(episode => {
        const meta = metadata.find(m => m.id === episode.id);
        return {
          ...episode,
          offline_path: meta?.filePath
        };
      });
    } else {
      // Create minimal Episode objects from metadata
      return normalizeEpisodes(metadata);
    }
  };

  // Load episodes from API
  const fetchEpisodes = async () => {
    try {
      const networkState = await NetInfo.fetch();
      
      if (!networkState.isConnected) {
        setIsOffline(true);
        // In offline mode, load only downloaded episodes
        const offlineEpisodes = await getDownloadedEpisodes();
        if (offlineEpisodes.length > 0) {
          setEpisodes(offlineEpisodes);
          setError(null);
        } else {
          setError('No episodes available in offline mode');
        }
        return;
      }
      
      setIsOffline(false);
      
      const { data, error: apiError } = await supabase
        .from('episodes')
        .select('*')
        .order('publication_date', { ascending: false });

      const episodesData = data as any[];
      // Normalize the data to match our Episode interface
      const normalizedEpisodes: Episode[] = normalizeEpisodes(episodesData);
      setEpisodes(normalizedEpisodes);
      
      // Save episodes to cache for offline use
      await saveEpisodesToCache(episodesData);
      
      setError(null);
    } catch (err) {
      console.error('Error fetching episodes:', err);
      if (isMounted.current) {
        // In case of error, try to load from cache
        const cachedEpisodes = await loadCachedEpisodes();
        if (cachedEpisodes.length > 0) {
          setEpisodes(cachedEpisodes);
          setError('Offline mode - Displaying cached data');
        } else {
          // If no cache is available, try to load downloaded episodes
          const offlineEpisodes = await getDownloadedEpisodes();
          if (offlineEpisodes.length > 0) {
            setEpisodes(offlineEpisodes);
            setError('Offline mode - Displaying downloaded episodes');
          } else {
            setError('Error loading episodes and no cached data available');
          }
        }
      }
    }
  };

  // Check downloaded episodes
  const checkDownloadedEpisodes = async () => {
    if (Platform.OS === 'web' || !isMounted.current) return;

    try {
      // Ensure directory exists
      await ensureDownloadsDirectory(DOWNLOADS_DIR, FileSystem);
      
      // Read files in directory
      const files = await FileSystem.readDirectoryAsync(DOWNLOADS_DIR)
        .catch(() => [] as string[]);
      
      // Update status for each episode
      const newStatus: DownloadStatus = {};
      
      for (const episode of episodes) {
        if (!episode?.mp3Link && !episode?.offline_path) continue;
        
        let isDownloaded = false;
        let filePath: string | undefined;
        
        if (episode.offline_path) {
          // If we already have an offline path, check if it exists
          const fileInfo = await FileSystem.getInfoAsync(episode.offline_path);
          isDownloaded = fileInfo.exists;
          filePath = isDownloaded ? episode.offline_path : undefined;
        } else if (episode.mp3Link) {
          // Otherwise, check by filename
          const filename = getFilename(episode.mp3Link);
          isDownloaded = files.includes(filename);
          filePath = isDownloaded ? DOWNLOADS_DIR + filename : undefined;
        }
        
        newStatus[episode.id] = {
          ...downloadStatus[episode.id],
          progress: isDownloaded ? 1 : 0,
          downloading: downloadStatus[episode.id]?.downloading || false,
          downloaded: isDownloaded,
          filePath
        };
      }
      
      if (isMounted.current) {
        setDownloadStatus(newStatus);
      }
    } catch (error) {
      console.warn('Error checking downloads:', error);
    }
  };

  // Download an episode
  const downloadEpisode = async (episode: Episode) => {
    // Check if the episode has a valid mp3 link
    if (!episode?.mp3Link) {
      setError('Download link not available');
      return;
    }
    
    if (Platform.OS === 'web') {
      window.open(episode.mp3Link, '_blank');
      return;
    }

    try {
      setError(null);
      await ensureDownloadsDirectory(DOWNLOADS_DIR, FileSystem);
      
      const filename = getFilename(episode.mp3Link);
      const fileUri = DOWNLOADS_DIR + filename;

      // Update status
      setDownloadStatus(prev => ({
        ...prev,
        [episode.id]: {
          ...prev[episode.id],
          progress: 0,
          downloading: true,
          downloaded: false
        }
      }));

      // Create the download
      const downloadResumable = FileSystem.createDownloadResumable(
        episode.mp3Link,
        fileUri,
        {},
        (downloadProgress) => {
          if (!isMounted.current || !downloadProgress.totalBytesExpectedToWrite) return;
          
          const progress = downloadProgress.totalBytesWritten / 
                          downloadProgress.totalBytesExpectedToWrite;
          
          // Limit state updates to save battery
          if (Math.abs(progress - (downloadStatus[episode.id]?.progress || 0)) > 0.05) {
            setDownloadStatus(prev => ({
              ...prev,
              [episode.id]: {
                ...prev[episode.id],
                progress
              }
            }));
          }
        }
      );

      // Start the download
      const result = await downloadResumable.downloadAsync();
      
      if (!isMounted.current) return;
      
      if (result?.uri) {
        // Save metadata
        const metadataUri = fileUri + '.meta';
        const metadata = {
          id: episode.id,
          title: episode.title,
          description: episode.description,
          downloadDate: new Date().toISOString()
        };
        
        await FileSystem.writeAsStringAsync(
          metadataUri,
          JSON.stringify(metadata)
        );

        // Update status
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
        throw new Error('Download failed');
      }
    } catch (error) {
      console.error('Download error:', error);
      
      if (isMounted.current) {
        setError('Error during download');
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
  };

  // Delete a download
  const deleteDownload = async (episode: Episode) => {
    if (Platform.OS === 'web') return;

    try {
      let filePath: string | undefined;
      let metaPath: string | undefined;
      
      if (episode.offline_path) {
        // If we have a direct offline path
        filePath = episode.offline_path;
        metaPath = episode.offline_path + '.meta';
      } else if (episode.mp3Link) {
        // Otherwise, build path from URL
        const filename = getFilename(episode.mp3Link);
        filePath = DOWNLOADS_DIR + filename;
        metaPath = filePath + '.meta';
      } else {
        throw new Error('Unable to determine file to delete');
      }
      
      // Delete the file and metadata
      await Promise.all([
        FileSystem.deleteAsync(filePath, { idempotent: true }).catch(() => {}),
        metaPath ? FileSystem.deleteAsync(metaPath, { idempotent: true }).catch(() => {}) : Promise.resolve()
      ]);

      // Update status
      if (isMounted.current) {
        setDownloadStatus(prev => ({
          ...prev,
          [episode.id]: {
            progress: 0,
            downloading: false,
            downloaded: false
          }
        }));
        
        // Remove episode from episodes list if we're in offline mode
        if (isOffline) {
          setEpisodes(prevEpisodes => 
            prevEpisodes.filter(ep => ep.id !== episode.id)
          );
        }
      }
    } catch (error) {
      console.error('Error deleting download:', error);
      setError('Error while deleting');
    }
  };

  // Delete all downloads
  const deleteAllDownloads = async () => {
    if (Platform.OS === 'web') return;

    try {
      // Delete and recreate the directory
      await FileSystem.deleteAsync(DOWNLOADS_DIR, { idempotent: true });
      await ensureDownloadsDirectory(DOWNLOADS_DIR, FileSystem);

      // Reset all statuses
      if (isMounted.current) {
        const newStatus: DownloadStatus = {};
        episodes.forEach(episode => {
          newStatus[episode.id] = {
            progress: 0,
            downloading: false,
            downloaded: false
          };
        });
        
        setDownloadStatus(newStatus);
        
        // Clear episodes list if we're in offline mode
        if (isOffline) {
          setEpisodes([]);
          setError('No episodes available in offline mode');
        }
      }
    } catch (error) {
      console.error('Error deleting all downloads:', error);
      setError('Error while deleting downloads');
    }
  };

  // Clean up old downloads
  const cleanupOldDownloads = async () => {
    if (Platform.OS === 'web' || !isMounted.current) return;

    try {
      const files = await FileSystem.readDirectoryAsync(DOWNLOADS_DIR)
        .catch(() => [] as string[]);
      
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
        } catch (error) {
          console.warn('Error processing metadata file:', error);
        }
      }
      
      // Refresh statuses
      await checkDownloadedEpisodes();
    } catch (error) {
      console.error('Error cleaning up old downloads:', error);
    }
  };

  // Helper to confirm deletion of all downloads
  const confirmDeleteAll = useCallback(() => {
    const hasDownloads = Object.values(downloadStatus).some(status => status.downloaded);
    
    if (!hasDownloads) {
      setError('No downloaded episodes to delete');
      return;
    }
    
    Alert.alert(
      'Delete all downloads',
      'Are you sure you want to delete all downloaded episodes?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', onPress: deleteAllDownloads, style: 'destructive' }
      ]
    );
  }, [downloadStatus]);

  // Handler to play an episode
  const playEpisode = useCallback((episode: Episode, index: number) => {
    if (downloadStatus[episode.id]?.downloaded) {
      const filePath = downloadStatus[episode.id]?.filePath;
      
      // For a downloaded episode, pass the local path
      router.push({
        pathname: '/player/player',
        params: { 
          episodeId: episode.id,
          offlinePath: filePath
        }
      });
    } else {
      // For an online episode, use the index
      router.push({
        pathname: '/player/player',
        params: { episodeId: episode.id }
      });
    }
  }, [router, downloadStatus]);

  // Refresh data (forces complete reload)
  const refreshData = useCallback(async () => {
    setIsLoading(true);
    try {
      await checkNetworkStatus();
      await fetchEpisodes();
      await checkDownloadedEpisodes();
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Progress circle component
  const ProgressCircle = ({ progress }: { progress: number }) => {
    const radius = 10;
    const strokeWidth = 2;
    const center = radius + strokeWidth;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference * (1 - progress);
    
    return (
      <View style={styles.progressCircleContainer}>
        <Svg width={center * 2} height={center * 2}>
          {/* Background circle */}
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={theme.colors.borderColor}
            strokeWidth={strokeWidth}
            fill="none"
          />
          
          {/* Progress circle */}
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={theme.colors.primary}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(-90, ${center}, ${center})`}
          />
        </Svg>
        
        {/* Percentage */}
        <Text style={styles.progressText}>
          {Math.round(progress * 100)}%
        </Text>
      </View>
    );
  };

  // Message if no episodes are available
  const NoEpisodesMessage = () => (
    <EmptyState message="No episodes available">
      {isOffline && (
        <OfflineIndicator text="Mode hors-ligne" style={styles.offlineMessageContainer} />
      )}
      <RetryButton onPress={refreshData} text="Refresh" style={styles.refreshButton} />
    </EmptyState>
  );

  // Display during loading
  if (isLoading) {
    return <LoadingIndicator message="Loading..." style={componentStyle.loadingContainer} />;
  }

  // Main display
  return (
    <View style={componentStyle.container}>
      <View style={componentStyle.header}>
        <MaterialIcons name="download-for-offline" size={24} color={theme.colors.text} style={{marginRight: 8}} />
        <Text style={componentStyle.headerTitle}>Downloads</Text>
        <View style={styles.headerActions}>
          {isOffline && <OfflineIndicator />}
          {Platform.OS !== 'web' && Object.values(downloadStatus).some(status => status.downloaded) && (
            <TouchableOpacity
              style={styles.deleteAllButton}
              onPress={confirmDeleteAll}
            >
              <MaterialIcons name="delete" size={24} color={theme.colors.text} />
            </TouchableOpacity>
          )}
        </View>
        {!isOffline && <View>
          <Image source={{ uri: avatarUrl }}
            style={{ width: 40, height: 40, borderRadius: 20 }}
            alt="User Avatar"
          />
        </View>}
      </View>
      
      {error && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      )}

      <FlatList
        data={episodes}
        keyExtractor={item => item.id}
        contentContainerStyle={episodes.length === 0 ? { flex: 1 } : undefined}
        renderItem={({ item: episode, index }) => (
          <View key={episode.id} style={styles.episodeCard}>
            <TouchableOpacity 
              style={styles.episodeInfo}
              onPress={() => playEpisode(episode, index)}
              activeOpacity={0.7}
            >
              <Text style={episodeStyle.episodeTitle}>{episode.title}</Text>
              {episode.publicationDate && (
                <Text style={styles.episodeDate}>
                  {new Date(episode.publicationDate).toLocaleDateString()}
                </Text>
              )}
              {downloadStatus[episode.id]?.downloaded && (
                <Text style={styles.downloadedIndicator}>Downloaded</Text>
              )}
            </TouchableOpacity>

            <View style={styles.actions}>
              {Platform.OS !== 'web' ? (
                !isOffline && (
                  downloadStatus[episode.id]?.downloaded ? (
                    <TouchableOpacity
                      style={[styles.actionButton, styles.deleteButton]}
                      onPress={() => deleteDownload(episode)}
                    >
                      <MaterialIcons name="delete" size={20} color={theme.colors.text} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[
                        styles.actionButton, 
                        styles.downloadButton,
                        downloadStatus[episode.id]?.downloading && styles.downloadingButton
                      ]}
                      onPress={() => downloadEpisode(episode)}
                      disabled={downloadStatus[episode.id]?.downloading || isOffline}
                    >
                      {downloadStatus[episode.id]?.downloading ? (
                        <ProgressCircle progress={downloadStatus[episode.id]?.progress || 0} />
                      ) : (
                        <MaterialIcons name="cloud-download" size={20} color={theme.colors.text} />
                      )}
                    </TouchableOpacity>
                  )
                )
              ) : (
                <TouchableOpacity
                  style={[styles.actionButton, styles.downloadButton]}
                  onPress={() => downloadEpisode(episode)}
                >
                  <MaterialIcons name="cloud-download" size={20} color={theme.colors.text} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
        ListEmptyComponent={<NoEpisodesMessage />}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refreshData}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
            progressBackgroundColor={theme.colors.secondaryBackground}
          />
        }
      />
    </View>
  );
}

// Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.primaryBackground,
  },
  loadingText: {
    color: theme.colors.text,
    marginTop: 16,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteAllButton: {
    padding: 8,
    backgroundColor: theme.colors.error,
    borderRadius: 8,
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.error,
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 14,
    flex: 1,
  },
  dismissButton: {
    padding: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.5)',
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dismissButtonText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyText: {
    color: theme.colors.description,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  offlineMessageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    backgroundColor: theme.colors.borderColor,
    borderRadius: 16,
    marginTop: 12,
    marginBottom: 16,
  },
  offlineText: {
    color: theme.colors.description,
    fontSize: 14,
    marginLeft: 8,
  },
  refreshButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.buttonBackground,
    borderRadius: 8,
    marginTop: 8,
  },
  refreshButtonText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  offlineIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.borderColor,
    marginLeft: 15,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 16,
  },
  offlineIndicatorText: {
    color: theme.colors.text,
    fontSize: 12,
    marginLeft: 4,
  },
  episodeCard: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: theme.colors.secondaryBackground,
    borderRadius: 10,
    marginBottom: 10,
    alignItems: 'center',
  },
  episodeInfo: {
    flex: 1,
    marginRight: 10,
  },
  episodeTitle: {
    fontSize: 14,
    color: theme.colors.text,
    marginBottom: 4,
  },
  episodeDate: {
    fontSize: 11,
    color: theme.colors.description,
  },
  downloadedIndicator: {
    fontSize: 10,
    color: theme.colors.primary,
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 20,
    backgroundColor: theme.colors.borderColor,
    justifyContent: 'center',
    alignItems: 'center',
  },
  downloadButton: {
    backgroundColor: theme.colors.buttonBackground,
  },
  downloadingButton: {
    backgroundColor: theme.colors.downloadProgress,
  },
  deleteButton: {
    backgroundColor: theme.colors.error,
  },
  progressCircleContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  progressText: {
    position: 'absolute',
    color: theme.colors.text,
    fontSize: 8,
    fontWeight: 'bold',
  }
});