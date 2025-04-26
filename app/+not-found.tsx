import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '../styles/global';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function NotFoundScreen() {
  const router = useRouter();

  useEffect(() => {
    const redirectToPlayer = async () => {
      try {
        console.log('[NotFound] Tentative de redirection automatique vers le player...');
        
        // Récupérer les données de lecture sauvegardées
        const lastEpisodeId = await AsyncStorage.getItem('lastPlayedEpisodeId');
        const lastPosition = await AsyncStorage.getItem('lastPlayedPosition');
        const wasPlaying = await AsyncStorage.getItem('wasPlaying');
        
        if (lastEpisodeId) {
          console.log(`[NotFound] Redirection avec l'épisode ${lastEpisodeId} à la position ${lastPosition || 0}`);
          // Navigue vers le player avec l'épisode courant, la position et l'état de lecture
          router.replace({
            pathname: '/(tabs)/player',
            params: {
              episodeId: lastEpisodeId,
              position: lastPosition ? Number(lastPosition) : undefined,
              autoplay: wasPlaying === 'true' ? '1' : '0',
              fromNotFound: '1',
              timestamp: Date.now().toString() // Force le rechargement
            }
          });
        } else {
          console.log('[NotFound] Aucun épisode en cours trouvé, redirection vers le player par défaut');
          router.replace('/(tabs)/player');
        }
      } catch (error) {
        console.error('[NotFound] Erreur lors de la redirection:', error);
        router.replace('/(tabs)/player');
      }
    };

    // Rediriger automatiquement après un court délai
    const timeout = setTimeout(() => {
      redirectToPlayer();
    }, 500); // Délai court pour permettre à l'écran de s'afficher brièvement

    return () => clearTimeout(timeout);
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
      <Text style={styles.text}>Redirection en cours...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.primaryBackground,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  text: {
    color: theme.colors.text,
    fontSize: 16,
    marginTop: 16,
    textAlign: 'center',
  }
});