export interface GitHubOAuthPort {
  signInWithOAuth(input: {
    provider: 'github'
    options: { redirectTo: string }
  }): Promise<{ error: { message: string } | null }>
  signOut(): Promise<{ error: { message: string } | null }>
}

export interface OAuthRedirectLocation {
  origin: string
  pathname: string
}

export interface SupabaseAuthUserLike {
  app_metadata?: { provider?: unknown; providers?: unknown }
  identities?: Array<{ provider?: unknown }>
}

/** Only GitHub-linked Supabase sessions may use this app's cloud features. */
export function isGitHubUser(user: SupabaseAuthUserLike | null | undefined): boolean {
  if (!user) return false
  if (user.app_metadata?.provider === 'github') return true
  if (Array.isArray(user.app_metadata?.providers) && user.app_metadata.providers.includes('github')) return true
  return Array.isArray(user.identities) && user.identities.some((identity) => identity?.provider === 'github')
}

/** Build the OAuth return URL from Location.origin, which includes the scheme. */
export function createOAuthRedirectUrl(location: OAuthRedirectLocation): string {
  let origin: URL
  try {
    origin = new URL(location.origin)
  } catch {
    throw new Error('Invalid OAuth redirect URL: use an absolute origin with http:// or https://.')
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== location.origin.replace(/\/$/, '')) {
    throw new Error('Invalid OAuth redirect URL: use an absolute origin with http:// or https://.')
  }

  return new URL(location.pathname, origin).href
}

export async function signInWithGitHub(auth: GitHubOAuthPort, redirectTo: string): Promise<void> {
  let redirect: URL
  try {
    redirect = new URL(redirectTo)
  } catch {
    throw new Error('Could not sign in with GitHub: redirectTo must be an absolute URL with a protocol.')
  }
  if (!['http:', 'https:'].includes(redirect.protocol) || redirect.origin === 'null') {
    throw new Error('Could not sign in with GitHub: redirectTo must be an absolute URL with http:// or https://.')
  }

  const { error } = await auth.signInWithOAuth({ provider: 'github', options: { redirectTo } })
  if (error) throw new Error(`Could not sign in with GitHub: ${error.message}`)
}

export async function signOutFromSupabase(auth: GitHubOAuthPort): Promise<void> {
  const { error } = await auth.signOut()
  if (error) throw new Error(`Could not sign out: ${error.message}`)
}
