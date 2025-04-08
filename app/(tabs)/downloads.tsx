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
import { Download, Trash2, Play, Trash, WifiOff } from 'lucide-react-native';
import * as FileSystem from 'expo-file-system';
import { useRouter } from 'expo-router';
import { Episode } from '../../types/episode';
import Svg, { Circle } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
const EPISODES_CACHE_KEY = 'cached_episodes';
const CLEANUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_DOWNLOAD_AGE_DAYS = 7;

export default function DownloadsScreen() {
  // État principal
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  
  // Refs pour optimisation
  const isMounted = useRef(true);
  const router = useRouter();

  // Initialisation et nettoyage
  useEffect(() => {
    if (Platform.OS === 'web') {
      setIsLoading(false);
      return;
    }

    // Vérifier la connectivité
    checkNetworkStatus();

    // Initialisation
    setupDownloads();

    // Nettoyage
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Vérifier le statut du réseau
  const checkNetworkStatus = async () => {
    try {
      const state = await NetInfo.fetch();
      setIsOffline(!state.isConnected);
    } catch (error) {
      console.warn('Error checking network status:', error);
      // En cas d'erreur, supposer que nous sommes en ligne pour tenter de charger les données
      setIsOffline(false);
    }
  };

  // Initialiser les téléchargements
  const setupDownloads = async () => {
    try {
      // S'assurer que le répertoire existe
      await ensureDownloadsDirectory().catch(() => {});
      
      // Charger les épisodes (d'abord depuis le cache, puis depuis l'API si en ligne)
      await loadEpisodesWithCache();
      
      // Mettre en place le nettoyage automatique
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

  // Charger les épisodes avec gestion du cache
  const loadEpisodesWithCache = async () => {
    try {
      // Essayer de charger depuis le cache d'abord
      const cachedEpisodes = await loadCachedEpisodes();
      
      if (cachedEpisodes.length > 0) {
        // Mettre à jour l'état avec les données du cache
        setEpisodes(cachedEpisodes);
        
        // Si nous sommes en ligne, essayer de rafraîchir les données
        const networkState = await NetInfo.fetch();
        if (networkState.isConnected) {
          await fetchEpisodes();
        } else {
          setIsOffline(true);
        }
      } else {
        // Aucun cache disponible, essayer de charger depuis l'API
        await fetchEpisodes();
      }
    } catch (error) {
      console.error('Error loading episodes with cache:', error);
      // En cas d'erreur, essayer de charger depuis l'API
      await fetchEpisodes();
    }
  };

  // Charger les épisodes depuis le cache
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

  // Sauvegarder les épisodes dans le cache
  const saveEpisodesToCache = async (episodes: Episode[]) => {
    try {
      await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(episodes));
      console.log(`Saved ${episodes.length} episodes to cache`);
    } catch (error) {
      console.error('Error saving episodes to cache:', error);
    }
  };

  // Vérifier les téléchargements lorsque les épisodes changent
  useEffect(() => {
    if (episodes.length > 0 && Platform.OS !== 'web') {
      checkDownloadedEpisodes();
    }
  }, [episodes]);

  // Helpers pour le système de fichiers
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

  // Lire les métadonnées des épisodes téléchargés
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
          
          // Vérifier si le fichier audio correspondant existe
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

  // Récupérer les épisodes téléchargés (pour le mode hors ligne)
  const getDownloadedEpisodes = async () => {
    if (Platform.OS === 'web') return [];
    
    const metadata = await loadDownloadedEpisodesMetadata();
    
    // Fusionner avec les épisodes existants ou créer des objets Episode minimaux
    if (episodes.length > 0) {
      // Si nous avons des épisodes en mémoire, enrichir avec les métadonnées
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
      // Créer des objets Episode minimalistes à partir des métadonnées
      return metadata.map(meta => ({
        id: meta.id,
        title: meta.title || 'Épisode téléchargé',
        description: meta.description || '',
        mp3Link: '',
        mp3_link: '',
        duration: '',
        publicationDate: meta.downloadDate || new Date().toISOString(),
        publication_date: meta.downloadDate || new Date().toISOString(),
        offline_path: meta.filePath
      }));
    }
  };

  const getFilename = (url: string | undefined): string => {
    if (!url) return `episode-${Date.now()}.mp3`;
    return url.split('/').pop() || `episode-${Date.now()}.mp3`;
  };

  // Charger les épisodes depuis l'API
  const fetchEpisodes = async () => {
    try {
      const networkState = await NetInfo.fetch();
      
      if (!networkState.isConnected) {
        setIsOffline(true);
        // En mode hors ligne, charger uniquement les épisodes téléchargés
        const offlineEpisodes = await getDownloadedEpisodes();
        if (offlineEpisodes.length > 0) {
          setEpisodes(offlineEpisodes);
          setError(null);
        } else {
          setError('Aucun épisode disponible en mode hors ligne');
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
      
      // Sauvegarder les épisodes dans le cache pour une utilisation hors ligne
      await saveEpisodesToCache(episodesData);
      
      setError(null);
    } catch (err) {
      console.error('Error fetching episodes:', err);
      if (isMounted.current) {
        // En cas d'erreur, essayer de charger depuis le cache
        const cachedEpisodes = await loadCachedEpisodes();
        if (cachedEpisodes.length > 0) {
          setEpisodes(cachedEpisodes);
          setError('Mode hors ligne - Affichage des données en cache');
        } else {
          // Si aucun cache n'est disponible, essayer de charger les épisodes téléchargés
          const offlineEpisodes = await getDownloadedEpisodes();
          if (offlineEpisodes.length > 0) {
            setEpisodes(offlineEpisodes);
            setError('Mode hors ligne - Affichage des épisodes téléchargés');
          } else {
            setError('Erreur lors du chargement des épisodes et aucune donnée en cache');
          }
        }
      }
    }
  };

  // Vérifier les épisodes téléchargés
  const checkDownloadedEpisodes = async () => {
    if (Platform.OS === 'web' || !isMounted.current) return;

    try {
      // S'assurer que le répertoire existe
      await ensureDownloadsDirectory();
      
      // Lire les fichiers dans le répertoire
      const files = await FileSystem.readDirectoryAsync(DOWNLOADS_DIR)
        .catch(() => [] as string[]);
      
      // Mettre à jour le statut de chaque épisode
      const newStatus: DownloadStatus = {};
      
      for (const episode of episodes) {
        if (!episode?.mp3_link && !episode?.offline_path) continue;
        
        let isDownloaded = false;
        let filePath: string | undefined;
        
        if (episode.offline_path) {
          // Si nous avons déjà un chemin hors ligne, vérifier s'il existe
          const fileInfo = await FileSystem.getInfoAsync(episode.offline_path);
          isDownloaded = fileInfo.exists;
          filePath = isDownloaded ? episode.offline_path : undefined;
        } else if (episode.mp3_link) {
          // Sinon, vérifier par nom de fichier
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

  // Télécharger un épisode
  const downloadEpisode = async (episode: Episode) => {
    // Vérifier si l'épisode a un lien mp3 valide
    if (!episode?.mp3_link) {
      setError('Lien de téléchargement non disponible');
      return;
    }
    
    if (Platform.OS === 'web') {
      window.open(episode.mp3_link, '_blank');
      return;
    }

    try {
      setError(null);
      await ensureDownloadsDirectory();
      
      const filename = getFilename(episode.mp3_link);
      const fileUri = DOWNLOADS_DIR + filename;

      // Mettre à jour le statut
      setDownloadStatus(prev => ({
        ...prev,
        [episode.id]: {
          ...prev[episode.id],
          progress: 0,
          downloading: true,
          downloaded: false
        }
      }));

      // Créer le téléchargement
      const downloadResumable = FileSystem.createDownloadResumable(
        episode.mp3_link,
        fileUri,
        {},
        (downloadProgress) => {
          if (!isMounted.current || !downloadProgress.totalBytesExpectedToWrite) return;
          
          const progress = downloadProgress.totalBytesWritten / 
                          downloadProgress.totalBytesExpectedToWrite;
          
          // Limiter les mises à jour d'état pour économiser la batterie
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

      // Démarrer le téléchargement
      const result = await downloadResumable.downloadAsync();
      
      if (!isMounted.current) return;
      
      if (result?.uri) {
        // Enregistrer les métadonnées
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

        // Mettre à jour le statut
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
    } catch (error) {
      console.error('Download error:', error);
      
      if (isMounted.current) {
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
  };

  // Supprimer un téléchargement
  const deleteDownload = async (episode: Episode) => {
    if (Platform.OS === 'web') return;

    try {
      let filePath: string | undefined;
      let metaPath: string | undefined;
      
      if (episode.offline_path) {
        // Si nous avons un chemin hors ligne direct
        filePath = episode.offline_path;
        metaPath = episode.offline_path + '.meta';
      } else if (episode.mp3_link) {
        // Sinon, construire le chemin à partir de l'URL
        const filename = getFilename(episode.mp3_link);
        filePath = DOWNLOADS_DIR + filename;
        metaPath = filePath + '.meta';
      } else {
        throw new Error('Impossible de déterminer le fichier à supprimer');
      }
      
      // Supprimer le fichier et les métadonnées
      await Promise.all([
        FileSystem.deleteAsync(filePath, { idempotent: true }).catch(() => {}),
        metaPath ? FileSystem.deleteAsync(metaPath, { idempotent: true }).catch(() => {}) : Promise.resolve()
      ]);

      // Mettre à jour le statut
      if (isMounted.current) {
        setDownloadStatus(prev => ({
          ...prev,
          [episode.id]: {
            progress: 0,
            downloading: false,
            downloaded: false
          }
        }));
      }
    } catch (error) {
      console.error('Error deleting download:', error);
      setError('Erreur lors de la suppression');
    }
  };

  // Supprimer tous les téléchargements
  const deleteAllDownloads = async () => {
    if (Platform.OS === 'web') return;

    try {
      // Supprimer et recréer le répertoire
      await FileSystem.deleteAsync(DOWNLOADS_DIR, { idempotent: true });
      await ensureDownloadsDirectory();

      // Réinitialiser tous les statuts
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
      }
    } catch (error) {
      console.error('Error deleting all downloads:', error);
      setError('Erreur lors de la suppression des téléchargements');
    }
  };

  // Nettoyer les anciens téléchargements
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
      
      // Rafraîchir les statuts
      await checkDownloadedEpisodes();
    } catch (error) {
      console.error('Error cleaning up old downloads:', error);
    }
  };

  // Helper pour confirmer la suppression de tous les téléchargements
  const confirmDeleteAll = useCallback(() => {
    const hasDownloads = Object.values(downloadStatus).some(status => status.downloaded);
    
    if (!hasDownloads) {
      setError('Aucun épisode téléchargé à supprimer');
      return;
    }
    
    Alert.alert(
      'Supprimer tous les téléchargements',
      'Êtes-vous sûr de vouloir supprimer tous les épisodes téléchargés ?',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', onPress: deleteAllDownloads, style: 'destructive' }
      ]
    );
  }, [downloadStatus]);

  // Handler pour lancer la lecture d'un épisode
  const playEpisode = useCallback((episode: Episode, index: number) => {
    if (downloadStatus[episode.id]?.downloaded) {
      const filePath = downloadStatus[episode.id]?.filePath;
      
      // Pour un épisode téléchargé, passer le chemin local
      router.push({
        pathname: '/player',
        params: { 
          episodeId: episode.id,
          offlinePath: filePath
        }
      });
    } else {
      // Pour un épisode en ligne, utiliser l'index
      router.push({
        pathname: '/player',
        params: { episodeId: episode.id }
      });
    }
  }, [router, downloadStatus]);

  // Rafraîchir les données (force le rechargement complet)
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

  // Composant pour le cercle de progression
  const ProgressCircle = ({ progress }: { progress: number }) => {
    const radius = 10;
    const strokeWidth = 2;
    const center = radius + strokeWidth;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference * (1 - progress);
    
    return (
      <View style={styles.progressCircleContainer}>
        <Svg width={center * 2} height={center * 2}>
          {/* Cercle de fond */}
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke="#333333"
            strokeWidth={strokeWidth}
            fill="none"
          />
          
          {/* Cercle de progression */}
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke="#0ea5e9"
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(-90, ${center}, ${center})`}
          />
        </Svg>
        
        {/* Pourcentage */}
        <Text style={styles.progressText}>
          {Math.round(progress * 100)}%
        </Text>
      </View>
    );
  };

  // Message si aucun épisode n'est disponible
  const NoEpisodesMessage = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>Aucun épisode disponible</Text>
      {isOffline && (
        <View style={styles.offlineMessageContainer}>
          <WifiOff size={20} color="#888" />
          <Text style={styles.offlineText}>Mode hors ligne</Text>
        </View>
      )}
      <TouchableOpacity 
        style={styles.refreshButton}
        onPress={refreshData}
      >
        <Text style={styles.refreshButtonText}>Actualiser</Text>
      </TouchableOpacity>
    </View>
  );

  // Indicateur de mode hors ligne
  const OfflineIndicator = () => (
    <View style={styles.offlineIndicator}>
      <WifiOff size={16} color="#fff" />
      <Text style={styles.offlineIndicatorText}>Mode hors ligne</Text>
    </View>
  );

  // Affichage pendant le chargement
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0ea5e9" />
        <Text style={styles.loadingText}>Chargement des épisodes...</Text>
      </View>
    );
  }

  // Affichage principal
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Téléchargements</Text>
        <View style={styles.headerActions}>
          {isOffline && <OfflineIndicator />}
          {Platform.OS !== 'web' && Object.values(downloadStatus).some(status => status.downloaded) && (
            <TouchableOpacity
              style={styles.deleteAllButton}
              onPress={confirmDeleteAll}
            >
              <Trash size={20} color="#fff" />
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
          episodes.map((episode, index) => (
            <View key={episode.id} style={styles.episodeCard}>
              <TouchableOpacity 
                style={styles.episodeInfo}
                onPress={() => playEpisode(episode, index)}
                activeOpacity={0.7}
              >
                <Text style={styles.episodeTitle}>{episode.title}</Text>
                {episode.publication_date && (
                  <Text style={styles.episodeDate}>
                    {new Date(episode.publication_date).toLocaleDateString()}
                  </Text>
                )}
                {downloadStatus[episode.id]?.downloaded && (
                  <Text style={styles.downloadedIndicator}>Téléchargé</Text>
                )}
              </TouchableOpacity>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => playEpisode(episode, index)}
                >
                  <Play size={20} color="#fff" />
                </TouchableOpacity>

                {Platform.OS !== 'web' ? (
                  !isOffline && (
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
                        disabled={downloadStatus[episode.id]?.downloading || isOffline}
                      >
                        {downloadStatus[episode.id]?.downloading ? (
                          <ProgressCircle progress={downloadStatus[episode.id]?.progress || 0} />
                        ) : (
                          <Download size={20} color="#fff" />
                        )}
                      </TouchableOpacity>
                    )
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
      
      <TouchableOpacity 
        style={styles.floatingRefreshButton}
        onPress={refreshData}
      >
        <Text style={styles.refreshButtonText}>Actualiser</Text>
      </TouchableOpacity>
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  offlineText: {
    color: '#888',
    fontSize: 14,
    marginLeft: 8,
  },
  refreshButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#0ea5e9',
    borderRadius: 8,
    marginTop: 8,
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  floatingRefreshButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#0ea5e9',
    borderRadius: 8,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
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
  downloadedIndicator: {
    fontSize: 10,
    color: '#0ea5e9',
    marginTop: 4,
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
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  progressText: {
    position: 'absolute',
    color: '#fff',
    fontSize: 8,
    fontWeight: 'bold',
  }
});