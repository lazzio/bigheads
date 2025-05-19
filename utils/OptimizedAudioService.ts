import { AudioPlayer, setAudioModeAsync, createAudioPlayer, InterruptionMode, InterruptionModeAndroid } from 'expo-audio';
import { Episode } from '../types/episode';
import { normalizeAudioUrl } from './commons/timeUtils';

// Interface pour le statut retourné par getStatusAsync
export interface AudioStatus {
  isLoaded: boolean;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number; // en secondes
  duration: number; // en secondes
  currentEpisodeId: string | null;
  currentEpisode?: Episode | null;
}

// Type for expo-audio's playback status update
type ExpoAudioPlayerStatus = {
  currentTime?: number;
  duration?: number;
  playing?: boolean;
  isBuffering?: boolean;
  isLoaded?: boolean;
  didJustFinish?: boolean;
  // ... other properties from expo-audio status if needed
};

// Classe singleton pour gérer l'état audio global
class AudioManager {
  private static instance: AudioManager;
  private player: AudioPlayer | null = null;
  private isPlayerReady = false;
  private currentEpisode: Episode | null = null;
  private position = 0; // en secondes
  private duration = 0; // en secondes
  private isPlaying = false;
  private isBuffering = false;
  private listeners: Set<(data: any) => void> = new Set();
  private episodesList: Episode[] = [];
  private currentEpisodeIndex: number = -1;
  
  private initialSeekPositionMillis: number | null = null;
  private isLoadingNewSound: boolean = false;

  private constructor() {
    // Constructeur privé pour le modèle singleton
  }

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  public async setupAudio(): Promise<void> {
    if (this.isPlayerReady) return;

    await setAudioModeAsync({
      shouldPlayInBackground: true,
      allowsRecording: false,
      interruptionMode: 'doNotMix' as InterruptionMode, // Corrected: Use InterruptionMode for iOS
      playsInSilentMode: true,
      interruptionModeAndroid: 'doNotMix' as InterruptionModeAndroid,
      shouldRouteThroughEarpiece: false,
    });

    this.isPlayerReady = true;
  }

  // 2. Méthode pour définir la liste des épisodes en cours de lecture
  public setEpisodesList(episodes: Episode[], currentIndex: number = 0): void {
    if (!episodes || episodes.length === 0) {
      console.warn('[AudioManager] Attempted to set empty episodes list');
      return;
    }
    
    console.log(`[AudioManager] Setting episodes list with ${episodes.length} episodes, current index: ${currentIndex}`);
    this.episodesList = [...episodes];
    this.currentEpisodeIndex = Math.min(Math.max(0, currentIndex), episodes.length - 1);
  }

  // 3. Méthode pour naviguer à l'épisode suivant
  public async skipToNext(): Promise<boolean> {
    console.log('[AudioManager] skipToNext called');
    
    if (this.episodesList.length === 0) {
      console.warn('[AudioManager] Cannot skip to next: No episodes list set');
      return false;
    }
    
    const nextIndex = (this.currentEpisodeIndex + 1) % this.episodesList.length;
    const nextEpisode = this.episodesList[nextIndex];
    
    console.log(`[AudioManager] Skipping to next episode: ${nextEpisode.title} (index: ${nextIndex})`);
    
    try {
      this.currentEpisodeIndex = nextIndex;
      await this.loadSound(nextEpisode, 0); // position in ms
      await this.play();
      return true;
    } catch (error) {
      console.error('[AudioManager] Error skipping to next episode:', error);
      return false;
    }
  }

  // 4. Méthode pour naviguer à l'épisode précédent
  public async skipToPrevious(): Promise<boolean> {
    console.log('[AudioManager] skipToPrevious called');
    
    if (this.episodesList.length === 0) {
      console.warn('[AudioManager] Cannot skip to previous: No episodes list set');
      return false;
    }
    
    const currentStatus = await this.getStatusAsync();
    
    if (currentStatus.currentTime < 3) { // currentTime is in seconds
      const prevIndex = (this.currentEpisodeIndex - 1 + this.episodesList.length) % this.episodesList.length;
      const prevEpisode = this.episodesList[prevIndex];
      
      console.log(`[AudioManager] Skipping to previous episode: ${prevEpisode.title} (index: ${prevIndex})`);
      
      try {
        this.currentEpisodeIndex = prevIndex;
        await this.loadSound(prevEpisode, 0); // position in ms
        await this.play();
        return true;
      } catch (error) {
        console.error('[AudioManager] Error skipping to previous episode:', error);
        return false;
      }
    } else {
      console.log('[AudioManager] Returning to beginning of current episode');
      await this.seekTo(0); // position in ms
      return true;
    }
  }

  public async loadSound(episode: Episode, initialPositionMillis: number = 0): Promise<void> {
    await this.setupAudio();
    if (this.player) {
      this.player.removeListener('playbackStatusUpdate', this.onPlaybackStatusUpdate);
      this.player.remove();
      this.player = null;
    }
    
    let audioSourceUri: string;
    const isLocal = !!episode.offline_path;

    if (isLocal) {
      audioSourceUri = episode.offline_path!;
      console.log('[AudioManager] Using local file:', audioSourceUri);
    } else if (episode.mp3Link) {
      audioSourceUri = normalizeAudioUrl(episode.mp3Link);
      console.log('[AudioManager] Using remote URL:', audioSourceUri);
    } else {
      throw new Error('Episode has no valid audio source (offline_path or mp3Link).');
    }

    this.currentEpisode = { ...episode };
    this.position = 0;
    this.duration = episode.duration ? Number(episode.duration) : 0; 
    this.isPlaying = false;
    this.isBuffering = true;
    this.isLoadingNewSound = true;
    this.initialSeekPositionMillis = initialPositionMillis;

    // Corrected: Use createAudioPlayer directly
    this.player = createAudioPlayer({ uri: audioSourceUri }, 1000);
    // Null check for player before adding listener
    if (this.player) {
      this.player.addListener('playbackStatusUpdate', this.onPlaybackStatusUpdate);
    }

    this.notifyListeners({
      type: 'status',
      position: this.position,
      duration: this.duration,
      isPlaying: this.isPlaying,
      isBuffering: this.isBuffering,
      isLoaded: false,
      episodeId: this.currentEpisode?.id ?? null,
    });
  }

  private onPlaybackStatusUpdate = (status: ExpoAudioPlayerStatus) => {
    if (!this.player || !this.currentEpisode) {
      // If player or episode is null (e.g., after unloadSound), don't process.
      // Also, if status is somehow empty.
      if (!status || Object.keys(status).length === 0) {
        this.isBuffering = false;
        this.isPlaying = false;
         this.notifyListeners({ type: 'status', position: 0, duration: 0, isPlaying: false, isBuffering: false, isLoaded: false, episodeId: null });
      }
      return;
    }

    this.position = status.currentTime ?? this.position;
    this.duration = status.duration ?? this.duration;
    this.isPlaying = status.playing ?? false;
    this.isBuffering = status.isBuffering ?? false;

    if (this.isLoadingNewSound && status.isLoaded) {
      this.isBuffering = status.isBuffering ?? false; // Update buffering state based on actual loaded status
      this.notifyListeners({
        type: 'loaded',
        episode: this.currentEpisode,
        episodeId: this.currentEpisode?.id ?? null, // Ajouter explicitement episodeId
        duration: this.duration, // in seconds
        isLocalFile: !!this.currentEpisode.offline_path,
      });

      if (this.initialSeekPositionMillis !== null && this.player) {
        // seekTo takes seconds
        this.player.seekTo(this.initialSeekPositionMillis / 1000);
      }
      this.isLoadingNewSound = false; // Reset flag after initial load handling
      this.initialSeekPositionMillis = null; // Reset seek position
    }

    if (status.didJustFinish) {
      this.isPlaying = false;
      this.notifyListeners({ type: 'finished', episodeId: this.currentEpisode.id });
    }

    this.notifyListeners({
      type: 'status',
      position: this.position,
      duration: this.duration,
      isPlaying: this.isPlaying,
      isBuffering: this.isBuffering,
      isLoaded: status.isLoaded ?? false,
      episodeId: this.currentEpisode.id,
    });
  };

public async getStatusAsync(): Promise<AudioStatus> {
  if (!this.player || !this.player.isLoaded) { // Check player.isLoaded
    return { 
      isLoaded: false, 
      isPlaying: false, 
      isBuffering: this.isBuffering, // Reflect ongoing buffering if any
      currentTime: 0, 
      duration: 0, 
      currentEpisodeId: this.currentEpisode?.id ?? null,
      currentEpisode: this.currentEpisode ?? null
    };
  }
  
  // Properties from AudioPlayer are directly in seconds
  return {
    isLoaded: this.player.isLoaded,
    isPlaying: this.player.playing,
    isBuffering: this.player.isBuffering,
    currentTime: this.player.currentTime ?? 0,
    duration: this.player.duration ?? 0,
    currentEpisodeId: this.currentEpisode?.id ?? null,
    currentEpisode: this.currentEpisode,
  };
}

  public async unloadSound(): Promise<void> {
    if (this.player) {
      this.player.removeListener('playbackStatusUpdate', this.onPlaybackStatusUpdate);
      this.player.remove(); // Replaces unloadAsync
      this.player = null;
    }
    const unloadedEpisodeId = this.currentEpisode?.id;
    this.currentEpisode = null;
    this.position = 0;
    this.duration = 0;
    this.isPlaying = false;
    this.isBuffering = false;
    this.isLoadingNewSound = false;
    this.initialSeekPositionMillis = null;

    this.notifyListeners({ type: 'unloaded', episodeId: unloadedEpisodeId ?? null }); // Notify with the ID of the unloaded episode
    this.notifyListeners({ type: 'status', position: 0, duration: 0, isPlaying: false, isBuffering: false, isLoaded: false, episodeId: null });
  }

  public async play(): Promise<void> {
    if (!this.player || !this.player.isLoaded) return;
    try {
      this.player.play(); // expo-audio play is synchronous
      this.isPlaying = true; // Reflect state immediately
      // Status update will be handled by onPlaybackStatusUpdate
    } catch (error) {
      console.error('[AudioManager] Error playing sound:', error);
    }
  }

  public async pause(): Promise<void> {
    if (!this.player || !this.player.isLoaded) return;
    try {
      this.player.pause(); // expo-audio pause is synchronous
      this.isPlaying = false; // Reflect state immediately
      // Status update will be handled by onPlaybackStatusUpdate
    } catch (error) {
      console.error('[AudioManager] Error pausing sound:', error);
    }
  }

  // seekTo takes milliseconds for consistency with original public API, but converts to seconds for player
  public async seekTo(positionMillis: number): Promise<void> {
    if (!this.player || !this.player.isLoaded) return;
    try {
      await this.player.seekTo(positionMillis / 1000); // seekTo takes seconds
      // Update internal position immediately for consistency if needed, though event should cover it
      // this.position = positionMillis / 1000;
      // this.notifyListeners({ type: 'status', /* ... */ });
    } catch (error) {
      console.error('[AudioManager] Error seeking sound:', error);
    }
  }

  public async seekRelative(offsetSeconds: number): Promise<number | undefined> { // Return new position in seconds
    if (!this.player || !this.player.isLoaded) return undefined;
    try {
      const currentPositionSeconds = this.player.currentTime ?? 0;
      const durationSeconds = this.player.duration ?? 0;
      const newPositionSeconds = Math.max(0, Math.min(currentPositionSeconds + offsetSeconds, durationSeconds));
      await this.player.seekTo(newPositionSeconds);
      // this.position = newPositionSeconds; // Update internal position
      // this.notifyListeners({ type: 'status', /* ... */ });
      return newPositionSeconds; // Return the calculated new position
    } catch (error) {
      console.error('[AudioManager] Error seeking relative:', error);
      return undefined;
    }
  }

public addListener(callback: (data: any) => void): () => void {
  this.listeners.add(callback);
  // Envoyer l'état interne actuel immédiatement après l'ajout
  callback({
    type: 'status',
    position: this.position, // seconds
    duration: this.duration, // seconds
    isPlaying: this.isPlaying,
    isBuffering: this.isBuffering,
    isLoaded: !!(this.player && this.player.isLoaded),
    episodeId: this.currentEpisode?.id ?? null, // Utiliser episodeId au lieu de currentEpisodeId pour être cohérent
  });
  return () => {
    this.listeners.delete(callback);
  };
}

private notifyListeners(data: any): void {
  this.listeners.forEach(callback => {
    try {
      callback(data);
    } catch (error) {
      console.error('[AudioManager] Error in listener callback:', error);
    }
  });
}

// Removed startStatusInterval and stopStatusInterval as expo-audio handles updates via events

public async cleanup(): Promise<void> {
  await this.unloadSound(); // This now also removes listeners and the player
  this.listeners.clear();
  this.isPlayerReady = false;
  // No interval to clear
  }
}
// --- FIN DE LA CLASSE ---
// Exporter l'instance singleton
export const audioManager = AudioManager.getInstance();
