import TrackPlayer, {
  State as TrackPlayerState,
  Capability,
  Event as TrackPlayerEvent,
  Track,
  AppKilledPlaybackBehavior,
} from 'react-native-track-player';
import { Episode } from '../types/episode';
import { normalizeAudioUrl } from './commons/timeUtils';
import { savePositionLocally, getPositionLocally } from './cache/LocalStorageService';
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
  private isLoadingNewSound = false;
  private wasExplicitlyPaused = false; // Flag pour traquer si l'utilisateur a volontairement mis en pause

  private constructor() {}

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  public async setupAudio(): Promise<void> {
    if (this.isPlayerReady) return;
    await TrackPlayer.setupPlayer({
      // Configuration spécifique pour Android
      autoHandleInterruptions: false, // Gérer manuellement les interruptions
    });
    await TrackPlayer.updateOptions({
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
        Capability.Stop,
      ],
      compactCapabilities: [
        // Capability.Play,
        // Capability.Pause,
        // Capability.SkipToNext,
        // Capability.SkipToPrevious,
        Capability.Stop,
      ],
      // Options Android spécifiques
      android: {
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.PausePlayback, // Pause quand l'app est tuée
      },
    });
    TrackPlayer.addEventListener(TrackPlayerEvent.PlaybackState, this.onPlaybackStatusUpdate);
    TrackPlayer.addEventListener(TrackPlayerEvent.PlaybackActiveTrackChanged, this.onTrackChanged);
    TrackPlayer.addEventListener(TrackPlayerEvent.PlaybackQueueEnded, this.onQueueEnded);
    TrackPlayer.addEventListener(TrackPlayerEvent.PlaybackError, this.onPlaybackStatusUpdate);
    TrackPlayer.addEventListener(TrackPlayerEvent.PlaybackProgressUpdated, this.onPlaybackStatusUpdate);
    TrackPlayer.addEventListener(TrackPlayerEvent.RemotePlay, this.onRemotePlay.bind(this));
    TrackPlayer.addEventListener(TrackPlayerEvent.RemotePause, this.onRemotePause.bind(this));
    TrackPlayer.addEventListener(TrackPlayerEvent.RemoteNext, this.skipToNext.bind(this));
    TrackPlayer.addEventListener(TrackPlayerEvent.RemotePrevious, this.skipToPrevious.bind(this));
    TrackPlayer.addEventListener(TrackPlayerEvent.RemoteSeek, async (data) => {
      const positionMillis = data.position;
      if (typeof positionMillis === 'number') {
        await this.seekTo(positionMillis);
      } else {
        console.warn('[AudioManager] RemoteSeek event received with invalid position:', data);
      }
    });
    TrackPlayer.addEventListener(TrackPlayerEvent.RemoteStop, this.unloadSound.bind(this));
    
    // Gérer les interruptions audio (importantes pour Android)
    TrackPlayer.addEventListener(TrackPlayerEvent.PlaybackMetadataReceived, this.onPlaybackStatusUpdate);
    
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
    // Dans votre logique, "next" signifie l'index - 1 (épisode plus récent)
    if (this.currentEpisodeIndex <= 0) {
      console.warn('[AudioManager] Cannot skip to next: Already at last episode');
      return false;
    }
    const nextIndex = this.currentEpisodeIndex - 1;
    const nextEpisode = this.episodesList[nextIndex];
    try {
      this.currentEpisodeIndex = nextIndex;
      
      // Récupérer la position sauvegardée pour le nouvel épisode
      const savedPositionMillis = await this.getPlaybackPosition(nextEpisode.id);
      const initialPositionMillis = savedPositionMillis || 0;
      
      await this.loadSound(nextEpisode, initialPositionMillis);
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
    // Dans votre logique, "previous" signifie l'index + 1 (épisode plus ancien)
    if (this.currentEpisodeIndex >= this.episodesList.length - 1) {
      console.warn('[AudioManager] Cannot skip to previous: Already at first episode');
      return false;
    }
    const prevIndex = this.currentEpisodeIndex + 1;
    const prevEpisode = this.episodesList[prevIndex];
    try {
      this.currentEpisodeIndex = prevIndex;
      
      // Récupérer la position sauvegardée pour le nouvel épisode
      const savedPositionMillis = await this.getPlaybackPosition(prevEpisode.id);
      const initialPositionMillis = savedPositionMillis || 0;
      
      await this.loadSound(prevEpisode, initialPositionMillis);
      await this.play();
      return true;
    } catch (error) {
      console.error('[AudioManager] Error skipping to previous episode:', error);
      return false;
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
    this.wasExplicitlyPaused = false; // Réinitialiser le flag pour un nouvel épisode

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

  private onRemotePlay = async () => {
    console.log('[AudioManager] RemotePlay event received');
    // Ne jouer que si l'utilisateur n'a pas explicitement mis en pause
    if (this.wasExplicitlyPaused) {
      console.log('[AudioManager] RemotePlay: Ignored - user explicitly paused playback');
      return;
    }
    
    // Ne jouer que si on a un épisode chargé et que l'utilisateur veut vraiment jouer
    const state = await TrackPlayer.getState();
    if (state !== TrackPlayerState.None && this.currentEpisode) {
      console.log('[AudioManager] RemotePlay: Starting playback');
      await this.play();
    } else {
      console.log('[AudioManager] RemotePlay: Ignored - no episode loaded or not ready');
    }
    // Mettre à jour le statut dans tous les cas
    await this.onPlaybackStatusUpdate();
  };

  private onRemotePause = async () => {
    console.log('[AudioManager] RemotePause event received');
    await this.pause();
    // Mettre à jour le statut
    await this.onPlaybackStatusUpdate();
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
      this.wasExplicitlyPaused = false; // Réinitialiser le flag quand on joue
    } catch (error) {
      console.error('[AudioManager] Error playing sound:', error);
    }
  }

  public async pause(): Promise<void> {
    try {
      await TrackPlayer.pause();
      this.isPlaying = false;
      this.wasExplicitlyPaused = true; // Marquer que l'utilisateur a volontairement mis en pause
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

  private async getPlaybackPosition(episodeId: string): Promise<number | null> {
    const localPositionMillis = await getPositionLocally(episodeId);
    if (localPositionMillis !== null) {
      console.log(`[AudioManager] Using local position for ${episodeId}: ${localPositionMillis}ms`);
      return localPositionMillis;
    }

    const netInfoState = await NetInfo.fetch();
    if (netInfoState.isConnected && netInfoState.isInternetReachable) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          console.warn("[AudioManager] Cannot fetch remote position: no user logged in.");
          return null;
        }

        console.log(`[AudioManager] No local position for ${episodeId}, checking Supabase...`);
        const { data, error } = await supabase
          .from('watched_episodes')
          .select('playback_position, is_finished')
          .eq('user_id', user.id)
          .eq('episode_id', episodeId)
          .maybeSingle();

        if (error) {
          console.error("[AudioManager] Supabase fetch position error:", error.message);
        } else if (data) {
          const remotePositionSeconds = data.is_finished ? 0 : data.playback_position;
          if (remotePositionSeconds !== null && isFinite(remotePositionSeconds)) {
            const remotePositionMillis = remotePositionSeconds * 1000;
            console.log(`[AudioManager] Found remote position for ${episodeId}: ${remotePositionSeconds}s (Finished: ${data.is_finished}). Saving locally.`);
            await savePositionLocally(episodeId, remotePositionMillis);
            return remotePositionMillis;
          }
        } else {
          console.log(`[AudioManager] No remote position found for ${episodeId} in Supabase.`);
        }
      } catch (err) {
        console.error("[AudioManager] Exception fetching remote position:", err);
      }
    } else {
        console.log(`[AudioManager] Offline, cannot check remote position for ${episodeId}.`);
    }

    console.log(`[AudioManager] No position found for ${episodeId}, starting from beginning.`);
    return null;
  }
}

export const audioManager = AudioManager.getInstance();