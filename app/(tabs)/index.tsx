import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { theme } from '../../styles/global';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Image
      source={{ uri: 'https://images.unsplash.com/photo-1478737270239-2f02b77fc618?q=80&w=1024' }}
      style={styles.backgroundImage}
      />
      <View style={styles.overlay}>
        <Text style={styles.title}>Les Grosses Têtes</Text>
        <Text style={styles.subtitle}>Les intégrales</Text>

        <TouchableOpacity
          style={styles.playButton}
          onPress={() => router.push('/player/player')}
        >
          <MaterialIcons name="play-arrow" size={24} color={theme.colors.shadowColor} />
          <Text style={styles.playText}>Écouter le dernier épisode</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.primaryBackground,
  },
  backgroundImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: theme.colors.text,
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 18,
    color: theme.colors.text,
    textAlign: 'center',
    marginBottom: 40,
    opacity: 0.8,
  },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.text,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 30,
    gap: 8,
  },
  playText: {
    fontSize: 16,
    fontWeight: '600',
  },
});