import { getStringItem, removeStringItem } from './cache/LocalStorageService';
import { supabase } from '../lib/supabase';

const OFFLINE_WATCHED_EPISODES_KEY = 'offline_watched_episodes';

/**
 * Synchronise les épisodes vus hors ligne avec le serveur
 * Appelée lorsque l'application retrouve une connexion
 */
export async function syncOfflineWatchedEpisodes(): Promise<void> {
  try {
    // Récupérer les épisodes vus hors ligne
    const offlineWatchedEpisodesJSON = await getStringItem(OFFLINE_WATCHED_EPISODES_KEY);
    if (!offlineWatchedEpisodesJSON) {
      return;
    }

    const offlineWatchedEpisodes = JSON.parse(offlineWatchedEpisodesJSON) as string[];
    if (offlineWatchedEpisodes.length === 0) {
      return;
    }

    // Vérifier si l'utilisateur est connecté
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('User not logged in, cannot sync watched episodes');
      return;
    }

    // Insérer les épisodes vus en lot
    const watchedData = offlineWatchedEpisodes.map(episodeId => ({
      user_id: user.id,
      episode_id: episodeId,
      watched_at: new Date().toISOString()
    }));

    const { error } = await supabase
      .from('watched_episodes')
      .upsert(watchedData);

    if (error) {
      console.error('Error syncing watched episodes:', error);
      return;
    }

    // Si tout s'est bien passé, effacer les épisodes vus hors ligne
    await removeStringItem(OFFLINE_WATCHED_EPISODES_KEY);
    console.log(`Successfully synced ${watchedData.length} watched episodes`);
  } catch (error) {
    console.error('Error in syncOfflineWatchedEpisodes:', error);
  }
}
