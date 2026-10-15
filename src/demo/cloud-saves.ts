import { readTar } from '@wasm-gaming/celeste-wasm/tar'

export const CLOUD_SAVE_BUCKET = 'celeste-saves'

export interface CloudSaveSdk {
  exportSaves(): Promise<ReadableStream<Uint8Array>>
  importSaves(archive: Blob): Promise<number>
}

export interface CloudSaveVersion {
  name: string
  sha256: string
  contentHash: string
  createdAt: string
}

export interface CloudSaveSyncState {
  userId: string
  lastSyncedAt: string
  localContentHash: string
  remoteArchiveSha256: string
  remoteObjectName: string
}

export interface CloudSaveSnapshot {
  userId: string
  archive: Blob
  archiveSha256: string
  contentHash: string
  fileCount: number
  capturedAt: string
}

export interface CloudSaveSafetyBackup extends CloudSaveSnapshot {
  id: string
}

export interface CloudSaveRepository {
  getPending(userId: string): Promise<CloudSaveSnapshot[]>
  putPending(snapshot: CloudSaveSnapshot): Promise<void>
  clearPending(userId: string, archiveSha256: string): Promise<void>
  getSyncState(userId: string): Promise<CloudSaveSyncState | null>
  putSyncState(state: CloudSaveSyncState): Promise<void>
  putSafetyBackup(backup: CloudSaveSafetyBackup): Promise<void>
  getLatestSafetyBackup(userId: string): Promise<CloudSaveSafetyBackup | null>
}

interface StorageError {
  message: string
}

interface StorageObject {
  name: string
}

interface CloudSaveBucket {
  upload(
    path: string,
    file: Blob,
    options: { cacheControl: string; contentType: string; upsert: false },
  ): Promise<{ error: StorageError | null }>
  list(
    path: string,
    options: { limit: number; sortBy: { column: 'name'; order: 'desc' } },
  ): Promise<{ data: StorageObject[] | null; error: StorageError | null }>
  download(path: string): Promise<{ data: Blob | null; error: StorageError | null }>
}

export interface CloudSaveStorage {
  from(bucket: string): CloudSaveBucket
}

export interface RestoreConfirmation {
  remoteVersion: CloudSaveVersion
  localFileCount: number
  localChangedSinceLastSync: boolean
}

export type CloudSaveResult =
  | { status: 'saved'; version: CloudSaveVersion; alreadyPresent: boolean }
  | { status: 'queued'; message: string }
  | { status: 'idle' }

export interface RestoreResult {
  status: 'restored' | 'cancelled'
  restoredFiles: number
  safetyBackupId?: string
  localChangedSinceLastSync: boolean
}

const DB_NAME = 'celeste-cloud-saves'
const DB_VERSION = 1
const PENDING_STORE = 'pending'
const SYNC_STORE = 'sync-state'
const SAFETY_STORE = 'safety-backups'
const VERSION_NAME = /^(\d{13})-([a-f\d-]{36})-([a-f\d]{64})-([a-f\d]{64})\.tar\.gz$/i

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function makeId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', source)
  return toHex(new Uint8Array(digest))
}

function asGzipStream(blob: Blob): ReadableStream<Uint8Array> {
  return blob.stream() as ReadableStream<Uint8Array>
}

/** Hash the whole archive, decompress if needed, and parse every TAR entry before import. */
export async function inspectSaveArchive(blob: Blob): Promise<{
  archiveSha256: string
  contentHash: string
  fileCount: number
}> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length === 0) throw new Error('L’archive de sauvegarde est vide.')
  const archiveSha256 = await sha256(bytes)
  const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b
  let stream = asGzipStream(blob)
  if (compressed) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Ce navigateur ne peut pas vérifier une archive gzip de sauvegardes.')
    }
    stream = stream.pipeThrough(
      new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
    ) as ReadableStream<Uint8Array>
  }

  const entries: Array<{ path: string; size: number; sha256: string }> = []
  for await (const entry of readTar(stream)) {
    const contents = new Uint8Array(await new Response(entry.body).arrayBuffer())
    if (contents.byteLength !== entry.size) {
      throw new Error(`La sauvegarde « ${entry.path} » est tronquée.`)
    }
    entries.push({ path: entry.path, size: entry.size, sha256: await sha256(contents) })
  }
  entries.sort((a, b) => a.path.localeCompare(b.path))
  const contentHash = await sha256(new TextEncoder().encode(JSON.stringify(entries)))
  return { archiveSha256, contentHash, fileCount: entries.length }
}

function versionFromName(name: string): CloudSaveVersion | null {
  const match = VERSION_NAME.exec(name)
  if (!match) return null
  return {
    name,
    sha256: match[3].toLowerCase(),
    contentHash: match[4].toLowerCase(),
    createdAt: new Date(Number(match[1])).toISOString(),
  }
}

export class CloudSaveService {
  constructor(
    private readonly storage: CloudSaveStorage,
    private readonly sdk: CloudSaveSdk,
    private readonly repository: CloudSaveRepository,
  ) {}

  async captureStableLocal(userId: string, attempts = 4, quietMs = 200): Promise<CloudSaveSnapshot> {
    let previous = await this.captureLocal(userId)
    for (let attempt = 0; attempt < attempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, quietMs))
      const current = await this.captureLocal(userId)
      if (current.contentHash === previous.contentHash) return current
      previous = current
    }
    throw new Error('Les sauvegardes changent encore. Attends la fin de l’écriture puis réessaie.')
  }

  async saveNow(userId: string): Promise<CloudSaveResult> {
    const snapshot = await this.captureStableLocal(userId)
    await this.repository.putPending(snapshot)
    return this.flushPending(userId)
  }

  async saveStableAfterGameExit(userId: string): Promise<CloudSaveResult> {
    await this.queueStableAfterGameExit(userId)
    return this.flushPending(userId)
  }

  async queueStableAfterGameExit(userId: string): Promise<CloudSaveSnapshot> {
    const snapshot = await this.captureStableLocal(userId, 5, 250)
    await this.repository.putPending(snapshot)
    return snapshot
  }

  async flushPending(userId: string): Promise<CloudSaveResult> {
    const pending = await this.repository.getPending(userId)
    if (!pending.length) return { status: 'idle' }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { status: 'queued', message: `${pending.length} copie(s) locale(s) attend(ent) le retour de la connexion.` }
    }

    let lastResult: CloudSaveResult = { status: 'idle' }
    for (const snapshot of pending) {
      try {
        const inspected = await inspectSaveArchive(snapshot.archive)
        if (inspected.archiveSha256 !== snapshot.archiveSha256) {
          throw new Error('La copie locale en attente ne passe plus la vérification d’intégrité.')
        }
        lastResult = await this.uploadSnapshot(snapshot)
      } catch (error) {
        return { status: 'queued', message: errorMessage(error) }
      }
    }
    return lastResult
  }

  async listVersions(userId: string): Promise<CloudSaveVersion[]> {
    const { data, error } = await this.storage.from(CLOUD_SAVE_BUCKET).list(userId, {
      limit: 100,
      sortBy: { column: 'name', order: 'desc' },
    })
    if (error) throw new Error(`Impossible de lire les sauvegardes cloud : ${error.message}`)
    return (data ?? [])
      .map((item) => versionFromName(item.name))
      .filter((item): item is CloudSaveVersion => item !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async getSyncState(userId: string): Promise<CloudSaveSyncState | null> {
    return this.repository.getSyncState(userId)
  }

  async restore(
    userId: string,
    versionName: string,
    confirm: (details: RestoreConfirmation) => boolean | Promise<boolean>,
  ): Promise<RestoreResult> {
    const version = (await this.listVersions(userId)).find((item) => item.name === versionName)
    if (!version) throw new Error('Cette version n’existe plus dans ton espace cloud.')

    const path = `${userId}/${version.name}`
    const { data: archive, error } = await this.storage.from(CLOUD_SAVE_BUCKET).download(path)
    if (error || !archive) {
      throw new Error(`Impossible de télécharger la sauvegarde cloud${error ? ` : ${error.message}` : '.'}`)
    }

    const remote = await inspectSaveArchive(archive)
    if (remote.archiveSha256 !== version.sha256 || remote.contentHash !== version.contentHash) {
      throw new Error('La sauvegarde cloud a été altérée : son empreinte SHA-256 ne correspond pas.')
    }

    const local = await this.captureStableLocal(userId, 2, 100)
    const previousSync = await this.repository.getSyncState(userId)
    const localChangedSinceLastSync = Boolean(
      previousSync && local.contentHash !== previousSync.localContentHash,
    )
    if (local.fileCount > 0 && !(await confirm({
      remoteVersion: version,
      localFileCount: local.fileCount,
      localChangedSinceLastSync,
    }))) {
      return { status: 'cancelled', restoredFiles: 0, localChangedSinceLastSync }
    }

    const safetyBackup: CloudSaveSafetyBackup = {
      ...local,
      id: `${userId}/${Date.now()}-${makeId()}`,
    }
    await this.repository.putSafetyBackup(safetyBackup)

    const restoredFiles = await this.sdk.importSaves(archive)
    const mergedLocal = await this.captureStableLocal(userId, 2, 100)
    await this.repository.putSyncState({
      userId,
      lastSyncedAt: new Date().toISOString(),
      localContentHash: mergedLocal.contentHash,
      remoteArchiveSha256: remote.archiveSha256,
      remoteObjectName: version.name,
    })

    return {
      status: 'restored',
      restoredFiles,
      safetyBackupId: safetyBackup.id,
      localChangedSinceLastSync,
    }
  }

  async getLatestSafetyBackup(userId: string): Promise<CloudSaveSafetyBackup | null> {
    return this.repository.getLatestSafetyBackup(userId)
  }

  private async captureLocal(userId: string): Promise<CloudSaveSnapshot> {
    const stream = await this.sdk.exportSaves()
    const archive = await new Response(stream).blob()
    const typedArchive = new Blob([archive], { type: 'application/gzip' })
    const inspected = await inspectSaveArchive(typedArchive)
    return {
      userId,
      archive: typedArchive,
      archiveSha256: inspected.archiveSha256,
      contentHash: inspected.contentHash,
      fileCount: inspected.fileCount,
      capturedAt: new Date().toISOString(),
    }
  }

  private async uploadSnapshot(snapshot: CloudSaveSnapshot): Promise<CloudSaveResult> {
    const versions = await this.listVersions(snapshot.userId)
    const existing = versions.find((item) =>
      item.sha256 === snapshot.archiveSha256 || item.contentHash === snapshot.contentHash,
    )
    if (existing) {
      await this.repository.clearPending(snapshot.userId, snapshot.archiveSha256)
      await this.repository.putSyncState({
        userId: snapshot.userId,
        lastSyncedAt: new Date().toISOString(),
        localContentHash: snapshot.contentHash,
        remoteArchiveSha256: existing.sha256,
        remoteObjectName: existing.name,
      })
      return { status: 'saved', version: existing, alreadyPresent: true }
    }

    const createdAt = Date.now()
    const version: CloudSaveVersion = {
      name: `${createdAt}-${makeId()}-${snapshot.archiveSha256}-${snapshot.contentHash}.tar.gz`,
      sha256: snapshot.archiveSha256,
      contentHash: snapshot.contentHash,
      createdAt: new Date(createdAt).toISOString(),
    }
    const { error } = await this.storage.from(CLOUD_SAVE_BUCKET).upload(
      `${snapshot.userId}/${version.name}`,
      snapshot.archive,
      { cacheControl: '0', contentType: 'application/gzip', upsert: false },
    )
    if (error) throw new Error(`Impossible d’envoyer la sauvegarde cloud : ${error.message}`)

    await this.repository.putSyncState({
      userId: snapshot.userId,
      lastSyncedAt: new Date().toISOString(),
      localContentHash: snapshot.contentHash,
      remoteArchiveSha256: snapshot.archiveSha256,
      remoteObjectName: version.name,
    })
    await this.repository.clearPending(snapshot.userId, snapshot.archiveSha256)
    return { status: 'saved', version, alreadyPresent: false }
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB a refusé la requête.'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('La transaction IndexedDB a été annulée.'))
    transaction.onerror = () => reject(transaction.error ?? new Error('La transaction IndexedDB a échoué.'))
  })
}

/** Local durable queue and restore safety copies; records are never pruned automatically. */
export function createBrowserCloudSaveRepository(indexedDb: IDBFactory = indexedDB): CloudSaveRepository {
  let databasePromise: Promise<IDBDatabase> | null = null
  const database = (): Promise<IDBDatabase> => {
    if (databasePromise) return databasePromise
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDb.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(PENDING_STORE)) db.createObjectStore(PENDING_STORE, { keyPath: 'userId' })
        if (!db.objectStoreNames.contains(SYNC_STORE)) db.createObjectStore(SYNC_STORE, { keyPath: 'userId' })
        if (!db.objectStoreNames.contains(SAFETY_STORE)) {
          const store = db.createObjectStore(SAFETY_STORE, { keyPath: 'id' })
          store.createIndex('userId', 'userId', { unique: false })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB est indisponible.'))
      request.onblocked = () => reject(new Error('La base IndexedDB attend la fermeture d’un autre onglet.'))
    })
    return databasePromise
  }

  return {
    async getPending(userId) {
      const db = await database()
      const tx = db.transaction(PENDING_STORE, 'readonly')
      const result = await requestResult(tx.objectStore(PENDING_STORE).get(userId)) as
        | { userId: string; snapshots: CloudSaveSnapshot[] }
        | undefined
      await transactionDone(tx)
      return (result?.snapshots ?? []).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    },
    async putPending(snapshot) {
      const db = await database()
      const tx = db.transaction(PENDING_STORE, 'readwrite')
      const store = tx.objectStore(PENDING_STORE)
      const current = await requestResult(store.get(snapshot.userId)) as
        | { userId: string; snapshots: CloudSaveSnapshot[] }
        | undefined
      const snapshots = current?.snapshots ?? []
      if (!snapshots.some((item) => item.contentHash === snapshot.contentHash)) {
        store.put({ userId: snapshot.userId, snapshots: [...snapshots, snapshot] })
      }
      await transactionDone(tx)
    },
    async clearPending(userId, archiveSha256) {
      const db = await database()
      const tx = db.transaction(PENDING_STORE, 'readwrite')
      const store = tx.objectStore(PENDING_STORE)
      const current = await requestResult(store.get(userId)) as
        | { userId: string; snapshots: CloudSaveSnapshot[] }
        | undefined
      if (current) {
        const snapshots = current.snapshots.filter((item) => item.archiveSha256 !== archiveSha256)
        if (snapshots.length) store.put({ userId, snapshots })
        else store.delete(userId)
      }
      await transactionDone(tx)
    },
    async getSyncState(userId) {
      const db = await database()
      const tx = db.transaction(SYNC_STORE, 'readonly')
      const result = await requestResult(tx.objectStore(SYNC_STORE).get(userId)) as CloudSaveSyncState | undefined
      await transactionDone(tx)
      return result ?? null
    },
    async putSyncState(state) {
      const db = await database()
      const tx = db.transaction(SYNC_STORE, 'readwrite')
      tx.objectStore(SYNC_STORE).put(state)
      await transactionDone(tx)
    },
    async putSafetyBackup(backup) {
      const db = await database()
      const tx = db.transaction(SAFETY_STORE, 'readwrite')
      tx.objectStore(SAFETY_STORE).put(backup)
      await transactionDone(tx)
    },
    async getLatestSafetyBackup(userId) {
      const db = await database()
      const tx = db.transaction(SAFETY_STORE, 'readonly')
      const records = await requestResult(tx.objectStore(SAFETY_STORE).index('userId').getAll(userId)) as CloudSaveSafetyBackup[]
      await transactionDone(tx)
      return records.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0] ?? null
    },
  }
}
