/**
 * Secure Storage Utility for Sensitive Data
 * 
 * This module provides a more secure way to store sensitive data like API keys.
 * 
 * SECURITY NOTES:
 * 1. This uses sessionStorage instead of localStorage - data is cleared when tab closes
 * 2. Keys are obfuscated (not true encryption, but prevents casual inspection)
 * 3. For production apps with real security needs, consider:
 *    - Server-side proxy for API calls (best option - key never reaches client)
 *    - OAuth flow where user authenticates with their Google account
 *    - Environment variables for server-side rendering
 * 
 * IMPORTANT: No client-side storage is truly secure. The API key will always
 * be accessible to determined attackers with browser access. For maximum security,
 * use a backend proxy that holds the API key server-side.
 */

const STORAGE_PREFIX = 'p89_';
const XOR_SALT = 'poselab_static_salt_2024';

/**
 * Simple obfuscation (NOT encryption - just makes casual inspection harder)
 * This is NOT cryptographically secure, but prevents the key from being
 * immediately visible in DevTools.
 */
function obfuscate(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i) ^ XOR_SALT.charCodeAt(i % XOR_SALT.length);
    result += String.fromCharCode(charCode);
  }
  return btoa(result); // Base64 encode the result
}

function deobfuscate(encoded: string): string {
  try {
    const decoded = atob(encoded);
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      const charCode = decoded.charCodeAt(i) ^ XOR_SALT.charCodeAt(i % XOR_SALT.length);
      result += String.fromCharCode(charCode);
    }
    return result;
  } catch {
    return '';
  }
}

/**
 * Storage options
 */
export type StorageMode = 'session' | 'persistent';

interface SecureStorageOptions {
  /** 
   * 'session' - Cleared when browser tab closes (more secure)
   * 'persistent' - Persists across sessions (less secure but convenient)
   */
  mode?: StorageMode;
}

/**
 * Securely store a sensitive value
 */
export function secureSet(key: string, value: string, options: SecureStorageOptions = {}): void {
  const { mode = 'session' } = options;
  const storage = mode === 'session' ? sessionStorage : localStorage;
  const obfuscatedValue = obfuscate(value);
  storage.setItem(STORAGE_PREFIX + key, obfuscatedValue);
}

/**
 * Retrieve a securely stored value
 */
export function secureGet(key: string, options: SecureStorageOptions = {}): string | null {
  const { mode = 'session' } = options;
  const storage = mode === 'session' ? sessionStorage : localStorage;
  const obfuscatedValue = storage.getItem(STORAGE_PREFIX + key);
  
  if (!obfuscatedValue) return null;
  
  return deobfuscate(obfuscatedValue);
}

/**
 * Remove a securely stored value
 */
export function secureRemove(key: string, options: SecureStorageOptions = {}): void {
  const { mode = 'session' } = options;
  const storage = mode === 'session' ? sessionStorage : localStorage;
  storage.removeItem(STORAGE_PREFIX + key);
  
  // Also try to remove from the other storage in case it exists there
  const otherStorage = mode === 'session' ? localStorage : sessionStorage;
  otherStorage.removeItem(STORAGE_PREFIX + key);
}

/**
 * Check if a secure value exists
 */
export function secureHas(key: string, options: SecureStorageOptions = {}): boolean {
  const { mode = 'session' } = options;
  const storage = mode === 'session' ? sessionStorage : localStorage;
  return storage.getItem(STORAGE_PREFIX + key) !== null;
}

/**
 * Clear all secure storage
 */
export function secureClearAll(): void {
  // Clear from both storages
  [sessionStorage, localStorage].forEach(storage => {
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => storage.removeItem(key));
  });
}

/**
 * Migrate from old localStorage key to secure storage
 * Call this once to migrate existing users
 */
export function migrateFromLocalStorage(oldKey: string, newKey: string): void {
  const oldValue = localStorage.getItem(oldKey);
  if (oldValue) {
    // Store in session storage (more secure)
    secureSet(newKey, oldValue, { mode: 'session' });
    // Remove old insecure storage
    localStorage.removeItem(oldKey);
    console.log(`[SecureStorage] Migrated ${oldKey} to secure storage`);
  }
}

// API Key specific helpers
const API_KEY_STORAGE_KEY = 'gemini_key';

export const apiKeyStorage = {
  /**
   * Get the stored API key
   * Checks session first, then persistent storage
   */
  get(): string | null {
    // First check session storage (preferred)
    let key = secureGet(API_KEY_STORAGE_KEY, { mode: 'session' });
    if (key) return key;
    
    // Fall back to persistent storage
    key = secureGet(API_KEY_STORAGE_KEY, { mode: 'persistent' });
    return key;
  },
  
  /**
   * Store the API key
   * @param key - The API key to store
   * @param persistent - If true, persists across browser sessions (less secure)
   */
  set(key: string, persistent = false): void {
    secureSet(API_KEY_STORAGE_KEY, key, { mode: persistent ? 'persistent' : 'session' });
  },
  
  /**
   * Remove the stored API key
   */
  remove(): void {
    secureRemove(API_KEY_STORAGE_KEY, { mode: 'session' });
    secureRemove(API_KEY_STORAGE_KEY, { mode: 'persistent' });
  },
  
  /**
   * Check if an API key is stored
   */
  exists(): boolean {
    return secureHas(API_KEY_STORAGE_KEY, { mode: 'session' }) || 
           secureHas(API_KEY_STORAGE_KEY, { mode: 'persistent' });
  },
  
  /**
   * Migrate from old insecure localStorage
   */
  migrate(): void {
    migrateFromLocalStorage('gemini_api_key', API_KEY_STORAGE_KEY);
  }
};

