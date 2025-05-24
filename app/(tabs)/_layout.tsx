import { Tabs } from 'expo-router';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useEffect, useState } from 'react';
import { usePathname } from 'expo-router';
import { theme } from '../../styles/global';
import { tabBarStyle } from '@/styles/componentStyle';
import { audioManager } from '../../utils/OptimizedAudioService';
import { getCurrentEpisodeId } from '../../utils/cache/LocalStorageService';
import MiniPlayer from '../../components/MiniPlayer';

// Créer un composant séparé pour le TabBar personnalisé
function CustomTabBar({ state, descriptors, navigation }: any) {
  const pathname = usePathname();
  const [showMiniPlayer, setShowMiniPlayer] = useState(false);

  // Le mini-player devrait s'afficher sur tous les écrans tabs quand il y a un épisode en cours
  const pathAlloawedToShowMiniPlayer = true; // Afficher sur tous les onglets

  // Effet pour vérifier s'il y a un épisode en cours de lecture
  useEffect(() => {
    const checkCurrentEpisode = async () => {
      try {
        // Vérifier l'état de lecture actuel via audioManager
        const status = await audioManager.getStatusAsync();
        
        // Afficher le mini-player si un épisode est chargé
        setShowMiniPlayer(status.isLoaded && status.currentEpisodeId !== null);
        
        console.log('[TabLayout] Current audio status:', {
          isLoaded: status.isLoaded,
          currentEpisodeId: status.currentEpisodeId,
          showMiniPlayer: status.isLoaded && status.currentEpisodeId !== null
        });
      } catch (error) {
        console.error('[TabLayout] Error checking current episode:', error);
        setShowMiniPlayer(false);
      }
    };

    checkCurrentEpisode();
    
    // Écouter les événements de l'audioManager pour mettre à jour l'affichage du mini-player
    const unsubscribe = audioManager.addListener((data) => {
      
      if (data.type === 'loaded' && data.episode) {
        console.log('[TabLayout] Episode loaded, showing mini player');
        setShowMiniPlayer(true);
      } else if (data.type === 'unloaded') {
        console.log('[TabLayout] Episode unloaded, hiding mini player');
        setShowMiniPlayer(false);
      } else if (data.type === 'status') {
        // Mettre à jour la visibilité basée sur le statut
        const shouldShow = data.isLoaded && data.episodeId !== null;
        setShowMiniPlayer(shouldShow);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [pathname]); // Ajouter pathname comme dépendance pour re-check sur changement d'écran

  return (
    <View style={styles.tabContainer}>
      {/* TabBar standard - implémentation manuelle */}
      <View style={[tabBarStyle.tabBar, styles.tabBar]}>
        {state.routes.map((route: any, index: number) => {
          const { options } = descriptors[route.key];
          const label = options.title || route.name;
          const isFocused = state.index === index;

          const color = isFocused 
            ? theme.colors.text
            : theme.colors.description;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarTestID}
              onPress={onPress}
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
        })}
      </View>
      {/* Mini Player au-dessus des onglets */}
      {showMiniPlayer && pathAlloawedToShowMiniPlayer && <MiniPlayer />}
    </View>
  );
}

export default function TabLayout() {
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
    zIndex: 1,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  tabBarLabel: {
    fontSize: 12,
    marginTop: 2,
  },
});