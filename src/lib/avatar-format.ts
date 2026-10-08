// Pure (native-free) avatar thumbnail format helpers.
// Importable from UI, profile logic, and node:test without Expo modules.

// Square JPEG data-URI thumbnails produced by src/lib/avatar.ts.
export const AVATAR_DATA_PREFIX = "data:image/jpeg;base64,";
// Hard cap on the base64 payload (chars). Keeps the worst-case encrypted
// snapshot envelope below the backend limits (see worstCase below).
export const AVATAR_BASE64_MAX_CHARS = 5000;
export const AVATAR_STRING_MAX_CHARS =
    AVATAR_DATA_PREFIX.length + AVATAR_BASE64_MAX_CHARS;
// Edge length (px) of the square thumbnail written by the picker pipeline.
export const AVATAR_SIZE_PX = 128;

// Backend envelope budgets, mirrored from supabase/schema.sql
// (free360_valid_envelope) and docker/server.mjs (validEnvelope/readJson).
export const ENVELOPE_CIPHERTEXT_MAX_CHARS = 8192;
export const ENVELOPE_JSON_MAX_BYTES = 12000;
// NaCl secretbox authentication overhead added to every plaintext.
export const SECRETBOX_OVERHEAD_BYTES = 16;
// Nonce bytes (24) rendered as base64 inside the envelope.
export const NONCE_BASE64_CHARS = 32;

// Standard base64 alphabet emitted by expo-image-manipulator (base64: true).
const BASE64_PATTERN = /^[A-Za-z0-9+/=]*$/;

// Returns the canonical avatar string, or null when the value is absent or
// invalid. Never throws. Callers must strip (not reject) on null so one bad
// photo never invalidates the rest of the profile.
export function normalizeAvatar(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string" || !value) return null;
    if (!value.startsWith(AVATAR_DATA_PREFIX)) return null;
    if (value.length > AVATAR_STRING_MAX_CHARS) return null;
    const encoded = value.slice(AVATAR_DATA_PREFIX.length);
    if (!encoded || encoded.length > AVATAR_BASE64_MAX_CHARS) return null;
    if (encoded.length % 4 !== 0) return null;
    if (!BASE64_PATTERN.test(encoded)) return null;
    return value;
}

// Base64 chars needed to transport plaintextBytes through secretbox + base64.
export function ciphertextCharsForPlaintextBytes(
    plaintextBytes: number,
): number {
    return Math.ceil((plaintextBytes + SECRETBOX_OVERHEAD_BYTES) / 3) * 4;
}

// Worst-case envelope size for a profile carrying a max-size avatar:
// 40-char name (4 bytes/char upper bound), full home coordinates, battery,
// and a max-length avatar string. Returns char/byte counts the tester can
// assert against ENVELOPE_* budgets with margin to spare.
export function worstCaseSnapshotEnvelope(): {
    plaintextBytes: number;
    ciphertextChars: number;
    nonceChars: number;
    envelopeBytes: number;
} {
    const profile = {
        name: "X".repeat(40),
        home: { latitude: -90, longitude: -180, radius: 1000 },
        battery: 100,
        avatar: `${AVATAR_DATA_PREFIX}${"A".repeat(AVATAR_BASE64_MAX_CHARS)}`,
    };
    const payload = {
        type: "location",
        latitude: -90,
        longitude: -180,
        accuracy: 123.456,
        recordedAt: "2026-10-03T00:00:00.000Z",
        profile,
    };
    const plaintextBytes = new TextEncoder().encode(
        JSON.stringify(payload),
    ).length;
    const ciphertextChars = ciphertextCharsForPlaintextBytes(plaintextBytes);
    const nonceChars = NONCE_BASE64_CHARS;
    const envelopeBytes = new TextEncoder().encode(
        JSON.stringify({
            version: 1,
            nonce: "N".repeat(nonceChars),
            ciphertext: "C".repeat(ciphertextChars),
        }),
    ).length;
    return { plaintextBytes, ciphertextChars, nonceChars, envelopeBytes };
}
