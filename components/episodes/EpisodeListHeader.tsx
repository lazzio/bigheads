import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../../styles/global'; // Assuming global styles

const EpisodeListHeader = () => {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Épisodes</Text>
      {/* Placeholder for potential future actions like search/filter */}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 15,
    paddingTop: 15, // Adjust as needed for status bar height
    paddingBottom: 10,
    // backgroundColor: theme.colors.primaryBackground, // Match screen background
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderColor,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
});

export default EpisodeListHeader;
