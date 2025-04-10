import TrackPlayer, {
  Capability,
  Event,
  State,
  TrackType,
  useTrackPlayerEvents,
  RepeatMode,
  AppKilledPlaybackBehavior
} from 'react-native-track-player';
import { Episode } from '../types/episode';
import { Platform, PermissionsAndroid, NativeModules, Linking } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';

// Classe singleton pour gérer l'état audio global
class AudioManager {
  private static instance: AudioManager;
  private isPlayerReady = false;
  private currentEpisode: Episode | null = null;
  private position = 0;
  private duration = 0;
  private isPlaying = false;
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

  // Configurer le player pour la lecture en arrière-plan
  public async setupAudio(): Promise<void> {
    try {
      console.log('Setting up TrackPlayer');
      
      if (!this.isPlayerReady) {
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
          // Support de la lecture en arrière-plan
          android: {
            appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
          },
          // Notification pour iOS et Android
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
        console.log('TrackPlayer setup complete');
        
        // Configuration des événements
        this.setupEventListeners();
      }
    } catch (error) {
      console.error('Error setting up TrackPlayer:', error);
      // Continuer même en cas d'erreur pour permettre au moins la lecture de base
    }
  }

  // Configurer les écouteurs d'événements
  private setupEventListeners(): void {
    TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
      console.log('Playback state changed:', event.state);
      if (event.state === State.Playing) {
        this.isPlaying = true;
      } else if (event.state === State.Paused || event.state === State.Stopped) {
        this.isPlaying = false;
      }
      
      this.updatePlaybackStatus();
    });
    
    TrackPlayer.addEventListener(Event.PlaybackTrackChanged, async (event) => {
      if (event.nextTrack !== undefined && event.nextTrack !== null) {
        try {
          const track = await TrackPlayer.getTrack(event.nextTrack);
          if (track) {
            this.duration = track.duration ? track.duration * 1000 : 0;
            this.notifyListeners({
              type: 'loaded',
              episode: this.currentEpisode,
              duration: this.duration,
              isLocalFile: track.url?.startsWith('file://')
            });
          }
        } catch (err) {
          console.error('Error getting track after change:', err);
        }
      }
    });
    
    TrackPlayer.addEventListener(Event.PlaybackError, (event) => {
      console.error('Playback error:', event.message);
      this.notifyListeners({
        type: 'error',
        error: event.message || 'Erreur de lecture inconnue'
      });
    });
    
    // Écouter les mises à jour de progression
    TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, async (event) => {
      this.position = event.position * 1000; // Convertir en ms
      this.duration = event.duration * 1000; // Convertir en ms
      
      this.notifyListeners({
        type: 'status',
        position: this.position,
        duration: this.duration,
        isPlaying: this.isPlaying,
        isBuffering: false
      });
    });

    // Ajouter ces événements pour gérer les commandes de notification
    TrackPlayer.addEventListener(Event.RemotePlay, () => {
      console.log('Remote Play event received');
      this.play().catch(err => console.error('Error in remote play:', err));
    });

    TrackPlayer.addEventListener(Event.RemotePause, () => {
      console.log('Remote Pause event received');
      this.pause().catch(err => console.error('Error in remote pause:', err));
    });

    TrackPlayer.addEventListener(Event.RemoteStop, () => {
      console.log('Remote Stop event received');
      this.stop().catch(err => console.error('Error in remote stop:', err));
    });

    TrackPlayer.addEventListener(Event.RemoteNext, () => {
      console.log('Remote Next event received');
      this.notifyListeners({ type: 'remote-next' });
    });

    TrackPlayer.addEventListener(Event.RemotePrevious, () => {
      console.log('Remote Previous event received');
      this.notifyListeners({ type: 'remote-previous' });
    });

    TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
      console.log('Remote Seek event received:', event.position);
      this.seekTo(event.position * 1000).catch(err => console.error('Error in remote seek:', err));
    });
  }
  
  // Mise à jour manuelle du statut
  private async updatePlaybackStatus(): Promise<void> {
    try {
      const state = await TrackPlayer.getState();
      const position = await TrackPlayer.getPosition();
      const duration = await TrackPlayer.getDuration();
      
      this.isPlaying = state === State.Playing;
      this.position = position * 1000; // Convertir en ms
      this.duration = duration * 1000; // Convertir en ms
      
      this.notifyListeners({
        type: 'status',
        position: this.position,
        duration: this.duration,
        isPlaying: this.isPlaying,
        isBuffering: state === State.Buffering || state === State.Connecting
      });
    } catch (err) {
      console.error('Error updating playback status:', err);
    }
  }

  // Charger un épisode
  public async loadEpisode(episode: Episode): Promise<void> {
    try {
      // Nettoyage du son précédent si existant
      await TrackPlayer.reset();

      // Prioriser le chemin hors ligne s'il existe
      const audioSource = episode.offline_path || episode.mp3Link;
      
      if (!audioSource) {
        throw new Error("URL d'épisode invalide ou manquante");
      }

      console.log(`Loading episode: ${episode.title}`);
      console.log(`Audio source: ${audioSource.substring(0, 50)}...`);
      console.log(`Source type: ${episode.offline_path ? 'Fichier local' : 'URL distante'}`);

      this.currentEpisode = episode;
      
      // Déterminer la source audio
      let source: { uri: string };
      
      if (episode.offline_path) {
        // Utiliser le chemin local directement
        source = { uri: episode.offline_path };
        console.log('Utilisation du fichier local');
      } else {
        // Normaliser l'URL pour les sources distantes
        const normalizedUri = episode.mp3Link.startsWith('http') 
          ? episode.mp3Link 
          : `https://${episode.mp3Link}`;
          
        source = { uri: normalizedUri };
        console.log('Utilisation de l\'URL distante');
      }
      
      // Ajouter la piste à TrackPlayer
      await TrackPlayer.add({
        id: String(episode.id),
        url: source.uri,
        artist: 'L\'intégrale des Grosses Têtes',
        title: episode.title,
        description: episode.description,
        duration: episode.duration ? Number(episode.duration) : undefined,
        type: TrackType.Default,
      });

      // Obtenir immédiatement l'état pour mise à jour
      await this.updatePlaybackStatus();

      this.notifyListeners({
        type: 'loaded',
        episode,
        duration: this.duration,
        isLocalFile: !!episode.offline_path
      });
      
    } catch (error) {
      console.error('Error loading episode:', error);
      this.notifyListeners({
        type: 'error',
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      });
      throw error;
    }
  }

  // Arrêter l'audio
  public async stop(): Promise<void> {
    try {
      await TrackPlayer.stop();
      this.position = 0;
      this.isPlaying = false;
      
      this.notifyListeners({
        type: 'status',
        position: 0,
        duration: this.duration,
        isPlaying: false,
        isBuffering: false
      });
    } catch (error) {
      console.error('Error stopping sound:', error);
    }
  }

  // Mettre en pause la lecture
  public async pause(): Promise<void> {
    try {
      await TrackPlayer.pause();
      this.isPlaying = false;
      await this.updatePlaybackStatus();
    } catch (error) {
      console.error('Error pausing playback:', error);
      throw error;
    }
  }

  // Démarrer la lecture
  public async play(): Promise<void> {
    try {
      await TrackPlayer.play();
      this.isPlaying = true;
      await this.updatePlaybackStatus();
    } catch (error) {
      console.error('Error starting playback:', error);
      throw error;
    }
  }

  // Chercher une position spécifique
  public async seekTo(positionMillis: number): Promise<void> {
    try {
      await TrackPlayer.seekTo(positionMillis / 1000); // Conversion en secondes pour TrackPlayer
      await this.updatePlaybackStatus();
    } catch (error) {
      console.error('Error seeking sound:', error);
      throw error;
    }
  }

  // Avancer ou reculer de x secondes
  public async seekRelative(seconds: number): Promise<void> {
    try {
      const position = await TrackPlayer.getPosition();
      const duration = await TrackPlayer.getDuration() || 0;
      
      // Calculer la nouvelle position en secondes (TrackPlayer utilise des secondes)
      const newPosition = Math.max(0, Math.min(position + seconds, duration));
      
      await TrackPlayer.seekTo(newPosition);
      await this.updatePlaybackStatus();
    } catch (error) {
      console.error('Error seeking sound:', error);
      throw error;
    }
  }

  // Ajouter un écouteur pour les mises à jour d'état
  public addListener(callback: (data: any) => void): () => void {
    this.listeners.add(callback);
    
    // Envoyer l'état actuel immédiatement
    this.updatePlaybackStatus();
    
    // Retourner une fonction de nettoyage
    return () => {
      this.listeners.delete(callback);
    };
  }

  // Notifier tous les écouteurs
  private notifyListeners(data: any): void {
    this.listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in listener callback:', error);
      }
    });
  }

  // Obtenir l'état actuel
  public getState() {
    return {
      isPlaying: this.isPlaying,
      position: this.position,
      duration: this.duration,
      currentEpisode: this.currentEpisode
    };
  }

  // Nettoyer les ressources lors de la fermeture de l'application
  public async cleanup(): Promise<void> {
    await TrackPlayer.reset(); // Use reset instead of destroy
    this.listeners.clear();
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
