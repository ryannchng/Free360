import { COLORS, FONTS, RADII, SHADOWS } from "../theme";
import { useEffect, useState } from "react";
import {
    Alert,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    StyleSheet,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import {
    loadDeviceProfile,
    saveDeviceProfile,
    type DeviceProfile,
} from "../lib/circle";
import { enableNotifications, refreshHomeMonitoring } from "../lib/home-alerts";
import { MemberAvatar } from "../components/MemberAvatar";

// Structural avatar extension: parallel library lane adds
// `DeviceProfile.avatar?: string | null` in circle.ts. Intersect locally so this
// file typechecks both before and after that lane lands (no static type import).
type ProfileWithAvatar = DeviceProfile & { avatar?: string | null };

// Runtime contract (parallel library lane): `../lib/avatar` exports
// `pickProfilePhoto(): Promise<string | null>` (null = user cancelled).
// Valid result is a `data:image/jpeg;base64,` compressed square thumbnail (<~5k chars).
// Dynamic import keeps this file typechecking before that module lands; once it
// exists the import resolves and photos flow through the existing encrypted snapshots.
async function requestProfilePhoto(): Promise<string | null> {
    try {
        // @ts-ignore - provided by the parallel avatar library lane
        const mod = await import("../lib/avatar");
        const picker = (
            mod as { pickProfilePhoto?: () => Promise<string | null> }
        ).pickProfilePhoto;
        if (typeof picker !== "function")
            throw new Error("Photo picker is unavailable.");
        return await picker();
    } catch (error) {
        if (error instanceof Error && /cancel/i.test(error.message))
            return null;
        throw error instanceof Error
            ? error
            : new Error("Could not open the photo picker.");
    }
}

export default function ProfileRoute() {
    const router = useRouter();
    const [profile, setProfile] = useState<ProfileWithAvatar>({
        name: "",
        home: null,
        battery: null,
    });
    const [busy, setBusy] = useState(false);
    const [photoBusy, setPhotoBusy] = useState(false);
    const [draftAvatar, setDraftAvatar] = useState<string | null | undefined>(
        undefined,
    );
    const [latitude, setLatitude] = useState("");
    const [longitude, setLongitude] = useState("");
    useEffect(() => {
        void loadDeviceProfile().then((value) => {
            const withAvatar = value as ProfileWithAvatar;
            setProfile(withAvatar);
            setDraftAvatar(withAvatar.avatar ?? null);
            setLatitude(
                withAvatar.home ? String(withAvatar.home.latitude) : "",
            );
            setLongitude(
                withAvatar.home ? String(withAvatar.home.longitude) : "",
            );
        });
    }, []);
    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        try {
            await action();
        } catch (error) {
            Alert.alert(
                "Could not save",
                error instanceof Error ? error.message : "Please try again.",
            );
        } finally {
            setBusy(false);
        }
    };
    const pickPhoto = async () => {
        if (photoBusy || busy) return;
        setPhotoBusy(true);
        try {
            const uri = await requestProfilePhoto();
            // null = cancelled: preserve the current photo.
            if (typeof uri === "string" && uri) setDraftAvatar(uri);
        } catch (error) {
            // Failure preserves the current photo; surface the reason.
            Alert.alert(
                "Could not update photo",
                error instanceof Error ? error.message : "Please try again.",
            );
        } finally {
            setPhotoBusy(false);
        }
    };
    const save = async () => {
        let home = null;
        if (latitude.trim() || longitude.trim()) {
            const lat = Number(latitude),
                lon = Number(longitude);
            if (
                !latitude.trim() ||
                !longitude.trim() ||
                !Number.isFinite(lat) ||
                Math.abs(lat) > 90 ||
                !Number.isFinite(lon) ||
                Math.abs(lon) > 180
            )
                throw new Error(
                    "Enter valid latitude and longitude, or clear both to remove your home.",
                );
            home = { latitude: lat, longitude: lon, radius: 150 };
        }
        await saveDeviceProfile({
            ...profile,
            name: profile.name.trim(),
            home,
            avatar: draftAvatar ?? null,
        } as DeviceProfile);
        await refreshHomeMonitoring();
        router.back();
    };
    const avatarPreview = draftAvatar ?? null;
    return (
        <SafeAreaView style={styles.root}>
            <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
            >
                <Pressable
                    onPress={() => router.back()}
                    accessibilityRole="button"
                >
                    <Text style={styles.link}>Back</Text>
                </Pressable>
                <Text style={styles.title}>Your profile</Text>
                <Text style={styles.body}>
                    Your name is linked to this phone’s UUID. Your circle can
                    see your name, photo, home, and last reported battery level.
                </Text>
                <Text style={styles.label}>PROFILE PHOTO</Text>
                <View style={styles.photoRow}>
                    <MemberAvatar
                        name={profile.name || "You"}
                        avatar={avatarPreview}
                        color={COLORS.purple}
                        size={96}
                        accessibilityLabel="Profile photo preview"
                    />
                    <View style={styles.photoActions}>
                        <Pressable
                            style={[
                                styles.secondaryButton,
                                (photoBusy || busy) && styles.disabledButton,
                            ]}
                            disabled={photoBusy || busy}
                            onPress={() => void pickPhoto()}
                            accessibilityRole="button"
                            accessibilityLabel="Change profile photo"
                            accessibilityState={{
                                busy: photoBusy,
                                disabled: photoBusy || busy,
                            }}
                        >
                            <Text style={styles.secondaryButtonText}>
                                {photoBusy
                                    ? "Choosing…"
                                    : avatarPreview
                                      ? "Change photo"
                                      : "Add photo"}
                            </Text>
                        </Pressable>
                        {avatarPreview ? (
                            <Pressable
                                style={[
                                    styles.secondaryButton,
                                    (photoBusy || busy) &&
                                        styles.disabledButton,
                                ]}
                                disabled={photoBusy || busy}
                                onPress={() => setDraftAvatar(null)}
                                accessibilityRole="button"
                                accessibilityLabel="Remove profile photo"
                                accessibilityState={{
                                    disabled: photoBusy || busy,
                                }}
                            >
                                <Text style={styles.secondaryButtonText}>
                                    Remove photo
                                </Text>
                            </Pressable>
                        ) : null}
                        <Text style={styles.hint}>
                            Square thumbnail stored on this device and shared
                            encrypted with your circle.
                        </Text>
                    </View>
                </View>
                <Text style={styles.label}>NAME</Text>
                <TextInput
                    accessibilityLabel="Your name"
                    style={styles.input}
                    value={profile.name}
                    maxLength={40}
                    onChangeText={(name) =>
                        setProfile((current) => ({ ...current, name }))
                    }
                    placeholder="Your name"
                />
                <Text style={styles.label}>HOME LOCATION</Text>
                <Text style={styles.body}>
                    Save your own residence. Arrival and departure monitoring
                    uses a 150 metre radius. Clear both coordinates to remove
                    it.
                </Text>
                <TextInput
                    accessibilityLabel="Home latitude"
                    style={styles.input}
                    value={latitude}
                    onChangeText={setLatitude}
                    keyboardType="numbers-and-punctuation"
                    placeholder="Latitude"
                />
                <TextInput
                    accessibilityLabel="Home longitude"
                    style={styles.input}
                    value={longitude}
                    onChangeText={setLongitude}
                    keyboardType="numbers-and-punctuation"
                    placeholder="Longitude"
                />
                <Pressable
                    disabled={busy}
                    onPress={() =>
                        void run(async () => {
                            if (
                                !(
                                    await Location.requestForegroundPermissionsAsync()
                                ).granted
                            )
                                throw new Error(
                                    "Location permission is required.",
                                );
                            const position =
                                await Location.getCurrentPositionAsync({
                                    accuracy: Location.Accuracy.High,
                                });
                            setLatitude(String(position.coords.latitude));
                            setLongitude(String(position.coords.longitude));
                        })
                    }
                >
                    <Text style={styles.link}>
                        Use my current location as home
                    </Text>
                </Pressable>
                <Pressable
                    style={styles.button}
                    disabled={busy || !profile.name.trim()}
                    onPress={() => void run(save)}
                    accessibilityRole="button"
                    accessibilityLabel="Save profile"
                >
                    <Text style={styles.buttonText}>
                        {busy ? "Working…" : "Save profile"}
                    </Text>
                </Pressable>
                <Text style={styles.label}>HOME ALERTS</Text>
                <Text style={styles.body}>
                    Enable push notifications to receive home activity alerts
                    while the app is closed. Open the activity tab to see who
                    arrived or left. Background location sharing must be enabled
                    on the travelling phone.
                </Text>
                <Pressable
                    style={styles.button}
                    disabled={busy}
                    onPress={() =>
                        void run(async () => {
                            await enableNotifications();
                            Alert.alert(
                                "Notifications enabled",
                                "You will receive home activity alerts from your circle.",
                            );
                        })
                    }
                >
                    <Text style={styles.buttonText}>Enable notifications</Text>
                </Pressable>
            </ScrollView>
        </SafeAreaView>
    );
}
const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: COLORS.canvas },
    content: { padding: 24, gap: 14 },
    title: {
        fontFamily: FONTS.heavy,
        fontSize: 26,
        fontWeight: "normal",
        color: COLORS.ink,
    },
    body: {
        fontFamily: FONTS.regular,
        fontSize: 14,
        lineHeight: 21,
        color: COLORS.muted,
    },
    label: {
        fontFamily: FONTS.bold,
        fontSize: 12,
        fontWeight: "normal",
        marginTop: 16,
    },
    input: {
        minHeight: 48,
        backgroundColor: COLORS.white,
        borderColor: COLORS.border,
        padding: 16,
        borderRadius: RADII.card,
        color: COLORS.ink,
        ...SHADOWS.card,
    },
    button: {
        minHeight: 48,
        backgroundColor: COLORS.purple,
        borderRadius: RADII.pill,
        padding: 17,
        alignItems: "center",
        ...SHADOWS.card,
    },
    buttonText: {
        fontFamily: FONTS.bold,
        color: COLORS.white,
        fontWeight: "normal",
    },
    link: {
        minHeight: 48,
        fontFamily: FONTS.bold,
        color: COLORS.purple,
        paddingVertical: 12,
        fontWeight: "normal",
    },
    photoRow: {
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        backgroundColor: COLORS.white,
        borderColor: COLORS.border,
        borderRadius: RADII.card,
        padding: 16,
        ...SHADOWS.card,
    },
    photoActions: { flex: 1, gap: 8 },
    secondaryButton: {
        minHeight: 48,
        backgroundColor: COLORS.purpleSoft,
        borderRadius: RADII.card,
        paddingVertical: 11,
        paddingHorizontal: 14,
        alignItems: "center",
        ...SHADOWS.card,
    },
    secondaryButtonText: {
        fontFamily: FONTS.bold,
        color: COLORS.purple,
        fontWeight: "normal",
        fontSize: 13,
    },
    disabledButton: { opacity: 0.55 },
    hint: {
        fontFamily: FONTS.regular,
        fontSize: 11,
        lineHeight: 16,
        color: COLORS.subtle,
    },
});
