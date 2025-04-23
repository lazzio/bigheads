import React, { useEffect, useState, useRef, useCallback } from 'react';
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
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../../lib/supabase';
import { Download, Trash, WifiOff, Music, Check, AlertTriangle } from 'lucide-react-native';
import * as FileSystem from 'expo-file-system';
// Importer useFocusEffect
import { useRouter, useFocusEffect } from 'expo-router';
import { Episode } from '../../types/episode';
import Svg, { Circle } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Progress from 'react-native-progress';

interface DownloadStatus {
  [key: string]: {
    progress: number; // Garder progress comme nombre entre 0 et 1 (ou 0-100 selon l'implémentation)
    downloading: boolean;
    downloaded: boolean;
    filePath?: string;
    error?: string | null;
  };
}

const DOWNLOADS_DIR = FileSystem.documentDirectory + 'downloads/';
const EPISODES_CACHE_KEY = 'cached_episodes';
const CLEANUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DOWNLOAD_AGE_DAYS = 7;

// --- Fonctions parseDuration et formatDuration ---
function parseDuration(durationStr: string | number | null): number | null {
    if (typeof durationStr === 'number') return durationStr;
    if (typeof durationStr !== 'string' || !durationStr) return null;
    const parts = durationStr.split(':').map(Number);
    let seconds = 0;
    if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
    else if (parts.length === 1 && !isNaN(parts[0])) seconds = parts[0];
    return isNaN(seconds) ? null : seconds;
}

function formatDuration(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined || isNaN(seconds) || seconds <= 0) {
      return '--:--';
    }
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    const minutesStr = String(minutes).padStart(2, '0');
    const secsStr = String(secs).padStart(2, '0');

    if (hours > 0) {
      return `${hours}:${minutesStr}:${secsStr}`;
    } else {
      return `${minutesStr}:${secsStr}`;
    }
}

const colors = {
  background: '#121212',
  cardBackground: '#1a1a1a',
  textPrimary: '#ffffff',
  textSecondary: '#b3b3b3',
  textMuted: '#808080',
  iconColor: '#ffffff',
  iconColorDownloaded: '#0ea5e9', // Bleu pour téléchargé/progression
  iconColorDelete: '#ef4444', // Rouge pour supprimer
  errorText: '#ef4444',
  offlineBackground: '#333333',
  offlineText: '#aaaaaa',
};

export default function DownloadsScreen() {
  // --- State Management (Ajouter 'error' au status) ---
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({});
  const [error, setError] = useState<string | null>(null); // Erreur globale
  const [isLoading, setIsLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);


  const isMounted = useRef(true);
  const router = useRouter();

  // --- Initial useEffect (inchangé, gère le premier chargement) ---
  useEffect(() => {
    if (Platform.OS === 'web') {
      setIsLoading(false);
      return;
    }
    setIsLoading(true); // Définir le chargement initial ici
    checkNetworkStatus();
    setupDownloads(); // setupDownloads contient déjà le premier loadEpisodesWithCache et met isLoading à false dans finally

    // Cleanup function for component unmount
    return () => {
      isMounted.current = false;
    };
  }, []);

  // --- NOUVEAU: useFocusEffect pour rafraîchissement automatique ---
  useFocusEffect(
    useCallback(() => {
      // Ne pas remettre isLoading(true) ici pour éviter le loader à chaque focus
      console.log("Downloads screen focused: Refreshing status...");

      // Rafraîchir l'état réseau et vérifier les épisodes téléchargés
      const refreshOnFocus = async () => {
        if (Platform.OS === 'web' || !isMounted.current) return;
        try {
          await checkNetworkStatus(); // Met à jour isOffline
          // Rafraîchir la liste des épisodes (fetchEpisodes gère offline/online)
          await fetchEpisodes();
          // Revérifier les statuts des fichiers téléchargés
          await checkDownloadedEpisodes();
        } catch (error) {
          console.error("Error refreshing on focus:", error);
          // Gérer l'erreur si nécessaire, peut-être afficher un toast discret
        }
        // Pas besoin de setIsLoading(false) ici, car on n'a pas mis à true
      };

      refreshOnFocus();

    }, []) // Dépendances vides pour s'exécuter à chaque focus
  );

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
      await ensureDownloadsDirectory().catch(() => {});
      
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

  // Load episodes from cache
  const loadCachedEpisodes = async (): Promise<Episode[]> => {
    try {
      const cachedData = await AsyncStorage.getItem(EPISODES_CACHE_KEY);
      if (cachedData) {
        const episodes = JSON.parse(cachedData);
        console.log(`Loaded ${episodes.length} episodes from cache`);
        return episodes;
      }
    } catch (error) {
      console.error('Error loading cached episodes:', error);
    }
    return [];
  };

  // Save episodes to cache for offline use
  const saveEpisodesToCache = async (episodes: Episode[]) => {
    try {
      await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(episodes));
      console.log(`Saved ${episodes.length} episodes to cache`);
    } catch (error) {
      console.error('Error saving episodes to cache:', error);
    }
  };

  // Check downloads when episodes change
  useEffect(() => {
    if (episodes.length > 0 && Platform.OS !== 'web') {
      checkDownloadedEpisodes();
    }
  }, [episodes]);

  // File system helpers
  const ensureDownloadsDirectory = async () => {
    if (Platform.OS === 'web') return false;
    
    try {
      const dirInfo = await FileSystem.getInfoAsync(DOWNLOADS_DIR);
      
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(DOWNLOADS_DIR, { intermediates: true });
      }
      
      return true;
    } catch (error) {
      console.error('Error creating downloads directory:', error);
      return false;
    }
  };

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
      return metadata.map(meta => ({
        id: meta.id,
        title: meta.title || 'Downloaded Episode',
        description: meta.description || '',
        mp3Link: '',
        mp3_link: '',
        duration: parseDuration(meta.duration),
        publicationDate: meta.downloadDate || new Date().toISOString(),
        publication_date: meta.downloadDate || new Date().toISOString(),
        offline_path: meta.filePath
      }));
    }
  };

  // Generate filename from URL
  const getFilename = (url: string | undefined): string => {
    if (!url) return `episode-${Date.now()}.mp3`;
    return url.split('/').pop() || `episode-${Date.now()}.mp3`;
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
      const normalizedEpisodes: Episode[] = episodesData.map(ep => ({
        id: ep.id,
        title: ep.title,
        description: ep.description,
        mp3Link: ep.mp3_link || '',
        mp3_link: ep.mp3_link || '',
        duration: ep.duration || '',
        publicationDate: ep.publication_date || '',
        publication_date: ep.publication_date || '',
        originalMp3Link: ep.original_mp3_link,
        offline_path: ep.offline_path
      }));
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
      await ensureDownloadsDirectory();
      
      // Read files in directory
      const files = await FileSystem.readDirectoryAsync(DOWNLOADS_DIR)
        .catch(() => [] as string[]);
      
      // Update status for each episode
      const newStatus: DownloadStatus = {};
      
      for (const episode of episodes) {
        if (!episode?.mp3_link && !episode?.offline_path) continue;
        
        let isDownloaded = false;
        let filePath: string | undefined;
        
        if (episode.offline_path) {
          // If we already have an offline path, check if it exists
          const fileInfo = await FileSystem.getInfoAsync(episode.offline_path);
          isDownloaded = fileInfo.exists;
          filePath = isDownloaded ? episode.offline_path : undefined;
        } else if (episode.mp3_link) {
          // Otherwise, check by filename
          const filename = getFilename(episode.mp3_link);
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
    if (!episode?.mp3_link) {
      setError('Download link not available');
      return;
    }
    
    if (Platform.OS === 'web') {
      window.open(episode.mp3_link, '_blank');
      return;
    }

    try {
      setError(null); // Clear global error
      await ensureDownloadsDirectory();
      const filename = getFilename(episode.mp3_link);
      const fileUri = DOWNLOADS_DIR + filename;

      setDownloadStatus(prev => ({
        ...prev,
        [episode.id]: {
          ...prev[episode.id],
          progress: 0,
          downloading: true,
          downloaded: false,
          error: null
        }
      }));

      const downloadResumable = FileSystem.createDownloadResumable(
        episode.mp3_link,
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
            progress: 1, // Ou 100 si tu utilises 0-100
            downloading: false,
            downloaded: true,
            filePath: result.uri,
            error: null
          }
        }));
      } else {
        throw new Error('Download failed or was cancelled');
      }
    } catch (error: any) {
      console.error('Download error:', error);
      if (isMounted.current) {
        // Mettre l'erreur spécifique à l'épisode
        setDownloadStatus(prev => ({
          ...prev,
          [episode.id]: {
            ...prev[episode.id],
            progress: 0,
            downloading: false,
            downloaded: false,
            error: error.message || 'Download failed'
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
      } else if (episode.mp3_link) {
        // Otherwise, build path from URL
        const filename = getFilename(episode.mp3_link);
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
            downloaded: false,
            filePath: undefined,
            error: null
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
      await ensureDownloadsDirectory();

      // Reset all statuses
      if (isMounted.current) {
        const newStatus: DownloadStatus = {};
        Object.keys(downloadStatus).forEach(id => { // Utiliser les clés existantes
          newStatus[id] = {
            progress: 0,
            downloading: false,
            downloaded: false,
            filePath: undefined, // Nettoyer filePath
            error: null
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
  const playEpisode = useCallback((episode: Episode) => {
    const status = downloadStatus[episode.id];
    // Jouer uniquement si l'épisode est marqué comme téléchargé ET a un chemin de fichier valide
    if (status?.downloaded && status.filePath) {
      router.push({
        pathname: '/(tabs)/player',
        params: {
          // Passer offlinePath pour indiquer au lecteur d'utiliser le fichier local
          offlinePath: status.filePath,
          // Optionnel: passer aussi l'ID si le lecteur en a besoin pour trouver d'autres infos
          episodeId: episode.id
        }
      });
    } else {
      // Ne rien faire ou afficher un message si l'épisode n'est pas téléchargé
      console.log("L'épisode n'est pas téléchargé ou le chemin est manquant.");
      Alert.alert("Lecture impossible", "Cet épisode n'est pas disponible hors ligne.");
    }
  }, [router, downloadStatus]);

  // Progress circle component
  const ProgressCircle = ({ progress }: { progress: number }) => {
    const strokeWidth = 2.5; // Légèrement plus épais pour la visibilité
    const radius = 10; // Rayon du cercle intérieur (fond)
    const outerRadius = radius + strokeWidth; // Rayon du cercle extérieur (progression)

    // Le centre doit être calculé par rapport au cercle le plus extérieur
    const center = outerRadius + strokeWidth / 2; // Centre de l'espace SVG
    const size = center * 2; // Taille totale du SVG

    // Circonférence pour le cercle de progression (extérieur)
    const circumference = 2 * Math.PI * outerRadius;
    const strokeDashoffset = circumference * (1 - progress);

    return (
      // Le conteneur View n'a plus besoin de taille fixe, Svg la définit
      <View style={styles.progressCircleContainer}>
        <Svg width={size} height={size}>
          {/* Cercle de fond (intérieur) */}
          <Circle
            cx={center}
            cy={center}
            r={radius} // Rayon intérieur
            stroke={colors.cardBackground} // Couleur de fond plus sombre
            strokeWidth={strokeWidth}
            fill="none"
          />

          {/* Arc de progression (extérieur) */}
          <Circle
            cx={center}
            cy={center}
            r={outerRadius} // Rayon extérieur
            stroke={colors.iconColorDownloaded} // Couleur de progression (bleu)
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round" // Extrémités arrondies
            transform={`rotate(-90 ${center} ${center})`} // Rotation pour commencer en haut
          />
        </Svg>
        {/* Optionnel: Texte de pourcentage au centre */}
        {/* <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text> */}
      </View>
    );
  };

  // Message if no episodes are available
  const NoEpisodesMessage = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>Aucun épisode disponible</Text>
      {isOffline && (
        <View style={styles.offlineMessageContainer}>
          <WifiOff size={20} color={colors.textMuted} />
          <Text style={styles.offlineText}>Mode hors ligne</Text>
        </View>
      )}
      {/* Bouton Refresh supprimé */}
    </View>
  );

  // Offline mode indicator
  const OfflineIndicator = () => (
    <View style={styles.offlineIndicator}>
      <WifiOff size={16} color="#fff" />
      <Text style={styles.offlineIndicatorText}>Offline mode</Text>
    </View>
  );

  // Display during loading
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0ea5e9" />
        <Text style={styles.loadingText}>Loading episodes...</Text>
      </View>
    );
  }

  // Main display
  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <Text style={styles.headerTitle}>Téléchargements</Text>
        <View style={styles.headerActions}>
          {isOffline && <OfflineIndicator />}
          {Platform.OS !== 'web' && Object.values(downloadStatus).some(status => status.downloaded) && (
            <TouchableOpacity onPress={confirmDeleteAll}>
              <Trash size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
      
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)} style={styles.dismissButton}>
            <Text style={styles.dismissButtonText}>×</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={styles.scrollView}>
        {episodes.length === 0 ? (
          <NoEpisodesMessage />
        ) : (
          episodes.map((episode) => {
            // Obtenir le statut spécifique à cet épisode
            const status = downloadStatus[episode.id] || { downloaded: false, downloading: false, progress: 0, error: null };
            const displayDuration = formatDuration(parseDuration(episode.duration));

            // Déterminer l'action pour le bouton de droite
            const handleDownloadAction = () => {
              if (status.downloaded) {
                Alert.alert( "Supprimer", `Supprimer "${episode.title}" ?`,
                  [ { text: "Annuler", style: "cancel" },
                    { text: "Supprimer", style: "destructive", onPress: () => deleteDownload(episode) } ]
                );
              } else if (status.downloading) {
                // TODO: Implémenter la pause/annulation
                console.log("Action Pause/Annuler à implémenter");
              } else if (status.error) {
                 console.log("Action Réessayer");
                 downloadEpisode(episode); // Relancer le téléchargement
              } else {
                downloadEpisode(episode);
              }
            };

            return (
              <TouchableOpacity
                key={episode.id}
                style={styles.episodeItem}
                // Appeler playEpisode seulement si téléchargé
                onPress={() => status.downloaded && status.filePath ? playEpisode(episode) : Alert.alert("Non disponible", "Téléchargez l'épisode pour l'écouter.")}
                activeOpacity={status.downloaded ? 0.7 : 1.0}
              >
                {/* Placeholder Image */}
                <View style={styles.episodeImagePlaceholder}>
                  <Music size={28} color={colors.textSecondary} />
                </View>

                {/* Infos Texte */}
                <View style={styles.episodeInfo}>
                  <Text style={styles.episodeTitle} numberOfLines={2}>{episode.title}</Text>
                  <Text style={styles.episodeDuration} numberOfLines={1}>
                    {displayDuration}
                  </Text>
                  {/* Afficher l'erreur spécifique à l'item */}
                  {status.error && !status.downloading && (
                     <Text style={styles.errorTextItem} numberOfLines={1}>Erreur: {status.error}</Text>
                  )}
                </View>

                {/* Bouton/Indicateur de Téléchargement */}
                <TouchableOpacity
                  style={styles.downloadButtonContainer}
                  onPress={handleDownloadAction}
                  disabled={isOffline && !status.downloaded} // Désactiver si offline et non téléchargé
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  {status.downloading ? (
                    // Afficher la progression circulaire
                    // <ProgressCircle progress={status.progress} />
                    // Ou si tu utilises react-native-progress:
                    <Progress.Circle size={30} progress={status.progress} indeterminate={status.progress === 0} color={colors.iconColorDownloaded} />
                  ) : status.downloaded ? (
                    // Afficher l'icône "Téléchargé"
                    <Check size={28} color={colors.iconColorDownloaded} />
                  ) : status.error ? (
                     // Afficher l'icône "Erreur"
                    <AlertTriangle size={26} color={colors.errorText} />
                  ) : (
                    // Afficher l'icône "Télécharger"
                    <Download size={26} color={isOffline ? colors.textMuted : colors.iconColor} /> // Grisé si offline
                  )}
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 15,
    paddingHorizontal: 20,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    // borderBottomColor: colors.cardBackground,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15, // Espace entre icônes
  },
  offlineIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#333',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 16,
  },
  offlineIndicatorText: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 4,
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#ef4444',
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorText: {
    color: '#ef4444',
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
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  scrollView: {
    flex: 1,
  },
  listContentContainer: { // Ajouter si on passe à FlatList
     paddingHorizontal: 15,
     paddingBottom: 30,
     paddingTop: 10,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyText: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  offlineMessageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    backgroundColor: '#333',
    borderRadius: 16,
    marginTop: 12,
    marginBottom: 16,
  },
  // Styles pour les items de la liste
  episodeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20, // Padding latéral
    paddingVertical: 15, // Padding vertical
    borderBottomWidth: 1, // Séparateur fin
    borderBottomColor: colors.cardBackground, // Couleur du séparateur
  },
  episodeImagePlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: colors.cardBackground,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  episodeInfo: {
    flex: 1, // Prend l'espace disponible
    justifyContent: 'center',
    marginRight: 10, // Espace avant le bouton de droite
  },
  episodeTitle: {
    fontSize: 16,
    fontWeight: '500', // Moins gras que bold
    color: colors.textPrimary,
    marginBottom: 4,
  },
  episodeDuration: { // Nouveau style pour la durée
    fontSize: 13,
    color: colors.textSecondary, // Couleur secondaire
  },
   errorTextItem: { // Erreur spécifique à l'item
    fontSize: 12,
    color: colors.errorText,
    marginTop: 4,
  },
  // Conteneur pour le bouton/indicateur de droite
  downloadButtonContainer: {
    width: 44, // Zone cliquable fixe
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10, // Espace à gauche
  },
  // Style pour le cercle de progression SVG
  progressCircleContainer: {
    // Plus besoin de width/height ici, Svg les définit
    justifyContent: 'center',
    alignItems: 'center',
    // position: 'relative', // Pas nécessaire si le texte n'est pas superposé
  },
  progressText: { // Si tu veux afficher le % dans le cercle SVG
     // position: 'absolute', // Décommenter si superposé
     color: colors.textSecondary,
     fontSize: 10,
     fontWeight: '600',
  },
  // Styles pour les messages offline/refresh (inchangés)
  offlineText: {
    color: '#888',
    fontSize: 14,
    marginLeft: 8,
  },
});