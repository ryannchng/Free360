// Pure, UI-agnostic helpers for member display names, initials, and avatars.
// No React Native imports so this file is unit-testable with plain node.

export type AvatarLike = string | null | undefined | unknown;

/**
 * Derive 1-2 capital initials from a display name.
 * - Trims whitespace and splits on whitespace.
 * - Single word ("Ryan") -> first two letters ("RY"), matching legacy slice(0,2) behaviour.
 * - Two+ words ("Ryan Smith") -> first letter of first two words ("RS").
 * - Empty/blank -> "?" (callers that need a per-index fallback like "M1" handle it explicitly).
 */
export function initialsForName(name: string | null | undefined): string {
  if (typeof name !== 'string') return '?';
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '?';
  const parts = trimmed.split(' ');
  if (parts.length === 1) {
    const word = parts[0];
    const letters = [...word];
    if (letters.length === 1) return letters[0].toUpperCase();
    return (letters[0] + letters[1]).toUpperCase();
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Canonical display name: trimmed name or fallback. */
export function displayNameFor(name: string | null | undefined, fallback = 'Member'): string {
  if (typeof name !== 'string') return fallback;
  const trimmed = name.trim().replace(/\s+/g, ' ');
  return trimmed || fallback;
}

/**
 * Whether a stored avatar value is renderable by RN <Image>.
 * Contract (parallel library lane): DeviceProfile.avatar?: string | null,
 * valid value is a `data:image/jpeg;base64,` compressed square thumbnail (<~5k chars).
 * Be lenient on length here (other lane enforces size); reject empty/malformed/wrong-scheme.
 */
export function isDisplayableAvatar(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32) return false;
  if (!value.startsWith('data:image/')) return false;
  if (!value.includes(';base64,')) return false;
  // Guard against absurd payloads that would blow up lists/markers.
  if (value.length > 100000) return false;
  return true;
}

/** Return the avatar URI when displayable, otherwise null (caller renders initials fallback). */
export function avatarUriFor(value: unknown): string | null {
  return isDisplayableAvatar(value) ? (value as string) : null;
}

/** Extract a displayable avatar from a profile-like object without depending on circle.ts types. */
export function avatarForProfile(profile: { avatar?: unknown } | null | undefined): string | null {
  if (!profile || typeof profile !== 'object') return null;
  return avatarUriFor((profile as { avatar?: unknown }).avatar ?? null);
}
