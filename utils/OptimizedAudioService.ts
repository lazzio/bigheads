import TrackPlayer, {
  Capability,
  Event,
  State,
  TrackType,
  useTrackPlayerEvents,
  RepeatMode,
  AppKilledPlaybackBehavior,
  Track, // Importer Track
  PlaybackState, // Importer PlaybackState
} from 'react-native-track-player';
import { Episode } from '../types/episode';
import { Platform, PermissionsAndroid, NativeModules, Linking } from 'react-native';
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
  private isBuffering = false; // Ajouter un état pour le buffering
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
    if (this.isPlayerReady) return; // Déjà initialisé

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
        progressUpdateEventInterval: 1,
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
      await TrackPlayer.reset(); // Réinitialiser avant de charger une nouvelle piste

      let audioSourceUri: string;
      const isLocal = !!episode.offline_path;

      if (isLocal) {
        audioSourceUri = episode.offline_path!;
        console.log('[AudioManager] Using local file:', audioSourceUri);
      } else if (episode.mp3Link) {
        audioSourceUri = normalizeAudioUrl(episode.mp3Link); // Utiliser la fonction de normalisation
        console.log('[AudioManager] Using remote URL:', audioSourceUri);
      } else {
        throw new Error("Episode has no valid audio source (offline_path or mp3Link).");
      }

      this.currentEpisode = { ...episode }; // Stocker l'épisode actuel

      const track: Track = {
        id: String(episode.id), // Utiliser l'ID de l'épisode comme ID de piste
        url: audioSourceUri,
        title: episode.title || 'Épisode sans titre',
        artist: 'Les Intégrales BigHeads', // Ou autre artiste par défaut
        duration: episode.duration ? Number(episode.duration) : undefined, // Durée en secondes
        type: TrackType.Default,
      };

      await TrackPlayer.add(track);
      console.log(`[AudioManager] Track added: ${track.title}`);

      // Se positionner si nécessaire (après l'ajout de la piste)
      if (initialPositionMillis > 0) {
        // Convertir en secondes pour TrackPlayer.seekTo
        const initialPositionSeconds = initialPositionMillis / 1000;
        // S'assurer que la position initiale ne dépasse pas la durée (si connue)
        const seekPosition = track.duration ? Math.min(initialPositionSeconds, track.duration - 0.1) : initialPositionSeconds;

        if (seekPosition > 0) {
          console.log(`[AudioManager] Seeking to initial position: ${seekPosition}s`);
          // Attendre un court instant pour que le lecteur soit prêt à chercher
          await new Promise(resolve => setTimeout(resolve, 150)); // Petit délai
          try {
            await TrackPlayer.seekTo(seekPosition);
          } catch (seekError) {
            console.error(`[AudioManager] Error seeking to initial position ${seekPosition}s:`, seekError);
            // Continuer même si le seek échoue initialement
          }
        }
      }

      // Mettre à jour l'état interne et notifier les écouteurs
      await this.updateLocalStatus(); // Mettre à jour l'état local immédiatement
      this.notifyListeners({
        type: 'loaded',
        episode: this.currentEpisode,
        duration: this.duration, // Utiliser la durée mise à jour
        isLocalFile: isLocal,
      });

    } catch (error) {
      console.error('[AudioManager] Error in loadSound:', error);
      this.currentEpisode = null; // Réinitialiser l'épisode en cas d'erreur
      this.notifyListeners({ type: 'error', error: error instanceof Error ? error.message : String(error) });
      throw error; // Propager l'erreur
    }
  }

  // --- NOUVELLE MÉTHODE: Obtenir le statut actuel ---
  /**
   * Récupère l'état actuel du lecteur audio.
   * @returns Promise<AudioStatus> L'état actuel.
   */
  public async getStatusAsync(): Promise<AudioStatus> {
    if (!this.isPlayerReady) {
      // Retourner un état par défaut si le lecteur n'est pas prêt
      return {
        isLoaded: false,
        isPlaying: false,
        isBuffering: false,
        positionMillis: 0,
        durationMillis: 0,
        currentEpisodeId: null,
      };
    }
    try {
      const state = await TrackPlayer.getState();
      const activeTrack = await TrackPlayer.getActiveTrack(); // Obtenir la piste active
      const position = await TrackPlayer.getPosition(); // en secondes
      const duration = await TrackPlayer.getDuration(); // en secondes
      const buffered = await TrackPlayer.getBufferedPosition(); // en secondes

      const isLoaded = activeTrack !== null && activeTrack !== undefined;
      const isPlaying = state === State.Playing;
      // Considérer comme buffering si l'état est Buffering/Loading ou si la position bufferisée est proche de la position actuelle
      const isBuffering = state === State.Buffering || state === State.Loading || (isLoaded && duration > 0 && buffered < position + 1 && !isPlaying);

      // Mettre à jour l'état local pour la cohérence (optionnel mais recommandé)
      this.isPlaying = isPlaying;
      this.isBuffering = isBuffering;
      this.position = position * 1000;
      this.duration = duration * 1000;
      // Assurer que currentEpisode est à jour si une piste est chargée
      if (isLoaded && (!this.currentEpisode || String(this.currentEpisode.id) !== activeTrack.id)) {
        // Potentiellement recharger les détails de l'épisode si nécessaire,
        // mais pour le statut, l'ID suffit.
        console.warn(`[AudioManager] Mismatch between active track ID (${activeTrack.id}) and stored episode ID (${this.currentEpisode?.id}). Status reflects active track.`);
      }

      return {
        isLoaded,
        isPlaying,
        isBuffering,
        positionMillis: this.position,
        durationMillis: this.duration,
        currentEpisodeId: activeTrack?.id ?? null, // Utiliser l'ID de la piste active
      };
    } catch (error) {
      console.error('[AudioManager] Error getting status:', error);
      // Retourner un état par défaut en cas d'erreur
      return {
        isLoaded: false,
        isPlaying: false,
        isBuffering: false,
        positionMillis: 0,
        durationMillis: 0,
        currentEpisodeId: this.currentEpisode?.id ?? null, // Retourner l'ID connu si possible
      };
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
      // Notifier les écouteurs que le son est déchargé (ou statut mis à jour)
      this.notifyListeners({
        type: 'status', // Ou un nouveau type 'unloaded'
        position: 0,
        duration: 0,
        isPlaying: false,
        isBuffering: false,
        isLoaded: false, // Indiquer que rien n'est chargé
      });
      console.log('[AudioManager] Sound unloaded.');
    } catch (error) {
      console.error('[AudioManager] Error unloading sound:', error);
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
      const targetPosition = duration ? Math.min(Math.max(0, positionSeconds), duration - 0.1) : Math.max(0, positionSeconds);

      await TrackPlayer.seekTo(targetPosition);
      await this.updateLocalStatus(); // Mettre à jour l'état local immédiatement
    } catch (error) {
      console.error(`[AudioManager] Error seeking to ${positionSeconds}s:`, error);
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
      const currentPosition = await TrackPlayer.getPosition(); // Position actuelle en secondes
      const newPositionSeconds = currentPosition + offsetSeconds;
      // Utiliser la méthode seekTo existante qui gère les limites et prend des millisecondes
      await this.seekTo(newPositionSeconds * 1000);
    } catch (error) {
      console.error(`[AudioManager] Error seeking relative by ${offsetSeconds}s:`, error);
    }
  }

  public async stop(): Promise<void> {
    console.warn('[AudioManager] stop() called. Consider using unloadSound() for full reset.');
    await this.unloadSound(); // Déléger à unloadSound pour la cohérence
  }

  // --- Gestion des écouteurs et état interne ---

  // Mettre à jour l'état local basé sur les requêtes TrackPlayer
  // Utile après des actions comme seekTo pour une mise à jour immédiate
  private async updateLocalStatus(): Promise<void> {
    if (!this.isPlayerReady) return;
    try {
      const status = await this.getStatusAsync(); // Utiliser la nouvelle méthode
      this.isPlaying = status.isPlaying;
      this.isBuffering = status.isBuffering;
      this.position = status.positionMillis;
      this.duration = status.durationMillis;
      // Notifier les changements
      this.notifyListeners({
        type: 'status',
        position: this.position,
        duration: this.duration,
        isPlaying: this.isPlaying,
        isBuffering: this.isBuffering,
        isLoaded: status.isLoaded,
      });
    } catch (error) {
      console.error('[AudioManager] Error updating local status:', error);
    }
  }

  private setupEventListeners(): void {
    console.log('[AudioManager] Setting up event listeners...');
    // Utiliser un Map pour stocker les références aux listeners pour pouvoir les supprimer
    const listeners = new Map<Event, (payload: any) => void>();

    listeners.set(Event.PlaybackState, async (data: { state: State | PlaybackState }) => {
      console.log('[AudioManager] Event.PlaybackState:', data.state);
      const state = typeof data.state === 'string' ? data.state as State : State.None; // Gérer les anciens et nouveaux types d'état
      this.isPlaying = state === State.Playing;
      this.isBuffering = state === State.Buffering || state === State.Loading;
      await this.updateLocalStatus(); // Mettre à jour tout l'état local
      // Déclencher 'finished' UNIQUEMENT lorsque la lecture se termine naturellement.
      // Ne plus le faire pour State.Stopped (qui peut être causé par reset/stop).
      if (state === State.Ended) {
        console.log('[AudioManager] Playback ended.');
        this.notifyListeners({ type: 'finished' }); // Notifier la fin
        // Réinitialiser la position locale et l'état de lecture
        this.position = 0;
        this.isPlaying = false;
        // Notifier le changement de statut (position 0, non en lecture)
        this.notifyListeners({ type: 'status', position: 0, isPlaying: false, isBuffering: false, isLoaded: true }); // Assumer toujours chargé à la fin
      } else if (state === State.Stopped) {
        // Simplement logguer l'arrêt sans déclencher 'finished'
        console.log('[AudioManager] Playback stopped (likely due to reset or stop call).');
        // L'état isPlaying et isBuffering est déjà mis à jour plus haut.
        // updateLocalStatus s'assure que les listeners sont notifiés de l'état arrêté.
      }
    });

    listeners.set(Event.PlaybackProgressUpdated, (data: { position: number; duration: number; buffered: number }) => {
      this.position = data.position * 1000;
      this.duration = data.duration * 1000;
      // Mettre à jour isBuffering basé sur la position bufferisée
      this.isBuffering = this.isPlaying && data.buffered < data.position + 1.5 && data.duration > 0;

      this.notifyListeners({
        type: 'status',
        position: this.position,
        duration: this.duration,
        isPlaying: this.isPlaying, // Garder l'état isPlaying actuel
        isBuffering: this.isBuffering,
        isLoaded: true, // Si on reçoit la progression, c'est chargé
      });
    });

    listeners.set(Event.PlaybackError, (error: any) => {
      console.error('[AudioManager] Event.PlaybackError:', error.code, error.message);
      this.isPlaying = false;
      this.isBuffering = false;
      this.notifyListeners({ type: 'error', error: error.message || 'Erreur de lecture inconnue' });
    });

    listeners.set(Event.PlaybackActiveTrackChanged, async (data: { track?: Track | null, nextTrack?: Track | null }) => {
      console.log(`[AudioManager] Event.PlaybackActiveTrackChanged: New track ID: ${data.track?.id}`);
      if (!data.track) {
        // La piste a été retirée ou la file est vide
        console.log('[AudioManager] Active track is now null/undefined.');
        await this.unloadSound(); // Considérer comme déchargé
      } else {
        // Une nouvelle piste est active, mettre à jour l'épisode actuel si possible
        if (!this.currentEpisode || String(this.currentEpisode.id) !== data.track.id) {
          console.warn(`[AudioManager] Active track changed (${data.track.id}), but internal episode might be out of sync.`);
          // Idéalement, il faudrait retrouver l'objet Episode correspondant à data.track.id
          // Pour l'instant, on met juste à jour l'état avec les infos de la piste
          this.currentEpisode = { // Créer un Episode partiel basé sur la Track
            id: data.track.id!,
            title: data.track.title || 'Épisode inconnu',
            mp3Link: data.track.url as string,
            description: '',
            duration: String(data.track.duration ?? 0),
            publicationDate: ''
          };
        }
        await this.updateLocalStatus(); // Mettre à jour le statut avec la nouvelle piste
      }
    });

    // --- Écouteurs pour les contrôles à distance (notification/lock screen) ---
    listeners.set(Event.RemotePlay, () => { console.log('[AudioManager] Event.RemotePlay'); this.play(); });
    listeners.set(Event.RemotePause, () => { console.log('[AudioManager] Event.RemotePause'); this.pause(); });
    listeners.set(Event.RemoteStop, () => { console.log('[AudioManager] Event.RemoteStop'); this.unloadSound(); }); // Utiliser unloadSound
    listeners.set(Event.RemoteSeek, (data: { position: number }) => { console.log(`[AudioManager] Event.RemoteSeek: ${data.position}s`); this.seekTo(data.position * 1000); });
    listeners.set(Event.RemoteNext, () => { console.log('[AudioManager] Event.RemoteNext'); this.notifyListeners({ type: 'remote-next' }); });
    listeners.set(Event.RemotePrevious, () => { console.log('[AudioManager] Event.RemotePrevious'); this.notifyListeners({ type: 'remote-previous' }); });

    // Ajouter tous les écouteurs définis
    for (const [event, listener] of listeners.entries()) {
      TrackPlayer.addEventListener(event, listener);
    }
  }

  public addListener(callback: (data: any) => void): () => void {
    this.listeners.add(callback);
    // Envoyer l'état actuel immédiatement après l'ajout
    this.getStatusAsync().then(status => {
      callback({
        type: 'status',
        ...status // Envoyer toutes les propriétés du statut
      });
    }).catch(err => console.error("Error sending initial status to listener:", err));

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
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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
