import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import '../lib/background-location';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="[tab]" />
        <Stack.Screen name="create-circle" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="invite" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="join" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
    </>
  );
}
