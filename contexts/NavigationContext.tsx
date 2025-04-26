import React, { createContext, useContext, useEffect, ReactNode } from 'react';
import { AppState } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Type du contexte (peut être étendu si besoin)
type NavigationContextType = null;

const NavigationContext = createContext<NavigationContextType>(null);

interface NavigationProviderProps {
  children: ReactNode;
}

export function NavigationProvider({ children }: NavigationProviderProps) {
  const router = useRouter();

  useEffect(() => {
    // Vérifie au démarrage si une navigation vers le player est demandée (ex: notification)
    const checkInitialState = async () => {
      const shouldNavigate = await AsyncStorage.getItem('navigateToPlayer');
      if (shouldNavigate === 'true') {
        await AsyncStorage.removeItem('navigateToPlayer');
        router.navigate('/(tabs)/player');
      }
    };

    checkInitialState();

    // Écouteur AppState pour d'autres besoins de navigation globale
    const appStateSubscription = AppState.addEventListener('change', () => {
      // Ajoutez ici des comportements globaux si besoin
    });

    // --- Correction du bug de sélection d'épisode ---
    // À chaque navigation vers le player avec un nouvel épisode, on force la mise à jour de l'URL (et donc des params)
    // Cela permet à PlayerScreen de détecter le changement et de charger le bon épisode.
    // À utiliser dans la liste d'épisodes : router.push({ pathname: '/(tabs)/player', params: { episodeId: ... } })
    // Ici, on écoute les changements de navigation pour forcer la réinitialisation si besoin (optionnel, sécurité)
    // (Rien à ajouter ici côté provider, la correction est côté navigation dans la liste d'épisodes.)

    return () => {
      appStateSubscription.remove();
    };
  }, [router]);

  return (
    <NavigationContext.Provider value={null}>
      {children}
    </NavigationContext.Provider>
  );
}

// Hook optionnel pour utiliser le contexte (à étendre si besoin)
export function useNavigation() {
  return useContext(NavigationContext);
}