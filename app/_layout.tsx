import { FC, useEffect, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
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

// Découpler la gestion de session de la navigation
function AuthenticationProvider({ children }: { children: React.ReactNode }) {
  const segments = useSegments();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [authInitialized, setAuthInitialized] = useState(false);

  useEffect(() => {
    // Ne pas naviguer tant que l'authentification n'est pas initialisée
    if (!authInitialized) return;

    const inAuthGroup = segments[0] === 'auth';
    
    // Vérifier la session de l'utilisateur
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session && inAuthGroup) {
          // Attendre un peu pour s'assurer que le layout est monté
          setTimeout(() => router.replace('/(tabs)'), 0);
        } else if (!session && !inAuthGroup) {
          // Attendre un peu pour s'assurer que le layout est monté
          setTimeout(() => router.replace('/auth/login'), 0);
        }
        
        setIsLoading(false);
      } catch (error) {
        console.error('Auth session error:', error);
        setIsLoading(false);
        // En cas d'erreur, rediriger vers login
        setTimeout(() => router.replace('/auth/login'), 0);
      }
    };

    checkSession();
  }, [segments, authInitialized]);

  // Initialiser l'authentification une seule fois au montage
  useEffect(() => {
    // Ajouter un timeout pour éviter un blocage indéfini
    const timeoutId = setTimeout(() => {
      if (isLoading) {
        console.warn('Authentication timeout reached');
        setIsLoading(false);
        setAuthInitialized(true);
      }
    }, 5000);

    // Configurer l'écouteur d'état d'authentification
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const inAuthGroup = segments[0] === 'auth';

      if (event === 'SIGNED_OUT' && !inAuthGroup) {
        // Utiliser setTimeout pour éviter la navigation avant le montage
        setTimeout(() => router.replace('/auth/login'), 0);
      } else if (event === 'SIGNED_IN' && inAuthGroup) {
        // Utiliser setTimeout pour éviter la navigation avant le montage
        setTimeout(() => router.replace('/(tabs)'), 0);
      }
    });

    // Marquer l'initialisation comme terminée
    setAuthInitialized(true);

    return () => {
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  return <>{children}</>;
}

// Layout principal qui définit la structure de base de l'application
const RootLayout: FC = () => {
  useFrameworkReady();
  
  return (
    <AuthenticationProvider>
      {/* Utiliser Slot au lieu de Stack pour la première navigation */}
      <Slot />
      <StatusBar style="auto" />
    </AuthenticationProvider>
  );
};

// Utiliser ErrorBoundary au lieu du wrapper simple pour plus de sécurité
export default Sentry.withErrorBoundary(RootLayout, {
  fallback: ErrorFallback,
});