import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { Episode } from '../../types/episode';
import { formatTime } from '../../utils/audioUtils';
import { theme } from '../../styles/global';

interface EpisodeListItemProps {
  episode: Episode;
  isWatched: boolean;
  onPress: () => void;
}

const EpisodeListItem = React.memo(({ episode, isWatched, onPress }: EpisodeListItemProps) => {
  return (
    <TouchableOpacity style={styles.itemContainer} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.infoContainer}>
        <Text style={styles.title} numberOfLines={2}>{episode.title}</Text>
        <Text style={styles.description} numberOfLines={2}>{episode.description}</Text>
        <View style={styles.metaContainer}>
           <Text style={styles.date}>
            {new Date(episode.publicationDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
          </Text>
          {episode.duration && Number(episode.duration) > 0 && (
            <>
              <Text style={styles.separator}>•</Text>
              <Text style={styles.duration}>{formatTime(Number(episode.duration))}</Text>
            </>
          )}
        </View>
      </View>
      <View style={styles.iconContainer}>
        {isWatched ? (
          <MaterialIcons name="check-circle" size={26} color={theme.colors.primary} />
        ) : (
          <MaterialIcons name="play-circle-outline" size={28} color={theme.colors.text} />
        )}
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  itemContainer: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 15,
    backgroundColor: theme.colors.secondaryBackground,
    borderRadius: 10,
    marginBottom: 10,
    marginHorizontal: 15,
    alignItems: 'center',
  },
  infoContainer: {
    flex: 1,
    marginRight: 15,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 4,
  },
  description: {
    fontSize: 13,
    color: theme.colors.description,
    marginBottom: 6,
    lineHeight: 18,
  },
  metaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  date: {
    fontSize: 12,
    color: theme.colors.secondaryDescription,
  },
  separator: {
    fontSize: 12,
    color: theme.colors.secondaryDescription,
    marginHorizontal: 5,
  },
  duration: {
    fontSize: 12,
    color: theme.colors.secondaryDescription,
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default EpisodeListItem;
