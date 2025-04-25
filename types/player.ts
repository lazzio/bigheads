import { Episode } from './episode';

export interface PlayerState {
  currentEpisode: Episode | null;
  episodes: Episode[];
  currentIndex: number;
  isPlaying: boolean;
  isBuffering: boolean;
  isLoading: boolean; // Loading episode data or track
  position: number; // Current position in seconds
  duration: number; // Total duration in seconds
  playbackPositions: Map<string, number>; // Map<episodeId, positionSeconds>
  isOffline: boolean;
  error: string | null;
  sleepTimerActive: boolean;
}

export interface PlayerActions {
  setEpisodes: (episodes: Episode[]) => void;
  setCurrentEpisode: (episode: Episode | null, index: number) => void;
  setPlaybackState: (state: { isPlaying?: boolean; isBuffering?: boolean; isLoading?: boolean }) => void;
  updateProgress: (position: number, duration: number) => void;
  setPlaybackPositions: (positions: Map<string, number>) => void;
  updateSinglePlaybackPosition: (episodeId: string, position: number) => void;
  setIsOffline: (offline: boolean) => void;
  setError: (error: string | null) => void;
  toggleSleepTimer: () => void;
  resetPlayerState: () => void; // To reset state on logout or major error
}

export interface PlayerContextType extends PlayerState {
  actions: PlayerActions;
}

// Type for items stored in AsyncStorage for pending positions
export interface PendingPosition {
  episodeId: string;
  positionSeconds: number;
  userId: string;
  timestamp: string;
}

// Type for items stored in AsyncStorage for offline watched episodes
export interface OfflineWatched {
  episodeId: string;
  userId: string;
  timestamp: string;
}
