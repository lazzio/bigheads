import { Tabs } from 'expo-router';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useEffect, useState, useRef, useCallback } from 'react';
import { usePathname } from 'expo-router';
import { theme } from '../../styles/global';
import { tabBarStyle } from '@/styles/componentStyle';
import { audioManager } from '../../utils/OptimizedAudioService';
import MiniPlayer from '../../components/MiniPlayer';

// Créer un composant séparé pour le TabBar personnalisé
function CustomTabBar({ state, descriptors, navigation }: any) {
  const pathname = usePathname();
  const [showMiniPlayer, setShowMiniPlayer] = useState(false);
  const isMountedRef = useRef(true); // ✅ Tracker si le composant est monté
  const listenerRef = useRef<(() => void) | null>(null);

  // Le mini-player devrait s'afficher uniquement sur certains écrans
  const pathAllowedToShowMiniPlayer = pathname.endsWith('/episodes') || pathname.endsWith('/downloads');

  // ✅ CORRECTION : Wrapper sécurisé pour setState
  const safeSetShowMiniPlayer = useCallback((value: boolean) => {
    if (isMountedRef.current) {
      setShowMiniPlayer(value);
    }
  }, []);

  // ✅ CORRECTION : Fonction async sécurisée
  const checkCurrentEpisode = useCallback(async () => {
    if (!isMountedRef.current) return;
    
    try {
      console.log('[TabLayout] Checking current episode...');
      const status = await audioManager.getStatusAsync();
      
      if (!isMountedRef.current) return; // Vérifier après l'async
      
      const shouldShow = status.isLoaded && status.currentEpisodeId !== null;
      safeSetShowMiniPlayer(shouldShow);
      
      console.log('[TabLayout] Current audio status:', {
        isLoaded: status.isLoaded,
        currentEpisodeId: status.currentEpisodeId,
        showMiniPlayer: shouldShow
      });
    } catch (error) {
      console.error('[TabLayout] Error checking current episode:', error);
      if (isMountedRef.current) {
        safeSetShowMiniPlayer(false);
      }
    }
  }, [safeSetShowMiniPlayer]);

  // ✅ CORRECTION : Gestionnaire d'événements sécurisé
  const handleAudioEvent = useCallback((data: any) => {
    if (!isMountedRef.current) return;
    
    try {

      if (data.type === 'loaded' && data.episode) {
        console.log('[TabLayout] Episode loaded, showing mini player');
        safeSetShowMiniPlayer(true);
      } else if (data.type === 'unloaded') {
        console.log('[TabLayout] Episode unloaded, hiding mini player');
        safeSetShowMiniPlayer(false);
      } else if (data.type === 'status') {
        const shouldShow = data.isLoaded && data.episodeId !== null;
        safeSetShowMiniPlayer(shouldShow);
      }
    } catch (error) {
      console.error('[TabLayout] Error handling audio event:', error);
    }
  }, [safeSetShowMiniPlayer]);

  // ✅ CORRECTION : Gestionnaire de navigation sécurisé
  const handleTabPress = useCallback((route: any, index: number, isFocused: boolean) => {
    if (!isMountedRef.current) return;
    
    try {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });

      if (!isFocused && !event.defaultPrevented) {
        // ✅ Wrapper la navigation dans un try-catch
        Promise.resolve(navigation.navigate(route.name)).catch((navError) => {
          console.error('[TabLayout] Navigation error:', navError);
        });
      }
    } catch (error) {
      console.error('[TabLayout] Error in tab press handler:', error);
    }
  }, [navigation]);

  // Effet pour vérifier s'il y a un épisode en cours de lecture
  useEffect(() => {
    isMountedRef.current = true;
    
    // ✅ CORRECTION : Wrapper dans un timeout pour éviter les conflits
    const initializeAsync = async () => {
      try {
        await checkCurrentEpisode();
        
        if (!isMountedRef.current) return;
        
        // ✅ Nettoyer l'ancien listener s'il existe
        if (listenerRef.current) {
          listenerRef.current();
          listenerRef.current = null;
        }
        
        // Écouter les événements de l'audioManager
        const unsubscribe = audioManager.addListener(handleAudioEvent);
        listenerRef.current = unsubscribe;
        
      } catch (error) {
        console.error('[TabLayout] Error in initialization:', error);
      }
    };

    // ✅ Délai micro pour éviter les conflits de session
    const timeoutId = setTimeout(initializeAsync, 10);

    return () => {
      isMountedRef.current = false;
      clearTimeout(timeoutId);
      
      // ✅ Nettoyer le listener
      if (listenerRef.current) {
        try {
          listenerRef.current();
        } catch (error) {
          console.error('[TabLayout] Error cleaning up listener:', error);
        }
        listenerRef.current = null;
      }
    };
  }, [pathname, checkCurrentEpisode, handleAudioEvent]);

  // ✅ CORRECTION : Rendu protégé contre les erreurs
  const renderTabButton = useCallback((route: any, index: number) => {
    try {
      const { options } = descriptors[route.key];
      const label = options.title || route.name;
      const isFocused = state.index === index;

      const color = isFocused 
        ? theme.colors.text
        : theme.colors.description;

      return (
        <TouchableOpacity
          key={route.key}
          accessibilityRole="button"
          accessibilityState={isFocused ? { selected: true } : {}}
          accessibilityLabel={options.tabBarAccessibilityLabel}
          testID={options.tabBarTestID}
          onPress={() => handleTabPress(route, index, isFocused)}
          style={styles.tabButton}
        >
          {options.tabBarIcon && options.tabBarIcon({ color, size: 24 })}
          {options.tabBarShowLabel !== false && (
            <Text style={[styles.tabBarLabel, { color }]}>
              {label}
            </Text>
          )}
        </TouchableOpacity>
      );
    } catch (error) {
      console.error('[TabLayout] Error rendering tab button:', error);
      return null;
    }
  }, [descriptors, state.index, handleTabPress]);

  // ✅ CORRECTION : Rendu principal protégé
  try {
    return (
      <View style={styles.tabContainer}>
        {/* TabBar standard - implémentation manuelle */}
        <View style={[tabBarStyle.tabBar, styles.tabBar]}>
          {state.routes.map(renderTabButton)}
        </View>
        {/* Mini Player au-dessus des onglets */}
        {showMiniPlayer && pathAllowedToShowMiniPlayer && <MiniPlayer />}
      </View>
    );
  } catch (error) {
    console.error('[TabLayout] Critical error in CustomTabBar render:', error);
    return null;
  }
}

export default function TabLayout() {
  try {
    return (
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: tabBarStyle.tabBar,
          tabBarActiveTintColor: theme.colors.text,
          tabBarInactiveTintColor: theme.colors.description,
          tabBarShowLabel: true,
          tabBarLabelPosition: 'below-icon',
        }}
        // Utiliser notre composant custom comme tabBar
        tabBar={props => <CustomTabBar {...props} />}
      >
        <Tabs.Screen
          name="index"
          options={{
            headerShown: false,
            title: 'Accueil',
            tabBarIcon: ({ size, color }) => (
              <MaterialIcons name="home" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="episodes"
          options={{
            headerShown: false,
            title: 'Episodes',
            tabBarIcon: ({ size, color }) => (
              <MaterialIcons name="library-music" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="downloads"
          options={{
            headerShown: false,
            title: 'Téléchargements',
            tabBarIcon: ({ size, color }) => (
              <MaterialIcons name="download-for-offline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            headerShown: false,
            title: 'Profil',
            tabBarIcon: ({ size, color }) => (
              <MaterialIcons name="person" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    );
  } catch (error) {
    console.error('[TabLayout] Critical error in TabLayout:', error);
    return null;
  }
}

// Ces styles seront combinés avec vos styles tabBarStyle existants
const styles = StyleSheet.create({
  tabContainer: {
    // Conteneur global pour le TabBar + MiniPlayer
    width: '100%',
    backgroundColor: theme.colors.darkBackground,
    position: 'relative',
  },
  tabBar: {
    // Style spécifique pour le TabBar
    flexDirection: 'row',
    height: 70,
    borderTopWidth: 0,
    position: 'relative',
    marginBottom: 0,
    zIndex: 1,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  tabBarLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 2,
  },
});