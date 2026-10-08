import type * as NotificationsModule from "expo-notifications";

// expo-notifications throws while evaluating on Android in Expo Go (remote push was removed there in SDK 53),
// so a static import would crash every route that touches it. Load it lazily and treat "unavailable" as a
// normal state in Expo Go; a development build always loads the full module.
let cached: typeof NotificationsModule | null | undefined;

export function getNotifications(): typeof NotificationsModule | null {
    if (cached === undefined) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            cached =
                require("expo-notifications") as typeof NotificationsModule;
        } catch (error) {
            console.warn(
                "[Free360] expo-notifications is unavailable here:",
                error instanceof Error ? error.message : error,
            );
            cached = null;
        }
    }
    return cached;
}
