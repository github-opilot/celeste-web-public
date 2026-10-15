import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

import {
  linkUsernameAndPassword,
  normalizeUsername,
  registerWithUsername,
  sendPasswordRecovery,
  signInWithUsername,
} from '../dist/classic-auth.js';

const PROJECT = new URL('../', import.meta.url);
const USER_ID = 'a3b06c28-8c93-4f80-9d29-b88763a615f1';

async function edgeCore() {
  const source = await readFile(new URL('supabase/functions/_shared/username-login-core.ts', PROJECT), 'utf8');
  const compiled = await transform(source, { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
}

function loginDependencies(overrides = {}) {
  const calls = { lookups: [], verifications: [], limits: [] };
  return {
    calls,
    dependencies: {
      async consumeRateLimits(username, address) {
        calls.limits.push({ username, address });
        return { allowed: true, retryAfterSeconds: 0 };
      },
      async findUserIdByUsername(username) {
        calls.lookups.push(username);
        return username === 'madeline' ? USER_ID : null;
      },
      async getAuthUser(id) {
        calls.userIds = [...(calls.userIds ?? []), id];
        return id === USER_ID ? { email: 'private@example.invalid', emailConfirmed: true } : null;
      },
      async verifyPassword(email, password) {
        calls.verifications.push({ email, password });
        if (email === 'private@example.invalid' && password === 'correct horse battery') {
          return { access_token: 'access-token', refresh_token: 'refresh-token' };
        }
        return null;
      },
      dummyUserId: () => '00000000-0000-4000-8000-000000000000',
      dummyEmail: () => 'missing@example.invalid',
      ...overrides,
    },
  };
}

test('username validation and signup delegate passwords only to Supabase Auth', async () => {
  assert.equal(normalizeUsername('  MaDeLiNe_2 '), 'madeline_2');
  assert.throws(() => normalizeUsername('ab'), /3 à 20/);
  assert.throws(() => normalizeUsername('not valid'), /3 à 20/);

  const calls = [];
  const client = {
    auth: {
      async signUp(input) {
        calls.push(input);
        return { data: { session: null }, error: null };
      },
    },
  };
  const result = await registerWithUsername(client, {
    username: 'Madeline_2',
    email: 'm@example.invalid',
    password: 'a-long-test-password',
    confirmation: 'a-long-test-password',
    emailRedirectTo: 'https://celeste.example/',
  });
  assert.equal(result.session, null);
  assert.deepEqual(calls[0].options.data, { username: 'Madeline_2' });
  assert.equal(calls[0].email, 'm@example.invalid');
  assert.equal(calls[0].password, 'a-long-test-password');
  await assert.rejects(registerWithUsername(client, {
    username: 'Another', email: 'm@example.invalid', password: 'long-enough-password',
    confirmation: 'does-not-match', emailRedirectTo: 'https://celeste.example/',
  }), /ne correspondent pas/);
  assert.equal(calls.length, 1, 'invalid signup data never reaches Auth');
});

test('case-insensitive concurrent username claims have one winner and a generic failure', async () => {
  const claimed = new Set();
  const client = {
    auth: {
      async signUp({ options }) {
        await Promise.resolve();
        const normalized = options.data.username.toLowerCase();
        if (claimed.has(normalized)) return { data: { session: null }, error: { message: 'duplicate key' } };
        claimed.add(normalized);
        return { data: { session: null }, error: null };
      },
    },
  };
  const makeInput = (username) => ({
    username, email: `${username}@example.invalid`, password: 'long-enough-password',
    confirmation: 'long-enough-password', emailRedirectTo: 'https://celeste.example/',
  });
  const outcomes = await Promise.allSettled([
    registerWithUsername(client, makeInput('Madeline')),
    registerWithUsername(client, makeInput('mAdElInE')),
  ]);
  assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejected = outcomes.find(({ status }) => status === 'rejected');
  assert.match(rejected.reason.message, /^Inscription impossible\. Vérifie les informations/);
  assert.doesNotMatch(rejected.reason.message, /pseudo.*pris/i);
});

test('username login sets the returned Supabase session and never needs a browser email', async () => {
  const calls = [];
  const client = {
    functions: {
      async invoke(name, options) {
        calls.push({ name, options });
        return { data: { access_token: 'access', refresh_token: 'refresh' }, error: null };
      },
    },
    auth: {
      async setSession(tokens) { calls.push({ tokens }); return { error: null }; },
    },
  };
  await signInWithUsername(client, 'Madeline', 'password');
  assert.deepEqual(calls, [
    { name: 'username-login', options: { body: { username: 'Madeline', password: 'password' } } },
    { tokens: { access_token: 'access', refresh_token: 'refresh' } },
  ]);
  assert.equal(JSON.stringify(calls).includes('email'), false);
});

test('unknown pseudo and wrong password produce the same response and disclose no email', async () => {
  const { handleUsernameLogin } = await edgeCore();
  const known = loginDependencies();
  const unknown = loginDependencies();
  const [wrongPassword, unknownUsername] = await Promise.all([
    handleUsernameLogin({ username: 'Madeline', password: 'wrong-password' }, 'client-ip', known.dependencies),
    handleUsernameLogin({ username: 'notfound', password: 'wrong-password' }, 'client-ip', unknown.dependencies),
  ]);
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(unknownUsername, wrongPassword);
  assert.equal(JSON.stringify(wrongPassword.body).includes('@'), false);
  assert.equal(known.calls.verifications[0].email, 'private@example.invalid');
  assert.equal(unknown.calls.verifications[0].email, 'missing@example.invalid');

  const successful = loginDependencies();
  const response = await handleUsernameLogin(
    { username: 'Madeline', password: 'correct horse battery' },
    'client-ip', successful.dependencies,
  );
  assert.deepEqual(response.body, { access_token: 'access-token', refresh_token: 'refresh-token' });
  assert.equal(JSON.stringify(response.body).includes('private@example.invalid'), false);
});

test('rate limits stop authentication lookups and return a generic retry response', async () => {
  const { handleUsernameLogin } = await edgeCore();
  const state = loginDependencies({
    async consumeRateLimits() { return { allowed: false, retryAfterSeconds: 120 }; },
  });
  const response = await handleUsernameLogin(
    { username: 'Madeline', password: 'wrong-password' }, 'client-ip', state.dependencies,
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers['Retry-After'], '120');
  assert.equal(state.calls.lookups.length, 0);
  assert.equal(state.calls.verifications.length, 0);
  assert.doesNotMatch(JSON.stringify(response.body), /Madeline|@/);
});

test('GitHub account migration keeps the same Supabase user id and creates no second account', async () => {
  const operations = [];
  const id = await linkUsernameAndPassword({
    async getCurrentUser() {
      operations.push('get-current-user');
      return { id: USER_ID, email: 'github@example.invalid', emailConfirmed: true };
    },
    async updatePassword() { operations.push('update-password'); },
    async updateUsername(userId, username) { operations.push({ userId, username }); },
  }, {
    currentUserId: USER_ID,
    username: 'Madeline',
    password: 'new-long-password',
    confirmation: 'new-long-password',
    addPassword: true,
  });
  assert.equal(id, USER_ID);
  assert.deepEqual(operations, [
    'get-current-user',
    'update-password',
    { userId: USER_ID, username: 'Madeline' },
  ]);
  await assert.rejects(linkUsernameAndPassword({
    async getCurrentUser() { return { id: USER_ID, email: null, emailConfirmed: false }; },
    async updatePassword() { assert.fail('must not change password before email is confirmed'); },
    async updateUsername() { assert.fail('must not claim pseudo before email is confirmed'); },
  }, {
    currentUserId: USER_ID, username: 'Madeline', password: 'new-long-password',
    confirmation: 'new-long-password', addPassword: true,
  }), /confirme une adresse e-mail/);
});

test('password recovery accepts only an absolute return URL and uses Auth', async () => {
  let request;
  await sendPasswordRecovery({ auth: { async resetPasswordForEmail(email, options) {
    request = { email, options };
    return { error: null };
  } } }, 'm@example.invalid', 'https://celeste.example/');
  assert.deepEqual(request, { email: 'm@example.invalid', options: { redirectTo: 'https://celeste.example/' } });
  await assert.rejects(sendPasswordRecovery({ auth: { async resetPasswordForEmail() { assert.fail(); } } }, 'm@example.invalid', '127.0.0.1:8033'), /URL de retour doit être absolue/);
});

test('profile migration enforces unique normalized pseudos and own-row access only', async () => {
  const sql = await readFile(new URL('supabase/username-auth.sql', PROJECT), 'utf8');
  assert.match(sql, /username_normalized text generated always as \(lower\(username\)\) stored/i);
  assert.match(sql, /create unique index if not exists profiles_username_normalized_unique[\s\S]*on public\.profiles \(username_normalized\)/i);
  assert.match(sql, /after insert on auth\.users[\s\S]*execute function public\.create_celeste_profile_for_auth_user/i);
  assert.match(sql, /for select[\s\S]*using \(id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /for update[\s\S]*using \(id = \(select auth\.uid\(\)\)\)[\s\S]*with check \(id = \(select auth\.uid\(\)\)\)/i);
  assert.match(sql, /grant update \(username\) on table public\.profiles to authenticated/i);
  assert.doesNotMatch(sql, /password\s+(?:text|varchar|bytea)/i);
  assert.doesNotMatch(sql, /email\s+(?:text|varchar)/i);
  assert.match(sql, /grant execute on function public\.consume_username_login_limits\(text, text\) to service_role/i);

  const config = await readFile(new URL('supabase/config.toml', PROJECT), 'utf8');
  assert.match(config, /\[functions\.username-login\][\s\S]*verify_jwt = false/);
  const frontend = await readFile(new URL('src/demo/index.html', PROJECT), 'utf8');
  const inlineModules = [...frontend.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
  assert.ok(inlineModules.length >= 1, 'the page should have inline module wiring');
  for (const [, source] of inlineModules) await transform(source, { loader: 'js', format: 'esm' });
  assert.match(frontend, /Se connecter avec GitHub/);
  assert.match(frontend, /id="login-password"[^>]*name="password"[^>]*autocomplete="current-password"/);
  assert.doesNotMatch(frontend, /SUPABASE_SERVICE_ROLE_KEY|sb_secret_/i);

  const edge = await readFile(new URL('supabase/functions/username-login/index.ts', PROJECT), 'utf8');
  await transform(edge, { loader: 'ts', format: 'esm' });
  assert.match(edge, /keyedHash\(hmacSecret/);
  assert.match(edge, /admin\.auth\.admin\.getUserById/);
  assert.match(edge, /passwordAuth\.auth\.signInWithPassword/);
  assert.match(edge, /readJsonBody\(request\)/);
});

