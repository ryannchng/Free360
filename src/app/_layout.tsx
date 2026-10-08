import { Stack, router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { initializeBackendSettings } from "../lib/backend-settings";
import { useFonts } from "expo-font";
import type { NotificationResponse } from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { getNotifications } from "../lib/notifications";
import { ensureStartupPermissions } from "../lib/startup-permissions";
import "../lib/background-location";
import "../lib/home-alerts";

export default function RootLayout() {
    const [fontsLoaded, fontError] = useFonts({
        "Poppins-Regular": require("../../assets/fonts/Poppins-Regular.ttf"),
        "Poppins-SemiBold": require("../../assets/fonts/Poppins-SemiBold.ttf"),
        "Poppins-Bold": require("../../assets/fonts/Poppins-Bold.ttf"),
        "Poppins-ExtraBold": require("../../assets/fonts/Poppins-ExtraBold.ttf"),
    });
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let mounted = true;
        void initializeBackendSettings()
            .then(() => {
                if (mounted) setReady(true);
            })
            .catch(() => {
                if (mounted)
                    setError(
                        "Could not read your saved server settings. Please try again.",
                    );
            });
        return () => {
            mounted = false;
        };
    }, [attempt]);
    useEffect(() => {
        // Single startup permission check: foreground location only, and only
        // when the OS will still show a prompt. Camera/photos/notifications stay
        // just-in-time behind explicit user actions; background location stays
        // behind the sharing toggle in App.tsx which carries its own rationale.
        // The helper singleflights concurrent mounts and never throws.
        void ensureStartupPermissions();
    }, []);
    const navigationReady = ready && (fontsLoaded || Boolean(fontError));
    useEffect(() => {
        if (!navigationReady) return;
        const Notifications = getNotifications();
        if (!Notifications) return;
        const open = (response: NotificationResponse) => {
            if (response.notification.request.content.data?.url === "/activity")
                router.push("/activity");
        };
        const listener =
            Notifications.addNotificationResponseReceivedListener(open);
        void Notifications.getLastNotificationResponseAsync().then(
            (response) => {
                if (response) {
                    open(response);
                    void Notifications.clearLastNotificationResponseAsync();
                }
            },
        );
        return () => listener.remove();
    }, [navigationReady]);
    if (!fontsLoaded && !fontError) return null;
    if (!ready)
        return (
            <SafeAreaProvider>
                <View
                    style={{
                        flex: 1,
                        justifyContent: "center",
                        alignItems: "center",
                        padding: 24,
                        gap: 16,
                    }}
                >
                    {error ? (
                        <>
                            <Text>{error}</Text>
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => {
                                    setError(null);
                                    setAttempt((value) => value + 1);
                                }}
                            >
                                <Text>Try again</Text>
                            </Pressable>
                        </>
                    ) : (
                        <ActivityIndicator accessibilityLabel="Loading server settings" />
                    )}
                </View>
            </SafeAreaProvider>
        );
    return (
        <SafeAreaProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="[tab]" />
                <Stack.Screen
                    name="create-circle"
                    options={{ animation: "slide_from_right" }}
                />
                <Stack.Screen
                    name="invite"
                    options={{ animation: "slide_from_right" }}
                />
                <Stack.Screen
                    name="join"
                    options={{ animation: "slide_from_bottom" }}
                />
            </Stack>
        </SafeAreaProvider>
    );
}
