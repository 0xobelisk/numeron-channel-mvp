export type NumeronProxyContext = {
  version: 1;
  ownerAddress: string;
  proxyAddress: string;
  walletOrigin: string;
  expiresAt: number;
  approvedAt: string;
};

const NUMERON_PROXY_CONTEXT_STORAGE_KEY = 'NUMERON_PROXY_CONTEXT_V1';

export function readNumeronProxyContext() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(NUMERON_PROXY_CONTEXT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as NumeronProxyContext;
  } catch {
    return null;
  }
}

export function saveNumeronProxyContext(context: NumeronProxyContext) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(NUMERON_PROXY_CONTEXT_STORAGE_KEY, JSON.stringify(context));
}

export function clearNumeronProxyContext() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(NUMERON_PROXY_CONTEXT_STORAGE_KEY);
}

export function isNumeronProxyContextActive(
  context: NumeronProxyContext | null,
  proxyAddress?: string | null,
  now = Date.now()
) {
  if (!context) {
    return false;
  }

  if (proxyAddress && context.proxyAddress.toLowerCase() !== proxyAddress.toLowerCase()) {
    return false;
  }

  return context.expiresAt > now;
}
