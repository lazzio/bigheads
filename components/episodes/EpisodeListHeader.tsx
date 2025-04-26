import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../../styles/global';
import { componentStyle } from '../../styles/componentStyle';

const EpisodeListHeader = () => {
  return (
    <View style={componentStyle.header}>
      <Text style={componentStyle.headerTitle}>Épisodes</Text>
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
