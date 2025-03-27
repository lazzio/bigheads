import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image, Platform } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { storage } from '../../lib/storage';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const redirectUrl = Linking.createURL('/(tabs)');

  async function handleLogin() {
    try {
      setLoading(true);
      setError(null);

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      router.replace('/(tabs)');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    try {
      setLoading(true);
      setError(null);
  
      // Clear any existing auth data
      await storage.removeItem('supabase.auth.token');
      await storage.removeItem('supabase.auth.refreshToken');
      await storage.removeItem('supabase.auth.user');
  
      if (Platform.OS === 'web') {
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
        // Pour mobile
        const redirectUrl = Linking.createURL('/(tabs)');
        
        // Log pour déboguer - utile pour configurer votre client OAuth2
        console.log("Redirect URL:", redirectUrl);
        
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
          // Ouvrir le navigateur pour l'authentification
          const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
  
          if (result.type === 'success') {
            // Extraire les paramètres de l'URL
            const { url } = result;
            
            // Gérer correctement l'URL de redirection
            // L'URL peut contenir soit un fragment (#) soit des paramètres de requête (?)
            let params;
            if (url.includes('#')) {
              params = new URLSearchParams(url.split('#')[1]);
            } else if (url.includes('?')) {
              params = new URLSearchParams(url.split('?')[1]);
            }
            
            // Vérifier si nous avons un code d'autorisation (pour flow PKCE)
            const code = params?.get('code');
            
            if (code) {
              // Pour le flux PKCE, on utilise exchangeCodeForSession
              const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);
              
              if (sessionError) throw sessionError;
              
              if (sessionData?.session) {
                router.replace('/(tabs)');
              }
            } else {
              // Fallback à l'ancienne méthode (implicite) avec access_token et refresh_token
              const access_token = params?.get('access_token');
              const refresh_token = params?.get('refresh_token');
              
              if (access_token && refresh_token) {
                const { error: sessionError } = await supabase.auth.setSession({
                  access_token,
                  refresh_token,
                });
                
                if (sessionError) throw sessionError;
                router.replace('/(tabs)');
              } else {
                throw new Error("Tokens non trouvés dans l'URL de redirection");
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("Erreur d'authentification:", err);
      setError(err instanceof Error ? err.message : 'Une erreur est survenue lors de la connexion');
      // Nettoyer les données d'authentification partielles
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
        <Image
          source={{ uri: '../assets/images/google.svg' }}
          style={styles.googleIcon}
          resizeMode="contain"
        />
        <Text style={styles.googleButtonText}>Continuer avec Google</Text>
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
    padding: 12,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
  },
  googleIcon: {
    width: 18,
    height: 18,
    marginRight: 24,
  },
  googleButtonText: {
    color: '#757575',
    fontSize: 15,
    fontWeight: '500',
  },
});