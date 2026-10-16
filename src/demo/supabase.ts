import { createClient } from '@supabase/supabase-js'
import { CloudSaveService, createBrowserCloudSaveRepository } from './cloud-saves.js'
import { createOAuthRedirectUrl, isGitHubUser, signInWithGitHub, signOutFromSupabase } from './cloud-auth.js'

declare const __SUPABASE_URL__: string
declare const __SUPABASE_PUBLISHABLE_KEY__: string

export const supabaseConfigured = Boolean(__SUPABASE_URL__ && __SUPABASE_PUBLISHABLE_KEY__)

export function createSupabaseClient() {
  if (!supabaseConfigured) return null
  return createClient(__SUPABASE_URL__, __SUPABASE_PUBLISHABLE_KEY__, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      persistSession: true,
    },
  })
}

export { CloudSaveService, createBrowserCloudSaveRepository, inspectSaveArchive } from './cloud-saves.js'
export { createOAuthRedirectUrl, isGitHubUser, signInWithGitHub, signOutFromSupabase }
