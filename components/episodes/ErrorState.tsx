import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { theme } from '../../styles/global';

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

const ErrorState = ({ message, onRetry }: ErrorStateProps) => {
  return (
    <View style={styles.container}>
      <MaterialIcons name="error-outline" size={48} color={theme.colors.error} />
      <Text style={styles.errorText}>{message || 'Une erreur est survenue'}</Text>
      <TouchableOpacity onPress={onRetry} style={styles.retryButton}>
        <Text style={styles.retryButtonText}>Réessayer</Text>
      </TouchableOpacity>
    </View>
  );
};

// Using similar styles to EmptyState for consistency
const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 15,
    marginBottom: 20,
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

export default ErrorState;
