import { useEffect, useCallback, useRef } from 'react';
import TrackPlayer, {
  Capability,
  Event,
  State,
  usePlaybackState,
  useProgress,
  RepeatMode,
  Track,
} from 'react-native-track-player';
import { usePlayerState } from './usePlayerState';
import { Episode } from '../types/episode';
import { supabase } from '../lib/supabase';
import { savePendingPosition, addOfflineWatched } from '../services/OfflineService';
import { triggerSync } from '../services/PlaybackSyncService';
import { durationToSeconds } from '../utils/audioUtils';
import { POSITION_SAVE_INTERVAL_MS, SEEK_INTERVAL_SECONDS, SKIP_AUDITORS_SECONDS } from '../utils/constants';

// Flag to ensure setup happens only once
let isSetup = false;

export const useAudioManager = () => {
  const {
    currentEpisode,
    episodes,
    currentIndex,
    isOffline,
    sleepTimerActive,
    actions,
  } = usePlayerState();
  const { position, duration } = useProgress(1000); // Update progress every second
  const playbackState = usePlaybackState();

  const lastSavedPositionRef = useRef<number>(-1);
  const savePositionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const sleepTimerTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- Setup ---
  const setupPlayer = useCallback(async () => {
    if (isSetup) return;
    try {
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
        // stopWithApp: true, // Keep playing in background
        // alwaysPauseOnInterruption: true, // Pause on calls, etc.
        notificationCapabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
            Capability.SeekTo,
        ],
      });
      await TrackPlayer.setRepeatMode(RepeatMode.Off);
      isSetup = true;
      console.log('[AudioManager] TrackPlayer setup complete.');
    } catch (error) {
      console.error('[AudioManager] Error setting up TrackPlayer:', error);
      actions.setError('Erreur initialisation lecteur audio.');
    }
  }, [actions]);

  useEffect(() => {
    setupPlayer();
    // No cleanup needed for setupPlayer itself as it's guarded by isSetup
  }, [setupPlayer]);

  // --- State Synchronization ---
  useEffect(() => {
    const isPlaying = playbackState.state === State.Playing;
    const isBuffering = playbackState.state === State.Buffering || playbackState.state === State.Loading;

    // Update context state based on TrackPlayer state
    actions.setPlaybackState({ isPlaying, isBuffering });

    // Update progress in context
    // Note: useProgress provides position/duration in seconds
    actions.updateProgress(position, duration);

  }, [playbackState.state, position, duration, actions]);

  // --- Position Saving Logic ---
  const saveCurrentPosition = useCallback(async (posToSave: number) => {
    if (!currentEpisode || posToSave <= 0 || posToSave === lastSavedPositionRef.current) {
      return;
    }
    const positionSeconds = Math.floor(posToSave);
    console.log(`[AudioManager] Saving position ${positionSeconds}s for ${currentEpisode.id}`);
    lastSavedPositionRef.current = positionSeconds;
    await savePendingPosition({ episodeId: currentEpisode.id, positionSeconds });
    actions.updateSinglePlaybackPosition(currentEpisode.id, positionSeconds); // Update context immediately
    triggerSync(); // Trigger sync after saving
  }, [currentEpisode, actions]);

  // --- Playback Controls ---
  const playAudio = useCallback(async () => {
    try {
      await TrackPlayer.play();
    } catch (error) {
      console.error('[AudioManager] Error playing audio:', error);
      actions.setError('Erreur de lecture.');
    }
  }, [actions]);

  const pauseAudio = useCallback(async () => {
    try {
      await TrackPlayer.pause();
      // Position saving is handled by the useEffect hook listening for State.Paused
    } catch (error) {
      console.error('[AudioManager] Error pausing audio:', error);
    }
  }, []);

  const seekTo = useCallback(async (seconds: number) => {
    try {
      await TrackPlayer.seekTo(seconds);
      actions.updateProgress(seconds, duration); // Update context immediately for responsiveness
    } catch (error) {
      console.error('[AudioManager] Error seeking:', error);
    }
  }, [actions, duration]);

  const seekRelative = useCallback(async (deltaSeconds: number) => {
    const newPosition = Math.max(0, position + deltaSeconds);
    await seekTo(newPosition);
  }, [position, seekTo]);

  const skipToNext = useCallback(async () => {
    if (currentIndex < episodes.length - 1) {
      const nextIndex = currentIndex + 1;
      // Save current position before skipping
      await saveCurrentPosition(position);
      actions.setCurrentEpisode(episodes[nextIndex], nextIndex);
      // Loading is handled by PlayerScreen effect watching currentEpisode change
    } else {
      console.log('[AudioManager] Already at the last episode.');
      // Optionally stop or loop? Currently stops due to RepeatMode.Off
    }
  }, [currentIndex, episodes, actions, position, saveCurrentPosition]);

  const skipToPrevious = useCallback(async () => {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
       // Save current position before skipping
      await saveCurrentPosition(position);
      actions.setCurrentEpisode(episodes[prevIndex], prevIndex);
       // Loading is handled by PlayerScreen effect watching currentEpisode change
    } else {
      console.log('[AudioManager] Already at the first episode.');
      // Optionally seek to 0?
      await seekTo(0);
    }
  }, [currentIndex, episodes, actions, position, saveCurrentPosition, seekTo]);

  // --- Sleep Timer ---
  const handleSleepTimerEnd = useCallback(() => {
      console.log('[AudioManager] Sleep Timer Ended. Stopping playback.');
      pauseAudio();
      actions.toggleSleepTimer(); // Deactivate timer in state

      // Optional: Attempt to close app (platform-specific, might not work reliably)
      // Consider just stopping playback as the primary action.
      // ... (Code for BackHandler.exitApp() or IntentLauncher - use with caution)
  }, [pauseAudio, actions]);


  // --- Event Handling ---
  useEffect(() => {
    const listener = TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
        console.log('[AudioManager] Playback State:', state);
        if (state === State.Error) {
            console.error('[AudioManager] Playback Error Event');
            // TrackPlayer doesn't always provide detailed errors here.
            // Consider checking TrackPlayer.getActiveTrack() or queue for more info if needed.
            actions.setError('Erreur de lecture audio.');
            // Optionally try to reset or skip track
        }
    });

    const trackListener = TrackPlayer.addEventListener(Event.PlaybackTrackChanged, async (data) => {
        console.log('[AudioManager] Track Changed:', data);
        // This event fires when a track starts playing, not just when added.
        // 'nextTrack' might be null if the queue ended.
        if (data.nextTrack) {
            const track = await TrackPlayer.getTrack(data.nextTrack);
            if (track && track.id !== currentEpisode?.id) {
                // If track changes unexpectedly (e.g., remote control), update context
                const newIndex = episodes.findIndex((ep: Episode) => ep.id === track.id);
                if (newIndex !== -1) {
                    console.log(`[AudioManager] Syncing context to track change: ${track.title}`);
                    actions.setCurrentEpisode(episodes[newIndex], newIndex);
                }
            }
        }
    });

    const queueEndListener = TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async (data) => {
        console.log('[AudioManager] Queue Ended:', data);
        if (currentEpisode) {
            console.log(`[AudioManager] Episode ${currentEpisode.title} finished.`);
            actions.setPlaybackState({ isPlaying: false });
            actions.updateProgress(duration, duration); // Mark as finished visually

            // Mark as watched
            if (isOffline) {
                addOfflineWatched(currentEpisode.id);
            } else {
                // Direct Supabase update (or trigger sync)
                const { data: { user } } = await supabase.auth.getUser();
                if (user) {
                    supabase.from('watched_episodes').upsert({
                        episode_id: currentEpisode.id,
                        user_id: user.id, // Get current user ID
                        watched_at: new Date().toISOString(),
                        is_finished: true,
                        playback_position: null
                    }, { onConflict: 'user_id, episode_id' }) // <-- FIX: closing parenthesis was missing here
                    .then(({ error }) => {
                        if (error) console.error('[AudioManager] Error marking episode watched:', error);
                        else console.log(`[AudioManager] Marked ${currentEpisode.id} as watched.`);
                    });
                }
                triggerSync(); // Ensure sync happens if offline data was added

                // Handle sleep timer if active
                if (sleepTimerActive) {
                    handleSleepTimerEnd();
                }

                // Optional: Auto-play next?
                // skipToNext();
            }
        }
    });

    const remotePlay = TrackPlayer.addEventListener(Event.RemotePlay, () => { playAudio(); });
    const remotePause = TrackPlayer.addEventListener(Event.RemotePause, () => { pauseAudio(); });
    const remoteNext = TrackPlayer.addEventListener(Event.RemoteNext, () => { skipToNext(); });
    const remotePrevious = TrackPlayer.addEventListener(Event.RemotePrevious, () => { skipToPrevious(); });
    // Use explicit event data parameter if destructuring causes issues
    const remoteSeek = TrackPlayer.addEventListener(Event.RemoteSeek, (eventData) => { seekTo(eventData.position); });


    return () => {
      listener.remove();
      trackListener.remove();
      queueEndListener.remove();
      remotePlay.remove();
      remotePause.remove();
      remoteNext.remove();
      remotePrevious.remove();
      remoteSeek.remove();
    };
  }, [actions, currentEpisode, episodes, isOffline, sleepTimerActive, duration, playAudio, pauseAudio, skipToNext, skipToPrevious, seekTo, handleSleepTimerEnd]);


  // Save position immediately on pause
  useEffect(() => {
    if (playbackState.state === State.Paused && position > 0) {
      // Clear any pending interval save
      if (savePositionIntervalRef.current) {
        clearInterval(savePositionIntervalRef.current);
        savePositionIntervalRef.current = null;
      }
      // Save immediately
      saveCurrentPosition(position);
    }
  }, [playbackState.state, position, saveCurrentPosition]);

  // Save position periodically while playing
  useEffect(() => {
    if (playbackState.state === State.Playing) {
      if (savePositionIntervalRef.current) {
        clearInterval(savePositionIntervalRef.current); // Clear existing interval if any
      }
      savePositionIntervalRef.current = setInterval(() => {
        saveCurrentPosition(position);
      }, POSITION_SAVE_INTERVAL_MS);
    } else {
      // Clear interval if not playing
      if (savePositionIntervalRef.current) {
        clearInterval(savePositionIntervalRef.current);
        savePositionIntervalRef.current = null;
      }
    }

    // Cleanup interval on unmount or when dependencies change
    return () => {
      if (savePositionIntervalRef.current) {
        clearInterval(savePositionIntervalRef.current);
        savePositionIntervalRef.current = null;
      }
    };
  }, [playbackState.state, position, saveCurrentPosition]);

  // Save position on unmount / app background (handled by PlayerScreen using this hook's state)


  // --- Track Loading ---
  const loadTrack = useCallback(async (episode: Episode, startPosition: number = 0) => {
    if (!episode) return;
    console.log(`[AudioManager] Loading track: ${episode.title}, Start: ${startPosition}s`);
    actions.setPlaybackState({ isLoading: true });
    lastSavedPositionRef.current = -1; // Reset last saved position

    const trackDuration = durationToSeconds(episode.duration);

    const track: Track = {
      id: episode.id,
      url: episode.offline_path || episode.mp3Link,
      title: episode.title,
      artist: 'Big Heads', // Or dynamically set if available
      artwork: episode.artworkUrl || undefined, // Use placeholder
      duration: trackDuration > 0 ? trackDuration : undefined, // Only set if known
      // Add other metadata if needed (genre, date, etc.)
    };

    try {
      await TrackPlayer.reset();
      await TrackPlayer.add(track);
      if (startPosition > 0) {
        await TrackPlayer.seekTo(startPosition);
      }
      // Don't auto-play here, let user press play or handle based on context
      // await TrackPlayer.play();
      actions.setPlaybackState({ isLoading: false });
      console.log(`[AudioManager] Track ${episode.title} loaded.`);
    } catch (error) {
      console.error(`[AudioManager] Error loading track ${episode.title}:`, error);
      actions.setError(`Erreur chargement épisode: ${episode.title}`);
      actions.setPlaybackState({ isLoading: false });
    }
  }, [actions]);


  // --- Sleep Timer Activation/Deactivation ---
  useEffect(() => {
      if (sleepTimerActive) {
          console.log('[AudioManager] Sleep Timer Activated (e.g., 30 minutes)');
          // Clear any existing timer
          if (sleepTimerTimeoutRef.current) {
              clearTimeout(sleepTimerTimeoutRef.current);
          }
          // Set new timer (e.g., 30 minutes)
          sleepTimerTimeoutRef.current = setTimeout(handleSleepTimerEnd, 30 * 60 * 1000);
      } else {
          // Clear timer if deactivated
          if (sleepTimerTimeoutRef.current) {
              clearTimeout(sleepTimerTimeoutRef.current);
              sleepTimerTimeoutRef.current = null;
              console.log('[AudioManager] Sleep Timer Deactivated/Cleared.');
          }
      }

      // Cleanup timer on unmount
      return () => {
          if (sleepTimerTimeoutRef.current) {
              clearTimeout(sleepTimerTimeoutRef.current);
          }
      };
  }, [sleepTimerActive, handleSleepTimerEnd]);


  return {
    loadTrack,
    playAudio,
    pauseAudio,
    seekTo,
    seekRelative,
    skipToNext,
    skipToPrevious,
    saveCurrentPosition, // Expose for saving on app background/unmount
  };
};
