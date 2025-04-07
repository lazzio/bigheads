import { Platform } from 'react-native';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';

/**
 * Vérifie si une URL audio est valide
 */
export function isValidAudioUrl(url: string | undefined): boolean {
  if (!url) return false;
  
  // URL basique
  const trimmedUrl = url.trim();
  if (trimmedUrl === '') return false;
  
  // Vérifier le format de l'URL
  try {
    // Ajouter http:// si nécessaire pour l'analyse
    const urlToCheck = trimmedUrl.startsWith('http')
      ? trimmedUrl
      : `https://${trimmedUrl}`;
      
    new URL(urlToCheck);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normaliser une URL audio
 */
export function normalizeAudioUrl(url: string | undefined): string {
  if (!url) return '';
  
  const trimmedUrl = url.trim();
  if (trimmedUrl === '') return '';
  
  // Ajouter le protocole si nécessaire
  if (!trimmedUrl.startsWith('http')) {
    return `https://${trimmedUrl}`;
  }
  
  return trimmedUrl;
}

/**
 * Configure le mode audio pour une meilleure compatibilité
 */
export async function setupOptimalAudioMode(): Promise<void> {
  try {
    // Création de la configuration avec les paramètres de base uniquement
    // Corriger le type en utilisant un type standard au lieu de AudioMode
    if (Platform.OS === 'android') {
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    const audioConfig: {[key: string]: any} = {
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    };
    
    // Uniquement sur iOS, ajouter le mode d'interruption
    if (Platform.OS === 'ios') {
      audioConfig.interruptionModeIOS = InterruptionModeIOS.DoNotMix;
    }
    
    // Uniquement sur Android, ajouter le mode d'interruption
    if (Platform.OS === 'android') {
      audioConfig.interruptionModeAndroid = InterruptionModeAndroid.DoNotMix;
      audioConfig.playThroughEarpieceAndroid = false;
    }
    
    // Appliquer la configuration
    await Audio.setAudioModeAsync(audioConfig);
    
    console.log('Audio mode set successfully with config:', audioConfig);
  } catch (error) {
    console.error('Error setting audio mode:', error);
    throw error; // Propager l'erreur pour la gérer dans le composant
  }
}

/**
 * Formatter le temps en millisecondes en format mm:ss
 */
export function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Nettoyer les ressources audio
 */
export async function cleanupAudioResources(sound: Audio.Sound | null): Promise<void> {
  if (sound) {
    try {
      await sound.stopAsync().catch(() => {});
      await sound.unloadAsync();
    } catch (error) {
      console.warn('Error cleaning up audio resources:', error);
    }
  }
}

/**
 * Débogage des status de lecture audio
 */
export function debugPlaybackStatus(status: any): void {
  if (!__DEV__) return;
  
  console.log('Audio Status:', {
    isLoaded: status.isLoaded,
    isPlaying: status.isPlaying,
    position: status.positionMillis,
    duration: status.durationMillis,
    isBuffering: status.isBuffering,
    error: status.error,
  });
}

/**
 * Vérifie si un son est correctement chargé
 */
export async function isSoundLoaded(sound: Audio.Sound | null): Promise<boolean> {
  if (!sound) return false;
  
  try {
    const status = await sound.getStatusAsync();
    return status.isLoaded === true;
  } catch (error) {
    console.error("Error checking if sound is loaded:", error);
    return false;
  }
}

/**
 * Charge un fichier audio avec plus de fiabilité et de timeout
 */
export async function loadSoundWithRetry(
  uri: string, 
  retries = 2,
  timeoutMs = 10000
): Promise<Audio.Sound | null> {
  let attempt = 0;
  
  while (attempt <= retries) {
    try {
      console.log(`Loading sound attempt ${attempt + 1}/${retries + 1} for URI: ${uri.substring(0, 50)}...`);
      
      // Création d'un nouvel objet son à chaque tentative
      const sound = new Audio.Sound();
      
      // Configuration d'un timeout pour éviter les blocages
      const loadPromise = sound.loadAsync(
        { uri },
        { shouldPlay: false, progressUpdateIntervalMillis: 500 }
      );
      
      // Ajouter une protection par timeout
      const timeoutPromise = new Promise<null>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Timeout de ${timeoutMs}ms dépassé lors du chargement audio`));
        }, timeoutMs);
      });
      
      // Utiliser la première promesse qui se résout
      const result = await Promise.race([loadPromise, timeoutPromise]);
      
      if (result === null) {
        // Le timeout a gagné
        throw new Error('Timeout lors du chargement audio');
      }
      
      // Vérifier que le son est correctement chargé
      const status = await sound.getStatusAsync();
      
      if (status.isLoaded) {
        console.log('Son chargé avec succès après', attempt + 1, 'tentative(s)');
        return sound;
      } else {
        throw new Error('Le son a été chargé mais son état n\'est pas valide');
      }
    } catch (error) {
      console.warn(`Tentative ${attempt + 1} échouée:`, error);
      attempt++;
      
      // Attendre un peu plus longtemps entre chaque tentative
      if (attempt <= retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  
  return null;
}
