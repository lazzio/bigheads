import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { syncPushTokenAfterLogin } from '../../utils/notifications/EpisodeNotificationService'; // <<< Importer la nouvelle fonction

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleRegister() {
    try {
      setLoading(true);
      setError(null);

      const { error: signUpError, data } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) throw signUpError;

      // Vérifier si l'inscription nécessite une confirmation par email
      if (data.user && data.user.identities && data.user.identities.length === 0) {
         Alert.alert("Vérification requise", "Veuillez vérifier votre email pour activer votre compte.");
         // Ne pas rediriger immédiatement, l'utilisateur doit vérifier son email
         // Optionnel: rediriger vers une page d'attente ou laisser sur l'écran d'inscription
      } else if (data.session) {
         // Connexion réussie (ou pas de vérification nécessaire)
         console.log('Registration successful, attempting to sync push token...');
         await syncPushTokenAfterLogin(); // <<< Appeler la synchro ici
         router.replace('/(tabs)'); // Rediriger vers l'application principale
      } else {
         // Cas inattendu
         throw new Error("Inscription terminée mais aucune session reçue.");
      }

    } catch (err) {
      console.error("Registration error:", err);
      setError(err instanceof Error ? err.message : 'Une erreur est survenue lors de l\'inscription');
    } finally {
      setLoading(false);
    }
  }

  // ... handleGoogleSignIn (ajouter syncPushTokenAfterLogin ici aussi si la redirection est immédiate) ...
  async function handleGoogleSignIn() {
    try {
      setLoading(true);
      setError(null);

      // Note: signInWithOAuth peut ne pas retourner de session immédiatement,
      // l'état d'authentification est souvent géré par un listener global.
      // Il est préférable d'appeler syncPushTokenAfterLogin depuis ce listener global.
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
          skipBrowserRedirect: Platform.OS !== 'web',
        },
      });

      if (oauthError) throw oauthError;

      // NE PAS appeler syncPushTokenAfterLogin ici si la session n'est pas garantie.
      // Laissez le listener d'état d'authentification (dans _layout.tsx ?) le gérer.

    } catch (err) {
      console.error("Google Sign-In error:", err);
      setError(err instanceof Error ? err.message : 'Une erreur est survenue lors de la connexion Google');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Créer un compte</Text>

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
        onPress={handleRegister}
        disabled={loading}>
        <Text style={styles.buttonText}>
          {loading ? 'Création...' : 'Créer un compte'}
        </Text>
      </TouchableOpacity>

      <Link href="/auth/login" style={styles.link}>
        <Text style={styles.linkText}>Déjà un compte ? Se connecter</Text>
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
  }
});