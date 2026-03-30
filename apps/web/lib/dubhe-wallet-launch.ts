const DUBHE_BRIDGE_WINDOW_NAME_PREFIX = 'dubhe-wallet-bridge:';
const DUBHE_WALLET_LAUNCH_STORAGE_KEY = 'NUMERON_DUBHE_WALLET_LAUNCH_V1';

export type DubheWalletLaunchContext = {
  version: 1;
  source: 'dubhe-wallet';
  walletAddress: string | null;
  walletNetwork: string;
  walletAuthMethod: string | null;
  walletLocked: boolean;
  walletOrigin: string | null;
  returnUrl: string | null;
  appSlug?: string;
  launchedAt?: string;
};

type BridgePayload = {
  version?: number;
  source?: string;
  launchedAt?: string;
  returnUrl?: string;
  app?: {
    slug?: string;
  };
  wallet?: {
    address?: string | null;
    network?: string;
    authMethod?: string | null;
    locked?: boolean;
    origin?: string | null;
  };
};

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const atobFn =
    typeof globalThis !== 'undefined' && typeof globalThis.atob === 'function'
      ? globalThis.atob.bind(globalThis)
      : null;

  if (!atobFn) {
    throw new Error('Base64 decoding is unavailable in this environment.');
  }

  return decodeURIComponent(
    escape(atobFn(`${normalized}${padding}`))
  );
}

function parseBridgePayload(input: string): BridgePayload | null {
  try {
    return JSON.parse(base64UrlDecode(input)) as BridgePayload;
  } catch {
    return null;
  }
}

function buildContext(payload: BridgePayload | null, url: URL): DubheWalletLaunchContext | null {
  const walletAddress = url.searchParams.get('dubhe_wallet_address') ?? payload?.wallet?.address ?? null;
  const walletNetwork =
    url.searchParams.get('dubhe_wallet_network') ?? payload?.wallet?.network ?? '';

  if (!walletAddress && !walletNetwork) {
    return null;
  }

  const walletOrigin =
    url.searchParams.get('dubhe_wallet_origin') ?? payload?.wallet?.origin ?? null;

  return {
    version: 1,
    source: 'dubhe-wallet',
    walletAddress,
    walletNetwork,
    walletAuthMethod:
      url.searchParams.get('dubhe_wallet_auth') ?? payload?.wallet?.authMethod ?? null,
    walletLocked:
      (url.searchParams.get('dubhe_wallet_locked') ?? `${payload?.wallet?.locked ?? false}`) ===
      'true',
    walletOrigin,
    returnUrl: url.searchParams.get('dubhe_wallet_return_url') ?? payload?.returnUrl ?? null,
    appSlug: payload?.app?.slug,
    launchedAt: payload?.launchedAt,
  };
}

export function parseDubheWalletLaunchContext(
  href: string,
  windowName?: string
): DubheWalletLaunchContext | null {
  try {
    const url = new URL(href);
    const encodedPayload = url.searchParams.get('dubhe_bridge');
    const queryPayload = encodedPayload ? parseBridgePayload(encodedPayload) : null;

    if (queryPayload) {
      return buildContext(queryPayload, url);
    }

    if (windowName?.startsWith(DUBHE_BRIDGE_WINDOW_NAME_PREFIX)) {
      const raw = windowName.slice(DUBHE_BRIDGE_WINDOW_NAME_PREFIX.length);
      const payload = JSON.parse(raw) as BridgePayload;
      return buildContext(payload, url);
    }

    return buildContext(null, url);
  } catch {
    return null;
  }
}

export function saveDubheWalletLaunchContext(context: DubheWalletLaunchContext | null) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!context) {
    window.sessionStorage.removeItem(DUBHE_WALLET_LAUNCH_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(DUBHE_WALLET_LAUNCH_STORAGE_KEY, JSON.stringify(context));
}

export function readDubheWalletLaunchContext() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(DUBHE_WALLET_LAUNCH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as DubheWalletLaunchContext;
  } catch {
    return null;
  }
}

export function resolveCurrentDubheWalletLaunchContext() {
  if (typeof window === 'undefined') {
    return null;
  }

  const parsed = parseDubheWalletLaunchContext(window.location.href, window.name);
  if (parsed) {
    saveDubheWalletLaunchContext(parsed);
    return parsed;
  }
  return readDubheWalletLaunchContext();
}
