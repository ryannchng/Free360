// Deployed with --no-verify-jwt: validate the user's bearer token explicitly below.
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return new Response('Unauthorized', { status: 401 });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: { user }, error } = await admin.auth.getUser(authorization.slice(7));
  if (error || !user) return new Response('Unauthorized', { status: 401 });
  const { data, error: targetsError } = await admin.rpc('free360_push_targets', { p_user: user.id });
  if (targetsError) return new Response('Not a circle member', { status: 403 });
  if (!data?.length) return Response.json({ sent: 0 });
  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', ...(Deno.env.get('EXPO_ACCESS_TOKEN') ? { Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` } : {}) },
      body: JSON.stringify(data.map(({ token }: { token: string }) => ({ to: token, title: 'Free360 home activity', body: 'Someone in your circle arrived at or left a saved home. Open Free360 for details.', sound: 'default', channelId: 'homes', data: { url: '/activity' } }))),
    });
    const tickets = await response.json();
    if (!response.ok) throw new Error('Push service unavailable');
    const results = Array.isArray(tickets.data) ? tickets.data : [];
    for (let index = 0; index < results.length; index++) {
      if (results[index].details?.error === 'DeviceNotRegistered') await admin.from('free360_push_tokens').delete().eq('token', data[index].token);
    }
    if (results.some((ticket: { status: string }) => ticket.status === 'error')) return Response.json({ error: 'One or more notifications were rejected' }, { status: 502 });
    return Response.json({ accepted: results.length });
  } catch {
    return Response.json({ error: 'Push delivery failed' }, { status: 502 });
  }
});
