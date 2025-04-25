import { Link, Stack, useRouter } from 'expo-router';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { theme } from '../styles/global';
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { audioManager } from '../utils/OptimizedAudioService';

export default function NotFoundScreen() {
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Fonction pour vérifier l'état du lecteur et rediriger
    const checkPlayerAndRedirect = async () => {
      try {
        const state = audioManager.getState();
        
        console.log('NotFoundScreen: Vérification de l\'état du lecteur', state);
        
        if (state.currentEpisode) {
          console.log('NotFoundScreen: Épisode en cours, redirection vers le player');
          
          // IMPORTANT: Sauvegardez l'état pour empêcher la réinitialisation
          await AsyncStorage.setItem('preservePlayback', 'true');
          
          // Rediriger vers l'écran player
          router.replace('/(tabs)/player');
          
          // NOUVEAU: Assurez-vous que la lecture continue si elle était en cours
          if (state.isPlaying) {
            setTimeout(() => {
              audioManager.handleAppReactivation();
            }, 500);
          }
        } else {
          console.log('NotFoundScreen: Aucun épisode en cours, affichage normal');
          setIsRedirecting(false);
        }
      } catch (error) {
        console.error('Erreur lors de la vérification de l\'état du lecteur:', error);
        setIsRedirecting(false);
        setErrorMessage('Impossible de vérifier l\'état de lecture');
      }
    };

    // Ajouter un délai pour s'assurer que les états sont bien initialisés
    const timeout = setTimeout(checkPlayerAndRedirect, 500);
    
    return () => clearTimeout(timeout);
  }, [router]);

  // Afficher un écran de chargement pendant la redirection
  if (isRedirecting) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={theme.colors.primary || '#b48d7b'} />
        <Text style={[styles.text, { marginTop: 15 }]}>Chargement en cours...</Text>
      </View>
    );
  }

  // Afficher l'écran not found normal si pas de redirection
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View style={styles.container}>
        {errorMessage ? (
          <Text style={[styles.text, { color: 'red' }]}>{errorMessage}</Text>
        ) : (
          <Text style={styles.text}>Cette page n'existe pas.</Text>
        )}
        <Link href="/" style={styles.link}>
          <Text>Retour à l'accueil</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  text: {
    fontSize: 20,
    fontWeight: '600',
    color: theme.colors.text,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
});