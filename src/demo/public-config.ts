declare const __CELESTE_RUNTIME_BASE_URL__: string

/** Public static runtime location; it contains no credential. */
export const PUBLIC_CONFIG = Object.freeze({
  runtimeBaseUrl: __CELESTE_RUNTIME_BASE_URL__ || '',
})
