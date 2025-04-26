import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useEpisodes } from '../../hooks/episodes/useEpisodes';
import EpisodeListHeader from '../../components/episodes/EpisodeListHeader';
import EpisodeList from '../../components/episodes/EpisodeList';
import { theme } from '../../styles/global'; // Assuming global styles

export default function EpisodesScreen() {
  const router = useRouter();
  const {
    episodes,
    watchedEpisodes,
    loading,
    error,
    isOffline,
    refresh,
  } = useEpisodes();

  // Correction : toujours passer l'episodeId dans les params pour forcer le rechargement du player
  const handlePlayPress = (episodeId: string) => {
    router.push({
      pathname: '/(tabs)/player',
      params: { episodeId }, // Ajout du paramètre episodeId
    });
  };

  return (
    <View style={styles.container}>
      <EpisodeListHeader />
      <EpisodeList
        episodes={episodes}
        watchedEpisodes={watchedEpisodes}
        loading={loading}
        error={error}
        isOffline={isOffline}
        onRefresh={refresh}
        onPlayPress={handlePlayPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.primaryBackground,
  },
});
