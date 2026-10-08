// Startup permission check: foreground location only.
//
// Required-permission inventory (from actual feature usage in this repo):
// - Foreground location: REQUIRED on startup. Map, sharing toggle (App.tsx
//   `requestLocation`), and profile "use my current location" all need it.
//   Asked once on startup when the OS will still show a prompt.
// - Background location: REQUIRED for background sharing + home geofences
//   (BACKGROUND_LOCATION_TASK, HOME_TASK), but it is NOT asked on startup.
//   Android 11+ routes `requestBackgroundPermissionsAsync` to system settings
//   and iOS defers the "Always" prompt; both platforms require foreground
//   first plus an in-context rationale. It stays behind the existing explicit
//   user action in App.tsx `requestLocation` (with its pre-prompt Alert).
// - Motion activity: OPTIONAL (App.tsx shares location even when denied).
// - Camera (join.tsx), photo library (avatar.ts), notifications
//   (home-alerts.ts `enableNotifications`): all just-in-time behind explicit
//   user actions. Never requested on startup.
//
// Denial handling: when `canAskAgain` is false (permanently denied) the OS
// will not show another prompt, so this helper returns without requesting and
// marks the run completed — no repeated or infinite prompts. Errors are caught
// and reported as an outcome so app startup never breaks.
//
// Overlap handling: a module-level singleflight (`inFlight`) dedupes
// concurrent callers (e.g. React StrictMode double-effect) and a `completed`
// flag prevents re-prompting on later remounts. Callers needing a retry must
// pass `{ force: true }` (reserved for explicit user actions, not startup).

export type StartupPermissionState = {
    granted: boolean;
    canAskAgain?: boolean;
};

export type StartupLocationAdapter = {
    getForegroundPermissionsAsync(): Promise<StartupPermissionState>;
    requestForegroundPermissionsAsync(): Promise<StartupPermissionState>;
};

export type StartupPermissionOutcome =
    | "already-granted"
    | "granted-after-request"
    | "denied-after-request"
    | "permanently-denied"
    | "skipped"
    | "unavailable"
    | "error";

export type StartupPermissionResult = {
    outcome: StartupPermissionOutcome;
    /** True only when a system permission prompt was actually shown. */
    asked: boolean;
};

export type EnsureStartupPermissionsOptions = {
    adapter?: StartupLocationAdapter;
    /** Overrides the detected platform. `'web'` skips native permission work. */
    platform?: string;
    /** Re-run even if a startup check already completed in this session. */
    force?: boolean;
};

// Pure decision rule, kept side-effect free so it is unit testable:
// only ask when the OS will actually show a prompt.
export function shouldAskForPermission(
    state: StartupPermissionState | null | undefined,
): boolean {
    if (!state || state.granted) return false;
    return state.canAskAgain === true;
}

let cachedAdapter: StartupLocationAdapter | null | undefined;

function loadLocationAdapter(): StartupLocationAdapter | null {
    if (cachedAdapter !== undefined) return cachedAdapter;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const location = require("expo-location") as StartupLocationAdapter;
        cachedAdapter =
            typeof location?.getForegroundPermissionsAsync === "function" &&
            typeof location?.requestForegroundPermissionsAsync === "function"
                ? location
                : null;
    } catch {
        cachedAdapter = null;
    }
    return cachedAdapter;
}

function currentPlatform(): string {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const rn = require("react-native") as { Platform?: { OS?: string } };
        return rn.Platform?.OS ?? "native";
    } catch {
        return "native";
    }
}

let inFlight: Promise<StartupPermissionResult> | null = null;
let completed = false;
let lastResult: StartupPermissionResult | null = null;

async function runStartupPermissions(
    options: EnsureStartupPermissionsOptions,
): Promise<StartupPermissionResult> {
    try {
        if ((options.platform ?? currentPlatform()) === "web") {
            return { outcome: "skipped", asked: false };
        }
        const adapter = options.adapter ?? loadLocationAdapter();
        if (!adapter) return { outcome: "unavailable", asked: false };
        const current = await adapter.getForegroundPermissionsAsync();
        if (current.granted)
            return { outcome: "already-granted", asked: false };
        if (!shouldAskForPermission(current)) {
            return { outcome: "permanently-denied", asked: false };
        }
        const next = await adapter.requestForegroundPermissionsAsync();
        return {
            outcome: next.granted
                ? "granted-after-request"
                : "denied-after-request",
            asked: true,
        };
    } catch (error) {
        console.warn(
            "[Free360] Startup permission check failed:",
            error instanceof Error ? error.message : error,
        );
        return { outcome: "error", asked: false };
    }
}

export function ensureStartupPermissions(
    options: EnsureStartupPermissionsOptions = {},
): Promise<StartupPermissionResult> {
    if (inFlight) return inFlight;
    if (completed && !options.force && lastResult)
        return Promise.resolve(lastResult);
    inFlight = runStartupPermissions(options).then((result) => {
        inFlight = null;
        completed = true;
        lastResult = result;
        return result;
    });
    return inFlight;
}

// Test-only reset for the module-level singleflight state.
export function __resetStartupPermissionsForTests(): void {
    inFlight = null;
    completed = false;
    lastResult = null;
}
