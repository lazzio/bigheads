import { View, Text, FlatList, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native'; // Ajouter Platform et ActivityIndicator
import { useRouter, useFocusEffect } from 'expo-router';
import { Play, CircleCheck as CheckCircle2, WifiOff, Music } from 'lucide-react-native'; // Importer une icône pour le placeholder
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import { Episode } from '../../types/episode';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';

type SupabaseEpisode = Database['public']['Tables']['episodes']['Row'];
type WatchedEpisodeRow = Database['public']['Tables']['watched_episodes']['Row']; // Utiliser le type Row complet

const EPISODES_CACHE_KEY = 'cached_episodes';

const colors = {
  background: '#121212',
  cardBackground: '#1a1a1a',
  textPrimary: '#ffffff', // Blanc pur pour le titre
  textSecondary: '#b3b3b3', // Gris clair pour la description
  textMuted: '#808080',    // Gris plus foncé pour la durée
  iconColor: '#ffffff',
  iconColorWatched: '#0ea5e9', // Garder le bleu pour "vu"
  offlineBackground: '#333333',
  offlineText: '#aaaaaa',
  errorBackground: 'rgba(239, 68, 68, 0.2)',
  errorBorder: '#ef4444',
  errorText: '#ff4444',
  loadingText: '#ffffff',
};

export default function EpisodesScreen() {
  const router = useRouter();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [watchedEpisodes, setWatchedEpisodes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  // Vérifier l'état de la connexion
  const checkNetworkStatus = async () => {
    try {
      const state = await NetInfo.fetch();
      setIsOffline(!state.isConnected);
      return !state.isConnected;
    } catch (error) {
      console.warn('Error checking network status:', error);
      return false;
    }
  };

  // Utiliser useFocusEffect pour rafraîchir la liste des épisodes vus à chaque fois que l'écran est affiché
  useFocusEffect(
    useCallback(() => {
      fetchWatchedEpisodes();
    }, [])
  );

  useEffect(() => {
    const initialize = async () => {
      await checkNetworkStatus();
      fetchEpisodes();
      fetchWatchedEpisodes();
    };
    
    initialize();
  }, []);

  // Charger les épisodes depuis le cache
  const loadCachedEpisodes = async (): Promise<Episode[]> => {
    try {
      const cachedData = await AsyncStorage.getItem(EPISODES_CACHE_KEY);
      if (cachedData) {
        const episodes = JSON.parse(cachedData);
        console.log(`Loaded ${episodes.length} episodes from cache for episodes tab`);
        return episodes;
      }
    } catch (error) {
      console.error('Error loading cached episodes:', error);
    }
    return [];
  };

  async function fetchEpisodes() {
    try {
      // Vérifier d'abord si nous sommes hors-ligne
      const offline = await checkNetworkStatus();
      
      if (offline) {
        // En mode hors-ligne, essayer de charger depuis le cache
        const cachedEpisodes = await loadCachedEpisodes();
        if (cachedEpisodes.length > 0) {
          setEpisodes(cachedEpisodes);
          // Message informatif, pas d'erreur
          setError(null);
        } else {
          // Pas de cache disponible, afficher un message informatif
          setError(null); // Pas d'erreur, juste une info
        }
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('episodes')
        .select('*')
        .order('publication_date', { ascending: false });

      if (error) throw error;

      const formattedEpisodes: Episode[] = (data as SupabaseEpisode[]).map(episode => ({
        id: episode.id,
        title: episode.title,
        description: episode.description,
        originalMp3Link: episode.original_mp3_link,
        original_mp3_link: episode.original_mp3_link,
        mp3Link: episode.mp3_link,
        mp3_link: episode.mp3_link,
        offline_path: episode.offline_path,
        duration: episode.duration,
        publicationDate: episode.publication_date,
        publication_date: episode.publication_date
      }));

      setEpisodes(formattedEpisodes);
      
      // Sauvegarder dans le cache
      try {
        await AsyncStorage.setItem(EPISODES_CACHE_KEY, JSON.stringify(formattedEpisodes));
      } catch (cacheError) {
        console.error('Error saving episodes to cache:', cacheError);
      }
    } catch (err) {
      const offline = await checkNetworkStatus();
      
      if (offline) {
        // En mode hors-ligne, essayer d'abord de charger depuis le cache
        const cachedEpisodes = await loadCachedEpisodes();
        if (cachedEpisodes.length > 0) {
          setEpisodes(cachedEpisodes);
          setError(null); // Pas d'erreur en mode hors-ligne
        } else {
          // Message informatif pour le mode hors-ligne sans cache
          setError(null);
        }
      } else {
        // Une vraie erreur s'est produite alors qu'on est en ligne
        setError(err instanceof Error ? err.message : 'Une erreur est survenue');
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchWatchedEpisodes() {
    try {
      const userResponse = await supabase.auth.getUser();
      const userId = userResponse.data.user?.id;
      if (!userId) {
        console.log('Utilisateur non connecté, saut récupération épisodes vus');
        setWatchedEpisodes(new Set()); // S'assurer que c'est vide si non connecté
        return;
      }

      const { data, error } = await supabase
        .from('watched_episodes')
        .select('episode_id') // Sélectionner seulement l'ID
        .eq('user_id', userId)
        .eq('is_finished', true);

      if (error) throw error;

      // Utiliser WatchedEpisodeRow si on sélectionne plus, sinon juste { episode_id: string }
      const watchedIds = new Set((data as { episode_id: string }[]).map(we => we.episode_id));
      console.log(`Récupéré ${watchedIds.size} épisodes terminés`);
      setWatchedEpisodes(watchedIds);
    } catch (err) {
      console.error('Erreur récupération épisodes vus:', err);
      setWatchedEpisodes(new Set()); // Réinitialiser en cas d'erreur
    }
  }

  // --- Fonction pour formater la durée (si tu n'en as pas déjà une) ---
  const formatDuration = (seconds: number | null | undefined): string => {
    if (seconds === null || seconds === undefined || isNaN(seconds) || seconds <= 0) {
      return '--:--';
    }
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    const minutesStr = String(minutes).padStart(2, '0');
    const secsStr = String(secs).padStart(2, '0');

    if (hours > 0) {
      return `${hours}:${minutesStr}:${secsStr}`;
    } else {
      return `${minutesStr}:${secsStr}`;
    }
  };

  // --- Rendu du composant ---
  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.iconColorWatched} />
        <Text style={styles.loadingText}>Chargement des épisodes...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Episodes</Text>

      {isOffline && (
        <View style={styles.offlineContainer}>
          <WifiOff size={20} color={colors.textSecondary} />
          <Text style={styles.offlineText}>
            Mode hors-ligne activé
          </Text>
        </View>
      )}

      {error && !isOffline && ( // Afficher l'erreur seulement si on n'est pas en mode offline (qui a son propre message)
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {episodes.length === 0 && !loading ? ( // Vérifier !loading aussi
        <View style={styles.emptyContainer}>
          {isOffline ? (
            <>
              <Text style={styles.emptyText}>Aucun épisode téléchargé ou en cache.</Text>
              <Text style={styles.hintText}>Connectez-vous pour voir les derniers épisodes.</Text>
            </>
          ) : (
            <Text style={styles.emptyText}>Aucun épisode trouvé.</Text>
          )}
        </View>
      ) : (
        <FlatList
          data={episodes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContentContainer} // Style pour le contenu interne
          renderItem={({ item }) => {
            const displayDuration = formatDuration(item.duration);
            const isWatched = watchedEpisodes.has(item.id);

            const handlePress = () => {
              router.push({
                pathname: '/(tabs)/player',
                params: { episodeId: item.id }
              });
            };

            return (
              // Rendre la carte entière cliquable pour la navigation
              <TouchableOpacity
                style={[styles.episodeItem, isWatched && styles.episodeItemWatched]} // Style optionnel pour item vu
                onPress={handlePress}
                activeOpacity={0.8} // Légèrement plus visible au toucher
              >
                {/* 1. Placeholder Image/Icon */}
                <View style={styles.episodeImagePlaceholder}>
                  {/* Tu pourrais mettre une Image ici plus tard */}
                  <Music size={24} color={colors.textSecondary} />
                </View>

                {/* Informations principales (Titre, Desc, Durée) */}
                <View style={styles.episodeInfo}>
                  <Text style={styles.episodeTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.episodeMeta} numberOfLines={1}>
                    {item.description ? item.description.substring(0, 50) + '...' : new Date(item.publication_date).toLocaleDateString()}
                  </Text>
                  <Text style={styles.episodeDuration}>{displayDuration}</Text>
                </View>

                {/* Bouton d'action à droite (Play/Check) */}
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={handlePress} // Le bouton fait la même action que la carte
                  hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }} // Zone de clic plus grande
                >
                  {isWatched ? (
                    <CheckCircle2 size={28} color={colors.iconColorWatched} />
                  ) : (
                    <Play size={28} color={colors.iconColor} />
                  )}
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

// --- Styles Refondus (UI Moderne) ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  header: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 15,
    marginTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
  },
  offlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.offlineBackground,
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 8,
    marginBottom: 16,
    marginHorizontal: 20,
  },
  offlineText: {
    color: colors.offlineText,
    fontSize: 14,
    marginLeft: 10,
    flex: 1,
  },
  errorContainer: {
    backgroundColor: colors.errorBackground,
    padding: 12,
    marginBottom: 16,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: colors.errorBorder,
    marginHorizontal: 20,
  },
  errorText: {
    color: colors.errorText,
    fontSize: 15,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingBottom: 50,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 17,
    textAlign: 'center',
    marginBottom: 10,
  },
  hintText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  // --- Styles Liste & Items ---
  listContentContainer: {
    paddingHorizontal: 10, // Réduire légèrement le padding global
    paddingBottom: 30,
    paddingTop: 5,
  },
  episodeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent', // Fond transparent, on se base sur le fond global
    paddingVertical: 12, // Padding vertical
    paddingHorizontal: 10, // Padding horizontal
    marginBottom: 8, // Espace entre items
    // Enlever le fond de carte et l'ombre pour un look plus intégré type liste
  },
  episodeItemWatched: {
    opacity: 0.6, // Atténuer un peu plus les éléments vus
  },
  // Style pour le placeholder d'image
  episodeImagePlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 8, // Coins arrondis
    backgroundColor: colors.cardBackground, // Fond gris foncé
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15, // Espace entre image et texte
  },
  episodeInfo: {
    flex: 1, // Prend l'espace restant entre image et bouton
    justifyContent: 'center', // Centrer verticalement le contenu texte
  },
  episodeTitle: {
    fontSize: 16, // Taille ok
    fontWeight: 'bold', // Gras pour le titre
    color: colors.textPrimary,
    marginBottom: 4, // Espace sous le titre
  },
  episodeMeta: { // Pour description courte ou date
    fontSize: 13,
    color: colors.textSecondary, // Couleur secondaire
    marginBottom: 6, // Espace sous la meta
  },
  episodeDuration: {
    fontSize: 12,
    color: colors.textMuted, // Couleur discrète
  },
  // Bouton d'action à droite
  actionButton: {
    paddingLeft: 15, // Espace avant le bouton
    paddingRight: 5, // Espace après le bouton
    height: 40, // Assurer une hauteur suffisante pour le clic
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Pas besoin de styles spécifiques pour playIcon/checkIcon si on utilise juste les icônes
  loadingText: {
    marginTop: 10,
    color: colors.loadingText,
    fontSize: 16,
  },
});