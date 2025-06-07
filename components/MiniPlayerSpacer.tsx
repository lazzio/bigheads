import React, { useState, useEffect } from 'react';
import { View } from 'react-native';
import { useAudio } from './AudioContext';
import { MINI_PLAYER_HEIGHT } from './MiniPlayer';

interface MiniPlayerSpacerProps {
  style?: any;
}

export default function MiniPlayerSpacer({ style }: MiniPlayerSpacerProps) {
  const audioManager = useAudio();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // Listen to AudioManager to know if mini player should be visible
    const unsubscribe = audioManager.addListener((data: any) => {
      if (!isMounted) return;
      
      switch (data.type) {
        case 'loaded':
          if (data.episode) {
            setIsVisible(true);
          }
          break;
        case 'unloaded':
          setIsVisible(false);
          break;
      }
    });

    // Check initial state
    audioManager.getStatusAsync().then(status => {
      if (isMounted) {
        setIsVisible(status.isLoaded && !!status.currentEpisodeId);
      }
    }).catch(() => {
      // Ignore errors on initial check
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [audioManager]);

  // Only render spacing when mini player should be visible
  if (!isVisible) {
    return null;
  }

  return (
    <View 
      style={[
        { 
          height: MINI_PLAYER_HEIGHT,
          marginBottom: 5,
          backgroundColor: 'transparent' 
        },
        style
      ]} 
    />
  );
}
