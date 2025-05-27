import { StyleSheet } from 'react-native';
import { theme } from './global';

export const componentStyle = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.primaryBackground,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.primaryBackground,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: 20,
    paddingBottom: 10,
    marginTop: 25,
    marginBottom: 0,
    backgroundColor: theme.colors.darkBackground,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
});

export const tabBarStyle = StyleSheet.create(
  {
    tabBar: {
      height: 70,
      paddingBottom: 10,
      backgroundColor: theme.colors.darkerBackground,
      borderRadius: 10,
    },
    tabBarIcon: {
      paddingBottom: 10,
    },
  }
);

export const episodeStyle = StyleSheet.create({
  episodeItem: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: theme.colors.secondaryBackground,
    borderRadius: 10,
    marginBottom: 10,
    alignItems: 'center',
  },
  episodeTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: 3,
  },
  episodeDescription: {
    fontSize: 12,
    color: theme.colors.description,
    marginBottom: 5,
    lineHeight: 16,
  },
  episodeImage: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    marginBottom: 20,
  },
  episodeActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
});