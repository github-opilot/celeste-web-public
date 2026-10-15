export interface LoginSessionTokens {
  access_token: string
  refresh_token: string
}

export interface LoginDependencies {
  consumeRateLimits(username: string | null, clientAddress: string): Promise<{
    allowed: boolean
    retryAfterSeconds: number
  }>
  findUserIdByUsername(username: string): Promise<string | null>
  getAuthUser(userId: string): Promise<{ email: string | null; emailConfirmed: boolean } | null>
  verifyPassword(email: string, password: string): Promise<LoginSessionTokens | null>
  dummyUserId(): string
  dummyEmail(): string
}

export interface LoginResponse {
  status: number
  headers?: Record<string, string>
  body: Record<string, unknown>
}

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/
const INVALID_CREDENTIALS = { code: 'INVALID_CREDENTIALS', error: 'Identifiant ou mot de passe invalide.' }

/**
 * Shared, dependency-injected login flow. It returns identical responses for an
 * unknown pseudo and an incorrect password, and never puts an email in a response.
 */
export async function handleUsernameLogin(
  payload: unknown,
  clientAddress: string,
  dependencies: LoginDependencies,
): Promise<LoginResponse> {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const rawUsername = typeof body.username === 'string' ? body.username.trim() : ''
  const normalized = USERNAME_PATTERN.test(rawUsername) ? rawUsername.toLowerCase() : null
  const rawPassword = typeof body.password === 'string' ? body.password : ''
  const passwordValid = rawPassword.length > 0 && rawPassword.length <= 256
  const password = passwordValid ? rawPassword : 'invalid-login-attempt'

  try {
    const limit = await dependencies.consumeRateLimits(normalized, clientAddress)
    if (!limit.allowed) {
      return {
        status: 429,
        headers: { 'Retry-After': String(Math.max(1, limit.retryAfterSeconds)) },
        body: { code: 'RATE_LIMITED', error: 'Trop de tentatives. Réessaie dans quelques minutes.' },
      }
    }

    const userId = normalized ? await dependencies.findUserIdByUsername(normalized) : null
    // Do the same Auth lookup and password verification for unknown pseudos.
    const authUser = await dependencies.getAuthUser(userId ?? dependencies.dummyUserId())
    const email = authUser?.emailConfirmed && authUser.email ? authUser.email : null
    const tokens = await dependencies.verifyPassword(email ?? dependencies.dummyEmail(), password)

    if (!normalized || !passwordValid || !userId || !email || !tokens) {
      return { status: 401, body: INVALID_CREDENTIALS }
    }

    return {
      status: 200,
      body: { access_token: tokens.access_token, refresh_token: tokens.refresh_token },
    }
  } catch {
    return {
      status: 503,
      body: { code: 'SERVICE_UNAVAILABLE', error: 'Connexion temporairement indisponible. Réessaie plus tard.' },
    }
  }
}
