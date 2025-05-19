import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  Dimensions, 
  Animated,
  PanResponder,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { audioManager } from '../utils/OptimizedAudioService';
import { theme } from '../styles/global';
import { Episode } from '../types/episode';
import { savePositionLocally } from '../utils/cache/LocalStorageService';

// Dimensions de l'écran
const { height } = Dimensions.get('window');
const MINI_PLAYER_HEIGHT = 60;
const FULL_PLAYER_HEIGHT = height;
const TAB_BAR_HEIGHT = 65;

export default function MiniPlayer() {
  const router = useRouter();
  
  // États du player
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  // États de l'animation
  const playerHeight = useRef(new Animated.Value(MINI_PLAYER_HEIGHT)).current;
  const playerY = useRef(new Animated.Value(height - MINI_PLAYER_HEIGHT - TAB_BAR_HEIGHT)).current;
  // Utiliser une position fixe au lieu de transformer par translateY
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Progress calculation
  const progress = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;

  const miniTitle = currentEpisode?.title.replace(/L'INTÉGRALE - /, '') || '';
  
  // Gestionnaire de pan pour le glissement
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
  });
  
  // Effect pour s'abonner aux événements du lecteur audio
  useEffect(() => {
    let isMounted = true;
    console.log('[MiniPlayer] Setting up audio event listener');
    
    const unsubscribe = audioManager.addListener((data: any) => {
      if (!isMounted) return;
      
      switch (data.type) {
        case 'loaded':
          if (data.episode) {
            console.log(`[MiniPlayer] Episode loaded: ${data.episode.title}`);
            setCurrentEpisode(data.episode);
            setError(null);
            if (data.duration > 0) {
              setDuration(data.duration);
            }
          }
          break;
          
        case 'status':
          // Mettre à jour la position
          setPosition(data.position);
          
          // Mettre à jour l'état de lecture
          setIsPlaying(data.isPlaying);
          setIsBuffering(data.isBuffering);
          
          // Si la durée est définie dans le statut
          if (data.duration > 0) {
            setDuration(data.duration);
          }
          
          // Effacer l'erreur si présente
          if (error) setError(null);
          break;
          
        case 'error':
          console.error(`[MiniPlayer] Received error: ${data.error}`);
          setError(data.error);
          setIsPlaying(false);
          setIsBuffering(false);
          break;
          
        case 'finished':
          console.log('[MiniPlayer] Playback finished');
          setPosition(duration);
          setIsPlaying(false);
          setIsBuffering(false);
          break;
          
        case 'unloaded':
          console.log('[MiniPlayer] Audio unloaded');
          setCurrentEpisode(null);
          setPosition(0);
          setDuration(0);
          setIsPlaying(false);
          setIsBuffering(false);
          break;
      }
    });
    
    // Vérifier s'il y a déjà un épisode en cours
    audioManager.getStatusAsync().then(status => {
      if (status.isLoaded && status.currentEpisodeId) {
        console.log(`[MiniPlayer] Retrieved current status: ${status.currentEpisodeId}, isPlaying=${status.isPlaying}`);
        setPosition(status.positionMillis);
        setIsPlaying(status.isPlaying);
        setDuration(status.durationMillis);
        
        // Récupérer les détails de l'épisode actuel
        if (status.currentEpisode) {
          setCurrentEpisode(status.currentEpisode);
        }
      } else {
        console.log('[MiniPlayer] No episode currently loaded');
      }
    }).catch(err => {
      console.error('[MiniPlayer] Error checking status:', err);
    });
    
    return () => {
      console.log('[MiniPlayer] Cleaning up audio event listener');
      isMounted = false;
      unsubscribe();
    };
  }, []);
  
  const minimizePlayer = useCallback(() => {
    console.log('[MiniPlayer] Minimizing player');
    setIsExpanded(false);
  }, []);
  
  // Fonction pour étendre/agrandir le player
  const expandPlayer = useCallback(() => {
    console.log('[MiniPlayer] Expanding player');
    setIsExpanded(true);
    
    // Vérifier si l'épisode est toujours chargé
    if (currentEpisode?.id) {
      // Mettre à jour l'état de lecture actuel si nécessaire
      audioManager.getStatusAsync().then(status => {
        if (status.isLoaded) {
          setIsPlaying(status.isPlaying);
          setPosition(status.positionMillis);
        }
      }).catch(err => {
        console.error("[MiniPlayer] Error refreshing status while expanding:", err);
      });
    }
  }, [currentEpisode]);
  
  // Contrôles du lecteur
  const handlePlayPause = useCallback(async () => {
    console.log(`[MiniPlayer] Play/Pause pressed. Current state: isPlaying=${isPlaying}`);
    try {
      if (isPlaying) {
        await audioManager.pause();
      } else {
        await audioManager.play();
      }
    } catch (err) {
      console.error("[MiniPlayer] Error toggling play/pause:", err);
    }
  }, [isPlaying]);
  
  // Fonction pour gérer le clic sur le mini-player
  const handleMiniPlayerPress = useCallback(() => {
    if (currentEpisode?.id) {
      // Sauvegarder la position de lecture actuelle dans le cache local avant d'ouvrir le player
      savePositionLocally(currentEpisode.id, position);
      console.log(`[MiniPlayer] Navigating to player for episode ${currentEpisode.id}`);
      router.push({
        pathname: '/player/player',
        params: { episodeId: currentEpisode.id }
      });
    }
  }, [currentEpisode, router, position]);

  // Si pas d'épisode en cours, ne pas afficher le mini-player
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
