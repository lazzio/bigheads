import { Tabs } from 'expo-router';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { theme } from '../../styles/global';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          borderTopWidth: 0,
          elevation: 0,
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
        },
        tabBarActiveTintColor: theme.colors.text,
        tabBarInactiveTintColor: theme.colors.description,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ size, color }) => (
            <MaterialIcons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="episodes"
        options={{
          title: 'Episodes',
          tabBarIcon: ({ size, color }) => (
            <MaterialIcons name="library-music" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="downloads"
        options={{
          title: 'Téléchargements',
          tabBarIcon: ({ size, color }) => (
            <MaterialIcons name="download-for-offline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ size, color }) => (
            <MaterialIcons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}