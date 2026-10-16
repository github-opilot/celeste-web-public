import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PROJECT = new URL('../', import.meta.url);

test('the app exposes GitHub OAuth only and contains no password-auth UI or calls', async () => {
  const html = await readFile(new URL('src/demo/index.html', PROJECT), 'utf8');
  assert.match(html, /id="auth-github"[^>]*>Continue with GitHub/);
  assert.match(html, /id="cloud-sign-in">Sign in with GitHub/);
  assert.match(html, /isGitHubUser\(user\)/);
  assert.doesNotMatch(html, /username-login|auth\.signInWithPassword|auth\.signUp|resetPasswordForEmail|updateUser\(\{\s*password/);
  assert.doesNotMatch(html, /type="password"|autocomplete="username"|Create account|Forgot password/i);
});

test('the old username-login endpoint can only be deployed as a retired 410 response', async () => {
  const edge = await readFile(new URL('supabase/functions/username-login/index.ts', PROJECT), 'utf8');
  assert.match(edge, /status:\s*410/);
  assert.match(edge, /sign-in has been removed/i);
  assert.doesNotMatch(edge, /signInWithPassword|handleUsernameLogin|SUPABASE_SERVICE_ROLE_KEY|readJsonBody/);
});

test('legacy cleanup removes username-login helpers without deleting saved profile rows', async () => {
  const sql = await readFile(new URL('supabase/disable-username-auth.sql', PROJECT), 'utf8');
  assert.match(sql, /drop trigger if exists on_auth_user_created_celeste_profile/i);
  assert.match(sql, /drop function if exists public\.consume_username_login_limits/i);
  assert.doesNotMatch(sql, /drop table if exists public\.profiles/i);

  const config = await readFile(new URL('supabase/config.toml', PROJECT), 'utf8');
  assert.match(config, /\[functions\.username-login\][\s\S]*verify_jwt = false/);
});
