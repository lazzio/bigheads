import { Stack } from 'expo-router';

export default function PlayerLayout() {
  return (
    <Stack>
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