import React, { createContext, useContext, useMemo } from 'react';
import { audioManager } from '../utils/OptimizedAudioService';

const AudioContext = createContext(audioManager);

export const AudioProvider = ({ children }: { children: React.ReactNode }) => {
  // On peut ajouter ici des hooks d'initialisation ou de debug si besoin
  return (
    <AudioContext.Provider value={audioManager}>
      {children}
    </AudioContext.Provider>
  );
};

export const useAudio = () => useContext(AudioContext);
