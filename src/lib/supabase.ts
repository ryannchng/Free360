import "react-native-url-polyfill/auto";
import "expo-sqlite/localStorage/install";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

import { getBackendSettings } from "./backend-settings";

let clientSettings = "";
let appStateListener: ReturnType<typeof AppState.addEventListener> | null =
    null;

let client: SupabaseClient | null = null;
let signIn: Promise<string> | null = null;

export function isSupabaseConfigured() {
    return getBackendSettings()?.backend === "supabase";
}

export function getSupabase() {
    const settings = getBackendSettings();
    if (settings?.backend !== "supabase")
        throw new Error(
            "Configure your Supabase server or scan an invitation QR.",
        );
    const identity = JSON.stringify(settings);
    if (!client || clientSettings !== identity) {
        client?.auth.stopAutoRefresh();
        if (client) void client.removeAllChannels();
        appStateListener?.remove();
        clientSettings = identity;
        client = createClient(settings.url, settings.publishableKey, {
            auth: {
                storage: localStorage,
                storageKey: `free360.auth.${encodeURIComponent(settings.url)}`,
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: false,
            },
        });
        if (Platform.OS !== "web") {
            const current = client;
            appStateListener = AppState.addEventListener("change", (state) => {
                if (state === "active") current.auth.startAutoRefresh();
                else current.auth.stopAutoRefresh();
            });
            if (AppState.currentState !== "active")
                current.auth.stopAutoRefresh();
        }
    }
    return client;
}

export function getProjectUrl() {
    getSupabase();
    return getBackendSettings()!.url;
}

export async function ensureDeviceSession() {
    if (signIn) return signIn;
    signIn = (async () => {
        const supabase = getSupabase();
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (data.session?.user.id) return data.session.user.id;
        const created = await supabase.auth.signInAnonymously();
        if (created.error) throw created.error;
        if (!created.data.user)
            throw new Error("Supabase did not create a device session.");
        return created.data.user.id;
    })();
    try {
        return await signIn;
    } finally {
        signIn = null;
    }
}
