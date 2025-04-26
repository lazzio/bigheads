import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { theme } from '../../styles/global';

interface EmptyStateProps {
  isOffline: boolean;
  onRetry: () => void;
}

const EmptyState = ({ isOffline, onRetry }: EmptyStateProps) => {
  return (
    <View style={styles.container}>
      <MaterialIcons name="hourglass-empty" size={48} color={theme.colors.description} />
      <Text style={styles.emptyText}>
        {isOffline ? "Aucun épisode disponible en mode hors-ligne" : "Aucun épisode trouvé"}
      </Text>
      {!isOffline && (
        <TouchableOpacity onPress={onRetry} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Actualiser</Text>
        </TouchableOpacity>
      )}
      {isOffline && (
         <Text style={styles.hintText}>Vérifiez vos téléchargements.</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    color: theme.colors.description,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 15,
    marginBottom: 20,
  },
   hintText: {
    color: theme.colors.secondaryDescription,
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: theme.colors.borderColor,
    paddingVertical: 10,
    paddingHorizontal: 25,
    borderRadius: 20,
  },
  retryButtonText: {
    color: theme.colors.text,
    fontSize: 16,
  },
});

export default EmptyState;
