import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transform } from 'esbuild';

import { CloudSaveService, inspectSaveArchive } from '../dist/cloud-saves.js';
import { createOAuthRedirectUrl, signInWithGitHub, signOutFromSupabase } from '../dist/cloud-auth.js';
import { tarStream } from '../dist/celeste/celeste.tar.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

async function syntheticArchive(text = '') {
  const entries = text
    ? [{ path: '0.celeste', size: new TextEncoder().encode(text).byteLength, body: async () => new Blob([text]).stream() }]
    : [];
  const tar = await new Response(tarStream(entries)).blob();
  return new Response(tar.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

function memoryRepository() {
  const pending = new Map();
  const states = new Map();
  const backups = [];
  return {
    pending,
    states,
    backups,
    async getPending(userId) { return pending.get(userId) ?? []; },
    async putPending(snapshot) {
      const queue = pending.get(snapshot.userId) ?? [];
      if (!queue.some((item) => item.contentHash === snapshot.contentHash)) queue.push(snapshot);
      pending.set(snapshot.userId, queue);
    },
    async clearPending(userId, hash) {
      const queue = (pending.get(userId) ?? []).filter((item) => item.archiveSha256 !== hash);
      if (queue.length) pending.set(userId, queue);
      else pending.delete(userId);
    },
    async getSyncState(userId) { return states.get(userId) ?? null; },
    async putSyncState(state) { states.set(state.userId, state); },
    async putSafetyBackup(backup) { backups.push(backup); },
    async getLatestSafetyBackup(userId) {
      return backups.filter((backup) => backup.userId === userId).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0] ?? null;
    },
  };
}

function memoryStorage() {
  const objects = new Map();
  const requests = [];
  return {
    objects,
    requests,
    forUser(authenticatedUserId) {
      return {
        from(bucket) {
          assert.equal(bucket, 'celeste-saves');
          return {
            async upload(path, blob, options) {
              requests.push({ operation: 'upload', user: authenticatedUserId, path, options });
              if (path.split('/')[0] !== authenticatedUserId) return { error: { message: 'RLS denied' } };
              if (options.upsert !== false || objects.has(path)) return { error: { message: 'Duplicate object' } };
              objects.set(path, blob);
              return { error: null };
            },
            async list(path) {
              requests.push({ operation: 'list', user: authenticatedUserId, path });
              if (path !== authenticatedUserId) return { data: [], error: null };
              return {
                data: [...objects.keys()]
                  .filter((key) => key.startsWith(`${authenticatedUserId}/`))
                  .map((key) => ({ name: key.slice(authenticatedUserId.length + 1) }))
                  .sort((a, b) => b.name.localeCompare(a.name)),
                error: null,
              };
            },
            async download(path) {
              requests.push({ operation: 'download', user: authenticatedUserId, path });
              if (path.split('/')[0] !== authenticatedUserId) return { data: null, error: { message: 'RLS denied' } };
              const data = objects.get(path);
              return data ? { data, error: null } : { data: null, error: { message: 'Not found' } };
            },
          };
        },
      };
    },
  };
}

function mutableSdk(initialArchive) {
  let localArchive = initialArchive;
  let imports = 0;
  let repository = null;
  return {
    get imports() { return imports; },
    setRepository(value) { repository = value; },
    setLocalArchive(value) { localArchive = value; },
    async exportSaves() { return localArchive.stream(); },
    async importSaves(archive) {
      assert.ok(repository.backups.length > 0, 'safety copy exists before import');
      localArchive = archive;
      imports++;
      return 1;
    },
  };
}

function service(storage, sdk, repository, userId) {
  return new CloudSaveService(storage.forUser(userId), sdk, repository);
}

test('GitHub auth actions use the callback URL and expose sign-out errors', async () => {
  const calls = [];
  const auth = {
    async signInWithOAuth(input) { calls.push(input); return { error: null }; },
    async signOut() { calls.push('signOut'); return { error: null }; },
  };
  await signInWithGitHub(auth, 'https://celeste.example/auth/callback');
  await signOutFromSupabase(auth);
  assert.deepEqual(calls, [
    { provider: 'github', options: { redirectTo: 'https://celeste.example/auth/callback' } },
    'signOut',
  ]);
  await assert.rejects(signOutFromSupabase({ ...auth, async signOut() { return { error: { message: 'denied' } }; } }), /denied/);
});

test('OAuth redirects always include an absolute HTTP(S) scheme', async () => {
  assert.equal(
    createOAuthRedirectUrl({ origin: 'http://127.0.0.1:8033', pathname: '/' }),
    'http://127.0.0.1:8033/',
  );
  assert.equal(
    createOAuthRedirectUrl({ origin: 'https://celeste.example', pathname: '/play/' }),
    'https://celeste.example/play/',
  );
  assert.throws(
    () => createOAuthRedirectUrl({ origin: '127.0.0.1:8033', pathname: '/' }),
    /origine absolue/,
  );

  let called = false;
  await assert.rejects(signInWithGitHub({
    async signInWithOAuth() { called = true; return { error: null }; },
    async signOut() { return { error: null }; },
  }, '127.0.0.1:8033'), /URL absolue/);
  assert.equal(called, false, 'invalid redirect must be rejected before calling Supabase');
});

test('synthetic save archives are parsed and hashed before use', async () => {
  const archive = await syntheticArchive('chapter=3;strawberries=12');
  const inspected = await inspectSaveArchive(archive);
  assert.equal(inspected.fileCount, 1);
  assert.match(inspected.archiveSha256, /^[a-f\d]{64}$/);
  assert.match(inspected.contentHash, /^[a-f\d]{64}$/);
  await assert.rejects(inspectSaveArchive(new Blob(['not a tar'])), /archive|tar/i);
});

test('cloud saves append immutable versions in the authenticated user folder', async () => {
  const storage = memoryStorage();
  const repository = memoryRepository();
  const archive = await syntheticArchive('chapter=1');
  const sdk = mutableSdk(archive);
  const saves = service(storage, sdk, repository, USER_A);

  const first = await saves.saveNow(USER_A);
  assert.equal(first.status, 'saved');
  assert.equal(first.alreadyPresent, false);
  assert.equal(storage.objects.size, 1);
  assert.equal([...storage.objects.keys()][0].split('/')[0], USER_A);
  assert.equal(storage.requests.find((item) => item.operation === 'upload').options.upsert, false);
  assert.equal(repository.pending.size, 0);

  const duplicate = await saves.saveNow(USER_A);
  assert.equal(duplicate.status, 'saved');
  assert.equal(duplicate.alreadyPresent, true);
  assert.equal(storage.objects.size, 1);

  sdk.setLocalArchive(await syntheticArchive('chapter=2'));
  const second = await saves.saveNow(USER_A);
  assert.equal(second.status, 'saved');
  assert.equal(storage.objects.size, 2, 'the previous cloud version remains stored');
});

test('offline saves stay queued and resume when the connection returns', async () => {
  const storage = memoryStorage();
  const repository = memoryRepository();
  const sdk = mutableSdk(await syntheticArchive('offline-progress'));
  const saves = service(storage, sdk, repository, USER_A);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  try {
    const queued = await saves.saveNow(USER_A);
    assert.equal(queued.status, 'queued');
    assert.equal(repository.pending.has(USER_A), true);
    sdk.setLocalArchive(await syntheticArchive('offline-progress-next'));
    const secondQueued = await saves.saveNow(USER_A);
    assert.equal(secondQueued.status, 'queued');
    assert.equal(repository.pending.get(USER_A).length, 2, 'offline versions are appended, not replaced');
    assert.equal(storage.objects.size, 0);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    const resumed = await saves.flushPending(USER_A);
    assert.equal(resumed.status, 'saved');
    assert.equal(repository.pending.has(USER_A), false);
    assert.equal(storage.objects.size, 2);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
});

test('a second browser can restore the same user archive after a safety copy', async () => {
  const storage = memoryStorage();
  const ownerRepo = memoryRepository();
  const ownerSdk = mutableSdk(await syntheticArchive('chapter=5'));
  const owner = service(storage, ownerSdk, ownerRepo, USER_A);
  await owner.saveNow(USER_A);

  const browserRepo = memoryRepository();
  const browserSdk = mutableSdk(await syntheticArchive());
  browserSdk.setRepository(browserRepo);
  const otherBrowser = service(storage, browserSdk, browserRepo, USER_A);
  const versions = await otherBrowser.listVersions(USER_A);
  assert.equal(versions.length, 1);
  const restored = await otherBrowser.restore(USER_A, versions[0].name, async () => true);
  assert.equal(restored.status, 'restored');
  assert.equal(restored.restoredFiles, 1);
  assert.equal(browserRepo.backups.length, 1);
  assert.equal(browserSdk.imports, 1);
});

test('a changed local save is a conflict and cannot restore without confirmation', async () => {
  const storage = memoryStorage();
  const repository = memoryRepository();
  const sdk = mutableSdk(await syntheticArchive('synced-local'));
  sdk.setRepository(repository);
  const saves = service(storage, sdk, repository, USER_A);
  await saves.saveNow(USER_A);
  const version = (await saves.listVersions(USER_A))[0];
  sdk.setLocalArchive(await syntheticArchive('newer-local-progress'));

  let confirmation = null;
  const cancelled = await saves.restore(USER_A, version.name, (details) => {
    confirmation = details;
    return false;
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(confirmation.localChangedSinceLastSync, true);
  assert.equal(sdk.imports, 0);
  assert.equal(repository.backups.length, 0);

  const accepted = await saves.restore(USER_A, version.name, () => true);
  assert.equal(accepted.status, 'restored');
  assert.equal(repository.backups.length, 1);
  assert.equal(sdk.imports, 1);
});

test('tampered cloud archives fail integrity validation before backup or import', async () => {
  const storage = memoryStorage();
  const repository = memoryRepository();
  const sdk = mutableSdk(await syntheticArchive());
  sdk.setRepository(repository);
  const saves = service(storage, sdk, repository, USER_A);
  await saves.saveNow(USER_A);
  const version = (await saves.listVersions(USER_A))[0];
  const objectPath = `${USER_A}/${version.name}`;
  storage.objects.set(objectPath, await syntheticArchive('tampered'));

  await assert.rejects(saves.restore(USER_A, version.name, () => true), /intégrité|SHA-256/i);
  assert.equal(repository.backups.length, 0);
  assert.equal(sdk.imports, 0);
});

test('another authenticated user cannot list or restore this user’s versions', async () => {
  const storage = memoryStorage();
  const repoA = memoryRepository();
  const savesA = service(storage, mutableSdk(await syntheticArchive('private')), repoA, USER_A);
  await savesA.saveNow(USER_A);
  const repoB = memoryRepository();
  const savesB = service(storage, mutableSdk(await syntheticArchive()), repoB, USER_B);

  assert.equal((await savesB.listVersions(USER_B)).length, 0);
  const privateName = (await savesA.listVersions(USER_A))[0].name;
  await assert.rejects(savesB.restore(USER_B, privateName, () => true), /n’existe plus/);
  assert.ok(storage.requests.filter((item) => item.user === USER_B).every((item) => item.path === USER_B));
});

test('the UI exposes cloud controls, validates before restoring, and RLS grants only owner read/insert', async () => {
  const html = readFileSync(new URL('../src/demo/index.html', import.meta.url), 'utf8');
  const sql = readFileSync(new URL('../supabase/celeste-saves.sql', import.meta.url), 'utf8');
  const inlineModule = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].at(-1)?.[1];
  assert.ok(inlineModule);
  await transform(inlineModule, { loader: 'js', format: 'esm' });
  assert.match(html, /Se connecter avec GitHub/);
  assert.match(html, /Se déconnecter/);
  assert.match(html, /Sauvegarder maintenant/);
  assert.match(html, /Restaurer ma progression/);
  assert.match(html, /cloud-sync-indicator/);
  assert.match(html, /createOAuthRedirectUrl\(window\.location\)/);
  assert.doesNotMatch(html, /location\.host\b/);
  assert.ok(html.indexOf('await saveRepository.putSafetyBackup(safetyBackup)') < html.indexOf('await importSaves(file)'));
  assert.match(html, /inspectSaveArchive\(file\)/);
  assert.match(sql, /for select[\s\S]*auth\.uid\(\)::text/i);
  assert.match(sql, /for insert[\s\S]*auth\.uid\(\)::text/i);
  assert.doesNotMatch(sql, /for update|for delete/i);
});
