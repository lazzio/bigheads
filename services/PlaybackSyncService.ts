import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../lib/supabase';
import {
  getPendingPositions,
  clearPendingPositions,
  getOfflineWatched,
  clearOfflineWatched,
} from './OfflineService';
import { PendingPosition, OfflineWatched } from '../types/player';

let isSyncing = false;
let syncTimeout: NodeJS.Timeout | null = null;

/**
 * Triggers synchronization with a delay to batch operations.
 */
export function triggerSync() {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }
  syncTimeout = setTimeout(() => {
    syncAllPendingData();
    syncTimeout = null;
  }, 5000); // Wait 5 seconds before syncing
}

/**
 * Attempts to sync all pending offline data (positions and watched status) with Supabase.
 */
async function syncAllPendingData() {
  if (isSyncing) {
    console.log('[SyncService] Sync already in progress.');
    return;
  }

  const networkState = await NetInfo.fetch();
  if (!networkState.isConnected) {
    console.log('[SyncService] No network connection, skipping sync.');
    return;
  }

  isSyncing = true;
  console.log('[SyncService] Starting synchronization...');

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[SyncService] Cannot sync, no user logged in.');
      isSyncing = false;
      return;
    }
    const userId = user.id;

    // Sync Positions
    const pendingPositions = await getPendingPositions();
    const userPendingPositions = pendingPositions.filter(p => p.userId === userId);
    if (userPendingPositions.length > 0) {
      console.log(`[SyncService] Syncing ${userPendingPositions.length} pending positions...`);
      const successfullySyncedPositions: PendingPosition[] = [];
      const upsertData = userPendingPositions.map(pos => ({
        user_id: pos.userId,
        episode_id: pos.episodeId,
        playback_position: pos.positionSeconds,
        watched_at: pos.timestamp,
        is_finished: false, // Explicitly set is_finished to false when syncing position
      }));

      const { error } = await supabase.from('watched_episodes').upsert(upsertData, {
        onConflict: 'user_id, episode_id',
      });

      if (error) {
        console.error('[SyncService] Error syncing positions:', error);
        // Decide if partial success needs handling or retry later
      } else {
        console.log('[SyncService] Successfully synced positions.');
        successfullySyncedPositions.push(...userPendingPositions);
        await clearPendingPositions(successfullySyncedPositions);
      }
    } else {
      console.log('[SyncService] No pending positions to sync.');
    }

    // Sync Watched Status
    const offlineWatched = await getOfflineWatched();
    const userOfflineWatched = offlineWatched.filter(w => w.userId === userId);
    if (userOfflineWatched.length > 0) {
      console.log(`[SyncService] Syncing ${userOfflineWatched.length} offline watched episodes...`);
      const successfullySyncedWatched: OfflineWatched[] = [];
      const upsertData = userOfflineWatched.map(watched => ({
        user_id: watched.userId,
        episode_id: watched.episodeId,
        watched_at: watched.timestamp,
        is_finished: true,
        playback_position: null, // Reset position when marking as finished
      }));

      const { error } = await supabase.from('watched_episodes').upsert(upsertData, {
        onConflict: 'user_id, episode_id',
      });

      if (error) {
        console.error('[SyncService] Error syncing watched status:', error);
      } else {
        console.log('[SyncService] Successfully synced watched status.');
        successfullySyncedWatched.push(...userOfflineWatched);
        await clearOfflineWatched(successfullySyncedWatched);
      }
    } else {
      console.log('[SyncService] No offline watched episodes to sync.');
    }

  } catch (error) {
    console.error('[SyncService] Unexpected error during sync:', error);
  } finally {
    isSyncing = false;
    console.log('[SyncService] Synchronization finished.');
  }
}

// Initial sync on startup (optional, can be triggered elsewhere)
// setTimeout(syncAllPendingData, 10000); // e.g., 10 seconds after app start
