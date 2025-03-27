import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { LogOut } from 'lucide-react-native';
import { storage } from '../../lib/storage';

export default function ProfileScreen() {
  const router = useRouter();

  async function handleLogout() {
    try {
      // Check if a session exists first
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        // Clear all storage items related to auth
        await storage.removeItem('supabase.auth.token');
        await storage.removeItem('supabase.auth.refreshToken');
        await storage.removeItem('supabase.auth.user');

        // Sign out from Supabase
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      }

      // Navigate to login screen regardless of session state
      router.replace('/auth/login');
    } catch (err) {
      console.error('Error during logout:', err);
      // Even if there's an error, try to redirect to login
      router.replace('/auth/login');
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profil</Text>
      
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <LogOut size={24} color="#fff" />
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
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
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ef4444',
    padding: 15,
    borderRadius: 8,
    gap: 8,
  },
  logoutText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});