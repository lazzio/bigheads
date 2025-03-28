import { FC, useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { supabase } from '../lib/supabase';
import * as Sentry from '@sentry/react-native';
import { initSentry } from '../lib/sentry/init';

// Initialiser Sentry de manière sûre (avec try-catch interne)
initSentry();

// Composant fallback en cas d'erreur
const ErrorFallback = () => (
  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#121212' }}>
    <Text style={{ color: '#fff', fontSize: 18, textAlign: 'center' }}>
      Une erreur est survenue. Veuillez redémarrer l'application.
    </Text>
  </View>
);

const RootLayout: FC = () => {
  useFrameworkReady();
  const segments = useSegments();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Ajouter un timeout pour éviter un blocage indéfini
    const timeoutId = setTimeout(() => {
      if (isLoading) {
        console.warn('Authentication timeout reached, redirecting to login');
        setIsLoading(false);
        router.replace('/auth/login');
      }
    }, 5000);

    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoading(false);
      // Only redirect if we're not already on the correct screen
      const inAuthGroup = segments[0] === 'auth';

      if (session && inAuthGroup) {
        router.replace('/(tabs)');
      } else if (!session && !inAuthGroup) {
        // Clear any existing session data to prevent token errors
        supabase.auth.signOut().then(() => {
          router.replace('/auth/login');
        });
      }
    }).catch((error) => {
      console.error('Auth session error:', error);
      setIsLoading(false);
      // If there's any error getting the session, sign out and redirect to login
      supabase.auth.signOut().then(() => {
        router.replace('/auth/login');
      });
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const inAuthGroup = segments[0] === 'auth';

      if (event === 'SIGNED_OUT') {
        router.replace('/auth/login');
      } else if (session && inAuthGroup) {
        router.replace('/(tabs)');
      } else if (!session && !inAuthGroup) {
        router.replace('/auth/login');
      }
    });

    return () => {
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [segments]);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="auth" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="+not-found" />
      </Stack>
      <StatusBar style="auto" />
    </>
  );
};

// Utiliser ErrorBoundary au lieu du wrapper simple pour plus de sécurité
export default Sentry.withErrorBoundary(RootLayout, {
  fallback: ErrorFallback,
});