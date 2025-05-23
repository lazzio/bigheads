// --- Imports ---
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, Animated, PanResponder, AppState } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useAudio } from './AudioContext';
import { theme } from '../styles/global';
import { Episode } from '../types/episode';
import { savePositionLocally } from '../utils/cache/LocalStorageService';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

// --- Constants ---
const { height } = Dimensions.get('window');
const MINI_PLAYER_HEIGHT = 60;
const TAB_BAR_HEIGHT = 65;
const OFFLINE_SYNC_QUEUE_KEY = 'offline_sync_queue';

// --- Main Component ---
export default function MiniPlayer() {
  const audioManager = useAudio();
  const router = useRouter();
  // Player state
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Animation state
  const playerHeight = useRef(new Animated.Value(MINI_PLAYER_HEIGHT)).current;
  const playerY = useRef(new Animated.Value(height - MINI_PLAYER_HEIGHT - TAB_BAR_HEIGHT)).current;
  const [isExpanded, setIsExpanded] = useState(false);
  // Progress
  const progress = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;
  const miniTitle = currentEpisode?.title.replace(/L'INTÉGRALE - /, '') || '';
  // Pan gesture
  const panResponder = PanResponder.create({ onStartShouldSetPanResponder: () => true });

  // --- Effects ---
  useEffect(() => {
    let isMounted = true;
    // Listen to AudioManager for all state changes
    const unsubscribe = audioManager.addListener((data: any) => {
      if (!isMounted) return;
      switch (data.type) {
        case 'loaded':
          if (data.episode) {
            setCurrentEpisode(data.episode);
            setError(null);
            if (data.duration > 0) setDuration(data.duration);
            // If loaded and isPlaying, update state
            setIsPlaying(data.isPlaying ?? false);
            setPosition(data.position ?? 0);
          }
          break;
        case 'status':
          setPosition(data.position ?? 0);
          setIsPlaying(data.isPlaying ?? false);
          setIsBuffering(data.isBuffering ?? false);
          if (data.duration > 0) setDuration(data.duration);
          if (error) setError(null);
          break;
        case 'error':
          setError(data.error);
          setIsPlaying(false);
          setIsBuffering(false);
          break;
        case 'finished':
          setPosition(duration);
          setIsPlaying(false);
          setIsBuffering(false);
          break;
        case 'unloaded':
          setCurrentEpisode(null);
          setPosition(0);
          setDuration(0);
          setIsPlaying(false);
          setIsBuffering(false);
          break;
      }
    });
    // On mount, sync with AudioManager's current status
    audioManager.getStatusAsync().then(status => {
      if (status.isLoaded && status.currentEpisodeId) {
        setPosition(status.currentTime);
        setIsPlaying(status.isPlaying);
        setDuration(status.duration);
        if (status.currentEpisode) setCurrentEpisode(status.currentEpisode);
      } else {
        setCurrentEpisode(null);
        setIsPlaying(false);
        setPosition(0);
        setDuration(0);
      }
    });
    const unsubscribeNet = NetInfo.addEventListener(async state => {
      if (state.isConnected && state.isInternetReachable) triggerOfflineSyncFlush();
    });
    const appStateListener = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') triggerOfflineSyncFlush();
    });
    return () => {
      isMounted = false;
      unsubscribe();
      unsubscribeNet();
      appStateListener.remove();
    };
  }, [duration, error]);

  // --- Handlers ---
  const minimizePlayer = useCallback(() => setIsExpanded(false), []);
  const expandPlayer = useCallback(() => {
    setIsExpanded(true);
    if (currentEpisode?.id) {
      audioManager.getStatusAsync().then(status => {
        if (status.isLoaded) {
          setIsPlaying(status.isPlaying);
          setPosition(status.currentTime);
        }
      });
    }
  }, [currentEpisode]);
  const handlePlayPause = useCallback(async () => {
    try {
      const status = await audioManager.getStatusAsync();
      if (status.isLoaded && status.isPlaying) {
        await audioManager.pause();
      } else if (status.isLoaded) {
        await audioManager.play();
      } else if (currentEpisode) {
        // If not loaded, stop all sounds before loading and playing
        await audioManager.stopAllSounds();
        await audioManager.loadSound(currentEpisode, position);
        await audioManager.play();
      }
    } catch (err) {
      console.error("[MiniPlayer] Error toggling play/pause:", err);
    }
    const net = await NetInfo.fetch();
    if (!net.isConnected || !net.isInternetReachable) {
      if (currentEpisode?.id) await queueOfflineSync(currentEpisode.id, position, duration);
    }
  }, [currentEpisode, position, duration]);
  const handleMiniPlayerPress = useCallback(() => {
    if (currentEpisode?.id) {
      savePositionLocally(currentEpisode.id, position);
      NetInfo.fetch().then(net => {
        if (!net.isConnected || !net.isInternetReachable) {
          queueOfflineSync(currentEpisode.id, position, duration);
        }
      });
      router.push({ pathname: '/player/play', params: { episodeId: currentEpisode.id } });
    }
  }, [currentEpisode, router, position, duration]);

  // --- Render ---
  if (!currentEpisode) return null;
  return (
    <GestureHandlerRootView style={{ width: '100%' }}>
      <Animated.View
        style={[
          styles.playerContainer,
          {
            bottom: TAB_BAR_HEIGHT,
            height: playerHeight,
            transform: isExpanded ? [{ translateY: 0 }] : [],
            opacity: currentEpisode ? 1 : 0,
          }
        ]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity 
          style={[
            styles.miniPlayer,
            { opacity: isExpanded ? 0 : 1 }
          ]}
          onPress={handleMiniPlayerPress}
          activeOpacity={0.9}
          disabled={isExpanded}
        >
          <Image 
            source={currentEpisode.artwork}
            style={styles.miniAlbumArt}
            contentFit="cover"
          />
          <View style={styles.miniTrackInfo}>
            <Text style={styles.miniTitle} numberOfLines={1}>{miniTitle}</Text>
          </View>
          <View style={styles.miniControls}>
            <TouchableOpacity onPress={handlePlayPause} style={styles.playButton}>
                <MaterialIcons name={isPlaying ? "pause" : "play-arrow"} size={28} color={theme.colors.text} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </GestureHandlerRootView>
  );
}

// --- Helpers ---
function isFinished(position: number, duration: number) {
  if (!duration || duration === 0) return false;
  return position / (duration * 1000) >= 0.98;
}

export async function triggerOfflineSyncFlush() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await flushOfflineSync(user.id);
  } catch (e) { /* ignore */ }
}

async function queueOfflineSync(episodeId: string, position: number, duration?: number) {
  try {
    const queueStr = await AsyncStorage.getItem(OFFLINE_SYNC_QUEUE_KEY);
    const queue = queueStr ? JSON.parse(queueStr) : [];
    queue.push({ episodeId, position, duration, timestamp: Date.now() });
    await AsyncStorage.setItem(OFFLINE_SYNC_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) { console.error('[MiniPlayer] Failed to queue offline sync', e); }
}

async function flushOfflineSync(userId: string) {
  try {
    const queueStr = await AsyncStorage.getItem(OFFLINE_SYNC_QUEUE_KEY);
    if (!queueStr) return;
    const queue = JSON.parse(queueStr);
    if (!Array.isArray(queue) || queue.length === 0) return;
    const latestByEpisode: Record<string, { position: number, timestamp: number, duration?: number }> = {};
    for (const item of queue) {
      if (!latestByEpisode[item.episodeId] || item.timestamp > latestByEpisode[item.episodeId].timestamp) {
        latestByEpisode[item.episodeId] = { position: item.position, timestamp: item.timestamp, duration: item.duration };
      }
    }
    const upsertData = Object.entries(latestByEpisode).map(([episodeId, { position, timestamp, duration }]) => ({
      user_id: userId,
      episode_id: episodeId,
      playback_position: position / 1000,
      watched_at: new Date(timestamp).toISOString(),
      is_finished: isFinished(position, duration || 0)
    }));
    if (upsertData.length > 0) {
      const { error } = await supabase
        .from('watched_episodes')
        .upsert(upsertData, { onConflict: 'user_id, episode_id' });
      if (!error) {
        await AsyncStorage.removeItem(OFFLINE_SYNC_QUEUE_KEY);
        console.log('[MiniPlayer] Offline sync queue flushed to Supabase');
      } else {
        console.error('[MiniPlayer] Error syncing offline queue:', error.message);
      }
    }
  } catch (e) { console.error('[MiniPlayer] Failed to flush offline sync', e); }
}

const styles = StyleSheet.create({
  playerContainer: {
    position: 'absolute',
    width: '100%',
    left: 0,
    right: 0,
    backgroundColor: theme.colors.darkerBackground,
    elevation: 10,
    overflow: 'hidden',
    zIndex: 1000,
  },
  miniPlayer: {
    height: MINI_PLAYER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  miniAlbumArt: {
    width: 35,
    height: 35,
    borderRadius: 4,
    backgroundColor: theme.colors.borderColor,
  },
  miniTrackInfo: {
    flex: 1,
    marginLeft: 12,
  },
  miniTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.text,
  },
  miniControls: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
  },
  playButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
