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

/** Build the OAuth return URL from Location.origin, which includes the scheme. */
export function createOAuthRedirectUrl(location: OAuthRedirectLocation): string {
  let origin: URL
  try {
    origin = new URL(location.origin)
  } catch {
    throw new Error('URL de retour OAuth invalide : utilise une origine absolue avec http:// ou https://.')
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== location.origin.replace(/\/$/, '')) {
    throw new Error('URL de retour OAuth invalide : utilise une origine absolue avec http:// ou https://.')
  }

  return new URL(location.pathname, origin).href
}

export async function signInWithGitHub(auth: GitHubOAuthPort, redirectTo: string): Promise<void> {
  let redirect: URL
  try {
    redirect = new URL(redirectTo)
  } catch {
    throw new Error('Connexion GitHub impossible : redirectTo doit être une URL absolue avec son protocole.')
  }
  if (!['http:', 'https:'].includes(redirect.protocol) || redirect.origin === 'null') {
    throw new Error('Connexion GitHub impossible : redirectTo doit être une URL absolue avec http:// ou https://.')
  }

  const { error } = await auth.signInWithOAuth({ provider: 'github', options: { redirectTo } })
  if (error) throw new Error(`Connexion GitHub impossible : ${error.message}`)
}

export async function signOutFromSupabase(auth: GitHubOAuthPort): Promise<void> {
  const { error } = await auth.signOut()
  if (error) throw new Error(`Déconnexion impossible : ${error.message}`)
}
