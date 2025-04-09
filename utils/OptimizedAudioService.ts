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
  private isBuffering = false;
  private progressiveLoading = false;
  private bufferSize = 180000; // Valeur par défaut: 180 secondes
  private nextEpisodePreload: { episode: Episode, sound: Audio.Sound } | null = null;
  private lastReportedPosition = 0;
  private bufferingStartTime = 0;
  private bufferThreshold = 10000; // 10 secondes de buffer minimum

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
          // Vérifier si la tâche existe déjà avant d'essayer de l'enregistrer
          const isTaskRegistered = await this.isTaskRegistered(BACKGROUND_AUDIO_TASK);
          
          if (!isTaskRegistered) {
            await BackgroundFetch.registerTaskAsync(BACKGROUND_AUDIO_TASK, {
              minimumInterval: 60, // 60 secondes - plus court pour les appareils restrictifs
              stopOnTerminate: false,
              startOnBoot: true,
            });
            
            this.isBackgroundTaskRegistered = true;
            console.log('Background task registered successfully');
          } else {
            console.log('Background task already registered');
            this.isBackgroundTaskRegistered = true;
          }
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
      // Vérifier si la tâche est déjà enregistrée
      if (await this.isTaskRegistered(BACKGROUND_AUDIO_TASK)) {
        this.isBackgroundTaskRegistered = true;
        console.log('Task was already registered');
        return;
      }
      
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
      
    } catch (error) {
      console.error('Error registering background task:', error);
      // Certaines erreurs peuvent être ignorées si la tâche est déjà enregistrée
      if (error instanceof Error && error.message.includes('already registered')) {
        this.isBackgroundTaskRegistered = true;
        console.log('Task was already registered');
      }
    }
  }

  // Vérifier si une tâche est enregistrée
  private async isTaskRegistered(taskName: string): Promise<boolean> {
    try {
      const tasks = await TaskManager.getRegisteredTasksAsync();
      return tasks.some(task => task.taskName === taskName);
    } catch (error) {
      console.error('Error checking task registration:', error);
      return false;
    }
  }

  // Désactiver la tâche d'arrière-plan
  private async unregisterBackgroundTask(): Promise<void> {
    if (this.isBackgroundTaskRegistered) {
      try {
        // Vérifier si la tâche existe avant de tenter de la supprimer
        const isRegistered = await this.isTaskRegistered(BACKGROUND_AUDIO_TASK);
        if (isRegistered) {
          await BackgroundFetch.unregisterTaskAsync(BACKGROUND_AUDIO_TASK);
          console.log('Background task unregistered');
        } else {
          console.log('Background task was not found, no need to unregister');
        }
      } catch (error) {
        console.error('Error unregistering background task:', error);
      } finally {
        // Marquer comme non enregistré quoi qu'il arrive
        this.isBackgroundTaskRegistered = false;
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
      // Si nous sommes en train de buffer, attendre un peu plus
      if (this.isBuffering && this.progressiveLoading) {
        // Vérifier l'état actuel du buffer
        const status = await this.sound.getStatusAsync();
        if (status.isLoaded) {
          const bufferAvailable = status.playableDurationMillis ? status.playableDurationMillis - status.positionMillis : 0;
          
          // Si le buffer est trop petit, attendre qu'il se remplisse davantage
          if (bufferAvailable < this.bufferThreshold && !status.isPlaying) {
            console.log(`Buffering before play: waiting for more data (${bufferAvailable}ms available)`);
            
            // Notifier que nous sommes en train de buffer
            this.notifyListeners({
              type: 'buffering',
              isBuffering: true
            });
            
            // Attendre que plus de données soient chargées
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
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
  public async loadEpisode(episode: Episode, options?: { 
    progressiveLoading?: boolean,
    bufferSize?: number,
    preloadNextEpisode?: Episode
  }): Promise<void> {
    try {
      // Nettoyage du son précédent si existant
      if (this.sound) {
        await this.sound.unloadAsync();
        this.sound = null;
      }

      // Si nous avons préchargé cet épisode, utilisons-le
      if (this.nextEpisodePreload && this.nextEpisodePreload.episode.id === episode.id) {
        this.sound = this.nextEpisodePreload.sound;
        this.currentEpisode = episode;
        this.nextEpisodePreload = null;
        
        this.notifyListeners({
          type: 'loaded',
          episode,
          duration: this.duration,
          isLocalFile: !!episode.offline_path
        });
        
        return;
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
      
      // Options de chargement progressif
      this.progressiveLoading = options?.progressiveLoading ?? false;
      if (options?.bufferSize) this.bufferSize = options.bufferSize;
      
      // Adapter le buffer threshold en fonction de la taille du buffer
      this.bufferThreshold = Math.max(5000, Math.min(this.bufferSize / 2, 30000));
      
      // Déterminer la source audio
      let source: { uri: string };
      
      if (episode.offline_path) {
        // Utiliser le chemin local directement
        source = { uri: episode.offline_path };
        console.log('Utilisation du fichier local');
      } else {
        // Normaliser l'URL pour les sources distantes
        const normalizedUri = episode.mp3Link?.startsWith('http') 
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
        rate?: number;
        initialStatus?: {
          shouldPlay: boolean;
          progressUpdateIntervalMillis: number;
          positionMillis: number;
          isLooping?: boolean;
          rate?: number;
        }
      } = {
        shouldPlay: false,
        progressUpdateIntervalMillis: 300, // Mise à jour plus fréquente pour améliorer la réactivité
        positionMillis: 0,
      };
      
      // Ajouter des configurations spécifiques pour Android si c'est une source distante
      if (Platform.OS === 'android' && !episode.offline_path) {
        playbackConfig.androidImplementation = 'MediaPlayer';
        
        // Configuration pour le chargement progressif
        if (this.progressiveLoading) {
          // Buffer plus grand pour une lecture plus stable
          playbackConfig.initialStatus = {
            shouldPlay: false,
            progressUpdateIntervalMillis: 300,
            positionMillis: 0,
            isLooping: false,
            rate: 1.0
          };
        }
      }
      
      // Marquer le début du chargement
      this.isBuffering = true;
      this.bufferingStartTime = Date.now();
      this.notifyListeners({
        type: 'buffering',
        isBuffering: true
      });
      
      // Créer l'objet audio avec les options appropriées
      const { sound } = await Audio.Sound.createAsync(
        source,
        playbackConfig,
        this.onPlaybackStatusUpdate.bind(this)
      );

      this.sound = sound;
      this.lastReportedPosition = 0;
      
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
      
      // Attendre un peu plus pour le buffer initial si c'est une source distante
      if (!episode.offline_path && this.progressiveLoading) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Marquer la fin du chargement initial
      this.isBuffering = false;
      
      this.notifyListeners({
        type: 'loaded',
        episode,
        duration: this.duration,
        isLocalFile: !!episode.offline_path
      });
      
      // Si demandé, précharger le prochain épisode
      if (options?.preloadNextEpisode && !options.preloadNextEpisode.offline_path) {
        this.preloadNextEpisode(options.preloadNextEpisode);
      }
      
    } catch (error) {
      console.error('Error loading episode:', error);
      this.notifyListeners({
        type: 'error',
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      });
      throw error;
    }
  }

  // Précharger le prochain épisode en arrière-plan
  private async preloadNextEpisode(episode: Episode): Promise<void> {
    try {
      // Ne pas précharger les fichiers locaux, ils se chargent déjà rapidement
      if (episode.offline_path) return;
      
      // Normaliser l'URL pour les sources distantes
      const normalizedUri = episode.mp3Link?.startsWith('http') 
        ? episode.mp3Link 
        : `https://${episode.mp3Link}`;
        
      const source = { uri: normalizedUri };
      
      // Configuration minimale pour le préchargement
      const preloadConfig = {
        shouldPlay: false,
        progressUpdateIntervalMillis: 1000,
        positionMillis: 0,
        volume: 0, // Muet pendant le préchargement
      };
      
      // Charger l'audio en arrière-plan mais ne pas commencer la lecture
      const { sound } = await Audio.Sound.createAsync(
        source,
        preloadConfig,
        null // Pas de callback pour les mises à jour
      );
      
      // Stocker pour une utilisation future
      this.nextEpisodePreload = {
        episode,
        sound
      };
      
      console.log(`Préchargement de l'épisode suivant terminé: ${episode.title}`);
    } catch (error) {
      // Échec silencieux pour le préchargement, ce n'est pas critique
      console.warn('Error preloading next episode:', error);
      this.nextEpisodePreload = null;
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

    // Mettre à jour la position seulement si la différence est significative
    // ou si nous ne sommes pas en train de mettre en buffer
    const newPosition = status.positionMillis;
    const positionDiff = Math.abs(newPosition - this.lastReportedPosition);

    // Détecter les sauts dans la lecture
    if (this.isPlaying && positionDiff > 1000 && !status.isBuffering && !this.isBuffering) {
      // Un saut s'est produit, mais nous ne sommes pas en train de buffer
      // C'est probablement un seek manuel ou une fin de buffer silencieuse
      console.log(`Position jumped by ${positionDiff}ms`);
    }

    this.lastReportedPosition = newPosition;
    this.position = newPosition;
    this.isPlaying = status.isPlaying;
    
    // Améliorer la détection de buffering
    const wasBuffering = this.isBuffering;
    
    // Gérer le buffering pour le chargement progressif
    if (this.progressiveLoading) {
      // Utilisons une logique plus sophistiquée pour détecter le buffering
      if (status.isBuffering) {
        // Entrée en mode buffering
        if (!this.isBuffering) {
          console.log('Buffering started');
          this.bufferingStartTime = Date.now();
        }
        this.isBuffering = true;
      } else if (this.isBuffering) {
        // Sortie potentielle du mode buffering
        
        // Vérifier le buffer disponible
        const bufferAvailable = status.playableDurationMillis - status.positionMillis;
        
        // Si nous avons assez de buffer, sortir du mode buffering
        if (bufferAvailable > this.bufferThreshold) {
          console.log(`Buffering ended with ${bufferAvailable}ms buffer`);
          this.isBuffering = false;
        } else {
          // Sinon, rester en buffer mais vérifier combien de temps nous sommes bloqués
          const bufferingTime = Date.now() - this.bufferingStartTime;
          
          // Si le buffering dure trop longtemps, sortir quand même
          if (bufferingTime > 5000 && bufferAvailable > 3000) {
            console.log(`Forced exit from buffering after ${bufferingTime}ms with ${bufferAvailable}ms buffer`);
            this.isBuffering = false;
          }
        }
      }
    } else {
      // Pour les sources non progressives, utiliser simplement le statut natif
      this.isBuffering = status.isBuffering;
    }
    
    // Si l'état de buffering a changé, notifier les écouteurs
    if (wasBuffering !== this.isBuffering) {
      console.log(`Buffering state changed to: ${this.isBuffering}`);
    }

    // Notifier les écouteurs du changement d'état
    this.notifyListeners({
      type: 'status',
      position: this.position,
      duration: this.duration,
      isPlaying: this.isPlaying,
      isBuffering: this.isBuffering
    });
    
    // Si nous utilisons le chargement progressif, vérifier si nous devons charger plus de contenu
    if (this.progressiveLoading && 
        this.duration > 0 && 
        !status.isBuffering && 
        status.positionMillis > 0) {
      
      // Buffer prédictif : demander plus de données avant d'en avoir besoin
      const bufferAvailable = status.playableDurationMillis - status.positionMillis;
      
      // Si le buffer disponible devient trop petit, prévenir le buffering
      if (bufferAvailable < this.bufferThreshold && this.isPlaying && !this.isBuffering) {
        console.log(`Buffer getting low (${bufferAvailable}ms), preparing for buffering`);
        
        // Avertir que nous commençons à bufferiser
        this.isBuffering = true;
        this.bufferingStartTime = Date.now();
        this.notifyListeners({
          type: 'buffering',
          isBuffering: true
        });
      }
    }
    
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
      // Indiquer que nous sommes en train de bufferiser pendant le seek
      this.isBuffering = true;
      this.bufferingStartTime = Date.now();
      
      this.notifyListeners({
        type: 'buffering',
        isBuffering: true
      });
      
      // Mettre à jour la position immédiatement pour éviter les sauts visuels
      this.position = positionMillis;
      this.lastReportedPosition = positionMillis;
      
      await this.sound.setPositionAsync(positionMillis);
      
      // Pour les sources distantes, attendre un peu pour le rebuffering après un seek
      if (this.progressiveLoading && !this.currentEpisode?.offline_path) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      // Vérifier l'état après le seek
      const status = await this.sound.getStatusAsync();
      if (status.isLoaded) {
        // Mettre à jour pour s'assurer que nous avons la bonne position
        this.position = status.positionMillis;
        this.lastReportedPosition = status.positionMillis;
      }
    } catch (error) {
      console.error('Error seeking sound:', error);
      throw error;
    } finally {
      // Réinitialiser l'état de buffering après un délai
      setTimeout(() => {
        this.isBuffering = false;
        this.notifyListeners({
          type: 'status',
          position: this.position,
          duration: this.duration,
          isPlaying: this.isPlaying,
          isBuffering: false
        });
      }, 300);
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
    this.stopKeepAliveTimer();
    
    if (this.sound) {
      try {
        // Éviter les erreurs ANR en utilisant un timeout
        const soundCleanupPromise = Promise.race([
          this.sound.unloadAsync(),
          new Promise(resolve => setTimeout(resolve, 3000)) // 3 secondes timeout
        ]);
        
        await soundCleanupPromise;
      } catch (error) {
        console.error('Error unloading sound:', error);
      } finally {
        this.sound = null;
      }
    }

    // Nettoyer les préchargements éventuels
    if (this.nextEpisodePreload?.sound) {
      try {
        await this.nextEpisodePreload.sound.unloadAsync().catch(() => {});
      } catch (error) {
        console.error('Error unloading preloaded sound:', error);
      }
      this.nextEpisodePreload = null;
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
