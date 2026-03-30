import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const BROWSER_IDENTITY_STORAGE_KEY = 'NUMERON_BROWSER_IDENTITY_V2';

export type BrowserIdentitySource = 'browser_ephemeral' | 'env_fallback' | 'runtime_ephemeral';

export type BrowserIdentity = {
  address: string;
  secretKey: string;
  source: BrowserIdentitySource;
};

let cachedIdentity: BrowserIdentity | null = null;

function buildIdentity(secretKey: string, source: BrowserIdentitySource): BrowserIdentity {
  const decoded = decodeSuiPrivateKey(secretKey);
  const keypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);

  return {
    address: keypair.toSuiAddress(),
    secretKey,
    source,
  };
}

function generateIdentity(source: BrowserIdentitySource): BrowserIdentity {
  const keypair = Ed25519Keypair.generate();

  return {
    address: keypair.toSuiAddress(),
    secretKey: keypair.getSecretKey(),
    source,
  };
}

export function generateBrowserIdentity(): BrowserIdentity {
  return generateIdentity(typeof window === 'undefined' ? 'runtime_ephemeral' : 'browser_ephemeral');
}

function readStoredSecretKey(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(BROWSER_IDENTITY_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as { secretKey?: string } | string;
    return typeof parsed === 'string' ? parsed : parsed.secretKey ?? null;
  } catch {
    return null;
  }
}

function writeStoredSecretKey(secretKey: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(BROWSER_IDENTITY_STORAGE_KEY, JSON.stringify({ secretKey }));
  } catch {
    // Ignore storage failures and keep the in-memory identity for this session.
  }
}

export function setBrowserIdentitySecretKey(secretKey: string): BrowserIdentity {
  const identity = buildIdentity(secretKey, typeof window === 'undefined' ? 'runtime_ephemeral' : 'browser_ephemeral');
  cachedIdentity = identity;
  writeStoredSecretKey(secretKey);
  return identity;
}

export function getOrCreateBrowserIdentity(): BrowserIdentity {
  if (cachedIdentity) {
    return cachedIdentity;
  }

  const storedSecretKey = readStoredSecretKey();
  if (storedSecretKey) {
    try {
      cachedIdentity = buildIdentity(storedSecretKey, 'browser_ephemeral');
      return cachedIdentity;
    } catch {
      // Fall through and replace the invalid stored identity.
    }
  }

  const envSecretKey = process.env.NEXT_PUBLIC_PRIVATE_KEY;
  if (typeof window === 'undefined' && envSecretKey) {
    cachedIdentity = buildIdentity(envSecretKey, 'env_fallback');
    return cachedIdentity;
  }

  const generated = generateBrowserIdentity();
  cachedIdentity = generated;
  writeStoredSecretKey(generated.secretKey);
  return generated;
}
