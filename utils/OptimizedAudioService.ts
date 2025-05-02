import TrackPlayer, {
  Capability,
  Event,
  State,
  TrackType,
  AppKilledPlaybackBehavior,
  Track,
} from 'react-native-track-player';
import { Episode } from '../types/episode';
import { Platform, PermissionsAndroid, Linking } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';

// Interface pour le statut retourné par getStatusAsync
export interface AudioStatus {
  isLoaded: boolean;
  isPlaying: boolean;
  isBuffering: boolean;
  positionMillis: number;
  durationMillis: number;
  currentEpisodeId: string | null;
}

// Classe singleton pour gérer l'état audio global
class AudioManager {
  private static instance: AudioManager;
  private isPlayerReady = false;
  private currentEpisode: Episode | null = null;
  private position = 0;
  private duration = 0;
  private isPlaying = false;
  private isBuffering = false;
  private listeners: Set<(data: any) => void> = new Set();

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

    try {
      console.log('[AudioManager] Setting up TrackPlayer...');
      await TrackPlayer.setupPlayer({
        autoHandleInterruptions: true,
      });

      await TrackPlayer.updateOptions({
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.Stop,
          Capability.SeekTo,
          Capability.SkipToPrevious,
          Capability.SkipToNext,
        ],
        compactCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToPrevious,
          Capability.SkipToNext,
        ],
        android: {
          appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
        },
        notificationCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SeekTo,
          Capability.SkipToPrevious,
          Capability.SkipToNext,
        ],
        icon: require('../assets/images/bh_opti.png'),
        progressUpdateEventInterval: 1,
        alwaysPauseOnInterruption: false,
      });

      this.isPlayerReady = true;
      console.log('[AudioManager] TrackPlayer setup complete.');
      this.setupEventListeners(); // Configurer les écouteurs après l'initialisation
    } catch (error) {
      console.error('[AudioManager] Error setting up TrackPlayer:', error);
      this.isPlayerReady = false; // Marquer comme non prêt en cas d'erreur
    }
  }

  // --- NOUVELLE MÉTHODE: Charger un son avec position initiale ---
  /**
   * Charge un épisode et démarre optionnellement la lecture à une position donnée.
   * @param episode L'épisode à charger.
   * @param initialPositionMillis Position initiale en millisecondes.
   */
  public async loadSound(episode: Episode, initialPositionMillis: number = 0): Promise<void> {
    if (!this.isPlayerReady) {
      console.warn('[AudioManager] Player not ready, attempting setup...');
      await this.setupAudio();
      if (!this.isPlayerReady) {
        throw new Error("TrackPlayer setup failed, cannot load sound.");
      }
    }

    console.log(`[AudioManager] Loading sound for episode ${episode.id} at ${initialPositionMillis}ms`);

    try {
      await TrackPlayer.reset();

      let audioSourceUri: string;
      const isLocal = !!episode.offline_path;

      if (isLocal) {
        audioSourceUri = episode.offline_path!;
        console.log('[AudioManager] Using local file:', audioSourceUri);
      } else if (episode.mp3Link) {
        audioSourceUri = normalizeAudioUrl(episode.mp3Link);
        console.log('[AudioManager] Using remote URL:', audioSourceUri);
      } else {
        throw new Error("Episode has no valid audio source (offline_path or mp3Link).");
      }

      this.currentEpisode = { ...episode }; // Stocker l'épisode actuel
      // Réinitialiser l'état avant le chargement
      this.position = 0;
      // Utiliser la durée de l'épisode si dispo, convertir en ms
      this.duration = episode.duration ? Number(episode.duration) * 1000 : 0;
      this.isPlaying = false;
      this.isBuffering = true; // Considérer en buffering pendant le chargement

      const track: Track = {
        id: String(episode.id),
        url: audioSourceUri,
        title: episode.title || 'Épisode sans titre',
        artist: 'Les Intégrales BigHeads',
        // Passer la durée en secondes à TrackPlayer si disponible
        duration: episode.duration ? Number(episode.duration) : undefined,
        type: TrackType.Default,
      };

      await TrackPlayer.add(track);
      console.log(`[AudioManager] Track added: ${track.title}`);

      // --- Initial Seek ---
      let actualInitialPositionMillis = 0;
      let trackDurationSeconds: number | undefined = track.duration;

      // Only try to seek if we have a position
      if (initialPositionMillis > 0) {
        const initialPositionSeconds = initialPositionMillis / 1000;
        console.log(`[AudioManager] Will seek to ${initialPositionSeconds.toFixed(2)}s after loading`);

        // Try to get duration after add
        if (!trackDurationSeconds || trackDurationSeconds <= 0) {
          try {
            await new Promise(resolve => setTimeout(resolve, 100)); // Wait for track to be processed
            trackDurationSeconds = await TrackPlayer.getDuration();
            console.log(`[AudioManager] Fetched duration: ${trackDurationSeconds?.toFixed(2)}s`);
          } catch (e) {
            console.warn('[AudioManager] Could not get duration after add:', e);
            trackDurationSeconds = 0;
          }
        }

        // Calculate seek position (don't seek past the end)
        const seekPositionSeconds = trackDurationSeconds && trackDurationSeconds > 0
          ? Math.min(initialPositionSeconds, trackDurationSeconds - 0.5)
          : initialPositionSeconds;

        if (seekPositionSeconds > 0) {
          console.log(`[AudioManager] Seeking to initial position: ${seekPositionSeconds.toFixed(2)}s`);
          
          // Add a small delay to ensure track is loaded before seeking
          await new Promise(resolve => setTimeout(resolve, 200));
          
          try {
            await TrackPlayer.seekTo(seekPositionSeconds);
            actualInitialPositionMillis = seekPositionSeconds * 1000;
            console.log(`[AudioManager] Seek successful to ${actualInitialPositionMillis.toFixed(0)}ms`);
          } catch (seekError) {
            console.error(`[AudioManager] Error seeking to initial position ${seekPositionSeconds.toFixed(2)}s:`, seekError);
            // Try one more time with more delay
            try {
              await new Promise(resolve => setTimeout(resolve, 500));
              await TrackPlayer.seekTo(seekPositionSeconds);
              actualInitialPositionMillis = seekPositionSeconds * 1000;
              console.log(`[AudioManager] Second seek attempt successful to ${actualInitialPositionMillis.toFixed(0)}ms`);
            } catch (retryError) {
              console.error(`[AudioManager] Even second seek attempt failed:`, retryError);
            }
          }
        }
      }

      // Update internal state
      this.position = actualInitialPositionMillis;
      
      // Try to get duration if still needed
      if (this.duration === 0) {
        try {
          const actualDuration = await TrackPlayer.getDuration();
          if (actualDuration > 0) {
            this.duration = actualDuration * 1000;
            console.log(`[AudioManager] Updated duration: ${this.duration}ms`);
          }
        } catch (e) { /* Ignore duration errors */ }
      }

      this.isBuffering = false;

      // Notify listeners
      this.notifyListeners({
        type: 'loaded',
        episode: this.currentEpisode,
        duration: this.duration,
        isLocalFile: isLocal,
      });
      
      // Send initial status
      this.notifyListeners({
        type: 'status',
        position: this.position,
        duration: this.duration,
        isPlaying: this.isPlaying,
        isBuffering: this.isBuffering,
        isLoaded: true,
        episodeId: this.currentEpisode?.id ?? null,
      });

    } catch (error) {
      console.error('[AudioManager] Error in loadSound:', error);
      const episodeIdOnError = this.currentEpisode?.id ?? null; // Capture before resetting
      this.currentEpisode = null;
      this.position = 0;
      this.duration = 0;
      this.isPlaying = false;
      this.isBuffering = false;
      this.notifyListeners({ type: 'error', error: error instanceof Error ? error.message : String(error), episodeId: episodeIdOnError });
      this.notifyListeners({ type: 'status', position: 0, duration: 0, isPlaying: false, isBuffering: false, isLoaded: false, episodeId: null }); // Notify reset status
      throw error;
    }
  }

  // --- MODIFICATION: getStatusAsync devient une pure requête ---
  public async getStatusAsync(): Promise<AudioStatus> {
    if (!this.isPlayerReady) {
      return { isLoaded: false, isPlaying: false, isBuffering: false, positionMillis: 0, durationMillis: 0, currentEpisodeId: null };
    }
    try {
      const [state, position, duration, buffered, currentTrackIdObject] = await Promise.all([
        TrackPlayer.getState(),
        TrackPlayer.getPosition(), // secondes
        TrackPlayer.getDuration(), // secondes
        TrackPlayer.getBufferedPosition(), // secondes
        TrackPlayer.getTrack(await TrackPlayer.getCurrentTrack() ?? 0)
      ]);

      const isLoaded = state !== State.None && state !== State.Stopped && duration > 0;
      const isPlaying = state === State.Playing;
      // Consider buffering if loading, buffering, or playing near the end without enough buffer
      const isBuffering = state === State.Buffering || state === State.Loading || (isPlaying && duration > 0 && buffered < position + 1 && position < duration - 1);
      const currentTrackId = currentTrackIdObject?.id ?? null;

      // Ensure the internal currentEpisode matches the actual track player state if possible
      if (this.currentEpisode && this.currentEpisode.id !== currentTrackId) {
          console.warn(`[AudioManager] getStatusAsync detected mismatch: Internal=${this.currentEpisode.id}, TrackPlayer=${currentTrackId}. Internal state might be stale.`);
          // Optionally: Force update internal state here? Risky if called frequently.
      }

      // Retourner l'état fraîchement récupéré
      return {
        isLoaded,
        isPlaying,
        isBuffering,
        // Retourner les valeurs directes de TrackPlayer (converties en ms)
        positionMillis: position * 1000,
        durationMillis: duration * 1000,
        // --- MODIFICATION: Return current track ID from TrackPlayer ---
        currentEpisodeId: currentTrackId ? String(currentTrackId) : null,
      };
    } catch (error) {
      console.error('[AudioManager] Error in getStatusAsync:', error);
      // Return default state on error, reset internal potentially?
      this.currentEpisode = null; // Reset internal state if TP fails
      this.isPlaying = false;
      this.isBuffering = false;
      this.position = 0;
      this.duration = 0;
      return { isLoaded: false, isPlaying: false, isBuffering: false, positionMillis: 0, durationMillis: 0, currentEpisodeId: null };
    }
  }

  // --- NOUVELLE MÉTHODE: Décharger le son ---
  /**
   * Arrête la lecture et décharge la piste actuelle.
   */
  public async unloadSound(): Promise<void> {
    console.log('[AudioManager] Unloading sound...');
    if (!this.isPlayerReady) return;
    try {
      await TrackPlayer.reset(); // reset arrête, supprime la file d'attente et réinitialise
      this.currentEpisode = null;
      this.position = 0;
      this.duration = 0;
      this.isPlaying = false;
      this.isBuffering = false;
      // Notify listeners about the unloaded state
      this.notifyListeners({ type: 'status', position: 0, duration: 0, isPlaying: false, isBuffering: false, isLoaded: false, episodeId: null }); // <<< AJOUTER episodeId: null
      console.log('[AudioManager] Sound unloaded.');
    } catch (error) {
      console.error('[AudioManager] Error unloading sound:', error);
      // Attempt to reset state even on error
      this.currentEpisode = null;
      this.position = 0;
      this.duration = 0;
      this.isPlaying = false;
      this.isBuffering = false;
      this.notifyListeners({ type: 'status', position: 0, duration: 0, isPlaying: false, isBuffering: false, isLoaded: false, episodeId: null }); // <<< AJOUTER episodeId: null
    }
  }

  // --- Méthodes existantes (play, pause, seekTo, stop, etc.) ---
  // Assurez-vous qu'elles mettent à jour l'état local (this.isPlaying, etc.)
  // et utilisent updateLocalStatus ou getStatusAsync si nécessaire.

  public async play(): Promise<void> {
    if (!this.isPlayerReady) return;
    console.log('[AudioManager] Playing...');
    try {
      await TrackPlayer.play();
      // L'événement PlaybackState mettra à jour isPlaying via l'écouteur
    } catch (error) {
      console.error('[AudioManager] Error playing:', error);
      this.notifyListeners({ type: 'error', error: 'Erreur lors de la lecture.' });
    }
  }

  public async pause(): Promise<void> {
    if (!this.isPlayerReady) return;
    console.log('[AudioManager] Pausing...');
    try {
      await TrackPlayer.pause();
      // L'événement PlaybackState mettra à jour isPlaying via l'écouteur
    } catch (error) {
      console.error('[AudioManager] Error pausing:', error);
      this.notifyListeners({ type: 'error', error: 'Erreur lors de la mise en pause.' });
    }
  }

  // seekTo prend maintenant des millisecondes pour la cohérence interne
  public async seekTo(positionMillis: number): Promise<void> {
    if (!this.isPlayerReady) return;
    const positionSeconds = positionMillis / 1000;
    console.log(`[AudioManager] Seeking to absolute ${positionSeconds.toFixed(1)}s`);
    try {
      const duration = await TrackPlayer.getDuration(); // en secondes
      // S'assurer que la position cible est valide
      const targetPosition = duration ? Math.min(Math.max(0, positionSeconds), duration - 0.1) : Math.max(0, positionSeconds);

      // Simplement demander à TrackPlayer de chercher la position
      await TrackPlayer.seekTo(targetPosition);

      // <<< Supprimer la mise à jour locale immédiate >>>
      // await this.updateLocalStatus();
      // La mise à jour se fera via l'événement PlaybackProgressUpdated

    } catch (error) {
      console.error(`[AudioManager] Error seeking to ${positionSeconds}s:`, error);
      // Optionnel: notifier une erreur de seek?
      // this.notifyListeners({ type: 'error', error: 'Erreur lors du déplacement.' });
    }
  }

  // --- NOUVELLE MÉTHODE: Avancer/Reculer relativement ---
  /**
   * Avance ou recule la lecture d'un certain nombre de secondes.
   * @param offsetSeconds Nombre de secondes à ajouter (positif pour avancer, négatif pour reculer).
   */
  public async seekRelative(offsetSeconds: number): Promise<void> {
    if (!this.isPlayerReady) return;
    console.log(`[AudioManager] Seeking relative by ${offsetSeconds}s`);
    try {
      // Obtenir la position actuelle directement depuis TrackPlayer pour plus de précision
      const currentPositionSeconds = await TrackPlayer.getPosition();
      const newPositionSeconds = currentPositionSeconds + offsetSeconds;
      // Utiliser la méthode seekTo existante qui gère les limites et prend des millisecondes
      await this.seekTo(newPositionSeconds * 1000); // seekTo ne met plus à jour immédiatement
    } catch (error) {
      console.error(`[AudioManager] Error seeking relative by ${offsetSeconds}s:`, error);
      // Optionnel: notifier une erreur de seek?
      // this.notifyListeners({ type: 'error', error: 'Erreur lors du déplacement relatif.' });
    }
  }

  public async stop(): Promise<void> {
    console.warn('[AudioManager] stop() called. Consider using unloadSound() for full reset.');
    await this.unloadSound(); // Déléger à unloadSound pour la cohérence
  }

  // --- Gestion des écouteurs et état interne ---

  private setupEventListeners(): void {
    console.log('[AudioManager] Setting up event listeners...');
    // Utiliser un Map pour stocker les références aux listeners pour pouvoir les supprimer
    const listeners = new Map<Event, (payload: any) => void>();

    // --- MODIFICATION: PlaybackState met à jour l'état interne et notifie directement ---
    listeners.set(Event.PlaybackState, async (data: { state: State }) => {
      const state = data.state;
      let isPlaying = this.isPlaying; // Default to current state to handle buffering correctly
      let isBuffering = this.isBuffering;
      let isLoaded = this.currentEpisode !== null; // Assume loaded if an episode is set

      console.log(`[AudioManager] Playback state changed: ${state}`);

      switch (state) {
        case State.Playing:
          isPlaying = true;
          isBuffering = false;
          isLoaded = true;
          break;
        case State.Paused:
          isPlaying = false;
          isBuffering = false;
          isLoaded = true; // Still loaded when paused
          break;
        case State.Buffering:
        case State.Loading: // Group loading and buffering
          // Keep previous playing state during buffer (already defaulted)
          isBuffering = true;
          isLoaded = true; // Considered loaded even if buffering
          break;
        case State.Ready:
        case State.Connecting: // Group ready and connecting
          // Intermediate states, might be buffering
          isPlaying = false; // Explicitly set to false for these states
          isBuffering = true; // Assume buffering during ready/connecting
          isLoaded = true;
          break;
        case State.Error:
          console.error('[AudioManager] Playback error state detected.');
          isPlaying = false;
          isBuffering = false;
          isLoaded = false; // Consider not loaded on error
          this.currentEpisode = null; // Reset episode on error
          this.position = 0;
          this.duration = 0;
          this.notifyListeners({ type: 'error', error: 'Erreur de lecture TrackPlayer.', episodeId: null });
          break;
        case State.Ended:
          console.log('[AudioManager] Playback ended.');
          isPlaying = false;
          isBuffering = false;
          isLoaded = true; // Still loaded at the end, just not playing
          // Position should be at the end, duration remains
          this.position = this.duration; // Set position to end
          this.notifyListeners({ type: 'finished', episodeId: this.currentEpisode?.id ?? null });
          break;
        case State.Stopped:
          console.log('[AudioManager] Playback stopped.');
          isPlaying = false;
          isBuffering = false;
          isLoaded = false; // Stopped implies not loaded/ready
          this.currentEpisode = null; // Reset episode on stop
          this.position = 0;
          this.duration = 0;
          break;
        case State.None: // Explicitly handle None
        default: // Catch any unexpected states
          isPlaying = false;
          isBuffering = false;
          isLoaded = false;
          break;
      }

      // Update internal state
      this.isPlaying = isPlaying;
      this.isBuffering = isBuffering;

      // Notify listeners with the updated state, including position/duration
      // Avoid notifying redundantly for states like Error/Ended/Stopped where specific notifications already happened?
      // Let's notify always for status consistency, except maybe after error/finished?
      // Re-evaluating: Notify always to ensure UI reflects the final state (e.g., isPlaying=false after Ended)
      this.notifyListeners({
          type: 'status',
          position: this.position, // Use potentially updated position (e.g., after Ended)
          duration: this.duration, // Use potentially updated duration (e.g., after Error/Stopped)
          isPlaying: this.isPlaying,
          isBuffering: this.isBuffering,
          isLoaded: isLoaded, // Use the isLoaded determined within the switch
          // --- MODIFICATION: Include episode ID in status ---
          episodeId: this.currentEpisode?.id ?? null,
      });
    });

    // --- MODIFICATION: PlaybackProgressUpdated met à jour l'état interne et notifie ---
    listeners.set(Event.PlaybackProgressUpdated, (data: { position: number; duration: number; buffered: number }) => {
      // Update internal state
      const newPosition = data.position * 1000;
      const newDuration = data.duration * 1000;

      // Only update if changed significantly to avoid excessive updates? No, let TP handle frequency.
      this.position = newPosition;
      if (newDuration > 0 && this.duration !== newDuration) {
          this.duration = newDuration; // Update duration if it changes
      }

      // Determine buffering state based on progress
      // If playing and buffered position is close to current position, consider buffering
      const isPotentiallyBuffering = this.isPlaying && newDuration > 0 && data.buffered < data.position + 1 && data.position < data.duration - 1;
      if (isPotentiallyBuffering !== this.isBuffering) {
          this.isBuffering = isPotentiallyBuffering;
      }

      // Notify listeners
      this.notifyListeners({
        type: 'status',
        position: this.position,
        duration: this.duration,
        isPlaying: this.isPlaying,
        isBuffering: this.isBuffering, // Use updated buffering state
        isLoaded: this.currentEpisode !== null && this.duration > 0,
        // --- MODIFICATION: Include episode ID in status ---
        episodeId: this.currentEpisode?.id ?? null,
      });
    });

    // --- MODIFICATION: PlaybackTrackChanged ---
    listeners.set(Event.PlaybackTrackChanged, (data: { track: Track | null, nextTrack: Track | null, position: number }) => {
        console.log(`[AudioManager] Track changed. Next track: ${data.nextTrack?.id}, Current track obj: ${data.track?.id}`);
        // This event signals that a NEW track is about to be played (or playback stopped).
        // 'data.track' is the *previous* track, 'data.nextTrack' is the *new* one.
        if (!data.nextTrack) {
            // Playback likely stopped or finished queue
            console.log('[AudioManager] Track changed to null/end of queue.');
            // State change (Ended/Stopped) should handle resetting internal state.
        } else {
            // A new track is active, update the internal episode if it doesn't match
            const newTrackId = String(data.nextTrack.id); // Assurer que c'est une string
            if (!this.currentEpisode || this.currentEpisode.id !== newTrackId) {
                console.warn(`[AudioManager] Active track changed (${newTrackId}), updating internal episode.`);
                // Try to create a partial Episode object based on the Track
                // This might be incomplete but better than having the wrong episode internally
                this.currentEpisode = {
                    id: newTrackId,
                    title: data.nextTrack.title || 'Épisode inconnu',
                    mp3Link: data.nextTrack.url as string, // Assume url is mp3Link
                    description: '', // Missing info
                    duration: data.nextTrack.duration ?? 0, // Use duration from track if available
                    publicationDate: '', // Missing info
                };
                // Reset position for the new track
                this.position = 0;
                this.duration = (data.nextTrack.duration ?? 0) * 1000;
                this.isPlaying = false; // Assume not playing initially
                this.isBuffering = true; // Assume buffering for new track
            }
        }
        // Notify status immediately after track change? Or wait for state/progress events?
        // Let's notify to reflect the potential change in episode/duration/position
        this.notifyListeners({
            type: 'status',
            position: this.position,
            duration: this.duration,
            isPlaying: this.isPlaying,
            isBuffering: this.isBuffering,
            isLoaded: this.currentEpisode !== null,
            episodeId: this.currentEpisode?.id ?? null,
        });
    });

    // ... (autres écouteurs: remote-play, remote-pause, etc.) ...
    listeners.set(Event.RemotePlay, () => {
        console.log('[AudioManager] Remote play received');
        this.play(); // Call internal play method
        this.notifyListeners({ type: 'remote-play' });
    });
    listeners.set(Event.RemotePause, () => {
        console.log('[AudioManager] Remote pause received');
        this.pause(); // Call internal pause method
        this.notifyListeners({ type: 'remote-pause' });
    });
    listeners.set(Event.RemoteNext, () => {
        console.log('[AudioManager] Remote next received');
        this.notifyListeners({ type: 'remote-next' });
    });
    listeners.set(Event.RemotePrevious, () => {
        console.log('[AudioManager] Remote previous received');
        this.notifyListeners({ type: 'remote-previous' });
    });
    listeners.set(Event.RemoteSeek, (data: { position: number }) => {
        console.log(`[AudioManager] Remote seek received: ${data.position}s`);
        this.seekTo(data.position * 1000); // Seek using internal method (takes ms)
        this.notifyListeners({ type: 'remote-seek', position: data.position * 1000 });
    });
    // --- FIN MODIFICATIONS ÉCOUTEURS ---

    TrackPlayer.addEventListener(Event.PlaybackState, listeners.get(Event.PlaybackState)!);
    TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, listeners.get(Event.PlaybackProgressUpdated)!);
    TrackPlayer.addEventListener(Event.PlaybackTrackChanged, listeners.get(Event.PlaybackTrackChanged)!);
    TrackPlayer.addEventListener(Event.RemotePlay, listeners.get(Event.RemotePlay)! as () => void);
    TrackPlayer.addEventListener(Event.RemotePause, listeners.get(Event.RemotePause)! as () => void);
    TrackPlayer.addEventListener(Event.RemoteNext, listeners.get(Event.RemoteNext)! as () => void);
    TrackPlayer.addEventListener(Event.RemotePrevious, listeners.get(Event.RemotePrevious)! as () => void);
    TrackPlayer.addEventListener(Event.RemoteSeek, listeners.get(Event.RemoteSeek)!);

    // Note: Consider adding PlaybackQueueEnded and PlaybackMetadataReceived if needed
  }

  public addListener(callback: (data: any) => void): () => void {
    this.listeners.add(callback);
    // Envoyer l'état interne actuel immédiatement après l'ajout
    callback({
      type: 'status',
      position: this.position,
      duration: this.duration,
      isPlaying: this.isPlaying,
      isBuffering: this.isBuffering,
      isLoaded: this.currentEpisode !== null, // Considérer chargé si un épisode est défini
      // Envoyer toutes les propriétés de AudioStatus si possible
      currentEpisodeId: this.currentEpisode?.id ?? null,
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

  public async getState(): Promise<AudioStatus> {
    return this.getStatusAsync();
  }

  public async cleanup(): Promise<void> {
    console.log('[AudioManager] Cleaning up...');
    if (this.isPlayerReady) {
      await TrackPlayer.reset(); // Utiliser reset pour arrêter et vider
    }
    this.listeners.clear();
    this.isPlayerReady = false; // Marquer comme non prêt
    console.log('[AudioManager] Cleanup complete.');
  }
}

// Exporter l'instance singleton
export const audioManager = AudioManager.getInstance();

// Exporter des fonctions utilitaires
export function formatTime(milliseconds: number): string {
  if (isNaN(milliseconds) || milliseconds < 0) {
    return "0:00"; // Retourner une valeur par défaut pour les entrées invalides
  }

  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const paddedSeconds = seconds.toString().padStart(2, '0');
  const paddedMinutes = minutes.toString().padStart(2, '0');

  if (hours > 0) {
    const paddedHours = hours.toString().padStart(2, '0');
    return `${paddedHours}:${paddedMinutes}:${paddedSeconds}`;
  } else {
    return `${minutes}:${paddedSeconds}`; // Garder MM:SS si moins d'une heure
  }
}

export function isValidAudioUrl(url: string | undefined): boolean {
  if (!url) return false;
  
  const trimmedUrl = url.trim();
  if (trimmedUrl === '') return false;
  
  // Accepter aussi les chemins de fichiers locaux
  if (trimmedUrl.startsWith('file://')) return true;
  
  try {
    const urlToCheck = trimmedUrl.startsWith('http')
      ? trimmedUrl
      : `https://${trimmedUrl}`;
      
    new URL(urlToCheck);
    return true;
  } catch {
    return false;
  }
}

export function normalizeAudioUrl(url: string | undefined): string {
  if (!url) return '';
  
  const trimmedUrl = url.trim();
  if (trimmedUrl === '') return '';
  
  // Ne pas modifier les chemins de fichiers locaux
  if (trimmedUrl.startsWith('file://')) return trimmedUrl;
  
  if (!trimmedUrl.startsWith('http')) {
    return `https://${trimmedUrl}`;
  }
  
  return trimmedUrl;
}

export async function requestBatteryOptimizationExemption(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  
  try {
    // Vérifier si nous avons déjà la permission
    const hasPermission = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
    );
    
    if (hasPermission) {
      // Ouvrir les paramètres pour désactiver l'optimisation de batterie
      const pkg = "xyz.myops.bigheads"; // Remplacer par votre package
      const intent = `package:${pkg}`;
      
      try {
        // Méthode 1: Utiliser Linking
        await Linking.openSettings();
        alert("Veuillez désactiver l'optimisation de la batterie pour cette application");
        return true;
      } catch (e) {
        try {
          // Méthode 2: Utiliser IntentLauncher
          await IntentLauncher.startActivityAsync(
            'android.settings.APPLICATION_DETAILS_SETTINGS',
            { data: intent }
          );
          alert("Veuillez désactiver l'optimisation de la batterie pour cette application");
          return true;
        } catch (err) {
          console.error("Impossible d'ouvrir les paramètres:", err);
          return false;
        }
      }
    } else {
      // Demander la permission
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
        {
          title: "Permission requise",
          message: "Pour que l'audio continue en arrière-plan, cette application a besoin d'être exemptée de l'optimisation de batterie",
          buttonNeutral: "Me demander plus tard",
          buttonNegative: "Annuler",
          buttonPositive: "OK"
        }
      );
      
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
  } catch (error) {
    console.error("Erreur lors de la demande d'exemption d'optimisation de batterie:", error);
    return false;
  }
}
