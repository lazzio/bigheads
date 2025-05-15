import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
import { Episode } from '../types/episode';
import { normalizeAudioUrl } from './commons/timeUtils';

// Interface pour le statut retourné par getStatusAsync
export interface AudioStatus {
  isLoaded: boolean;
  isPlaying: boolean;
  isBuffering: boolean;
  positionMillis: number;
  durationMillis: number;
  currentEpisodeId: string | null;
  currentEpisode?: Episode | null;
}

// Classe singleton pour gérer l'état audio global
class AudioManager {
  private static instance: AudioManager;
  private sound: Audio.Sound | null = null;
  private isPlayerReady = false;
  private currentEpisode: Episode | null = null;
  private position = 0;
  private duration = 0;
  private isPlaying = false;
  private isBuffering = false;
  private listeners: Set<(data: any) => void> = new Set();
  private episodesList: Episode[] = [];
  private currentEpisodeIndex: number = -1;
  private statusUpdateInterval: any = null;

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

    await Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      allowsRecordingIOS: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      playThroughEarpieceAndroid: false,
    });

    this.isPlayerReady = true;
  }

  // 2. Méthode pour définir la liste des épisodes en cours de lecture
  public setEpisodesList(episodes: Episode[], currentIndex: number = 0): void {
    if (!episodes || episodes.length === 0) {
      console.warn('[AudioManager] Attempted to set empty episodes list');
      return;
    }
    
    console.log(`[AudioManager] Setting episodes list with ${episodes.length} episodes, current index: ${currentIndex}`);
    this.episodesList = [...episodes];
    this.currentEpisodeIndex = Math.min(Math.max(0, currentIndex), episodes.length - 1);
  }

  // 3. Méthode pour naviguer à l'épisode suivant
  public async skipToNext(): Promise<boolean> {
    console.log('[AudioManager] skipToNext called');
    
    if (this.episodesList.length === 0) {
      console.warn('[AudioManager] Cannot skip to next: No episodes list set');
      return false;
    }
    
    // Déterminer le prochain index (boucler si nécessaire)
    const nextIndex = (this.currentEpisodeIndex + 1) % this.episodesList.length;
    const nextEpisode = this.episodesList[nextIndex];
    
    console.log(`[AudioManager] Skipping to next episode: ${nextEpisode.title} (index: ${nextIndex})`);
    
    try {
      // Charger le nouvel épisode
      this.currentEpisodeIndex = nextIndex;
      await this.loadSound(nextEpisode, 0);
      
      // Démarrer la lecture automatiquement
      await this.play();
      return true;
    } catch (error) {
      console.error('[AudioManager] Error skipping to next episode:', error);
      return false;
    }
  }

  // 4. Méthode pour naviguer à l'épisode précédent
  public async skipToPrevious(): Promise<boolean> {
    console.log('[AudioManager] skipToPrevious called');
    
    if (this.episodesList.length === 0) {
      console.warn('[AudioManager] Cannot skip to previous: No episodes list set');
      return false;
    }
    
    // Si on est près du début, aller à l'épisode précédent
    // Sinon, revenir au début de l'épisode actuel
    const currentStatus = await this.getStatusAsync();
    
    // Si la position actuelle est < 3 secondes, aller à l'épisode précédent
    if (currentStatus.positionMillis < 3000) {
      // Déterminer l'index précédent (boucler si nécessaire)
      const prevIndex = (this.currentEpisodeIndex - 1 + this.episodesList.length) % this.episodesList.length;
      const prevEpisode = this.episodesList[prevIndex];
      
      console.log(`[AudioManager] Skipping to previous episode: ${prevEpisode.title} (index: ${prevIndex})`);
      
      try {
        // Charger l'épisode précédent
        this.currentEpisodeIndex = prevIndex;
        await this.loadSound(prevEpisode, 0);
        
        // Démarrer la lecture automatiquement
        await this.play();
        return true;
      } catch (error) {
        console.error('[AudioManager] Error skipping to previous episode:', error);
        return false;
      }
    } else {
      // Si on est au-delà des 3 premières secondes, revenir au début de l'épisode actuel
      console.log('[AudioManager] Returning to beginning of current episode');
      await this.seekTo(0);
      return true;
    }
  }

  // --- NOUVELLE MÉTHODE: Charger un son avec position initiale ---
  /**
   * Charge un épisode et démarre optionnellement la lecture à une position donnée.
   * @param episode L'épisode à charger.
   * @param initialPositionMillis Position initiale en millisecondes.
   */
  public async loadSound(episode: Episode, initialPositionMillis: number = 0): Promise<void> {
    await this.setupAudio();
    if (this.sound) {
      await this.sound.unloadAsync();
      this.sound.setOnPlaybackStatusUpdate(null);
      this.sound = null;
    }
    
    let audioSourceUri: string;
    const isLocal = !!episode.offline_path;

    if (isLocal) {
      audioSourceUri = episode.offline_path!;
      console.log('[AudioManager] Using local file:', audioSourceUri);
    } else if (episode.mp3Link) {
      audioSourceUri = normalizeAudioUrl(episode.mp3Link);
      console.log('[AudioManager] Using remote URL:', audioSourceUri);
    } else {
      throw new Error('Episode has no valid audio source (offline_path or mp3Link).');
    }

    this.currentEpisode = { ...episode }; // Stocker l'épisode actuel
    // Réinitialiser l'état avant le chargement
    this.position = 0;
    // Utiliser la durée de l'épisode si dispo, convertir en ms
    this.duration = episode.duration ? Number(episode.duration) * 1000 : 0;
    this.isPlaying = false;
    this.isBuffering = true; // Considérer en buffering pendant le chargement

    const { sound } = await Audio.Sound.createAsync(
      { uri: audioSourceUri },
      { shouldPlay: false, positionMillis: initialPositionMillis },
      this.onPlaybackStatusUpdate
    );
    this.sound = sound;

    // Obtenir le statut initial
    const status = await sound.getStatusAsync();
    if ('isLoaded' in status && status.isLoaded) {
      this.duration = status.durationMillis || this.duration;
      this.position = status.positionMillis || 0;
      this.isBuffering = status.isBuffering || false;
    }

    // Notifier les écouteurs
    this.notifyListeners({
      type: 'loaded',
      episode: this.currentEpisode,
      duration: this.duration,
      isLocalFile: isLocal,
    });
    
    // Envoyer le statut initial
    this.notifyListeners({
      type: 'status',
      position: this.position,
      duration: this.duration,
      isPlaying: this.isPlaying,
      isBuffering: this.isBuffering,
      isLoaded: 'isLoaded' in status ? status.isLoaded : false,
      episodeId: this.currentEpisode?.id ?? null,
    });

    this.startStatusInterval();
  }

  private onPlaybackStatusUpdate = (status: any) => {
    if (!status) return;
    if ('isLoaded' in status && status.isLoaded) {
      this.position = status.positionMillis || 0;
      this.duration = status.durationMillis || this.duration;
      this.isPlaying = status.isPlaying || false;
      this.isBuffering = status.isBuffering || false;
      if (status.didJustFinish && !status.isLooping) {
        this.isPlaying = false;
        this.notifyListeners({ type: 'finished', episodeId: this.currentEpisode?.id ?? null });
      }
      this.notifyListeners({ type: 'status', position: this.position, duration: this.duration, isPlaying: this.isPlaying, isBuffering: this.isBuffering, isLoaded: status.isLoaded, episodeId: this.currentEpisode?.id ?? null });
    } else {
      this.isPlaying = false;
      this.isBuffering = false;
      this.notifyListeners({ type: 'status', position: 0, duration: 0, isPlaying: false, isBuffering: false, isLoaded: false, episodeId: null });
    }
  };

  // --- MODIFICATION: getStatusAsync devient une pure requête ---
public async getStatusAsync(): Promise<AudioStatus> {
  if (!this.sound) {
    return { 
      isLoaded: false, 
      isPlaying: false, 
      isBuffering: false, 
      positionMillis: 0, 
      durationMillis: 0, 
      currentEpisodeId: null,
      currentEpisode: null // Ajout de l'épisode complet
    };
  }
  
  const status = await this.sound.getStatusAsync();
  if ('isLoaded' in status && status.isLoaded) {
    return {
      isLoaded: true,
      isPlaying: status.isPlaying,
      isBuffering: status.isBuffering,
      positionMillis: status.positionMillis || 0,
      durationMillis: status.durationMillis || 0,
      currentEpisodeId: this.currentEpisode?.id ?? null,
      currentEpisode: this.currentEpisode,
    };
  } else {
    return { isLoaded: false, isPlaying: false, isBuffering: false, positionMillis: 0, durationMillis: 0, currentEpisodeId: null, currentEpisode: null };
  }
}

  // --- NOUVELLE MÉTHODE: Décharger le son ---
  /**
   * Arrête la lecture et décharge la piste actuelle.
   */
  public async unloadSound(): Promise<void> {
    if (this.sound) {
      await this.sound.unloadAsync();
      this.sound.setOnPlaybackStatusUpdate(null);
      this.sound = null;
    }
    this.currentEpisode = null;
    this.position = 0;
    this.duration = 0;
    this.isPlaying = false;
    this.isBuffering = false;
    this.notifyListeners({ type: 'unloaded', episodeId: null });
    this.notifyListeners({ type: 'status', position: 0, duration: 0, isPlaying: false, isBuffering: false, isLoaded: false, episodeId: null });
    this.stopStatusInterval();
  }

  // --- Méthodes existantes (play, pause, seekTo, stop, etc.) ---
  // Assurez-vous qu'elles mettent à jour l'état local (this.isPlaying, etc.)
  // et utilisent updateLocalStatus ou getStatusAsync si nécessaire.

  public async play(): Promise<void> {
    if (!this.sound) return;
    await this.sound.playAsync();
  }

  public async pause(): Promise<void> {
    if (!this.sound) return;
    await this.sound.pauseAsync();
  }

  // seekTo prend maintenant des millisecondes pour la cohérence interne
  public async seekTo(positionMillis: number): Promise<void> {
    if (!this.sound) return;
    await this.sound.setPositionAsync(positionMillis);
  }

  // --- NOUVELLE MÉTHODE: Avancer/Reculer relativement ---
  /**
   * Avance ou recule la lecture d'un certain nombre de secondes.
   * @param offsetSeconds Nombre de secondes à ajouter (positif pour avancer, négatif pour reculer).
   */
  public async seekRelative(offsetSeconds: number): Promise<void> {
    if (!this.sound) return;
    const status = await this.sound.getStatusAsync();
    if ('isLoaded' in status && status.isLoaded) {
      const newPosition = Math.max(0, Math.min((status.positionMillis || 0) + offsetSeconds * 1000, status.durationMillis || 0));
      await this.sound.setPositionAsync(newPosition);
    }
  }

  // --- GESTION DES LISTENERS ---
public addListener(callback: (data: any) => void): () => void {
  this.listeners.add(callback);
  // Envoyer l'état interne actuel immédiatement après l'ajout
  callback({
    type: 'status',
    position: this.position,
    duration: this.duration,
    isPlaying: this.isPlaying,
    isBuffering: this.isBuffering,
    isLoaded: !!this.sound,
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

private startStatusInterval() {
  this.stopStatusInterval();
  this.statusUpdateInterval = setInterval(async () => {
    if (this.sound) {
      const status = await this.sound.getStatusAsync();
      this.onPlaybackStatusUpdate(status);
    }
  }, 1000);
}

private stopStatusInterval() {
  if (this.statusUpdateInterval) {
    clearInterval(this.statusUpdateInterval);
    this.statusUpdateInterval = null;
  }
}

public async cleanup(): Promise<void> {
  await this.unloadSound();
  this.listeners.clear();
  this.isPlayerReady = false;
  this.stopStatusInterval();
  }
}
// --- FIN DE LA CLASSE ---
// Exporter l'instance singleton
export const audioManager = AudioManager.getInstance();
