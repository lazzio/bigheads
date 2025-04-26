import React from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator, RefreshControl, Text } from 'react-native';
import { Episode } from '../../types/episode';
import EpisodeListItem from './EpisodeListItem';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import OfflineBanner from './OfflineBanner';
import { theme } from '../../styles/global';

interface EpisodeListProps {
  episodes: Episode[];
  watchedEpisodes: Set<string>;
  loading: boolean;
  error: string | null;
  isOffline: boolean;
  onRefresh: () => void;
  onPlayPress: (episodeId: string) => void;
}

const EpisodeList = ({
  episodes,
  watchedEpisodes,
  loading,
  error,
  isOffline,
  onRefresh,
  onPlayPress,
}: EpisodeListProps) => {

  const renderItem = ({ item }: { item: Episode }) => (
    <EpisodeListItem
      episode={item}
      isWatched={watchedEpisodes.has(item.id)}
      onPress={() => onPlayPress(item.id)}
    />
  );

  // Decide what to render based on state
  const ListComponent = () => {
    // Full screen error takes priority if loading failed and no episodes are present
    if (!loading && error && episodes.length === 0) {
      return <ErrorState message={error} onRetry={onRefresh} />;
    }

    // Empty state if not loading, no error, and no episodes
    if (!loading && !error && episodes.length === 0) {
      return <EmptyState isOffline={isOffline} onRetry={onRefresh} />;
    }

    // Otherwise, render the list
    return (
      <FlatList
        data={episodes}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={loading} // Use loading state for refresh indicator
            onRefresh={onRefresh}
            tintColor={theme.colors.primary} // iOS spinner color
            colors={[theme.colors.primary]} // Android spinner colors
            progressBackgroundColor={theme.colors.secondaryBackground} // Android background
          />
        }
        ListHeaderComponent={
          <>
            {/* Show offline banner if offline */}
            {isOffline && <OfflineBanner showCacheMessage={episodes.length > 0} />}
            {/* Show non-blocking error banner if episodes are displayed but there was a refresh error */}
            {error && episodes.length > 0 && (
               <View style={styles.errorBanner}>
                 <Text style={styles.errorBannerText}>{error}</Text>
               </View>
            )}
          </>
        }
      />
    );
  };

  // Show loading indicator only on initial load
  if (loading && episodes.length === 0 && !error) {
     return (
       <View style={styles.centered}>
         <ActivityIndicator size="large" color={theme.colors.primary} />
       </View>
     );
  }

  return <ListComponent />;
};

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
   errorBanner: {
     backgroundColor: theme.colors.borderColor, // Use a less intrusive color
     paddingVertical: 8,
     paddingHorizontal: 15,
     marginHorizontal: 15,
     marginBottom: 10,
     borderRadius: 8,
     borderLeftWidth: 3,
     borderLeftColor: theme.colors.error,
  },
  errorBannerText: {
     color: theme.colors.description, // Less alarming text color
     fontSize: 14,
  },
});

export default EpisodeList;
