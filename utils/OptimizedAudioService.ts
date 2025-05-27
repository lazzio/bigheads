import TrackPlayer, {
  State as TrackPlayerState,
  Capability,
  Event as TrackPlayerEvent,
  Track,
} from 'react-native-track-player';
import { Episode } from '../types/episode';
import { normalizeAudioUrl } from './commons/timeUtils';
import { savePositionLocally } from './cache/LocalStorageService';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../lib/supabase';

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

// Classe singleton pour gérer l'état audio global
class AudioManager {
  private static instance: AudioManager;
  private currentEpisode: Episode | null = null;
  private position = 0; // en secondes
  private duration = 0; // en secondes
  private isPlaying = false;
  private isBuffering = false;
  private listeners: Set<(data: any) => void> = new Set();
  private episodesList: Episode[] = [];
  private currentEpisodeIndex: number = -1;
  private initialSeekPositionMillis: number | null = null;
  private isPlayerReady = false;
  private isLoadingNewSound: boolean = false;

  private constructor() {}

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  public async setupAudio(): Promise<void> {
    if (this.isPlayerReady) return;
    await TrackPlayer.setupPlayer();
    await TrackPlayer.updateOptions({
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
        Capability.Stop,
      ],
      compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious],
    });
    TrackPlayer.addEventListener(TrackPlayerEvent.PlaybackState, this.onPlaybackStatusUpdate);
    TrackPlayer.addEventListener(TrackPlayerEvent.PlaybackTrackChanged, this.onTrackChanged);
    TrackPlayer.addEventListener(TrackPlayerEvent.PlaybackQueueEnded, this.onQueueEnded);
    this.isPlayerReady = true;
  }

  public setEpisodesList(episodes: Episode[], currentIndex: number = 0): void {
    if (!episodes || episodes.length === 0) {
      console.warn('[AudioManager] Attempted to set empty episodes list');
      return;
    }
    this.episodesList = [...episodes];
    this.currentEpisodeIndex = Math.min(Math.max(0, currentIndex), episodes.length - 1);
  }

  public async skipToNext(): Promise<boolean> {
    if (this.episodesList.length === 0) {
      console.warn('[AudioManager] Cannot skip to next: No episodes list set');
      return false;
    }
    const nextIndex = (this.currentEpisodeIndex + 1) % this.episodesList.length;
    const nextEpisode = this.episodesList[nextIndex];
    try {
      this.currentEpisodeIndex = nextIndex;
      await this.loadSound(nextEpisode, 0);
      await this.play();
      return true;
    } catch (error) {
      console.error('[AudioManager] Error skipping to next episode:', error);
      return false;
    }
  }

  public async skipToPrevious(): Promise<boolean> {
    if (this.episodesList.length === 0) {
      console.warn('[AudioManager] Cannot skip to previous: No episodes list set');
      return false;
    }
    const currentStatus = await this.getStatusAsync();
    if (currentStatus.currentTime < 3) {
      const prevIndex = (this.currentEpisodeIndex - 1 + this.episodesList.length) % this.episodesList.length;
      const prevEpisode = this.episodesList[prevIndex];
      try {
        this.currentEpisodeIndex = prevIndex;
        await this.loadSound(prevEpisode, 0);
        await this.play();
        return true;
      } catch (error) {
        console.error('[AudioManager] Error skipping to previous episode:', error);
        return false;
      }
    } else {
      await this.seekTo(0);
      return true;
    }
  }

  private async syncPositionToSupabase(episodeId: string, positionMillis: number) {
    try {
      const net = await NetInfo.fetch();
      if (!net.isConnected || !net.isInternetReachable) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const positionSeconds = Math.floor(positionMillis / 1000);
      await supabase.from('watched_episodes').upsert({
        user_id: user.id,
        episode_id: episodeId,
        playback_position: positionSeconds,
        watched_at: new Date().toISOString(),
      }, { onConflict: 'user_id, episode_id' });
    } catch (e) {
      // Silent fail
    }
  }

  public async loadSound(episode: Episode, initialPositionMillis: number = 0): Promise<void> {
    await this.setupAudio();
    // Sauvegarde la position de l'ancien épisode avant de le décharger
    if (this.currentEpisode) {
      try {
        const status = await this.getStatusAsync();
        const lastPosition = status.currentTime ?? 0;
        await savePositionLocally(this.currentEpisode.id, lastPosition * 1000);
        await this.syncPositionToSupabase(this.currentEpisode.id, lastPosition * 1000);
      } catch (e) {
        console.warn('[AudioManager] Erreur lors de la sauvegarde de la position précédente', e);
      }
    }
    await TrackPlayer.reset();

    let audioSourceUri: string;
    const isLocal = !!episode.offline_path;
    if (isLocal) {
      audioSourceUri = episode.offline_path!;
    } else if (episode.mp3Link) {
      audioSourceUri = normalizeAudioUrl(episode.mp3Link);
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

    const track: Track = {
      id: episode.id,
      url: audioSourceUri,
      title: episode.title,
      artist: '',
      artwork: episode.artwork?.toString() || undefined,
      duration: this.duration,
    };

    await TrackPlayer.add([track]);
    // await TrackPlayer.skip(episode.id);

    this.notifyListeners({
      type: 'status',
      position: this.position,
      duration: this.duration,
      isPlaying: this.isPlaying,
      isBuffering: this.isBuffering,
      isLoaded: false,
      episodeId: this.currentEpisode?.id ?? null,
    });

    if (this.initialSeekPositionMillis !== null) {
      await TrackPlayer.seekTo(this.initialSeekPositionMillis / 1000);
      this.initialSeekPositionMillis = null;
    }
  }

  private onPlaybackStatusUpdate = async () => {
    const state = await TrackPlayer.getState();
    const position = await TrackPlayer.getPosition();
    const duration = await TrackPlayer.getDuration();
    this.position = position;
    this.duration = duration;
    this.isPlaying = state === TrackPlayerState.Playing;
    this.isBuffering = state === TrackPlayerState.Buffering;

    this.notifyListeners({
      type: 'status',
      position: this.position,
      duration: this.duration,
      isPlaying: this.isPlaying,
      isBuffering: this.isBuffering,
      isLoaded: state !== TrackPlayerState.None,
      episodeId: this.currentEpisode?.id ?? null,
    });
  };

  private onTrackChanged = async (data: any) => {
    // Optionally handle track change events if needed
  };

  private onQueueEnded = async () => {
    this.isPlaying = false;
    this.notifyListeners({ type: 'finished', episodeId: this.currentEpisode?.id ?? null });
  };

  public async getStatusAsync(): Promise<AudioStatus> {
    if (!this.isPlayerReady) {
      return {
        isLoaded: false,
        isPlaying: false,
        isBuffering: false,
        currentTime: 0,
        duration: 0,
        currentEpisodeId: null,
        currentEpisode: null,
      };
    }
    const state = await TrackPlayer.getState();
    const position = await TrackPlayer.getPosition();
    const duration = await TrackPlayer.getDuration();
    return {
      isLoaded: state !== TrackPlayerState.None,
      isPlaying: state === TrackPlayerState.Playing,
      isBuffering: state === TrackPlayerState.Buffering,
      currentTime: position,
      duration: duration,
      currentEpisodeId: this.currentEpisode?.id ?? null,
      currentEpisode: this.currentEpisode,
    };
  }

  public async unloadSound(): Promise<void> {
    await TrackPlayer.stop();
    await TrackPlayer.reset();
    const unloadedEpisodeId = this.currentEpisode?.id;
    this.currentEpisode = null;
    this.position = 0;
    this.duration = 0;
    this.isPlaying = false;
    this.isBuffering = false;
    this.isLoadingNewSound = false;
    this.initialSeekPositionMillis = null;

    this.notifyListeners({ type: 'unloaded', episodeId: unloadedEpisodeId ?? null });
    this.notifyListeners({ type: 'status', position: 0, duration: 0, isPlaying: false, isBuffering: false, isLoaded: false, episodeId: null });
  }

  public async play(): Promise<void> {
    try {
      await TrackPlayer.play();
      this.isPlaying = true;
    } catch (error) {
      console.error('[AudioManager] Error playing sound:', error);
    }
  }

  public async pause(): Promise<void> {
    try {
      await TrackPlayer.pause();
      this.isPlaying = false;
    } catch (error) {
      console.error('[AudioManager] Error pausing sound:', error);
    }
  }

  public async seekTo(positionMillis: number): Promise<void> {
    try {
      await TrackPlayer.seekTo(positionMillis / 1000);
    } catch (error) {
      console.error('[AudioManager] Error seeking sound:', error);
    }
  }

  public async seekRelative(offsetSeconds: number): Promise<number | undefined> {
    try {
      const currentPositionSeconds = await TrackPlayer.getPosition();
      const durationSeconds = await TrackPlayer.getDuration();
      const newPositionSeconds = Math.max(0, Math.min(currentPositionSeconds + offsetSeconds, durationSeconds));
      await TrackPlayer.seekTo(newPositionSeconds);
      return newPositionSeconds;
    } catch (error) {
      console.error('[AudioManager] Error seeking relative:', error);
      return undefined;
    }
  }

  public addListener(callback: (data: any) => void): () => void {
    this.listeners.add(callback);
    callback({
      type: 'status',
      position: this.position,
      duration: this.duration,
      isPlaying: this.isPlaying,
      isBuffering: this.isBuffering,
      isLoaded: this.isPlayerReady,
      episodeId: this.currentEpisode?.id ?? null,
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

  public async cleanup(): Promise<void> {
    await this.unloadSound();
    this.listeners.clear();
    this.isPlayerReady = false;
  }

  public async stopAllSounds(): Promise<void> {
    try {
      await TrackPlayer.stop();
      await TrackPlayer.reset();
    } catch (e) {}
    this.currentEpisode = null;
    this.position = 0;
    this.duration = 0;
    this.isPlaying = false;
    this.isBuffering = false;
    this.isLoadingNewSound = false;
    this.initialSeekPositionMillis = null;
    this.notifyListeners({ type: 'unloaded', episodeId: null });
    this.notifyListeners({ type: 'status', position: 0, duration: 0, isPlaying: false, isBuffering: false, isLoaded: false, episodeId: null });
  }
}

export const audioManager = AudioManager.getInstance();