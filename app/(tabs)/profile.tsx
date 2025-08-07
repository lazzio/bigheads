import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, SafeAreaView, Platform, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../lib/supabase';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { storage } from '../../lib/storage';
import NetInfo from '@react-native-community/netinfo';
import { theme } from '../../styles/global';
import { componentStyle } from '../../styles/componentStyle';
import { getGoogleUserInfo, GoogleUserInfo } from '../../lib/user';
import { OfflineIndicator } from '../../components/SharedUI';
import { clearLocalAuthSession } from '../../utils/commons/authUtils';

export default function ProfileScreen() {
  // State
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [userInfo, setUserInfo] = useState<GoogleUserInfo | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const avatarUrl = userInfo?.avatarUrl || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';

  // Hook for navigation
  const router = useRouter();

  // Check network connectivity
  const checkNetworkStatus = useCallback(async () => {
    try {
      const state = await NetInfo.fetch();
      setIsOffline(!state.isConnected);
    } catch (error) {
      console.warn('Error checking network status:', error);
      setIsOffline(false);
    }
  }, []);

  // Manage logout with memoization to avoid unnecessary re-creations
  const handleLogout = useCallback(async () => {
    if (isLoggingOut) return; // Éviter les déconnexions multiples

    setShowLogoutModal(true);
  }, [isLoggingOut]);

  const confirmLogout = useCallback(async () => {
    try {
      setIsLoggingOut(true);
      setShowLogoutModal(false);

      // Check if we're online for proper logout
      const networkState = await NetInfo.fetch();
      const isOnline = networkState.isConnected && networkState.isInternetReachable;

      if (isOnline) {
        // Online logout: use Supabase signOut
        const { data } = await supabase.auth.getSession();

        if (data.session) {
          // Use signOut method which already handles token cleanup
          await supabase.auth.signOut();
        }
      } else {
        // Offline logout: just clear local data
        console.log('[Profile] Performing offline logout');
      }

      // Clear all local authentication data in both cases
      await clearLocalAuthSession();

      // Additional cleanup for any remaining Supabase tokens
      storage.removeItem('supabase.auth.token').catch(() => { });
      storage.removeItem('supabase.auth.refreshToken').catch(() => { });
      storage.removeItem('supabase.auth.user').catch(() => { });

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
      // Check network status first
      await checkNetworkStatus();
      
      // Try to get user info (this should work offline too if cached)
      try {
        const user = await getGoogleUserInfo();
        setUserInfo(user);
      } catch (error) {
        console.warn('[Profile] Error fetching user info:', error);
        // In offline mode, we might not have user info, that's ok
      }
    };
    fetchUser();
  }, [checkNetworkStatus]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={componentStyle.container}>
        <LinearGradient
          colors={[theme.colors.backgroundFirst, theme.colors.backgroundLast]}
          style={componentStyle.container}
        >
          {/* En-tête */}
          <View style={componentStyle.header}>
            {/* <MaterialIcons name="account-circle" size={32} color={theme.colors.primary} style={{marginRight: 8}} /> */}
            <Image source={{ uri: avatarUrl }}
              style={{ width: 40, height: 40, borderRadius: 20, marginRight: 8 }}
              contentFit="cover"
              transition={1000}
              alt="User Avatar"
            />
            <Text style={componentStyle.headerTitle}>
              Paramètres du compte
            </Text>
            {isOffline && (
              <View style={{ marginLeft: 'auto' }}>
                <OfflineIndicator />
              </View>
            )}
          </View>

          {/* Contenu principal */}
          <View style={styles.content}>
            {userInfo && userInfo.email && (
              <View style={styles.profileCard}>
                <MaterialIcons name="email" size={24} color={theme.colors.text} />
                <Text style={styles.profileText}>{userInfo.email}</Text>
              </View>
            )}

            {isOffline && (
              <View style={styles.offlineNotice}>
                <MaterialIcons name="info-outline" size={20} color={theme.colors.description} />
                <Text style={styles.offlineNoticeText}>
                  Certaines fonctionnalités peuvent être limitées en mode hors-ligne.
                </Text>
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
        </LinearGradient>
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
  content: {
    flex: 1,
    padding: 10,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    // backgroundColor: theme.colors.secondaryBackground,
    backgroundColor: 'transparent',
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
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    gap: 8,
  },
  offlineNoticeText: {
    color: theme.colors.description,
    fontSize: 14,
    flex: 1,
    lineHeight: 18,
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
    // backgroundColor: theme.colors.secondaryBackground,
    backgroundColor: 'transparent',
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
    fontFamily: 'Inter_700Bold',
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