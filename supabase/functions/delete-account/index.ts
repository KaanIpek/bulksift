/**
 * Delete the signed-in user, and everything that cascades from them.
 *
 * This exists because a user cannot delete themselves with an anon key, and it
 * has to exist because App Review rejects any app that can create an account
 * but not remove one. The app calls it from Settings > Account > Delete
 * account; without it that row fails and the app is not submittable.
 *
 * Deploy:
 *   supabase functions deploy delete-account
 *
 * SUPABASE_SERVICE_ROLE_KEY is injected by the platform. It must never reach
 * the app - it bypasses row-level security entirely, which is exactly why the
 * deletion happens here and not on the phone.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = Deno.env.get('SUPABASE_URL');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !service || !anon) return json({ error: 'Not configured.' }, 500);

  /*
   * Who is asking is decided by their own token, never by the request body.
   * Taking a user id from the body would let any signed-in user delete any
   * other one - the service role does not check, which is the whole point of it.
   */
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Not signed in.' }, 401);

  const asUser = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: me, error: whoError } = await asUser.auth.getUser();
  if (whoError || !me?.user) return json({ error: 'Not signed in.' }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });

  /*
   * Rows first, then the account.
   *
   * `collections.user_id` is declared `on delete cascade`, so deleting the user
   * would take the rows with it - but only if that constraint is actually in
   * place, and a missing cascade would leave a stranger's data behind under a
   * recycled id. Deleting explicitly costs one statement and does not depend on
   * a schema detail being right.
   */
  const { error: rowsError } = await admin
    .from('collections')
    .delete()
    .eq('user_id', me.user.id);
  if (rowsError) return json({ error: rowsError.message }, 500);

  const { error: userError } = await admin.auth.admin.deleteUser(me.user.id);
  if (userError) return json({ error: userError.message }, 500);

  return json({ ok: true });
});
