import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleUsernameLogin } from '../_shared/username-login-core.ts'

const responseHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  Vary: 'Origin',
}

function jsonResponse(
  request: Request,
  status: number,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = new Headers({ ...responseHeaders, ...extraHeaders })
  const origin = request.headers.get('origin')
  if (origin) headers.set('Access-Control-Allow-Origin', origin)
  else headers.set('Access-Control-Allow-Origin', '*')
  return new Response(JSON.stringify(body), { status, headers })
}

function configuredOrigins(): Set<string> {
  const configured = Deno.env.get('USERNAME_LOGIN_ALLOWED_ORIGINS') ?? ''
  const origins = new Set<string>()
  for (const value of configured.split(',')) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const parsed = new URL(trimmed)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== trimmed) {
      throw new Error('USERNAME_LOGIN_ALLOWED_ORIGINS must contain origins only')
    }
    origins.add(parsed.origin)
  }
  return origins
}

function configuredKey(variable: string, legacyVariable: string): string | null {
  const keyed = Deno.env.get(variable)
  if (keyed) {
    try {
      const values = JSON.parse(keyed) as Record<string, string>
      return values.default ?? Object.values(values)[0] ?? null
    } catch {
      return null
    }
  }
  return Deno.env.get(legacyVariable) ?? null
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function keyedHash(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))))
}

function clientAddress(request: Request): string {
  // Prefer the edge proxy's single-address headers; use the last forwarded hop
  // as a fallback because it is the hop appended by the nearest proxy.
  const address = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim()
  return address || 'unknown-client-address'
}

async function readJsonBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('missing request body')

  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 8_192) {
      await reader.cancel()
      throw new Error('request body too large')
    }
    chunks.push(value)
  }

  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(body))
}

Deno.serve(async (request) => {
  let origins: Set<string>
  try {
    origins = configuredOrigins()
  } catch {
    console.error('[username-login] invalid allowed-origin configuration')
    return jsonResponse(request, 503, { code: 'SERVICE_UNAVAILABLE', error: 'Connexion temporairement indisponible.' })
  }

  const origin = request.headers.get('origin')
  if (!origins.size || !origin || !origins.has(origin)) {
    return jsonResponse(request, 403, { error: 'Origine non autorisée.' })
  }
  if (request.method === 'OPTIONS') {
    const headers = new Headers(responseHeaders)
    if (origin) headers.set('Access-Control-Allow-Origin', origin)
    else headers.set('Access-Control-Allow-Origin', '*')
    return new Response(null, { status: 204, headers })
  }
  if (request.method !== 'POST') {
    return jsonResponse(request, 405, { error: 'Méthode non autorisée.' }, { Allow: 'POST, OPTIONS' })
  }

  const projectUrl = Deno.env.get('SUPABASE_URL')
  const publishableKey = configuredKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  const secretKey = configuredKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  const hmacSecret = Deno.env.get('USERNAME_LOGIN_HMAC_SECRET')
  if (!projectUrl || !publishableKey || !secretKey || !hmacSecret) {
    console.error('[username-login] required server configuration is missing')
    return jsonResponse(request, 503, { code: 'SERVICE_UNAVAILABLE', error: 'Connexion temporairement indisponible.' })
  }

  let payload: unknown
  try {
    const declaredLength = Number(request.headers.get('content-length') ?? '0')
    if (declaredLength > 8_192) throw new Error('request too large')
    payload = await readJsonBody(request)
  } catch {
    return jsonResponse(request, 400, { error: 'Requête invalide.' })
  }

  try {
    const address = clientAddress(request)
    const admin = createClient(projectUrl, secretKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    })
    const passwordAuth = createClient(projectUrl, publishableKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    })

    const result = await handleUsernameLogin(payload, address, {
      async consumeRateLimits(username, ip) {
        const identifier = username ?? 'invalid-username'
        const [identifierHash, ipHash] = await Promise.all([
          keyedHash(hmacSecret, `username:${identifier}\n${ip}`),
          keyedHash(hmacSecret, `ip:${ip}`),
        ])
        const { data, error } = await admin.rpc('consume_username_login_limits', {
          p_identifier_hash: identifierHash,
          p_ip_hash: ipHash,
        })
        if (error) throw error
        const row = Array.isArray(data) ? data[0] : data
        if (!row || typeof row.allowed !== 'boolean') throw new Error('rate limit response unavailable')
        return { allowed: row.allowed, retryAfterSeconds: Number(row.retry_after_seconds) || 0 }
      },
      async findUserIdByUsername(username) {
        const { data, error } = await admin
          .from('profiles')
          .select('id')
          .eq('username_normalized', username)
          .maybeSingle()
        if (error) throw error
        return data?.id ?? null
      },
      async getAuthUser(userId) {
        const { data, error } = await admin.auth.admin.getUserById(userId)
        if (error) {
          if (error.status === 404) return null
          throw error
        }
        const user = data.user
        return {
          email: user.email ?? null,
          emailConfirmed: Boolean(user.email_confirmed_at),
        }
      },
      async verifyPassword(email, password) {
        const { data, error } = await passwordAuth.auth.signInWithPassword({ email, password })
        if (error) return null
        if (!data.session) return null
        return {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        }
      },
      dummyUserId: () => crypto.randomUUID(),
      dummyEmail: () => `missing-${crypto.randomUUID()}@invalid.example`,
    })

    return jsonResponse(request, result.status, result.body, result.headers)
  } catch (error) {
    console.error('[username-login] request failed', error instanceof Error ? error.name : 'unknown')
    return jsonResponse(request, 503, {
      code: 'SERVICE_UNAVAILABLE',
      error: 'Connexion temporairement indisponible. Réessaie plus tard.',
    })
  }
})
