import { Stack, router } from 'expo-router';
import { useEffect } from 'react';
import type { NotificationResponse } from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getNotifications } from '../lib/notifications';
import { ensureStartupPermissions } from '../lib/startup-permissions';
import '../lib/background-location';
import '../lib/home-alerts';

export default function RootLayout() {
  useEffect(() => {
    // Single startup permission check: foreground location only, and only
    // when the OS will still show a prompt. Camera/photos/notifications stay
    // just-in-time behind explicit user actions; background location stays
    // behind the sharing toggle in App.tsx which carries its own rationale.
    // The helper singleflights concurrent mounts and never throws.
    void ensureStartupPermissions();
  }, []);
  useEffect(() => {
    const Notifications = getNotifications();
    if (!Notifications) return;
    const open = (response: NotificationResponse) => {
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
