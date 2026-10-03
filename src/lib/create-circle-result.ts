// Pure, dependency-free validation for the create-circle Edge Function result.
// Kept separate from circle.ts so it can be unit-tested without Supabase/Expo.

export function isCreateCircleSuccess(data: unknown): boolean {
  return (
    data !== null &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    (data as Record<string, unknown>).ok === true
  );
}

function sanitizeServerMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 200);
}

export function resolveCreateCircleFailureMessage(payload: unknown, status: number | undefined): string {
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const serverMessage = sanitizeServerMessage((payload as Record<string, unknown>).error);
    if (serverMessage) return serverMessage;
  }
  if (status === 401) return 'This device is not signed in. Reopen the app and try again.';
  if (status === 429) return 'Too many attempts. Wait a bit and try again.';
  if (status === 400) return 'That setup code is not valid. Check the 16 digits and try again.';
  return 'Could not create the circle. Check your group server setup and try again.';
}
