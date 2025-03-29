import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, SafeAreaView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { LogOut, User } from 'lucide-react-native';
import { storage } from '../../lib/storage';

export default function ProfileScreen() {
  // État
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  
  // Hooks
  const router = useRouter();

  // Gérer la déconnexion avec mémoïsation pour éviter les recréations inutiles
  const handleLogout = useCallback(async () => {
    if (isLoggingOut) return; // Éviter les déconnexions multiples
    
    try {
      setIsLoggingOut(true);
      
      // Demander confirmation avant déconnexion
      Alert.alert(
        "Déconnexion",
        "Êtes-vous sûr de vouloir vous déconnecter ?",
        [
          { text: "Annuler", style: "cancel", onPress: () => setIsLoggingOut(false) },
          { 
            text: "Déconnexion", 
            style: "destructive", 
            onPress: async () => {
              try {
                // Déconnexion optimisée pour éviter les opérations inutiles
                const { data } = await supabase.auth.getSession();
                
                if (data.session) {
                  // Utiliser la méthode signOut qui gère déjà le nettoyage des tokens
                  await supabase.auth.signOut();
                  
                  // Nettoyage supplémentaire par sécurité (asynchrone mais pas besoin d'attendre)
                  storage.removeItem('supabase.auth.token').catch(() => {});
                  storage.removeItem('supabase.auth.refreshToken').catch(() => {});
                  storage.removeItem('supabase.auth.user').catch(() => {});
                }
                
                // Redirection
                router.replace('/auth/login');
              } catch (error) {
                console.error('Error during logout:', error);
                Alert.alert("Erreur", "Une erreur est survenue lors de la déconnexion");
                setIsLoggingOut(false);
              }
            }
          }
        ]
      );
    } catch (error) {
      // Gestion d'erreur améliorée
      console.error('Error initiating logout:', error);
      setIsLoggingOut(false);
      Alert.alert("Erreur", "Une erreur est survenue");
    }
  }, [isLoggingOut, router]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* En-tête */}
        <Text style={styles.title}>Profil</Text>
        
        {/* Contenu principal */}
        <View style={styles.content}>
          <View style={styles.profileCard}>
            <User size={32} color="#0ea5e9" />
            <Text style={styles.profileText}>
              Paramètres du compte
            </Text>
          </View>
          
          {/* Bouton de déconnexion */}
          <TouchableOpacity 
            style={styles.logoutButton} 
            onPress={handleLogout}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? (
              <ActivityIndicator size="small" color="#fff" style={styles.logoutIcon} />
            ) : (
              <LogOut size={24} color="#fff" style={styles.logoutIcon} />
            )}
            <Text style={styles.logoutText}>
              {isLoggingOut ? 'Déconnexion...' : 'Se déconnecter'}
            </Text>
          </TouchableOpacity>
        </View>
        
        {/* Bloc personnalisable en bas d'écran */}
        <View style={styles.stickyBottom}>
          {/* 
            Bloc personnalisable à compléter
            Exemples d'utilisation :
            - Bannière promotionnelle
            - Informations de version
            - Liens vers mentions légales
          */}
          <Text style={styles.stickyText}>Zone personnalisable</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#121212',
  },
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#121212',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
  },
  content: {
    flex: 1,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
    gap: 12,
  },
  profileText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ef4444',
    padding: 15,
    borderRadius: 8,
    gap: 8,
  },
  logoutIcon: {
    marginRight: 4,
  },
  logoutText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  stickyBottom: {
    padding: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    marginTop: 'auto',
    marginBottom: Platform.OS === 'ios' ? 0 : 16,
    // Ombre subtile
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  stickyText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
  },
});