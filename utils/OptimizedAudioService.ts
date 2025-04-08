import { Audio } from 'expo-av';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { Episode } from '../types/episode';
import { Linking, Platform, PermissionsAndroid, NativeModules } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';

// Identifiant unique pour la tâche d'arrière-plan
const BACKGROUND_AUDIO_TASK = 'xyz.myops.bigheads.audio-background';

// Définir la tâche d'arrière-plan
TaskManager.defineTask(BACKGROUND_AUDIO_TASK, async () => {
  // Cette tâche maintient le service actif pendant la lecture en arrière-plan
  console.log('Background task running to keep audio active');
  return BackgroundFetch.BackgroundFetchResult.NewData;
});

// Classe singleton pour gérer l'état audio global
class AudioManager {
  private static instance: AudioManager;
  private sound: Audio.Sound | null = null;
  private isBackgroundTaskRegistered = false;
  private currentEpisode: Episode | null = null;
  private position = 0;
  private duration = 0;
  private isPlaying = false;
  private listeners: Set<(data: any) => void> = new Set();
  private keepAliveTimer: NodeJS.Timeout | null = null;

  private constructor() {
    // Constructeur privé pour le modèle singleton
  }

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  // Configurer le mode audio optimal pour la lecture en arrière-plan
  public async setupAudio(): Promise<void> {
    try {
      console.log('Setting up optimized audio mode');
      
      // Utiliser la configuration audio la plus robuste possible
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        interruptionModeIOS: 1,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        interruptionModeAndroid: 1,
        playThroughEarpieceAndroid: false,
      });
  
      // Enregistrer une tâche d'arrière-plan simplifiée
      if (Platform.OS === 'android' && !this.isBackgroundTaskRegistered) {
        try {
          await BackgroundFetch.registerTaskAsync(BACKGROUND_AUDIO_TASK, {
            minimumInterval: 30, // 30 secondes - plus court pour les appareils restrictifs
            stopOnTerminate: false,
            startOnBoot: true,
          });
          
          this.isBackgroundTaskRegistered = true;
          console.log('Background task registered successfully');
        } catch (error) {
          // Ne pas échouer complètement si la tâche ne peut pas être enregistrée
          console.warn('Could not register background task:', error);
        }
      }
    } catch (error) {
      console.error('Error setting up audio mode:', error);
      // Continuer même en cas d'erreur pour permettre au moins la lecture de base
    }
  }

  // Enregistrer la tâche d'arrière-plan pour maintenir l'application active
  private async registerBackgroundTask(): Promise<void> {
    try {
      // Utiliser un intervalle plus court pour les appareils Pixel
      const isPixelDevice = Platform.OS === 'android' && 
        ((Platform.constants?.Brand || '').toLowerCase().includes('pixel') || 
        (NativeModules.PlatformConstants?.Model || '').toLowerCase().includes('pixel'));
      const minimumInterval = isPixelDevice ? 15 : 60; // 15 secondes pour Pixel, 60 pour les autres
      
      await BackgroundFetch.registerTaskAsync(BACKGROUND_AUDIO_TASK, {
        minimumInterval, // Plus court pour s'assurer que le service reste actif
        stopOnTerminate: false,
        startOnBoot: true,
      });
      
      this.isBackgroundTaskRegistered = true;
      console.log('Background task registered successfully');
      
      // Nous omettons l'appel à fetchTaskAsync car il n'est pas disponible
      // La tâche s'exécutera automatiquement selon l'intervalle défini
      
    } catch (error) {
      console.error('Error registering background task:', error);
      // Certaines erreurs peuvent être ignorées si la tâche est déjà enregistrée
      if (error instanceof Error && error.message.includes('already registered')) {
        this.isBackgroundTaskRegistered = true;
        console.log('Task was already registered');
      }
    }
  }

  // Désactiver la tâche d'arrière-plan
  private async unregisterBackgroundTask(): Promise<void> {
    if (this.isBackgroundTaskRegistered) {
      try {
        await BackgroundFetch.unregisterTaskAsync(BACKGROUND_AUDIO_TASK);
        this.isBackgroundTaskRegistered = false;
        console.log('Background task unregistered');
      } catch (error) {
        console.error('Error unregistering background task:', error);
      }
    }
  }

  // Dans la classe AudioManager
  private startKeepAliveTimer() {
    // Arrêter le timer existant s'il y en a un
    this.stopKeepAliveTimer();
    
    // Créer un nouveau timer qui "ping" le son toutes les 10 secondes
    this.keepAliveTimer = setInterval(() => {
      if (this.isPlaying && this.sound) {
        // Vérifier et restaurer l'état du son si nécessaire
        this.sound.getStatusAsync()
          .then(status => {
            // Vérifier si le statut est bien chargé et contient isPlaying
            if (status.isLoaded && !status.isPlaying && this.isPlaying) {
              // Si le son s'est arrêté mais devrait jouer, essayer de le redémarrer
              console.log('Audio stopped unexpectedly, trying to resume...');
              this.sound?.playAsync().catch(e => console.warn('Failed to resume audio:', e));
            }
          })
          .catch(err => console.warn('Failed to check audio status:', err));
      }
    }, 10000); // 10 secondes
  }
  
  private stopKeepAliveTimer() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }
  
  // Appeler startKeepAliveTimer après un playAsync réussi
  public async play(): Promise<void> {
    if (!this.sound) {
      console.warn('No sound loaded');
      return;
    }
  
    try {
      await this.sound.playAsync();
      this.startKeepAliveTimer(); // Démarrer le timer après avoir commencé la lecture
    } catch (error) {
      console.error('Error playing sound:', error);
      throw error;
    }
  }
  
  // Et arrêter le timer lors de la pause
  public async pause(): Promise<void> {
    if (!this.sound) {
      console.warn('No sound loaded');
      return;
    }
  
    try {
      await this.sound.pauseAsync();
      this.stopKeepAliveTimer(); // Arrêter le timer pendant la pause
    } catch (error) {
      console.error('Error pausing sound:', error);
      throw error;
    }
  }

  // Charger un épisode
  public async loadEpisode(episode: Episode): Promise<void> {
    try {
      // Nettoyage du son précédent si existant
      if (this.sound) {
        await this.sound.unloadAsync();
        this.sound = null;
      }

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
      
      // Configuration optimisée pour le type de source
      const playbackConfig: {
        shouldPlay: boolean;
        progressUpdateIntervalMillis: number;
        positionMillis: number;
        androidImplementation?: string;
      } = {
        shouldPlay: false,
        progressUpdateIntervalMillis: 1000,
        positionMillis: 0,
      };
      
      // Ajouter des configurations spécifiques pour Android si c'est une source distante
      if (Platform.OS === 'android' && !episode.offline_path) {
        playbackConfig.androidImplementation = 'MediaPlayer';
      }
      
      // Créer l'objet audio
      const { sound } = await Audio.Sound.createAsync(
        source,
        playbackConfig,
        this.onPlaybackStatusUpdate.bind(this)
      );

      this.sound = sound;
      
      // Pour les fichiers locaux, on peut obtenir directement le statut
      // Pour les sources distantes sur Android, attendre un peu pour le préchargement
      if (episode.offline_path || Platform.OS !== 'android') {
        const status = await sound.getStatusAsync();
        if (status.isLoaded) {
          this.duration = status.durationMillis || 0;
        }
      } else {
        // Pour les sources distantes sur Android
        await new Promise(resolve => setTimeout(resolve, 500));
        try {
          const status = await sound.getStatusAsync();
          if (status.isLoaded) {
            this.duration = status.durationMillis || 0;
          }
        } catch (err) {
          console.warn('Error getting initial status:', err);
        }
      }
      
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

  // Mettre à jour le status de lecture
  private onPlaybackStatusUpdate(status: any): void {
    if (!status.isLoaded) {
      if (status.error) {
        console.error(`Playback error: ${status.error}`);
        this.notifyListeners({
          type: 'error',
          error: status.error
        });
      }
      return;
    }

    this.position = status.positionMillis;
    this.isPlaying = status.isPlaying;

    // Notifier les écouteurs du changement d'état
    this.notifyListeners({
      type: 'status',
      position: this.position,
      duration: this.duration,
      isPlaying: this.isPlaying,
      isBuffering: status.isBuffering
    });

    // Gérer la fin de l'épisode
    if (status.didJustFinish) {
      this.notifyListeners({
        type: 'finished',
        episode: this.currentEpisode
      });
    }
  }

  // Arrêter l'audio
  public async stop(): Promise<void> {
    if (!this.sound) {
      return;
    }

    try {
      await this.sound.stopAsync();
      await this.sound.unloadAsync();
      this.sound = null;
      this.position = 0;
      this.isPlaying = false;
    } catch (error) {
      console.error('Error stopping sound:', error);
    }
  }

  // Chercher une position spécifique
  public async seekTo(positionMillis: number): Promise<void> {
    if (!this.sound) {
      console.warn('No sound loaded');
      return;
    }

    try {
      await this.sound.setPositionAsync(positionMillis);
    } catch (error) {
      console.error('Error seeking sound:', error);
      throw error;
    }
  }

  // Avancer ou reculer de x secondes
  public async seekRelative(seconds: number): Promise<void> {
    if (!this.sound) {
      console.warn('No sound loaded');
      return;
    }

    try {
      const status = await this.sound.getStatusAsync();
      if (!status.isLoaded) return;

      const newPosition = Math.max(0, Math.min(this.position + seconds * 1000, this.duration));
      await this.sound.setPositionAsync(newPosition);
    } catch (error) {
      console.error('Error seeking sound:', error);
      throw error;
    }
  }

  // Ajouter un écouteur pour les mises à jour d'état
  public addListener(callback: (data: any) => void): () => void {
    this.listeners.add(callback);
    
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
    if (this.sound) {
      try {
        await this.sound.unloadAsync();
      } catch (error) {
        console.error('Error unloading sound:', error);
      }
      this.sound = null;
    }

    await this.unregisterBackgroundTask();
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
