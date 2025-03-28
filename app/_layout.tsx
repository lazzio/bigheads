import { useEffect, useState, useRef, useCallback } from 'react';
import { Slot, useRouter, useSegments, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import * as SplashScreen from 'expo-splash-screen';
import * as Sentry from '@sentry/react-native';
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import { makeRedirectUri } from 'expo-auth-session';

// Définition des routes typées pour la navigation
type AppRoute = '/(tabs)' | '/auth/login';

// Keep splash screen visible until explicitly hidden
SplashScreen.preventAutoHideAsync().catch(() => {
  /* silent error - splash screen is optional */
});

// Type definition for ErrorUtils
declare global {
  interface ErrorUtils {
    setGlobalHandler: (callback: (error: any, isFatal?: boolean) => void) => void;
    getGlobalHandler: () => (error: any, isFatal?: boolean) => void;
  }
}

// Initialize Sentry early in a clean way
function initializeSentry() {
  try {
    const navigationIntegration = Sentry.reactNavigationIntegration({
      enableTimeToInitialDisplay: !isRunningInExpoGo(),
    });

    Sentry.init({
      dsn: Constants.expoConfig?.extra?.sentryDsn || process.env.EXPO_PUBLIC_SENTRY_DSN,
      enableAutoSessionTracking: true,
      sessionTrackingIntervalMillis: 10000,
      tracesSampleRate: 1.0,
      enableNativeCrashHandling: true,
      integrations: [navigationIntegration],
      enableNativeNagger: true,
      attachStacktrace: true,
      enableNativeFramesTracking: !isRunningInExpoGo(),
      debug: false,
    });

    Sentry.addBreadcrumb({
      category: 'app.lifecycle',
      message: 'App initialized',
      level: 'info',
    });

    return true;
  } catch (error) {
    console.error('Sentry initialization failed:', error);
    return false;
  }
}

// Initialize Sentry immediately
const isSentryInitialized = initializeSentry();

// Error display component
function ErrorDisplay({ error }: { error: Error }) {
  return (
    <View style={styles.errorContainer}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.errorMessage}>{error.message}</Text>
      <Text style={styles.errorHint}>Please restart the app</Text>
    </View>
  );
}

// Clean error boundary component
function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<Error | null>(null);
  
  useEffect(() => {
    if (!isSentryInitialized) return;

    const setupErrorHandler = () => {
      if (typeof (global as any).ErrorUtils !== 'undefined') {
        const ErrorUtils = (global as any).ErrorUtils;
        const originalHandler = ErrorUtils.getGlobalHandler();
        
        ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
          console.log('Global error caught:', error);
          
          // Capture with Sentry
          Sentry.captureException(error);
          
          // Only set state for fatal errors to avoid UI disruption for minor issues
          if (isFatal) {
            setError(error);
          }
          
          // Call original handler
          if (originalHandler) {
            originalHandler(error, isFatal);
          }
        });
        
        return () => {
          if (ErrorUtils && originalHandler) {
            ErrorUtils.setGlobalHandler(originalHandler);
          }
        };
      }
    };
    
    return setupErrorHandler();
  }, []);

  if (error) {
    return <ErrorDisplay error={error} />;
  }

  return <>{children}</>;
}

// Custom hook for auth state
function useAuthState() {
  const [session, setSession] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    
    // Get initial session
    const getInitialSession = async () => {
      try {
        setIsLoading(true);
        const { data } = await supabase.auth.getSession();
        setSession(data.session);
      } catch (error) {
        Sentry.captureException(error);
        console.error('Error getting session:', error);
      } finally {
        setIsLoading(false);
      }
    };

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, currentSession) => {
        setSession(currentSession);
      }
    );

    getInitialSession();

    // Cleanup
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return { session, isLoading };
}

// Safe navigation hook
function useSafeNavigation() {
  const router = useRouter();
  const navigationReady = useRef(false);
  const pendingNavigation = useRef<{ route: AppRoute; replace: boolean } | null>(null);
  
  // Mark navigation as ready after 500ms
  useEffect(() => {
    const timer = setTimeout(() => {
      navigationReady.current = true;
      
      // Process any pending navigation
      if (pendingNavigation.current) {
        const { route, replace } = pendingNavigation.current;
        if (replace) {
          router.replace(route);
        } else {
          router.push(route as any);
        }
        pendingNavigation.current = null;
      }
    }, 500);
    
    return () => clearTimeout(timer);
  }, [router]);
  
  const navigate = useCallback((route: AppRoute, options?: { replace?: boolean }) => {
    // Record navigation attempt for analytics
    Sentry.addBreadcrumb({
      category: 'navigation',
      message: `Attempting to navigate to ${route}`,
      level: 'info',
    });
    
    if (navigationReady.current) {
      if (options?.replace) {
        router.replace(route);
      } else {
        router.push(route as any);
      }
    } else {
      // Store navigation request for later
      pendingNavigation.current = { 
        route, 
        replace: options?.replace || false 
      };
      console.log(`Navigation queued: ${route}`);
    }
  }, [router]);
  
  return navigate;
}

// Main authenticated routes handler
function AuthRouter() {
  const segments = useSegments();
  const { session, isLoading } = useAuthState();
  const navigate = useSafeNavigation();

  // Determine if the user is on an auth screen
  const isOnAuthScreen = segments[0] === 'auth';
  
  // Handle authentication routing
  useEffect(() => {
    if (isLoading) return;
    
    const handleAuthRouting = async () => {
      // Add intent to Sentry
      Sentry.addBreadcrumb({
        category: 'auth',
        message: `Auth routing: ${session ? 'authenticated' : 'unauthenticated'}, on auth screen: ${isOnAuthScreen}`,
        level: 'info',
      });
      
      try {
        if (!session && !isOnAuthScreen) {
          // User is not authenticated and not on auth screen - redirect to login
          navigate('/auth/login', { replace: true });
        } else if (session && isOnAuthScreen) {
          // User is authenticated but on auth screen - redirect to main app
          navigate('/(tabs)', { replace: true });
        }
      } catch (error) {
        console.error('Auth routing error:', error);
        Sentry.captureException(error);
      }
    };

    // Small delay to ensure proper initialization
    const timer = setTimeout(handleAuthRouting, 50);
    
    return () => clearTimeout(timer);
  }, [session, isLoading, isOnAuthScreen, navigate]);

  // Return null to allow Slot to handle rendering
  return null;
}

// Loading screen component
function LoadingScreen() {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#0ea5e9" />
    </View>
  );
}

// Main layout component
export default function RootLayout() {
  // Important state flags
  const [isAppReady, setIsAppReady] = useState(false);
  const appMounted = useRef(false);
  
  // Initialize the app
  useEffect(() => {
    if (appMounted.current) return;
    appMounted.current = true;
    
    // Log app start with Sentry
    Sentry.addBreadcrumb({
      category: 'lifecycle',
      message: 'Root layout mounting',
      level: 'info',
    });
    
    console.log('Root layout mounting');
    
    // Simulate minimal initialization time to ensure component is ready
    const initializeApp = async () => {
      try {
        // Wait a bit to avoid race conditions
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Hide splash screen if it was shown
        try {
          await SplashScreen.hideAsync();
        } catch (error) {
          // Ignore errors from splash screen - it might not be available
          console.log('SplashScreen hide failed (might be normal):', error);
        }
        
        // Mark app as ready
        setIsAppReady(true);
      } catch (error) {
        console.error('Initialization error:', error);
        Sentry.captureException(error);
      }
    };
    
    initializeApp();
    
    return () => {
      appMounted.current = false;
    };
  }, []);
  
  // Important: always render Slot first, before any conditional logic
  return (
    <ErrorBoundary>
      {/* Order matters here - always render Slot first! */}
      <Slot />
      
      {/* Only handle auth routing after app is ready */}
      {isAppReady ? <AuthRouter /> : <LoadingScreen />}
      
      {/* Status bar configuration */}
      <StatusBar style="light" />
    </ErrorBoundary>
  );
}

// Clean styles
const styles = StyleSheet.create({
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
  }
});

// Helper for OAuth redirects
export const getRedirectUrl = () => {
  // Utiliser une chaîne de caractères simple pour le schéma
  const appScheme = typeof Constants.expoConfig?.scheme === 'string' 
    ? Constants.expoConfig.scheme 
    : 'myappscheme'; // Remplacez par votre schéma réel
  
  return makeRedirectUri({
    scheme: appScheme,
    path: '/(tabs)',
  });
};