import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, SafeAreaView, Platform, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { storage } from '../../lib/storage';
import { theme } from '../../styles/global';
import { componentStyle } from '../../styles/componentStyle';
import { getGoogleUserInfo, GoogleUserInfo } from '../../lib/user';

export default function ProfileScreen() {
  // State
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [userInfo, setUserInfo] = useState<GoogleUserInfo | null>(null);
  
  // Hook for navigation
  const router = useRouter();

  // Manage logout with memoization to avoid unnecessary re-creations
  const handleLogout = useCallback(async () => {
    if (isLoggingOut) return; // Éviter les déconnexions multiples
    
    setShowLogoutModal(true);
  }, [isLoggingOut]);

  const confirmLogout = useCallback(async () => {
    try {
      setIsLoggingOut(true);
      setShowLogoutModal(false);
      
      // Unconnecting the user
      const { data } = await supabase.auth.getSession();
      
      if (data.session) {
        // Use signOut method which already handles token cleanup
        await supabase.auth.signOut();
        
        // Additional cleanup in case signOut doesn't clear local storage
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

  useEffect(() => {
    const fetchUser = async () => {
      const user = await getGoogleUserInfo();
      setUserInfo(user);
    };
    fetchUser();
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={componentStyle.container}>
        {/* En-tête */}
        <View style={componentStyle.header}>
          <MaterialIcons name="account-circle" size={32} color={theme.colors.primary} style={{marginRight: 8}} />
          <Text style={componentStyle.headerTitle}>
            Paramètres du compte
          </Text>
        </View>
        
        {/* Contenu principal */}
        <View style={styles.content}>
          {userInfo && userInfo.email && (
            <View style={styles.profileCard}>
              <MaterialIcons name="email" size={24} color={theme.colors.text} />
              <Text style={styles.profileText}>{userInfo.email}</Text>
            </View>
          )}
        </View>
        
        <View style={styles.stickyBottom}>
          {/* Bouton de déconnexion */}
          <TouchableOpacity 
            style={styles.logoutButton} 
            onPress={handleLogout}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? (
              <ActivityIndicator size="small" color={theme.colors.text} style={styles.logoutIcon} />
            ) : (
              <MaterialIcons name="logout" size={24} color={theme.colors.text} style={styles.logoutIcon} />
            )}
            <Text style={styles.logoutText}>
              {isLoggingOut ? 'Déconnexion...' : 'Se déconnecter'}
            </Text>
          </TouchableOpacity>
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
                  <MaterialIcons name="close" size={24} color={theme.colors.description} />
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
                  <MaterialIcons name="logout" size={16} color={theme.colors.text} style={{ marginRight: 6 }} />
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
    backgroundColor: theme.colors.primaryBackground,
  },
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: theme.colors.primaryBackground,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: 20,
  },
  content: {
    flex: 1,
    padding: 10,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.secondaryBackground,
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
    gap: 12,
  },
  profileText: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.error,
    padding: 15,
    borderRadius: 8,
    gap: 8,
  },
  logoutIcon: {
    marginRight: 4,
  },
  logoutText: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  stickyBottom: {
    paddingBottom: 10,
    backgroundColor: theme.colors.secondaryBackground,
    borderRadius: 8,
    marginTop: 'auto',
    marginBottom: Platform.OS === 'ios' ? 0 : 16,
    // Ombre subtile
    ...Platform.select({
      ios: {
        shadowColor: theme.colors.shadowColor,
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
    color: theme.colors.description,
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
    backgroundColor: theme.colors.modal,
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: theme.colors.shadowColor,
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
    borderBottomColor: theme.colors.borderColor,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.text,
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
    borderTopColor: theme.colors.borderColor,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelButton: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
    borderRightColor: theme.colors.borderColor,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  cancelButtonText: {
    color: theme.colors.linkColor,
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: theme.colors.error,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonText: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
});