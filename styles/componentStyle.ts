import { StyleSheet } from 'react-native';
import { theme } from './global';

export const componentStyle = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.primaryBackground,
    //marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: 10,
    paddingBottom: 10,
    marginTop: 25,
    marginBottom: 10,
    //backgroundColor: theme.colors.secondaryBackground,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderColor,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
});