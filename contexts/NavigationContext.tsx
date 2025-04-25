import React, { createContext, useContext, useEffect, ReactNode } from 'react';
import { AppState } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { audioManager } from '../utils/OptimizedAudioService'; // Ajustez le chemin si nécessaire

// Définir le type du contexte
type NavigationContextType = null; // ou remplacez par une interface si vous avez des valeurs à partager

// Créer le contexte avec un type défini
const NavigationContext = createContext<NavigationContextType>(null);

// Définir l'interface pour les props du provider
interface NavigationProviderProps {
  children: ReactNode;
}

export function NavigationProvider({ children }: NavigationProviderProps) {
  const router = useRouter();
  
  useEffect(() => {
    // Gestionnaire pour les événements d'état de l'application
    const appStateSubscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState === 'active') {
        // L'application revient au premier plan
        try {
          // Appeler la méthode pour préserver la lecture
          await audioManager.handleAppReactivation();
          } catch (error) {
            console.error('Erreur lors de la réactivation de l\'audio:', error);
          }
        }
      });

    // Écouteur pour les interactions avec l'AudioManager
    const unsubscribe = audioManager.addListener((data) => {
      if (data.type === 'notification-interaction') {
        console.log('Interaction avec la notification détectée, navigation vers le player');
        router.navigate('/(tabs)/player');
      }
    });
    
    // Vérifier au démarrage si un épisode est en cours
    const checkInitialState = async () => {
      const shouldNavigate = await AsyncStorage.getItem('navigateToPlayer');
      if (shouldNavigate === 'true') {
        AsyncStorage.removeItem('navigateToPlayer');
        router.navigate('/(tabs)/player');
      }
    };
    
    checkInitialState();
    
    return () => {
      appStateSubscription.remove();
      unsubscribe();
    };
  }, [router]);
  
  return (
    <NavigationContext.Provider value={null}>
      {children}
    </NavigationContext.Provider>
  );
}

// Hook optionnel pour utiliser le contexte
export function useNavigation() {
  return useContext(NavigationContext);
}