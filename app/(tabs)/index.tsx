import { View, Text, StyleSheet, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useCallback } from 'react';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { theme } from '../../styles/global';
import { 
  getLastPlayedEpisodeId, 
  loadCachedEpisodes 
} from '../../utils/cache/LocalStorageService';
import { supabase } from '../../lib/supabase';
import NetInfo from '@react-native-community/netinfo';
import { Episode } from '../../types/episode';
import { parseDuration } from '../../utils/commons/timeUtils';
import { getImageUrlFromDescription } from '../../components/GTPersons';

export default function HomeScreen() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handlePlayPress = useCallback(async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    
    try {
      // 1. Vérifier le dernier épisode écouté dans le cache local
      const lastPlayedEpisodeId = await getLastPlayedEpisodeId();
      console.log('[HomeScreen] Last played episode ID:', lastPlayedEpisodeId);

      let targetEpisodeId: string | null = null;
      
      if (lastPlayedEpisodeId) {
        // 2. Vérifier si cet épisode existe encore dans les données disponibles
        const cachedEpisodes = await loadCachedEpisodes();
        const lastEpisodeExists = cachedEpisodes.some(ep => ep.id === lastPlayedEpisodeId);
        
        if (lastEpisodeExists) {
          console.log('[HomeScreen] Last played episode found in cache, using it');
          targetEpisodeId = lastPlayedEpisodeId;
        } else {
          console.log('[HomeScreen] Last played episode not found in cache, will fetch latest');
        }
      }

      // 3. Si pas de dernier épisode ou épisode introuvable, récupérer le plus récent
      if (!targetEpisodeId) {
        console.log('[HomeScreen] Fetching latest episode...');
        
        // Vérifier la connexion réseau
        const netInfo = await NetInfo.fetch();
        let latestEpisode: Episode | null = null;

        if (netInfo.isConnected && netInfo.isInternetReachable) {
          // Récupérer depuis Supabase
          console.log('[HomeScreen] Fetching latest episode from Supabase...');
          const { data, error } = await supabase
            .from('episodes')
            .select('*')
            .order('publication_date', { ascending: false })
            .limit(1);

          if (error) {
            console.error('[HomeScreen] Error fetching latest episode:', error);
            throw new Error('Erreur lors du chargement');
          }

          if (data && data.length > 0) {
            const episode = data[0];
            latestEpisode = {
              id: episode.id,
              title: episode.title,
              description: episode.description,
              originalMp3Link: episode.original_mp3_link,
              mp3Link: episode.offline_path || episode.mp3_link,
              duration: parseDuration(episode.duration),
              publicationDate: episode.publication_date,
              offline_path: episode.offline_path,
              artwork: episode.artwork || getImageUrlFromDescription(episode.description) || undefined,
            };
          }
        } else {
          // Mode hors ligne - utiliser le cache
          console.log('[HomeScreen] Offline mode, using cached episodes...');
          const cachedEpisodes = await loadCachedEpisodes();
          if (cachedEpisodes.length > 0) {
            // Trier par date de publication (le plus récent en premier)
            const sortedEpisodes = cachedEpisodes.sort((a, b) => 
              new Date(b.publicationDate).getTime() - new Date(a.publicationDate).getTime()
            );
            latestEpisode = sortedEpisodes[0];
          }
        }

        if (latestEpisode) {
          targetEpisodeId = latestEpisode.id;
          console.log('[HomeScreen] Latest episode found:', latestEpisode.title);
        } else {
          throw new Error('Aucun épisode disponible');
        }
      }

      // 4. Naviguer vers le player avec l'épisode cible
      if (targetEpisodeId) {
        console.log('[HomeScreen] Navigating to player with episode:', targetEpisodeId);
        router.push({
          pathname: '/player/play',
          params: { 
            episodeId: targetEpisodeId,
            source: 'home_button'
          }
        });
      } else {
        throw new Error('Impossible de déterminer l\'épisode à lancer');
      }

    } catch (error: any) {
      console.error('[HomeScreen] Error in handlePlayPress:', error);
      
      // En cas d'erreur, essayer de naviguer vers le player sans paramètres
      // Le player se chargera de gérer le cas par défaut
      router.push({
        pathname: '/player/play',
        params: { source: 'home_button_fallback' }
      });
    } finally {
      setIsLoading(false);
    }
  }, [router, isLoading]);

  return (
    <View style={styles.container}>
      <Image
        source={{ uri: 'https://images.unsplash.com/photo-1478737270239-2f02b77fc618?q=80&w=1024' }}
        style={styles.backgroundImage}
      />
      <View style={styles.overlay}>
        <Text style={styles.title}>Les Grosses Têtes</Text>
        <Text style={styles.subtitle}>Les intégrales</Text>

        <TouchableOpacity
          style={[styles.playButton, isLoading && styles.playButtonLoading]}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
          onPress={handlePlayPress}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={theme.colors.shadowColor} />
          ) : (
            <MaterialIcons name="play-arrow" size={52} color={theme.colors.shadowColor} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.primaryBackground,
  },
  backgroundImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: theme.colors.text,
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 18,
    color: theme.colors.text,
    textAlign: 'center',
    marginBottom: 40,
    opacity: 0.8,
  },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.text,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 30,
  },
  playButtonLoading: {
    opacity: 0.7,
  },
  playText: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.shadowColor,
  },
});