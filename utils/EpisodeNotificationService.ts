import * as Notifications from 'expo-notifications';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Identifiant unique pour la tâche de vérification des épisodes
const CHECK_NEW_EPISODES_TASK = 'xyz.myops.bigheads.check-new-episodes';

// Configurer les notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Fonctions de gestion du temps (Paris)
/**
 * Convertit une heure UTC en heure Paris avec prise en compte du changement d'heure été/hiver
 */
function convertToParisTime(utcDate: Date): Date {
  // Créer une date avec l'heure de Paris
  const parisDate = new Date(utcDate.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  return parisDate;
}

/**
 * Convertit une heure Paris en UTC pour la programmation
 */
function getNextParisTime(hour: number, minute: number): Date {
  // Date actuelle en UTC
  const now = new Date();
  
  // Conversion en heure de Paris
  const parisNow = convertToParisTime(now);
  
  // Créer l'heure cible à Paris pour aujourd'hui
  const targetParisTime = new Date(parisNow);
  targetParisTime.setHours(hour, minute, 0, 0);
  
  // Si l'heure cible est déjà passée, ajouter un jour
  if (parisNow > targetParisTime) {
    targetParisTime.setDate(targetParisTime.getDate() + 1);
  }
  
  // Calculer la différence en millisecondes entre maintenant et l'heure cible
  const parisTimeDiffMs = targetParisTime.getTime() - parisNow.getTime();
  
  // Ajouter cette différence à la date UTC actuelle
  const targetUtcTime = new Date(now.getTime() + parisTimeDiffMs);
  
  return targetUtcTime;
}

// Définir la tâche de vérification des épisodes
TaskManager.defineTask(CHECK_NEW_EPISODES_TASK, async () => {
  try {
    const result = await checkForNewEpisodes();
    return result
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (error) {
    console.error('Erreur lors de la vérification des nouveaux épisodes:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// Fonction pour vérifier les nouveaux épisodes
async function checkForNewEpisodes(): Promise<boolean> {
  try {
    // Obtenir la date du jour en heure de Paris au format YYYY-MM-DD
    const parisToday = convertToParisTime(new Date());
    const formattedDate = parisToday.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Récupérer le dernier épisode vérifié depuis le stockage
    const lastCheckedEpisodeId = await AsyncStorage.getItem('lastCheckedEpisodeId');
    
    console.log(`Vérification des nouveaux épisodes pour la date ${formattedDate} (heure de Paris)`);
    
    // Vérifier s'il y a un nouvel épisode avec la date de publication d'aujourd'hui
    const { data, error } = await supabase
      .from('episodes')
      .select('id, title, description')
      .eq('publication_date', formattedDate)
      .order('id', { ascending: false })
      .limit(1);
    
    if (error) {
      console.error('Erreur lors de la requête à Supabase:', error);
      return false;
    }
    
    // S'il y a un nouvel épisode et qu'il est différent du dernier vérifié
    if (data && data.length > 0 && data[0].id !== lastCheckedEpisodeId) {
      const newEpisode = data[0];
      
      // Enregistrer le nouvel épisode comme dernier vérifié
      await AsyncStorage.setItem('lastCheckedEpisodeId', newEpisode.id);
      
      // Envoyer une notification
      await sendNewEpisodeNotification(newEpisode);
      
      console.log('Nouvel épisode détecté et notification envoyée:', newEpisode.title);
      return true;
    }
    
    // Vérifier l'heure actuelle à Paris pour la re-programmation potentielle
    const parisCurrentHour = parisToday.getHours();
    const parisCurrentMinutes = parisToday.getMinutes();
    
    if ((parisCurrentHour === 17 && parisCurrentMinutes >= 30) || parisCurrentHour > 17) {
      // Nous sommes après 17h30 heure de Paris, programmer une nouvelle vérification dans 1 heure
      scheduleNextCheck(60);
    }
    
    return false;
  } catch (error) {
    console.error('Erreur lors de la vérification des nouveaux épisodes:', error);
    return false;
  }
}

// Envoyer une notification pour un nouvel épisode
async function sendNewEpisodeNotification(episode: { id: string, title: string, description: string }): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Nouvel épisode disponible !',
      body: episode.title,
      data: { episodeId: episode.id },
    },
    trigger: null, // Envoyer immédiatement
  });
}

// Programmer la prochaine vérification (en minutes)
function scheduleNextCheck(minutes: number): void {
  // Créer un rappel pour vérifier à nouveau plus tard
  setTimeout(() => {
    BackgroundFetch.registerTaskAsync(CHECK_NEW_EPISODES_TASK, {
      minimumInterval: 60 * minutes, // Convertir en secondes
      stopOnTerminate: false,
      startOnBoot: true,
    }).catch(err => console.error('Erreur lors de la programmation de la prochaine vérification:', err));
  }, 1000); // Attendre 1 seconde pour éviter tout conflit
}

// Configure la vérification initiale à 17h30 heure de Paris
function configureInitialCheck(): void {
  // Obtenir la prochaine occurrence de 17h30 heure de Paris en UTC
  const nextCheckTimeUtc = getNextParisTime(17, 30);
  
  // Temps d'attente en millisecondes
  const timeUntilCheck = nextCheckTimeUtc.getTime() - Date.now();
  
  console.log(`Next check scheduled for: ${nextCheckTimeUtc.toISOString()} (in ${Math.round(timeUntilCheck/1000/60)} minutes)`);
  
  // Programmer la vérification
  setTimeout(() => {
    checkForNewEpisodes().catch(err => 
      console.error('Erreur lors de la vérification initiale:', err)
    );
  }, timeUntilCheck);
}

// Initialiser le service de notification
export async function initEpisodeNotificationService(): Promise<void> {
  try {
    // Demander les permissions de notification
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      console.warn('Les permissions de notification n\'ont pas été accordées');
      return;
    }
    
    // Enregistrer la tâche de vérification périodique
    await BackgroundFetch.registerTaskAsync(CHECK_NEW_EPISODES_TASK, {
      minimumInterval: 60 * 60, // Vérifier toutes les heures (en secondes)
      stopOnTerminate: false,
      startOnBoot: true,
    });
    
    // Configurer la première vérification
    configureInitialCheck();
    
    console.log('Service de notification d\'épisodes initialisé avec succès');
  } catch (error) {
    console.error('Erreur lors de l\'initialisation du service de notification:', error);
  }
}

// Configurer un gestionnaire pour les notifications reçues
export function setupNotificationListener(onNotificationReceived: (episodeId: string) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(response => {
    const episodeId = response.notification.request.content.data?.episodeId;
    if (episodeId) {
      onNotificationReceived(episodeId);
    }
  });
  
  return () => subscription.remove();
}

// Fonction de test pour les notifications
export async function testNotification(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Test de notification',
      body: 'Ceci est un test de notification pour Les Intégrales BigHeads',
      data: { test: true },
    },
    trigger: null,
  });
  
  console.log('Notification de test envoyée');
}