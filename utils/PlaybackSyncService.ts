// filepath: /Users/mathieuandroz/code/mathieu/github/bigheads/utils/PlaybackSyncService.ts
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase'; // Ajustez le chemin si nécessaire
import { AppState } from 'react-native';

export const PENDING_POSITIONS_KEY = 'pendingPlaybackPositions';

// Interface pour les données stockées localement
interface PendingPosition {
  episodeId: string;
  positionSeconds: number;
  userId: string;
  timestamp: string; // ISO string date
}

let isSyncing = false; // Verrou pour éviter les synchronisations concurrentes
let netInfoUnsubscribe: (() => void) | null = null; // Pour se désabonner de l'écouteur NetInfo
let appStateSubscription: { remove: () => void } | null = null; // Pour se désabonner de l'écouteur AppState

/**
 * Tente de synchroniser les positions de lecture stockées localement avec Supabase.
 */
export async function syncPlaybackPositions() {
  if (isSyncing) {
    console.log('[SyncService] Sync already in progress.');
    return;
  }

  const netInfoState = await NetInfo.fetch();
  if (!netInfoState.isConnected || !netInfoState.isInternetReachable) {
    console.log('[SyncService] Sync skipped: No internet connection.');
    return;
  }

  isSyncing = true;
  console.log('[SyncService] Starting playback position sync...');

  try {
    const existingPendingString = await AsyncStorage.getItem(PENDING_POSITIONS_KEY);
    if (!existingPendingString) {
      console.log('[SyncService] No pending positions found.');
      isSyncing = false;
      return;
    }

    let pendingPositions: PendingPosition[] = JSON.parse(existingPendingString);
    if (!Array.isArray(pendingPositions) || pendingPositions.length === 0) {
        console.log('[SyncService] Pending positions data is invalid or empty.');
        await AsyncStorage.removeItem(PENDING_POSITIONS_KEY); // Clean up invalid data
        isSyncing = false;
        return;
    }


    console.log(`[SyncService] Found ${pendingPositions.length} pending positions.`);

    const successfullySynced: PendingPosition[] = [];
    const { data: { user } } = await supabase.auth.getUser(); // Vérifier l'utilisateur actuel

    if (!user) {
        console.warn('[SyncService] Cannot sync, no user logged in.');
        isSyncing = false;
        return;
    }

    // Filtrer les positions pour l'utilisateur actuel uniquement
    const userPendingPositions = pendingPositions.filter(p => p.userId === user.id);

    for (const pos of userPendingPositions) {
      console.log(`[SyncService] Tentative synchro pos pour épisode ${pos.episodeId}`);
      try {
        const { error } = await supabase
          .from('watched_episodes')
          .upsert({
            user_id: pos.userId, // Utiliser l'userId stocké
            episode_id: pos.episodeId,
            playback_position: pos.positionSeconds,
            watched_at: new Date(pos.timestamp).toISOString(), // Utiliser le timestamp stocké
            is_finished: false // <<< Explicitement false lors de la synchro de position hors ligne
          }, {
            onConflict: 'user_id, episode_id' // Assurez-vous que c'est votre contrainte unique
          });

        if (error) {
          console.error(`[SyncService] Supabase error for episode ${pos.episodeId}:`, error.message);
          // Ne pas ajouter aux successfullySynced, sera réessayé plus tard
        } else {
          console.log(`[SyncService] Success for episode ${pos.episodeId}.`);
          successfullySynced.push(pos);
        }
      } catch (syncErr) {
        console.error(`[SyncService] Exception for episode ${pos.episodeId}:`, syncErr);
        // Ne pas ajouter aux successfullySynced
      }
    }

    // Mettre à jour AsyncStorage en retirant les éléments synchronisés avec succès
    if (successfullySynced.length > 0) {
      const remainingPositions = pendingPositions.filter(p =>
        // Garder ceux qui ne sont PAS dans successfullySynced OU qui appartiennent à un autre user
        p.userId !== user.id || !successfullySynced.some(s => s.episodeId === p.episodeId && s.userId === p.userId)
      );

      if (remainingPositions.length === 0) {
        await AsyncStorage.removeItem(PENDING_POSITIONS_KEY);
        console.log('[SyncService] All pending positions synced and local storage cleared.');
      } else {
        await AsyncStorage.setItem(PENDING_POSITIONS_KEY, JSON.stringify(remainingPositions));
        console.log(`[SyncService] ${successfullySynced.length} positions synced. ${remainingPositions.length} remaining in storage.`);
      }
    }

  } catch (error) {
    console.error("[SyncService] Error during sync process:", error);
  } finally {
    isSyncing = false;
    console.log('[SyncService] Sync process finished.');
  }
}

/**
 * Initialise les écouteurs pour déclencher la synchronisation automatiquement.
 * @returns Une fonction pour nettoyer les écouteurs.
 */
export function initializePlaybackSync(): () => void {
    console.log('[SyncService] Initializing playback sync listeners...');
    // Tentative de synchronisation au démarrage (après un court délai pour laisser l'app se charger)
    setTimeout(syncPlaybackPositions, 5000);

    // Supprimer les anciens écouteurs s'ils existent
    netInfoUnsubscribe?.();
    appStateSubscription?.remove();

    // Écouter les changements d'état réseau
    netInfoUnsubscribe = NetInfo.addEventListener(state => {
        console.log('[SyncService] Network state changed. Connected:', state.isConnected, 'Internet Reachable:', state.isInternetReachable);
        if (state.isConnected && state.isInternetReachable) {
            console.log('[SyncService] Network available, triggering sync.');
            syncPlaybackPositions(); // Tenter la synchronisation quand le réseau revient
        }
    });

    // Écouter les changements d'état de l'application (passage en avant-plan)
    appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
        if (nextAppState === 'active') {
            console.log('[SyncService] App came to foreground, triggering sync.');
            syncPlaybackPositions(); // Tenter la synchronisation quand l'app revient active
        }
    });

    // Retourner une fonction de nettoyage
    return () => {
        console.log('[SyncService] Cleaning up sync listeners.');
        netInfoUnsubscribe?.();
        appStateSubscription?.remove();
        netInfoUnsubscribe = null;
        appStateSubscription = null;
    };
}