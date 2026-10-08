// Helpers for the managed Supabase 16-digit group setup code.
//
// The code is always handled as a string so leading zeros are retained.
// Normalization removes ONLY ASCII spaces and hyphens (comfortable typing,
// grouping, and paste). Every other character is preserved so validation
// fails visibly instead of silently discarding invalid input.

export const SETUP_CODE_LENGTH = 16;

// Bounded input length for the grouped Supabase entry field. Deliberately
// larger than the 19 chars of a valid grouped code so an overlong paste is
// kept (and stays invalid) instead of being truncated into a valid code.
export const SETUP_CODE_INPUT_MAX_LENGTH = 32;

const GROUP_SEPARATOR_PATTERN = /[ \-]/g;

export function normalizeSetupCode(value: string): string {
    return value.replace(GROUP_SEPARATOR_PATTERN, "");
}

export function isSetupCodeValid(value: string): boolean {
    return /^[0-9]{16}$/.test(normalizeSetupCode(value));
}

export function formatSetupCode(value: string): string {
    const normalized = normalizeSetupCode(value);
    if (!normalized) return "";
    return normalized.replace(/(.{4})(?=.)/g, "$1 ");
}
