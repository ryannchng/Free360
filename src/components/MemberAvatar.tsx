import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { avatarUriFor, initialsForName } from "../lib/member-display";
import { COLORS, FONTS } from "../theme";
import { BatteryBadge } from "./BatteryBadge";

type MemberAvatarProps = {
    name?: string | null;
    initials?: string | null;
    avatar?: string | null | unknown;
    color?: string;
    size?: number;
    accessibilityLabel?: string;
    /** Optional small caption rendered under the avatar (e.g. battery "82%"). */
    badgeText?: string | null;
    /** Called when the underlying Image starts/finishes loading (used by map markers). */
    onLoadingChange?: (loading: boolean) => void;
};

/**
 * Central avatar: renders the photo via RN <Image> when the stored value is a
 * valid data URI, otherwise falls back to initials. Handles async load failure
 * by falling back to initials so a corrupt payload never shows a broken image.
 */
export function MemberAvatar({
    name,
    initials,
    avatar,
    color = COLORS.deepPurple,
    size = 48,
    accessibilityLabel,
    badgeText,
    onLoadingChange,
}: MemberAvatarProps) {
    const uri = avatarUriFor(avatar);
    const label = (
        initials && initials.trim()
            ? initials.trim().toUpperCase()
            : initialsForName(name ?? "")
    ).slice(0, 1);
    const [failed, setFailed] = useState(false);
    const showPhoto = Boolean(uri) && !failed;

    return (
        <View
            accessible
            accessibilityLabel={
                accessibilityLabel ??
                (name ? `${name} avatar` : "Member avatar")
            }
        >
            <View
                style={[
                    styles.circle,
                    {
                        width: size,
                        height: size,
                        borderRadius: size * 0.3,
                        backgroundColor: color,
                    },
                ]}
            >
                {showPhoto ? (
                    <Image
                        source={{ uri: uri as string }}
                        style={{
                            width: size,
                            height: size,
                            borderRadius: size * 0.3,
                        }}
                        resizeMode="cover"
                        accessibilityIgnoresInvertColors
                        onError={() => {
                            setFailed(true);
                            onLoadingChange?.(false);
                        }}
                        onLoadStart={() => onLoadingChange?.(true)}
                        onLoadEnd={() => onLoadingChange?.(false)}
                    />
                ) : (
                    <Text style={[styles.initials, { fontSize: size * 0.31 }]}>
                        {label}
                    </Text>
                )}
            </View>
            {badgeText ? (
                <View style={styles.badge}>
                    <BatteryBadge value={Number(badgeText.replace(/%$/, ""))} />
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    circle: {
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 2,
        borderColor: COLORS.white,
        overflow: "hidden",
        position: "relative",
    },
    initials: {
        color: COLORS.white,
        fontFamily: FONTS.heavy,
        letterSpacing: -0.5,
    },
    badge: {
        position: "absolute",
        bottom: -6,
        alignSelf: "center",
    },
});
