// Keep this retired endpoint as a safe deployment target for projects that
// previously exposed username/password login. Deploying it immediately makes
// the legacy route return Gone; it no longer reads credentials or Auth data.
Deno.serve(() => new Response(
  JSON.stringify({ error: 'Username and password sign-in has been removed. Use GitHub sign-in.' }),
  {
    status: 410,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  },
))
