import { Stack, router } from 'expo-router';
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../lib/background-location';
import '../lib/home-alerts';

export default function RootLayout() {
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse) => {
      if (response.notification.request.content.data?.url === '/activity') router.push('/activity');
    };
    const listener = Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then(response => { if (response) { open(response); void Notifications.clearLastNotificationResponseAsync(); } });
    return () => listener.remove();
  }, []);
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="[tab]" />
        <Stack.Screen name="create-circle" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="invite" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="join" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
