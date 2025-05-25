import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import { syncPushTokenAfterLogin } from '../../utils/notifications/EpisodeNotificationService';
import { Link, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { storage } from '../../lib/storage';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

// Import SVG components
import Svg, { Path } from 'react-native-svg';

// Fixed GoogleIcon implementation using react-native-svg
function GoogleIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18" style={{ marginRight: 24 }}>
      <Path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <Path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
      />
      <Path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <Path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </Svg>
  );
}

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  
  // Création de l'URL de redirection correcte avec le schéma de l'app
  // Utiliser une URL complète avec le schéma de l'application
  const appScheme = typeof Constants.expoConfig?.scheme === 'string' 
  ? Constants.expoConfig.scheme 
  : 'xyz.myops.bigheads';
  const redirectUrl = Linking.createURL('/(tabs)', {
    // S'assurer que c'est un schéma deeplink et non une URL web
    scheme: appScheme
  });

  // Nettoyage du cache des sessions OAuth précédentes
  useEffect(() => {
    if (Platform.OS !== 'web') {
      WebBrowser.maybeCompleteAuthSession();
    }
    
    // Vérifions s'il y a déjà une session active au chargement
    const checkExistingSession = async () => {
      const { data } = await supabase.auth.getSession();
      console.log('Checking existing session on load:', data.session ? 'Session exists' : 'No session');
      
      if (data.session) {
        // Si une session existe déjà, rediriger vers l'app
        router.replace('/(tabs)');
      }
    };
    
    checkExistingSession();
  }, [router]);

  // Journal pour le débogage
  console.log('Login screen rendered, redirectUrl:', redirectUrl);

  async function handleLogin() {
    try {
      setLoading(true);
      setError(null);
      console.log('Attempting login with email/password');

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      console.log('Login successful, checking session');
      await syncPushTokenAfterLogin();
      console.log('Login successful, redirecting');
      router.replace('/(tabs)');
    } catch (err) {
      console.error('Login error:', err);
      // Capture d'exception pour Sentry
      Sentry.captureException(err);
      setError(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    try {
      // Ajout d'un breadcrumb pour Sentry
      Sentry.addBreadcrumb({
        category: 'auth',
        message: 'Starting Google OAuth flow',
        level: 'info',
        data: {
          platform: Platform.OS,
          redirectUrl: redirectUrl
        }
      });

      setLoading(true);
      setError(null);
      console.log('Starting Google OAuth flow');

      // Nettoyage des anciens tokens avant de commencer
      await storage.removeItem('supabase.auth.token');
      await storage.removeItem('supabase.auth.refreshToken');
      await storage.removeItem('supabase.auth.user');

      if (Platform.OS === 'web') {
        console.log('Web platform OAuth flow');
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin,
            queryParams: {
              access_type: 'offline',
              prompt: 'consent',
            },
          },
        });
        if (error) throw error;
      } else {
        console.log('Native platform OAuth flow');
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: redirectUrl,
            queryParams: {
              access_type: 'offline',
              prompt: 'consent',
            },
            skipBrowserRedirect: true,
          },
        });

        if (error) throw error;

        if (data?.url) {
          console.log('Opening auth URL in browser:', data.url);
          
          // Utiliser openAuthSessionAsync avec les bons paramètres
          const result = await WebBrowser.openAuthSessionAsync(
            data.url, 
            redirectUrl,
            { 
              showInRecents: true,
              preferEphemeralSession: false
            }
          );

          console.log('Auth browser result type:', result.type);
          
          if (result.type === 'success') {
            const { url } = result;
            console.log('OAuth redirect success, processing URL:', url);
            
            try {
              // Essayer de traiter l'URL de redirection et d'extraire les tokens
              if (url.includes('access_token') || url.includes('code=')) {
                console.log('URL contains auth params, extracting...');
                
                // Essayer d'extraire les paramètres de l'URL
                let params: URLSearchParams;
                if (url.includes('#')) {
                  // Format fragment
                  params = new URLSearchParams(url.split('#')[1]);
                } else {
                  // Format query
                  params = new URLSearchParams(url.split('?')[1]);
                }
                
                const access_token = params.get('access_token');
                const refresh_token = params.get('refresh_token');
                const code = params.get('code');
                
                console.log('Parsed tokens:', {
                  access_token: access_token ? 'present' : 'missing',
                  refresh_token: refresh_token ? 'present' : 'missing',
                  code: code ? 'present' : 'missing'
                });

                if (access_token && refresh_token) {
                  console.log('Tokens extracted, setting session');
                  const { error: sessionError } = await supabase.auth.setSession({
                    access_token,
                    refresh_token,
                  });

                  if (sessionError) throw sessionError;
                  await syncPushTokenAfterLogin();
                  router.replace('/(tabs)');
                } else if (code) {
                  console.log('Auth code found, exchanging for session');
                  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
                  
                  if (exchangeError) throw exchangeError;
                  await syncPushTokenAfterLogin();
                  router.replace('/(tabs)');
                } else {
                  console.log('No tokens in URL, checking session');
                  const { data: { session } } = await supabase.auth.getSession();
                  if (session) {
                    console.log('Session exists after OAuth, redirecting');
                    router.replace('/(tabs)');
                  } else {
                    throw new Error('Aucune donnée d\'authentification trouvée dans la redirection');
                  }
                }
              } else {
                console.log('No auth params in URL, checking session directly');
                // Vérifier directement si une session existe
                const { data: { session } } = await supabase.auth.getSession();
                if (session) {
                  await syncPushTokenAfterLogin();
                  console.log('Session exists, redirecting');
                  router.replace('/(tabs)');
                } else {
                  throw new Error('Aucune session trouvée après l\'authentification');
                }
              }
            } catch (parseError) {
              console.error('Error parsing OAuth redirect:', parseError);
              // Essayer une approche différente - obtenir la session actuelle
              const { data: { session } } = await supabase.auth.getSession();
              if (session) {
                await syncPushTokenAfterLogin();
                console.log('Session exists despite parse error, redirecting');
                router.replace('/(tabs)');
              } else {
                throw parseError;
              }
            }
          } else if (result.type === 'cancel') {
            console.log('User canceled OAuth flow');
            // L'utilisateur a annulé, afficher un message
            Alert.alert('Connexion annulée', 'Vous avez annulé la connexion Google.');
          }
        }
      }
    } catch (err) {
      console.error('Google sign-in error:', err);
      // Capture d'exception pour Sentry
      Sentry.captureException(err);
      setError(err instanceof Error ? err.message : 'Une erreur est survenue lors de la connexion Google');
      
      // Effacer les données d'auth partielles en cas d'erreur
      await storage.removeItem('supabase.auth.token');
      await storage.removeItem('supabase.auth.refreshToken');
      await storage.removeItem('supabase.auth.user');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connexion</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#666"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <TextInput
        style={styles.input}
        placeholder="Mot de passe"
        placeholderTextColor="#666"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleLogin}
        disabled={loading}>
        <Text style={styles.buttonText}>
          {loading ? 'Connexion...' : 'Se connecter'}
        </Text>
      </TouchableOpacity>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>ou</Text>
        <View style={styles.dividerLine} />
      </View>

      <TouchableOpacity
        style={styles.googleButton}
        onPress={handleGoogleSignIn}
        disabled={loading}>
        <GoogleIcon />
        <Text style={styles.googleButtonText}>Se connecter avec Google</Text>
      </TouchableOpacity>

      <Link href="/auth/register" style={styles.link}>
        <Text style={styles.linkText}>Pas encore de compte ? S'inscrire</Text>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    backgroundColor: '#121212',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
    color: '#fff',
  },
  button: {
    backgroundColor: '#0ea5e9',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  link: {
    marginTop: 20,
    alignSelf: 'center',
  },
  linkText: {
    color: '#0ea5e9',
    fontSize: 16,
  },
  error: {
    color: '#ef4444',
    marginBottom: 10,
    textAlign: 'center',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#333',
  },
  dividerText: {
    color: '#666',
    paddingHorizontal: 10,
  },
  googleButton: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
  },
  googleButtonText: {
    color: '#757575',
    fontSize: 15,
    fontWeight: '500',
  },
});