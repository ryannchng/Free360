// Managed Supabase circle creation endpoint.
//
// Deploy with JWT verification DISABLED; this handler validates the caller's
// bearer token explicitly with Supabase Auth below:
//
//   npx supabase login
//   npx supabase link --project-ref YOUR_PROJECT_REF
//   npx supabase functions deploy create-circle --no-verify-jwt
//
// Contract (client: src/lib/circle.ts via functions.invoke('create-circle'),
// result mapping: src/lib/create-circle-result.ts):
//   POST JSON { circleId: "<uuid>", setupCode: "<16 digits; spaces/dashes ok>" }
//   Authorization: Bearer <the device's Supabase session JWT>
//   -> 200 { ok: true }
//   -> 400 { error: "Invalid setup code" | "Setup code expired"
//                  | "Setup code already used" | "Invalid request" }
//   -> 401 { error: "Unauthorized" }
//   -> 409 { error: "This device already belongs to a circle" }
//   -> 429 { error: "Too many attempts, try again later" }
//   -> 405/500 sanitized JSON errors.
//
// The Auth user id verified from the bearer token is the ONLY identity used
// (p_user). A client-supplied user id is never accepted. Per-user and
// project-wide rate limits are enforced persistently in Postgres, so they hold
// across function instances. Client IP headers (e.g. X-Forwarded-For) are NOT
// trusted for security decisions because they are client-controlled and no
// Edge Function request header is documented as unspoofable (see README.md).
// Nothing secret is logged: error paths return generic messages and the raw
// setup code, tokens, and IPs never reach the logs.
import { createClient } from 'npm:@supabase/supabase-js@2';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SETUP_CODE_LENGTH = 64;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const authorization = request.headers.get('Authorization');
  if (!authorization || !authorization.startsWith('Bearer ')) return json(401, { error: 'Unauthorized' });
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: 'Unable to create circle' });
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: { user }, error: authError } = await admin.auth.getUser(authorization.slice('Bearer '.length));
  if (authError || !user) return json(401, { error: 'Unauthorized' });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Invalid request' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Invalid request' });
  const record = body as Record<string, unknown>;
  const circleId = record.circleId;
  const setupCode = record.setupCode;
  if (typeof circleId !== 'string' || !UUID_PATTERN.test(circleId)) return json(400, { error: 'Invalid request' });
  if (typeof setupCode !== 'string' || setupCode.length === 0 || setupCode.length > MAX_SETUP_CODE_LENGTH) {
    return json(400, { error: 'Invalid request' });
  }
  let status: string | null = null;
  try {
    const { data, error: rpcError } = await admin.rpc('free360_redeem_setup_code', {
      p_user: user.id,
      p_circle_id: circleId,
      p_setup_code: setupCode,
    });
    if (rpcError) throw rpcError;
    status = typeof data === 'string' ? data : null;
  } catch {
    return json(500, { error: 'Unable to create circle' });
  }
  switch (status) {
    case 'ok': return json(200, { ok: true });
    case 'invalid': return json(400, { error: 'Invalid setup code' });
    case 'expired': return json(400, { error: 'Setup code expired' });
    case 'used': return json(400, { error: 'Setup code already used' });
    case 'rate_limited_user':
    case 'rate_limited_global': return json(429, { error: 'Too many attempts, try again later' });
    case 'already_member': return json(409, { error: 'This device already belongs to a circle' });
    case 'invalid_request': return json(400, { error: 'Invalid request' });
    default: return json(500, { error: 'Unable to create circle' });
  }
});
