// Typed bridge between the shared launcher and the Celeste SDK.
// The player selects a ZIP locally; only save archives can be sent to Supabase.

import sdk from '@wasm-gaming/celeste-wasm';
import { inspectInstall, type InstallCheck } from '@wasm-gaming/celeste-wasm/install';
import { ZipReader } from '@wasm-gaming/celeste-wasm/zip';

declare global {
  interface Window {
    /** Convention the shared template's sdk.js looks for. */
    SDK?: typeof sdk;
    CELESTE?: {
      sdk: typeof sdk;
      manifest: typeof sdk.manifest;
      stagedInstall(): Promise<InstallCheck>;
      exportSaves(): Promise<ReadableStream<Uint8Array>>;
      importSaves(archive: Blob): Promise<number>;
      purgeStorage(): Promise<{ data: boolean; settings: boolean }>;
      checkArchive(bytes: ArrayBuffer | Uint8Array | Blob): Promise<InstallCheck>;
    };
  }
}

window.SDK = sdk;
window.CELESTE = {
  sdk,
  manifest: sdk.manifest,
  stagedInstall: () => sdk.stagedInstall(),
  exportSaves: () => sdk.exportSaves(),
  importSaves: (archive) => sdk.importSaves(archive),
  purgeStorage: () => sdk.purgeStorage(),

  async checkArchive(bytes): Promise<InstallCheck> {
    const reader = await ZipReader.open(
      bytes instanceof Blob ? bytes : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    );
    return inspectInstall(reader.entries.map((entry) => entry.name));
  },
};

// The runtime is built with threads, so the page has to be cross-origin
// isolated before any of this can run. `make preview` sends the headers;
// coi.js installs a service worker on compatible static hosts that need it.
const isolation = document.getElementById('isolation');
if (isolation) {
  isolation.textContent = window.crossOriginIsolated === true ? 'isolated' : 'not isolated';
  isolation.classList.toggle('bad', window.crossOriginIsolated !== true);
}
