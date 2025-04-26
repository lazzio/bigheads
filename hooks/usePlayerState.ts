import { useContext } from 'react';
import { PlayerContext } from '../contexts/PlayerContext';
import { PlayerContextType } from '../types/player';

export const usePlayerState = (): PlayerContextType => {
  const context = useContext(PlayerContext);
  if (context === undefined) {
    throw new Error('usePlayerState must be used within a PlayerProvider');
  }
  return context;
};
