import { Stack } from 'expo-router';

export default function PlayerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="player"
        options={{
          gestureEnabled: true,
          headerShown: false,
        }}
      />
    </Stack>
  );
}