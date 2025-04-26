import React, { createContext, useState, useMemo, useCallback, ReactNode } from 'react';
import { Episode } from '../types/episode';
import { PlayerState, PlayerActions, PlayerContextType } from '../types/player';

const initialState: PlayerState = {
  currentEpisode: null,
  episodes: [],
  currentIndex: -1,
  isPlaying: false,
  isBuffering: false,
  isLoading: true, // Start in loading state
  position: 0,
  duration: 0,
  playbackPositions: new Map(),
  isOffline: false,
  error: null,
  sleepTimerActive: false,
};

export const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

interface PlayerProviderProps {
  children: ReactNode;
}

export const PlayerProvider: React.FC<PlayerProviderProps> = ({ children }) => {
  const [state, setState] = useState<PlayerState>(initialState);

  const setEpisodes = useCallback((episodes: Episode[]) => {
    setState(prevState => ({ ...prevState, episodes }));
  }, []);

  const setCurrentEpisode = useCallback((episode: Episode | null, index: number) => {
    setState(prevState => ({
      ...prevState,
      currentEpisode: episode,
      currentIndex: index,
      position: 0, // Reset position when episode changes
      duration: 0,
      isPlaying: false, // Stop playback when changing episode manually
      isBuffering: false,
      isLoading: !!episode, // Set loading true if a new episode is being set
      error: null,
    }));
  }, []);

  const setPlaybackState = useCallback((newState: Partial<Pick<PlayerState, 'isPlaying' | 'isBuffering' | 'isLoading'>>) => {
    setState(prevState => ({ ...prevState, ...newState }));
  }, []);

  const updateProgress = useCallback((position: number, duration: number) => {
    // Ensure duration is only set if it's valid and different
    setState(prevState => ({
      ...prevState,
      position: Math.max(0, position),
      duration: duration > 0 && duration !== prevState.duration ? duration : prevState.duration,
    }));
  }, []);

  const setPlaybackPositions = useCallback((positions: Map<string, number>) => {
    setState(prevState => ({ ...prevState, playbackPositions: positions }));
  }, []);

  const updateSinglePlaybackPosition = useCallback((episodeId: string, position: number) => {
    setState(prevState => {
      const newPositions = new Map(prevState.playbackPositions);
      newPositions.set(episodeId, position);
      return { ...prevState, playbackPositions: newPositions };
    });
  }, []);

  const setIsOffline = useCallback((offline: boolean) => {
    setState(prevState => ({ ...prevState, isOffline: offline }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState(prevState => ({ ...prevState, error, isLoading: false, isPlaying: false, isBuffering: false }));
  }, []);

  const toggleSleepTimer = useCallback(() => {
    setState(prevState => ({ ...prevState, sleepTimerActive: !prevState.sleepTimerActive }));
  }, []);

  const resetPlayerState = useCallback(() => {
    setState(initialState);
    // Consider also calling TrackPlayer.reset() here or in useAudioManager
  }, []);

  const actions: PlayerActions = useMemo(() => ({
    setEpisodes,
    setCurrentEpisode,
    setPlaybackState,
    updateProgress,
    setPlaybackPositions,
    updateSinglePlaybackPosition,
    setIsOffline,
    setError,
    toggleSleepTimer,
    resetPlayerState,
  }), [
      setEpisodes, setCurrentEpisode, setPlaybackState, updateProgress,
      setPlaybackPositions, updateSinglePlaybackPosition, setIsOffline,
      setError, toggleSleepTimer, resetPlayerState
    ]);

  const contextValue = useMemo(() => ({ ...state, actions }), [state, actions]);

  return (
    <PlayerContext.Provider value={contextValue}>
      {children}
    </PlayerContext.Provider>
  );
};
