import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { theme } from '../../styles/global';

interface OfflineBannerProps {
  showCacheMessage: boolean;
}

const OfflineBanner = ({ showCacheMessage }: OfflineBannerProps) => {
  return (
    <View style={styles.offlineContainer}>
      <MaterialIcons name="wifi-off" size={20} color={theme.colors.description} />
      <Text style={styles.offlineText}>
        Mode hors-ligne
        {showCacheMessage && " - Affichage des épisodes en cache"}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  offlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.borderColor, // Slightly different background
    paddingVertical: 8,
    paddingHorizontal: 15,
    marginHorizontal: 15,
    marginTop: 10,
    marginBottom: 5,
    borderRadius: 8,
  },
  offlineText: {
    color: theme.colors.description,
    fontSize: 14,
    marginLeft: 10,
    flex: 1, // Allow text to wrap
  },
});

export default OfflineBanner;
