import TrackPlayer, { Event, State as TrackPlayerState } from 'react-native-track-player';
import { audioManager } from './OptimizedAudioService';
import { BackHandler } from 'react-native';

export async function PlaybackService() {
    TrackPlayer.addEventListener(Event.RemotePlay, () => {
        console.log('[PlaybackService] Event.RemotePlay');
        audioManager.play();
    });

    TrackPlayer.addEventListener(Event.RemotePause, () => {
        console.log('[PlaybackService] Event.RemotePause');
        audioManager.pause();
    });

    TrackPlayer.addEventListener(Event.RemoteNext, () => {
        console.log('[PlaybackService] Event.RemoteNext');
        audioManager.skipToNext();
    });

    TrackPlayer.addEventListener(Event.RemotePrevious, () => {
        console.log('[PlaybackService] Event.RemotePrevious');
        audioManager.skipToPrevious();
    });

    TrackPlayer.addEventListener(Event.RemoteStop, async () => {
        console.log('[PlaybackService] Event.RemoteStop');
        // Arrête la lecture et réinitialise le lecteur via AudioManager
        await audioManager.stopAllSounds();
        // Ferme l'application complètement
        BackHandler.exitApp();

    });

    TrackPlayer.addEventListener(Event.RemoteSeek, async (event: { position: number }) => {
        console.log('[PlaybackService] Event.RemoteSeek to:', event.position);
        // event.position est en secondes, audioManager.seekTo attend des millisecondes
        await audioManager.seekTo(event.position * 1000);
    });

    TrackPlayer.addEventListener(Event.RemoteDuck, async (event: { paused: boolean, permanent?: boolean }) => {
        console.log('[PlaybackService] Event.RemoteDuck:', event);
        if (event.permanent) {
            // Interruption permanente (ex: une autre app a pris le focus audio de manière permanente)
            await audioManager.stopAllSounds();
        } else if (event.paused) {
            // Interruption temporaire (ex: notification sonore, appel entrant)
            await audioManager.pause();
        } else {
            // Reprise du focus audio après une interruption temporaire
            // Vous pouvez ajouter une logique pour vérifier si la lecture doit reprendre.
            // Par exemple, si l'utilisateur n'a pas mis en pause manuellement.
            const status = await audioManager.getStatusAsync();
            if (status.isLoaded && !status.isPlaying) {
                await audioManager.play();
            }
        }
    });
}