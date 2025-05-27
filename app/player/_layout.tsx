import { Stack } from 'expo-router';
import { theme } from '../../styles/global';

export default function PlayerLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: theme.colors.darkBackground
        },
      }}>
      <Stack.Screen
        name="play"
        options={{
          gestureEnabled: true,
          headerShown: false,
        }}
      />
    </Stack>
  );
}