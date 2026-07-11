import { safeStorage } from 'electron'

// Wraps Electron's safeStorage (OS keychain on macOS, DPAPI on Windows,
// libsecret on Linux) so secrets written to electron-store's plaintext JSON
// file are encrypted at rest instead of sitting in the clear on disk.
// Falls back to plaintext only if the OS has no keychain backend available
// (e.g. a headless Linux box with no secret service running) so the app
// still functions — encryption is opportunistic, not a hard requirement.

const PREFIX = 'enc:v1:'

export function encryptSecret(value: string): string {
  if (!value) return value
  if (!safeStorage.isEncryptionAvailable()) return value
  return PREFIX + safeStorage.encryptString(value).toString('base64')
}

export function decryptSecret(value: string): string {
  if (!value || !value.startsWith(PREFIX)) return value
  if (!safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(PREFIX.length), 'base64'))
  } catch {
    return '' // undecryptable (e.g. moved to a different machine/user) — treat as unset
  }
}
