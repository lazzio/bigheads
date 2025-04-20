import TrackPlayer, {
  Capability,
  Event,
  State,
  TrackType,
  AppKilledPlaybackBehavior,
  Track, // Importer Track
  PlaybackState, // Importer PlaybackState
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
      this.duration = episode.duration ? episode.duration * 1000 : 0; // Utiliser la durée de l'épisode si dispo
      this.isPlaying = false;
      this.isBuffering = true; // Considérer en buffering pendant le chargement

      const track: Track = {
        id: String(episode.id),
        url: audioSourceUri,
        title: episode.title || 'Épisode sans titre',
        artist: 'Les Intégrales BigHeads',
        duration: episode.duration ? Number(episode.duration) : undefined,
        type: TrackType.Default,
      };

      await TrackPlayer.add(track);
      console.log(`[AudioManager] Track added: ${track.title}`);

      // --- Gestion du Seek Initial ---
      let actualInitialPositionMillis = 0;
      if (initialPositionMillis > 0) {
        const initialPositionSeconds = initialPositionMillis / 1000;
        const trackDurationSeconds = track.duration; // Durée en secondes
        const seekPositionSeconds = trackDurationSeconds ? Math.min(initialPositionSeconds, trackDurationSeconds - 0.1) : initialPositionSeconds;

        if (seekPositionSeconds > 0) {
          console.log(`[AudioManager] Seeking to initial position: ${seekPositionSeconds}s`);
          await new Promise(resolve => setTimeout(resolve, 150)); // Délai
          try {
            await TrackPlayer.seekTo(seekPositionSeconds);
            actualInitialPositionMillis = seekPositionSeconds * 1000; // Mémoriser la position réelle après seek
          } catch (seekError) {
            console.error(`[AudioManager] Error seeking to initial position ${seekPositionSeconds}s:`, seekError);
          }
        }
      }
      // --- Fin Seek Initial ---

      // Mettre à jour l'état interne APRÈS le seek potentiel
      this.position = actualInitialPositionMillis;
      // Essayer de récupérer la durée réelle si non fournie ou 0
      if (this.duration === 0) {
          try {
              const actualDuration = await TrackPlayer.getDuration(); // secondes
              if (actualDuration > 0) {
                  this.duration = actualDuration * 1000;
              }
          } catch (e) { /* Ignorer si getDuration échoue ici */ }
      }
      this.isBuffering = false; // Supposer que le chargement/seek initial est terminé

      // <<< SUPPRIMER l'appel à updateLocalStatus >>>
      // await this.updateLocalStatus();

      // Notifier que le chargement est terminé avec l'état interne mis à jour
      this.notifyListeners({
        type: 'loaded',
        episode: this.currentEpisode,
        duration: this.duration,
        isLocalFile: isLocal,
      });
      // Envoyer aussi un événement status initial
       this.notifyListeners({
         type: 'status',
         position: this.position,
         duration: this.duration,
         isPlaying: this.isPlaying, // Devrait être false initialement
         isBuffering: this.isBuffering, // Devrait être false ici
         isLoaded: true,
       });


    } catch (error) {
      console.error('[AudioManager] Error in loadSound:', error);
      this.currentEpisode = null;
      this.position = 0;
      this.duration = 0;
      this.isPlaying = false;
      this.isBuffering = false;
      this.notifyListeners({ type: 'error', error: error instanceof Error ? error.message : String(error) });
      this.notifyListeners({ type: 'status', position: 0, duration: 0, isPlaying: false, isBuffering: false, isLoaded: false });
      throw error;
    }
  }

  // --- MODIFICATION: getStatusAsync devient une pure requête ---
  public async getStatusAsync(): Promise<AudioStatus> {
    if (!this.isPlayerReady) {
      return { /* ... état non prêt ... */
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
      const activeTrack = await TrackPlayer.getActiveTrack();
      const position = await TrackPlayer.getPosition();
      const duration = await TrackPlayer.getDuration();
      const buffered = await TrackPlayer.getBufferedPosition();

      const isLoaded = activeTrack !== null && activeTrack !== undefined;
      const isPlaying = state === State.Playing;
      const isBuffering = state === State.Buffering || state === State.Loading || (isLoaded && duration > 0 && buffered < position + 1 && !isPlaying);

      // <<< SUPPRIMER les mises à jour de l'état interne ici >>>
      // this.isPlaying = isPlaying;
      // this.isBuffering = isBuffering;
      // this.position = position * 1000;
      // this.duration = duration * 1000;
      // ... (supprimer la logique de vérification/mise à jour de this.currentEpisode ici aussi) ...

      // Retourner l'état fraîchement récupéré
      return {
        isLoaded,
        isPlaying,
        isBuffering,
        // Retourner les valeurs directes de TrackPlayer (converties)
        positionMillis: position * 1000,
        durationMillis: duration * 1000,
        currentEpisodeId: activeTrack?.id ?? null,
      };
    } catch (error) {
      console.error('[AudioManager] Error getting status:', error);
      return { /* ... état d'erreur ... */
        isLoaded: false,
        isPlaying: false,
        isBuffering: false,
        positionMillis: 0,
        durationMillis: 0,
        currentEpisodeId: this.currentEpisode?.id ?? null,
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
    listeners.set(Event.PlaybackState, (data: { state: State | PlaybackState }) => {
      console.log('[AudioManager] Event.PlaybackState:', data.state);
      const state = typeof data.state === 'string' ? data.state as State : State.None;

      // Mettre à jour l'état interne directement
      this.isPlaying = state === State.Playing;
      this.isBuffering = state === State.Buffering || state === State.Loading;

      // Notifier immédiatement avec l'état interne mis à jour
      this.notifyListeners({
        type: 'status',
        position: this.position, // Utiliser la position interne actuelle
        duration: this.duration, // Utiliser la durée interne actuelle
        isPlaying: this.isPlaying,
        isBuffering: this.isBuffering,
        isLoaded: state !== State.None && state !== State.Stopped, // Considérer chargé sauf si None/Stopped
      });

      // Gérer la fin de lecture
      if (state === State.Ended) {
        console.log('[AudioManager] Playback ended.');
        this.position = 0; // Réinitialiser la position interne
        this.isPlaying = false; // Assurer que isPlaying est false
        this.notifyListeners({ type: 'finished' });
        // Notifier aussi le statut final (position 0, non en lecture)
        this.notifyListeners({ type: 'status', position: 0, duration: this.duration, isPlaying: false, isBuffering: false, isLoaded: true });
      } else if (state === State.Stopped) {
        console.log('[AudioManager] Playback stopped.');
        // L'état isPlaying/isBuffering est déjà mis à jour, la notification status ci-dessus suffit.
        // Si un arrêt implique un déchargement, unloadSound devrait être appelé ailleurs.
      }
      // <<< SUPPRIMER l'appel à updateLocalStatus >>>
      // await this.updateLocalStatus();
    });

    // --- MODIFICATION: PlaybackProgressUpdated met à jour l'état interne et notifie ---
    listeners.set(Event.PlaybackProgressUpdated, (data: { position: number; duration: number; buffered: number }) => {
      // Mettre à jour l'état interne
      this.position = data.position * 1000;
      // Mettre à jour la durée seulement si elle est valide et différente pour éviter des écrasements
      if (data.duration > 0 && data.duration * 1000 !== this.duration) {
          this.duration = data.duration * 1000;
      }
      // Mettre à jour isBuffering basé sur la position bufferisée (logique affinée)
      const wasBuffering = this.isBuffering;
      this.isBuffering = this.isPlaying && data.duration > 0 && data.buffered < data.position + 1.5;

      // Notifier seulement si quelque chose a changé (position, durée, buffering)
      // ou toujours notifier pour que l'UI se mette à jour ? -> Toujours notifier pour la position.
      this.notifyListeners({
        type: 'status',
        position: this.position,
        duration: this.duration,
        isPlaying: this.isPlaying, // Utiliser l'état interne isPlaying
        isBuffering: this.isBuffering,
        isLoaded: true, // Si on reçoit la progression, c'est chargé
      });
    });

    listeners.set(Event.PlaybackError, (error: any) => {
      console.error('[AudioManager] Event.PlaybackError:', error.code, error.message);
      // Mettre à jour l'état interne
      this.isPlaying = false;
      this.isBuffering = false;
      // Notifier l'erreur et le changement de statut
      this.notifyListeners({ type: 'error', error: error.message || 'Erreur de lecture inconnue' });
      this.notifyListeners({ type: 'status', position: this.position, duration: this.duration, isPlaying: false, isBuffering: false, isLoaded: false }); // Indiquer non chargé en cas d'erreur? Ou garder isLoaded? A tester.
    });

    // --- MODIFICATION: PlaybackActiveTrackChanged ---
    listeners.set(Event.PlaybackActiveTrackChanged, async (data: { track?: Track | null, nextTrack?: Track | null }) => {
        console.log(`[AudioManager] Event.PlaybackActiveTrackChanged: New track ID: ${data.track?.id}`);
        if (!data.track) {
            // La piste a été retirée ou la file est vide
            console.log('[AudioManager] Active track is now null/undefined.');
            // Appeler unloadSound pour nettoyer complètement l'état interne
            await this.unloadSound();
        } else {
            // Une nouvelle piste est active, mettre à jour l'épisode actuel si possible
            const newTrackId = String(data.track.id); // Assurer que c'est une string
            if (!this.currentEpisode || this.currentEpisode.id !== newTrackId) {
                console.warn(`[AudioManager] Active track changed (${newTrackId}), updating internal episode.`);
                // Essayer de créer un objet Episode partiel basé sur la Track
                this.currentEpisode = {
                    id: newTrackId,
                    title: data.track.title || 'Épisode inconnu',
                    mp3Link: data.track.url as string, // Assumer que l'URL est le mp3Link
                    description: '', // Infos manquantes
                    // Convertir la durée en secondes si elle existe, sinon null
                    duration: data.track.duration ? Number(data.track.duration) : null,
                    offline_path: undefined, // Pas de chemin local connu ici
                    publicationDate: '' // Info manquante
                };
                // Réinitialiser position/durée car la piste a changé
                this.position = 0;
                this.duration = data.track.duration ? Number(data.track.duration) * 1000 : 0;
            }
            // Notifier le changement de statut après changement de piste
            this.notifyListeners({
                type: 'status',
                position: this.position,
                duration: this.duration,
                isPlaying: this.isPlaying, // Garder l'état isPlaying actuel
                isBuffering: this.isBuffering,
                isLoaded: true, // La nouvelle piste est chargée
            });
            // <<< SUPPRIMER l'appel à updateLocalStatus >>>
            // await this.updateLocalStatus();
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
      // Supprimer d'abord un éventuel listener précédent pour éviter les doublons
      // Note: addEventListener typically replaces existing listeners for the same event in many libraries,
      // or TrackPlayer might handle this internally. If duplicates become an issue,
      // store the subscription returned by addEventListener and call .remove() on it before adding a new one.
      TrackPlayer.addEventListener(event, listener);
    }
    console.log('[AudioManager] Event listeners setup complete.');
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
