import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { supabase } from '../lib/supabase';
import * as SplashScreen from 'expo-splash-screen';
// Updated import for Sentry
import * as Sentry from '@sentry/react-native';
import { isRunningInExpoGo } from 'expo';

// Add this type declaration at the top of the file, before the component
declare global {
  interface ErrorUtils {
    setGlobalHandler: (callback: (error: any, isFatal?: boolean) => void) => void;
    getGlobalHandler: () => (error: any, isFatal?: boolean) => void;
  }
}

// Construct a new integration instance. This is needed to communicate between the integration and React
const navigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: !isRunningInExpoGo(),
});

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

// Initialize Sentry with new API
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enableAutoSessionTracking: true,
  sessionTrackingIntervalMillis: 10000,
  tracesSampleRate: 1.0,
  enableNativeCrashHandling: true,
  integrations: [
    navigationIntegration,
  ],
  enableNativeNagger: true,
  attachStacktrace: true,
  enableNativeFramesTracking: !isRunningInExpoGo(),
  debug: false
});

function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const errorHandler = (error: Error) => {
      console.log('Global error caught:', error);
      setError(error);
      Sentry.captureException(error);
    };

    // Add breadcrumb for app startup
    Sentry.addBreadcrumb({
      category: 'app lifecycle',
      message: 'App started',
      level: 'info',
    });

    // Access ErrorUtils with proper type safety
    try {
      // Use type assertion to help TypeScript understand this API exists
      const ErrorUtils = (global as any).ErrorUtils as ErrorUtils;
      
      if (ErrorUtils) {
        const originalHandler = ErrorUtils.getGlobalHandler();
        
        ErrorUtils.setGlobalHandler((error: any) => {
          errorHandler(error);
          if (originalHandler) {
            originalHandler(error);
          }
        });
        
        return () => {
          ErrorUtils.setGlobalHandler(originalHandler);
        };
      }
    } catch (e) {
      // If ErrorUtils is not available, fall back gracefully
      console.warn('ErrorUtils not available for global error handling');
    }
    
    return undefined;
  }, []);

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorMessage}>{error.message}</Text>
        <Text style={styles.errorHint}>Please restart the app</Text>
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  useFrameworkReady();
  const segments = useSegments();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [authInitialized, setAuthInitialized] = useState(false);

  useEffect(() => {
    if (!authInitialized) return;

    const inAuthGroup = segments[0] === 'auth';
    console.log('Current route segment:', segments[0], 'inAuthGroup:', inAuthGroup);

    // Get current auth state without triggering any redirects
    const checkAuthState = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        console.log('Auth session check:', session ? 'Has session' : 'No session');

        if (session && inAuthGroup) {
          console.log('Redirecting to tabs (has session, in auth group)');
          router.replace('/(tabs)');
        } else if (!session && !inAuthGroup) {
          console.log('Redirecting to login (no session, not in auth group)');
          // Don't sign out again to avoid potential loops, just redirect
          router.replace('/auth/login');
        }

        // Hide splash screen once auth is checked
        setTimeout(() => {
          SplashScreen.hideAsync();
          setIsLoading(false);
        }, 500);
      } catch (error) {
        console.error('Error checking auth state:', error);
        Sentry.captureException(error);
        router.replace('/auth/login');
        setTimeout(() => {
          SplashScreen.hideAsync();
          setIsLoading(false);
        }, 500);
      }
    };

    checkAuthState();
  }, [segments, authInitialized]);

  // Setup auth state listener
  useEffect(() => {
    console.log('Setting up auth listener');
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event);
      const inAuthGroup = segments[0] === 'auth';

      if (event === 'SIGNED_OUT') {
        console.log('User signed out, redirecting to login');
        router.replace('/auth/login');
      } else if (event === 'SIGNED_IN' && inAuthGroup) {
        console.log('User signed in, redirecting to tabs');
        router.replace('/(tabs)');
      }

      // Mark auth as initialized after first event
      if (!authInitialized) {
        setAuthInitialized(true);
      }
    });

    // If no auth event after a timeout, mark as initialized anyway
    const timer = setTimeout(() => {
      if (!authInitialized) {
        console.log('Auth listener timeout - forcing initialization');
        setAuthInitialized(true);
      }
    }, 2000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    // Add user context if authenticated
    async function setUserContext() {
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        Sentry.setUser({
          id: data.user.id,
          email: data.user.email,
        });
      }
    }

    setUserContext();
  }, []);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0ea5e9" />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="auth" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="+not-found" />
      </Stack>
      <StatusBar style="light" />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#121212',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#121212',
    padding: 20,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ef4444',
    marginBottom: 12,
  },
  errorMessage: {
    fontSize: 16,
    color: '#fff',
    marginBottom: 20,
    textAlign: 'center',
  },
  errorHint: {
    fontSize: 14,
    color: '#aaa',
  },
});