import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ViewStyle } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { theme } from '../styles/global';

/**
 * ErrorBanner
 * Displays an error message in a styled banner with an optional dismiss button.
 * @param message The error message to display.
 * @param onDismiss Optional callback to dismiss the error.
 */
export const ErrorBanner = ({ message, onDismiss }: { message: string, onDismiss?: () => void }) => (
  <View style={styles.errorContainer}>
    <MaterialIcons name="error-outline" size={20} color={theme.colors.error} style={{ marginRight: 8 }} />
    <Text style={styles.errorText}>{message}</Text>
    {onDismiss && (
      <TouchableOpacity onPress={onDismiss} style={styles.dismissButton}>
        <Text style={styles.dismissButtonText}>×</Text>
      </TouchableOpacity>
    )}
  </View>
);

/**
 * LoadingIndicator
 * Shows a centered loading spinner with an optional message.
 * @param message Optional loading message.
 * @param style Optional style override.
 */
export const LoadingIndicator = ({ message, style }: { message?: string, style?: ViewStyle }) => (
  <View style={[styles.loadingContainer, style]}>
    <ActivityIndicator size="small" color={theme.colors.loadingSpinner} />
    {message && <Text style={styles.loadingText}>{message}</Text>}
  </View>
);

/**
 * EmptyState
 * Shows a message for empty data states, with optional children (e.g., retry button).
 * @param message The main message to display.
 * @param children Optional React children (e.g., retry button).
 */
export const EmptyState = ({ message, children }: { message: string, children?: React.ReactNode }) => (
  <View style={styles.emptyContainer}>
    <MaterialIcons name="hourglass-empty" size={48} color={theme.colors.description} />
    <Text style={styles.emptyText}>{message}</Text>
    {children}
  </View>
);

/**
 * OfflineIndicator
 * Shows a small banner indicating offline mode.
 * @param text Optional text to display (default: 'Mode hors-ligne').
 * @param style Optional style override.
 */
export const OfflineIndicator = ({ text = 'Mode hors-ligne', style }: { text?: string, style?: ViewStyle }) => (
  <View style={[styles.offlineIndicator, style]}>
    <MaterialIcons name="wifi-off" size={16} color={theme.colors.text} />
    <Text style={styles.offlineIndicatorText}>{text}</Text>
  </View>
);

/**
 * RetryButton
 * A button to retry a failed action.
 * @param onPress Callback for retry action.
 * @param text Button text (default: 'Retry').
 * @param style Optional style override.
 */
export const RetryButton = ({ onPress, text = 'Retry', style }: { onPress: () => void, text?: string, style?: ViewStyle }) => (
  <TouchableOpacity onPress={onPress} style={[styles.retryButton, style]}>
    <Text style={styles.retryButtonText}>{text}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.error,
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorText: {
    fontFamily: 'Inter_400Regular',
    color: theme.colors.error,
    fontSize: 14,
    flex: 1,
  },
  dismissButton: {
    padding: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.5)',
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dismissButtonText: {
    color: theme.colors.text,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  loadingText: {
    fontFamily: 'Inter_400Regular',
    color: theme.colors.text,
    marginTop: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    color: theme.colors.description,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  offlineIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.borderColor,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 16,
  },
  offlineIndicatorText: {
    fontFamily: 'Inter_400Regular',
    color: theme.colors.text,
    fontSize: 12,
    marginLeft: 4,
  },
  retryButton: {
    marginTop: 25,
    backgroundColor: theme.colors.borderColor,
    paddingVertical: 10,
    paddingHorizontal: 25,
    borderRadius: 20,
  },
  retryButtonText: {
    fontFamily: 'Inter_500Medium',
    color: theme.colors.text,
    fontSize: 16,
  },
});