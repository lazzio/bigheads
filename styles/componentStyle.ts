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
    paddingBottom: 20,
    marginTop: 25,
    marginBottom: 10,
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
      backgroundColor: theme.colors.darkBackground,
      borderTopWidth: 0,
    },
    tabBarIcon: {
      paddingBottom: 10,
    },
  }
);