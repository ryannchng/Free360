import "react-native-url-polyfill/auto";
import "expo-sqlite/localStorage/install";
import { Platform } from "react-native";
import { secureStorage } from "./secure-storage";

export type BackendSettings =
    | { backend: "self-hosted"; url: string }
    | { backend: "supabase"; url: string; publishableKey: string };
const STORAGE_KEY = "free360.backend.v1";
let settings: BackendSettings | null = null;
let initialization: Promise<void> | null = null;

export function validateBackendSettings(value: unknown): BackendSettings {
    if (!value || typeof value !== "object")
        throw new Error("Choose a Free360 server.");
    const input = value as Record<string, unknown>;
    if (input.backend !== "self-hosted" && input.backend !== "supabase")
        throw new Error("Unsupported server type.");
    if (typeof input.url !== "string" || input.url.length > 2048)
        throw new Error("Enter your server HTTPS URL.");
    let url: URL;
    try {
        url = new URL(input.url.trim());
    } catch {
        throw new Error("Enter a valid server HTTPS URL.");
    }
    if (
        url.protocol !== "https:" ||
        !url.hostname ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.hostname.includes("example.com") ||
        url.hostname.includes("your-project-ref")
    ) {
        throw new Error(
            "Use your server HTTPS URL without credentials, query parameters or fragments.",
        );
    }
    const normalized = url.toString().replace(/\/+$/, "");
    if (input.backend === "self-hosted")
        return { backend: input.backend, url: normalized };
    // Only accept the public key format. Secret/service-role keys must never
    // become client settings or be propagated in invitations.
    if (
        typeof input.publishableKey !== "string" ||
        !/^sb_publishable_[A-Za-z0-9_-]+$/.test(input.publishableKey.trim()) ||
        input.publishableKey.length > 1024
    ) {
        throw new Error(
            "Enter a Supabase publishable key (sb_publishable_…). Do not use a secret or service-role key.",
        );
    }
    return {
        backend: input.backend,
        url: normalized,
        publishableKey: input.publishableKey.trim(),
    };
}

function environmentSettings(): BackendSettings | null {
    try {
        return validateBackendSettings(
            process.env.EXPO_PUBLIC_BACKEND === "self-hosted"
                ? {
                      backend: "self-hosted",
                      url: process.env.EXPO_PUBLIC_SELF_HOSTED_URL,
                  }
                : {
                      backend: process.env.EXPO_PUBLIC_BACKEND || "supabase",
                      url: process.env.EXPO_PUBLIC_SUPABASE_URL,
                      publishableKey:
                          process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
                  },
        );
    } catch {
        return null;
    }
}

async function migrateLegacySession(connection: BackendSettings | null) {
    if (connection?.backend !== "supabase") return;
    const target = `free360.auth.${encodeURIComponent(connection.url)}`;
    if (localStorage.getItem(target)) return;
    const rawCircle = await secureStorage.getItemAsync("free360.circle.v2");
    if (rawCircle && JSON.parse(rawCircle).projectUrl === connection.url) {
        const legacy = localStorage.getItem(
            `sb-${new URL(connection.url).hostname.split(".")[0]}-auth-token`,
        );
        if (legacy) localStorage.setItem(target, legacy);
    }
}

export function initializeBackendSettings(): Promise<void> {
    if (!initialization)
        initialization = (async () => {
            const raw =
                Platform.OS === "web"
                    ? localStorage.getItem(STORAGE_KEY)
                    : await secureStorage.getItemAsync(STORAGE_KEY);
            settings = raw
                ? validateBackendSettings(JSON.parse(raw))
                : environmentSettings();
            await migrateLegacySession(settings);
            // Remember legacy .env defaults so subsequent builds need no embedded server.
            if (!raw && settings) {
                if (Platform.OS === "web")
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
                else
                    await secureStorage.setItemAsync(
                        STORAGE_KEY,
                        JSON.stringify(settings),
                    );
            }
        })().catch((error) => {
            initialization = null;
            throw error;
        });
    return initialization;
}

export function getBackendSettings() {
    return settings;
}

export async function saveBackendSettings(value: unknown) {
    await initializeBackendSettings();
    const next = validateBackendSettings(value);
    if (JSON.stringify(next) === JSON.stringify(settings)) return;
    // Fail closed even for a pending claim: its key/session may already have
    // been committed on the server when a network response was lost.
    const circle = await secureStorage.getItemAsync("free360.circle.v2");
    const restoringLegacy =
        circle && !settings && JSON.parse(circle).projectUrl === next.url;
    if (circle && !restoringLegacy)
        throw new Error(
            "This phone already has a circle or a pending setup. Its server cannot be changed. Use a fresh app installation for another server.",
        );
    await migrateLegacySession(next);
    if (Platform.OS === "web")
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else await secureStorage.setItemAsync(STORAGE_KEY, JSON.stringify(next));
    settings = next;
}
