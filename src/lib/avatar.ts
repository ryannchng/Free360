import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import {
    AVATAR_BASE64_MAX_CHARS,
    AVATAR_DATA_PREFIX,
    AVATAR_SIZE_PX,
    normalizeAvatar,
} from "./avatar-format";

// JPEG quality ladder for the 128px thumbnail: first success within the hard
// base64 cap wins. Re-encoding as JPEG strips EXIF/GPS metadata, so no
// location or device tags from the original photo ever leave the device.
const QUALITY_STEPS = [0.6, 0.45, 0.3, 0.2];

async function encodeThumbnail(
    uri: string,
    width: number | undefined,
    height: number | undefined,
    compress: number,
): Promise<string | null> {
    let context = ImageManipulator.manipulate(uri);
    // Center-crop to a square first so the resize never stretches, even when
    // the system crop UI was skipped or returned a non-square image.
    if (width && height) {
        const side = Math.min(width, height);
        context = context.crop({
            originX: Math.floor((width - side) / 2),
            originY: Math.floor((height - side) / 2),
            width: side,
            height: side,
        });
    }
    context = context.resize({ width: AVATAR_SIZE_PX, height: AVATAR_SIZE_PX });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
        compress,
        format: SaveFormat.JPEG,
        base64: true,
    });
    if (!saved.base64) return null;
    return normalizeAvatar(`${AVATAR_DATA_PREFIX}${saved.base64}`);
}

// Gallery-only profile photo picker. Returns a capped
// `data:image/jpeg;base64,…` 128px square thumbnail, or null when the user
// cancels. Throws when library permission is denied or the image cannot be
// compressed within the encrypted-snapshot budget.
export async function pickProfilePhoto(): Promise<string | null> {
    const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync(false);
    if (!permission.granted)
        throw new Error(
            "Photo library permission is required to choose a profile picture.",
        );
    const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
        exif: false,
        base64: false,
    });
    if (result.canceled || !result.assets?.length) return null;
    const asset = result.assets[0];
    for (const compress of QUALITY_STEPS) {
        const thumbnail = await encodeThumbnail(
            asset.uri,
            asset.width,
            asset.height,
            compress,
        );
        if (thumbnail) return thumbnail;
    }
    throw new Error(
        `This photo is too detailed for a circle thumbnail (over ${AVATAR_BASE64_MAX_CHARS} chars at 128px). Try a simpler photo.`,
    );
}
