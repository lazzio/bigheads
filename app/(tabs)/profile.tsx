import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, SafeAreaView, Platform, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { LogOut, User, X } from 'lucide-react-native';
import { storage } from '../../lib/storage';

export default function ProfileScreen() {
  // État
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  
  // Hooks
  const router = useRouter();

  // Gérer la déconnexion avec mémoïsation pour éviter les recréations inutiles
  const handleLogout = useCallback(async () => {
    if (isLoggingOut) return; // Éviter les déconnexions multiples
    
    setShowLogoutModal(true);
  }, [isLoggingOut]);

  const confirmLogout = useCallback(async () => {
    try {
      setIsLoggingOut(true);
      setShowLogoutModal(false);
      
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
      setIsLoggingOut(false);
      setShowLogoutModal(false);
    }
  }, [router]);

  const cancelLogout = useCallback(() => {
    setShowLogoutModal(false);
    setIsLoggingOut(false);
  }, []);

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

      {/* Modal de confirmation de déconnexion */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={showLogoutModal}
        onRequestClose={cancelLogout}
      >
        <Pressable style={styles.modalOverlay} onPress={cancelLogout}>
          <View style={styles.modalContainer}>
            <Pressable style={styles.modalContent} onPress={e => e.stopPropagation()}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Déconnexion</Text>
                <TouchableOpacity onPress={cancelLogout} style={styles.closeButton}>
                  <X size={24} color="#888" />
                </TouchableOpacity>
              </View>
              
              <Text style={styles.modalText}>
                Êtes-vous sûr de vouloir vous déconnecter ?
              </Text>
              
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={styles.cancelButton} 
                  onPress={cancelLogout}
                >
                  <Text style={styles.cancelButtonText}>Annuler</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={styles.confirmButton} 
                  onPress={confirmLogout}
                >
                  <LogOut size={16} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.confirmButtonText}>Déconnexion</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
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
  // Styles pour le modal de confirmation
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '85%',
    maxWidth: 400,
  },
  modalContent: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomColor: '#333',
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  closeButton: {
    padding: 4,
  },
  modalText: {
    color: '#bbb',
    fontSize: 16,
    padding: 20,
    textAlign: 'center',
    lineHeight: 22,
  },
  modalButtons: {
    flexDirection: 'row',
    borderTopColor: '#333',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelButton: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
    borderRightColor: '#333',
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  cancelButtonText: {
    color: '#0ea5e9',
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#ef4444',
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});