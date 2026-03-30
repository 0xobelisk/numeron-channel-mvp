import { verifyPersonalMessageSignature } from '@mysten/sui/verify';

export const DEFAULT_DUBHE_CONNECT_RELAY_ORIGIN =
  'https://relay.dubhe.obelisk.build';
export const DEFAULT_DUBHE_WALLET_ORIGIN = 'https://dubhe-wallet.pages.dev';
export const DUBHE_CONNECT_IDENTITY_STORAGE_KEY = 'NUMERON_DUBHE_CONNECT_IDENTITY_V1';

export type DubheBridgeAccount = {
  address: string;
  publicKey: string;
  chains: string[];
  features: string[];
  label?: string;
};

export type DubheConnectSessionStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type DubheConnectCallbackStatus = 'approved' | 'rejected' | 'expired';

export type DubheConnectCreateParams = {
  appName: string;
  origin: string;
  network: string;
  walletOrigin?: string;
  callbackUrl?: string;
  statement?: string;
  expiresInMs?: number;
};

export type DubheConnectRequest = {
  appName: string;
  origin: string;
  network: string;
  walletOrigin: string;
  callbackUrl?: string;
  statement: string;
  nonce: string;
  requestedAt: string;
  expiresAt: string;
};

export type DubheConnectResult = {
  account: DubheBridgeAccount;
  message: string;
  bytes: string;
  signature: string;
  approvedAt: string;
};

export type DubheConnectSession = {
  id: string;
  relayOrigin: string;
  approvalUrl: string;
  pollUrl: string;
  status: DubheConnectSessionStatus;
  request: DubheConnectRequest;
  result?: DubheConnectResult;
  rejectionReason?: string;
};

export type DubheConnectIdentity = {
  sessionId: string;
  relayOrigin: string;
  address: string;
  publicKey: string;
  approvedAt: string;
  appName: string;
  network: string;
  walletOrigin: string;
};

export type DubheConnectCallbackInfo = {
  href: string;
  callbackOrigin: string;
  sessionId: string;
  relayOrigin: string;
  status: DubheConnectCallbackStatus;
};

type DubheConnectApproveParams = {
  account: DubheBridgeAccount;
  message: string;
  bytes: string;
  signature: string;
};

type SessionValidationOptions = {
  expectedSessionId?: string;
  expectedRelayOrigin?: string;
  expectedWalletOrigin?: string;
  expectedCallbackOrigin?: string;
};

const CALLBACK_SESSION_PARAM = 'dubhe_connect_session';
const CALLBACK_RELAY_PARAM = 'dubhe_connect_relay';
const CALLBACK_STATUS_PARAM = 'dubhe_connect_status';

export const DEFAULT_DUBHE_CONNECT_STATEMENT =
  'Sign in with Dubhe Wallet to continue into this Dubhe ecosystem app.';

function isLoopbackHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function normalizeTrustedOrigin(input: string, label: string) {
  const url = new URL(input);
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHostname(url.hostname));
  if (!secure) {
    throw new Error(`${label} must use HTTPS or loopback HTTP.`);
  }
  return url.origin;
}

function normalizeTrustedAbsoluteUrl(input: string, label: string) {
  const url = new URL(input);
  normalizeTrustedOrigin(url.origin, label);
  return url.toString();
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let message = `Request failed with ${response.status}`;
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload?.error) {
      message = payload.error;
    }
  } catch {}
  throw new Error(message);
}

function toBase64(bytes: Uint8Array) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
}

export function getConfiguredConnectRelayOrigin(explicit?: string | null) {
  if (explicit?.trim()) {
    return explicit.trim();
  }

  const envValue = process.env.NEXT_PUBLIC_DUBHE_CONNECT_RELAY_URL;
  if (envValue?.trim()) {
    return envValue.trim();
  }

  return DEFAULT_DUBHE_CONNECT_RELAY_ORIGIN;
}

export function getConfiguredWalletOrigin(explicit?: string | null) {
  if (explicit?.trim()) {
    return explicit.trim();
  }

  const envValue = process.env.NEXT_PUBLIC_DUBHE_WALLET_ORIGIN;
  if (envValue?.trim()) {
    return envValue.trim();
  }

  return DEFAULT_DUBHE_WALLET_ORIGIN;
}

export function buildDubheConnectMessage(request: DubheConnectRequest) {
  return [
    'Dubhe Connect',
    '',
    `App: ${request.appName}`,
    `Origin: ${request.origin}`,
    `Network: ${request.network}`,
    `Nonce: ${request.nonce}`,
    `Issued At: ${request.requestedAt}`,
    `Expires At: ${request.expiresAt}`,
    '',
    request.statement,
  ].join('\n');
}

export function parseDubheConnectCallbackUrl(payload: string) {
  try {
    const url = new URL(payload);
    const sessionId = url.searchParams.get(CALLBACK_SESSION_PARAM);
    const relayOrigin = url.searchParams.get(CALLBACK_RELAY_PARAM);
    const status = url.searchParams.get(CALLBACK_STATUS_PARAM);

    if (
      !sessionId ||
      !relayOrigin ||
      (status !== 'approved' && status !== 'rejected' && status !== 'expired')
    ) {
      return null;
    }

    return {
      href: url.toString(),
      callbackOrigin: url.origin,
      sessionId,
      relayOrigin: normalizeTrustedOrigin(relayOrigin, 'Relay origin'),
      status,
    } satisfies DubheConnectCallbackInfo;
  } catch {
    return null;
  }
}

export function validateDubheConnectSession(
  session: DubheConnectSession,
  options: SessionValidationOptions = {}
) {
  const relayOrigin = normalizeTrustedOrigin(session.relayOrigin, 'Relay origin');
  const requestOrigin = normalizeTrustedOrigin(session.request.origin, 'Request origin');
  const walletOrigin = normalizeTrustedOrigin(session.request.walletOrigin, 'Wallet origin');
  const callbackOrigin = session.request.callbackUrl
    ? normalizeTrustedOrigin(session.request.callbackUrl, 'Callback origin')
    : null;

  if (options.expectedSessionId && session.id !== options.expectedSessionId) {
    throw new Error('Dubhe Connect session id mismatch.');
  }

  if (
    options.expectedRelayOrigin &&
    relayOrigin !== normalizeTrustedOrigin(options.expectedRelayOrigin, 'Expected relay origin')
  ) {
    throw new Error('Dubhe Connect relay origin mismatch.');
  }

  if (
    options.expectedWalletOrigin &&
    walletOrigin !== normalizeTrustedOrigin(options.expectedWalletOrigin, 'Expected wallet origin')
  ) {
    throw new Error('Dubhe Connect wallet origin mismatch.');
  }

  if (callbackOrigin && callbackOrigin !== requestOrigin) {
    throw new Error('Dubhe Connect callback origin must match the request origin.');
  }

  if (
    options.expectedCallbackOrigin &&
    callbackOrigin !== normalizeTrustedOrigin(options.expectedCallbackOrigin, 'Expected callback origin')
  ) {
    throw new Error('Dubhe Connect callback origin mismatch.');
  }

  return {
    ...session,
    relayOrigin,
    request: {
      ...session.request,
      origin: requestOrigin,
      walletOrigin,
      callbackUrl: session.request.callbackUrl
        ? normalizeTrustedAbsoluteUrl(session.request.callbackUrl, 'Callback URL')
        : undefined,
    },
  } satisfies DubheConnectSession;
}

export function isDubheConnectExpired(session: Pick<DubheConnectSession, 'status' | 'request'>) {
  return session.status === 'expired' || new Date(session.request.expiresAt).getTime() <= Date.now();
}

export async function verifyDubheConnectSession(session: DubheConnectSession) {
  if (session.status !== 'approved' || !session.result) {
    throw new Error('Dubhe Connect session is not approved.');
  }

  const message = buildDubheConnectMessage(session.request);
  if (session.result.message !== message) {
    throw new Error('Signed message does not match the session request.');
  }

  const encodedMessage = new TextEncoder().encode(message);
  const expectedBytes = toBase64(encodedMessage);
  if (session.result.bytes !== expectedBytes) {
    throw new Error('Signed message bytes do not match the session request.');
  }

  const publicKey = await verifyPersonalMessageSignature(encodedMessage, session.result.signature, {
    address: session.result.account.address,
  });

  if (publicKey.toBase64() !== session.result.account.publicKey) {
    throw new Error('Signature public key does not match account payload.');
  }

  const expectedChain = `sui:${session.request.network}`;
  if (!Array.isArray(session.result.account.chains) || !session.result.account.chains.includes(expectedChain)) {
    throw new Error('Account payload does not include the requested chain.');
  }

  return {
    address: session.result.account.address,
    publicKey: publicKey.toBase64(),
    approvedAt: session.result.approvedAt,
    message,
  };
}

export function buildIdentityFromSession(
  session: DubheConnectSession,
  verification: Awaited<ReturnType<typeof verifyDubheConnectSession>>
): DubheConnectIdentity {
  return {
    sessionId: session.id,
    relayOrigin: session.relayOrigin,
    address: verification.address,
    publicKey: verification.publicKey,
    approvedAt: verification.approvedAt,
    appName: session.request.appName,
    network: session.request.network,
    walletOrigin: session.request.walletOrigin,
  };
}

export function saveDubheConnectIdentity(identity: DubheConnectIdentity) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(DUBHE_CONNECT_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
}

export function readDubheConnectIdentity() {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(DUBHE_CONNECT_IDENTITY_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as DubheConnectIdentity;
  } catch {
    return null;
  }
}

export function clearDubheConnectIdentity() {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(DUBHE_CONNECT_IDENTITY_STORAGE_KEY);
}

export function createDubheConnectClient(options: { relayOrigin: string }) {
  const relayOrigin = normalizeTrustedOrigin(options.relayOrigin, 'Relay origin');

  return {
    createSession: async (params: DubheConnectCreateParams) => {
      const response = await fetch(`${relayOrigin}/sessions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ...params,
          origin: normalizeTrustedOrigin(params.origin, 'Request origin'),
          walletOrigin: params.walletOrigin
            ? normalizeTrustedOrigin(params.walletOrigin, 'Wallet origin')
            : undefined,
          callbackUrl: params.callbackUrl
            ? normalizeTrustedAbsoluteUrl(params.callbackUrl, 'Callback URL')
            : undefined,
        }),
      });

      const session = await parseJsonResponse<DubheConnectSession>(response);
      return validateDubheConnectSession(session, {
        expectedRelayOrigin: relayOrigin,
      });
    },
    getSession: async (sessionId: string) => {
      const response = await fetch(`${relayOrigin}/sessions/${sessionId}`, {
        method: 'GET',
      });

      const session = await parseJsonResponse<DubheConnectSession>(response);
      return validateDubheConnectSession(session, {
        expectedRelayOrigin: relayOrigin,
      });
    },
    approveSession: async (sessionId: string, params: DubheConnectApproveParams) => {
      const response = await fetch(`${relayOrigin}/sessions/${sessionId}/approve`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      const session = await parseJsonResponse<DubheConnectSession>(response);
      return validateDubheConnectSession(session, {
        expectedRelayOrigin: relayOrigin,
      });
    },
    rejectSession: async (sessionId: string, reason?: string) => {
      const response = await fetch(`${relayOrigin}/sessions/${sessionId}/reject`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason }),
      });

      const session = await parseJsonResponse<DubheConnectSession>(response);
      return validateDubheConnectSession(session, {
        expectedRelayOrigin: relayOrigin,
      });
    },
  };
}
