export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/
export const MIN_PASSWORD_LENGTH = 12

export interface AuthError {
  message: string
  code?: string
  context?: unknown
}

export interface UsernameLoginClient {
  functions: {
    invoke(name: 'username-login', options: { body: { username: string; password: string } }): Promise<{
      data: unknown
      error: AuthError | null
    }>
  }
  auth: {
    setSession(tokens: { access_token: string; refresh_token: string }): Promise<{ error: AuthError | null }>
  }
}

export interface UsernameSignupClient {
  auth: {
    signUp(input: {
      email: string
      password: string
      options: { data: { username: string }; emailRedirectTo: string }
    }): Promise<{ data: { session: unknown }; error: AuthError | null }>
  }
}

export interface PasswordRecoveryClient {
  auth: {
    resetPasswordForEmail(email: string, options: { redirectTo: string }): Promise<{ error: AuthError | null }>
  }
}

export interface AccountLinkUser {
  id: string
  email: string | null
  emailConfirmed: boolean
}

export interface AccountLinkPort {
  getCurrentUser(): Promise<AccountLinkUser | null>
  updateUsername(userId: string, username: string): Promise<void>
  updatePassword(password: string): Promise<void>
}

function absoluteWebUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('L’URL de retour doit être absolue et inclure http:// ou https://.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin === 'null') {
    throw new Error('L’URL de retour doit être absolue et inclure http:// ou https://.')
  }
  return url
}

export function normalizeUsername(input: string): string {
  const username = input.trim()
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('Le pseudo doit contenir 3 à 20 caractères : lettres, chiffres ou tiret bas.')
  }
  return username.toLowerCase()
}

function validatePasswordPair(password: string, confirmation: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`)
  }
  if (password !== confirmation) throw new Error('Les deux mots de passe ne correspondent pas.')
}

export async function registerWithUsername(
  client: UsernameSignupClient,
  input: { username: string; email: string; password: string; confirmation: string; emailRedirectTo: string },
): Promise<{ session: unknown }> {
  const username = input.username.trim()
  normalizeUsername(username)
  validatePasswordPair(input.password, input.confirmation)
  absoluteWebUrl(input.emailRedirectTo)
  const email = input.email.trim()
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Saisis une adresse e-mail valide pour récupérer ton compte.')

  const { data, error } = await client.auth.signUp({
    email,
    password: input.password,
    options: { data: { username }, emailRedirectTo: input.emailRedirectTo },
  })
  if (error) {
    // A trigger and a case-insensitive unique index arbitrate simultaneous claims.
    // Keep the response generic so registration cannot be used to enumerate users.
    throw new Error('Inscription impossible. Vérifie les informations et réessaie.')
  }
  return { session: data.session }
}

export async function signInWithUsername(
  client: UsernameLoginClient,
  usernameInput: string,
  password: string,
): Promise<void> {
  const username = usernameInput.trim()
  normalizeUsername(username)
  if (!password) throw new Error('Identifiant ou mot de passe invalide.')

  const { data, error } = await client.functions.invoke('username-login', {
    body: { username, password },
  })
  const tokens = data as { access_token?: unknown; refresh_token?: unknown } | null
  if (error || typeof tokens?.access_token !== 'string' || typeof tokens.refresh_token !== 'string') {
    const status = error?.context && typeof error.context === 'object'
      ? (error.context as { status?: unknown }).status
      : undefined
    if (error?.code === 'RATE_LIMITED' || status === 429) {
      throw new Error('Trop de tentatives. Réessaie dans quelques minutes.')
    }
    if (error?.code === 'SERVICE_UNAVAILABLE' || status === 503) {
      throw new Error('Connexion temporairement indisponible. Réessaie plus tard.')
    }
    throw new Error('Identifiant ou mot de passe invalide.')
  }

  const { error: sessionError } = await client.auth.setSession({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  })
  if (sessionError) throw new Error('Connexion temporairement indisponible. Réessaie plus tard.')
}

export async function sendPasswordRecovery(
  client: PasswordRecoveryClient,
  emailInput: string,
  redirectTo: string,
): Promise<void> {
  const email = emailInput.trim()
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Saisis l’adresse e-mail associée au compte.')
  absoluteWebUrl(redirectTo)
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo })
  if (error) throw new Error('Impossible d’envoyer le lien de récupération. Réessaie plus tard.')
}

export async function linkUsernameAndPassword(
  account: AccountLinkPort,
  input: { currentUserId: string; username: string; password: string; confirmation: string; addPassword: boolean },
): Promise<string> {
  const username = input.username.trim()
  normalizeUsername(username)
  if (input.addPassword) validatePasswordPair(input.password, input.confirmation)

  const user = await account.getCurrentUser()
  if (!user || user.id !== input.currentUserId) {
    throw new Error('La session a changé. Reconnecte-toi puis réessaie.')
  }
  if (input.addPassword && (!user.email || !user.emailConfirmed)) {
    throw new Error('Ajoute et confirme une adresse e-mail dans ton compte avant d’activer le mot de passe.')
  }

  // The current Auth user id is preserved, so this account keeps its cloud saves.
  if (input.addPassword) await account.updatePassword(input.password)
  await account.updateUsername(user.id, username)
  return user.id
}
