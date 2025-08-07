import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { Episode } from '../../types/episode';
import { normalizeEpisodes } from './episodeUtils';

const DOWNLOADS_DIR = FileSystem.documentDirectory + 'downloads/';

/**
 * Load metadata for downloaded episodes
 */
export const loadDownloadedEpisodesMetadata = async () => {
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

/**
 * Get downloaded episodes as Episode objects
 */
export const getDownloadedEpisodes = async (existingEpisodes?: Episode[]): Promise<Episode[]> => {
  if (Platform.OS === 'web') return [];
  
  const metadata = await loadDownloadedEpisodesMetadata();
  
  // Merge with existing episodes or create minimal Episode objects
  if (existingEpisodes && existingEpisodes.length > 0) {
    // If we have episodes in memory, enrich with metadata
    return existingEpisodes.filter(episode => 
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
