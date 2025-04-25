import TrackPlayer, { Event } from 'react-native-track-player';

// Basic PlaybackService - More complex logic (like state management, sync)
// should ideally be handled within the main app context when possible,
// but this service ensures background controls work even if the app UI isn't active.
export async function PlaybackService() {

  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    console.log('[PlaybackService] Remote Play received');
    TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    console.log('[PlaybackService] Remote Pause received');
    TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    console.log('[PlaybackService] Remote Next received');
    TrackPlayer.skipToNext();
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    console.log('[PlaybackService] Remote Previous received');
    TrackPlayer.skipToPrevious();
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    console.log('[PlaybackService] Remote Seek received', event);
    TrackPlayer.seekTo(event.position);
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    console.log('[PlaybackService] Remote Stop received');
    TrackPlayer.stop();
    // Consider if you need TrackPlayer.destroy() depending on your app's lifecycle
  });

  // Optional: Handle playback ending or errors if needed in the background context
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, (event) => {
    console.log('[PlaybackService] Playback Queue Ended', event);
    // Potentially handle marking as watched or stopping service here if app is killed
  });

  TrackPlayer.addEventListener(Event.PlaybackState, (state) => {
    // console.log('[PlaybackService] Playback State Changed', state);
    // Can be used for debugging background state changes
  });

   TrackPlayer.addEventListener(Event.PlaybackError, (error) => {
    console.error('[PlaybackService] Playback Error', error);
    // Handle background playback errors
  });

}
