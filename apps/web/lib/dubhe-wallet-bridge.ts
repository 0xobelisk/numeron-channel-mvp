import {
  createDubheBridgeRequest,
  type DubheBridgeMethod,
  type DubheBridgeRequestMap,
  type DubheBridgeResponse,
  type DubheBridgeResponseMap,
} from './shared-bridge';

const DEFAULT_TIMEOUT_MS = 60_000;
export const DUBHE_WALLET_BRIDGE_RESPONSE_WINDOW_NAME_PREFIX =
  'dubhe-wallet-bridge-response:';

function toBase64(input: string) {
  const btoaFn =
    typeof globalThis !== 'undefined' && typeof globalThis.btoa === 'function'
      ? globalThis.btoa.bind(globalThis)
      : null;

  if (!btoaFn) {
    throw new Error('Base64 encoding is unavailable in this environment.');
  }

  return btoaFn(unescape(encodeURIComponent(input)));
}

function encodeBridgeRequest(request: unknown) {
  return encodeURIComponent(toBase64(JSON.stringify(request)));
}

function centerPopup(width: number, height: number) {
  if (typeof window === 'undefined') {
    return '';
  }

  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  return `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
}

export async function requestDubheWalletBridge<M extends DubheBridgeMethod>(
  method: M,
  params: DubheBridgeRequestMap[M],
  options: {
    walletOrigin: string;
    timeoutMs?: number;
  }
): Promise<DubheBridgeResponseMap[M]> {
  if (typeof window === 'undefined') {
    throw new Error('Dubhe Wallet bridge is only available in a browser.');
  }

  const walletOrigin = new URL(options.walletOrigin).origin;
  const request = createDubheBridgeRequest(method, window.location.origin, params);
  const popupUrl = `${walletOrigin}/bridge/popup?request=${encodeBridgeRequest(request)}`;
  const popup = window.open(popupUrl, '_blank', centerPopup(460, 760));

  if (!popup) {
    throw new Error('Wallet popup was blocked by the browser.');
  }

  return new Promise<DubheBridgeResponseMap[M]>((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Wallet bridge request timed out.'));
    }, timeoutMs);

    const closeCheckId = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error('Wallet popup was closed before approval.'));
      }
    }, 400);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== walletOrigin) {
        return;
      }

      const payload = event.data as DubheBridgeResponse<M> | undefined;
      if (!payload || payload.id !== request.id || payload.source !== 'dubhe-wallet') {
        return;
      }

      cleanup();

      if (!payload.ok) {
        const failure = payload as {
          ok: false;
          error: {
            message: string;
          };
        };
        reject(new Error(failure.error.message || 'Wallet bridge request failed.'));
        return;
      }

      resolve(payload.result);
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(closeCheckId);
      window.removeEventListener('message', onMessage);
    };

    window.addEventListener('message', onMessage);
  });
}

export function buildDubheWalletBridgeRedirectUrl<M extends DubheBridgeMethod>(
  method: M,
  params: DubheBridgeRequestMap[M],
  options: {
    walletOrigin: string;
    returnUrl: string;
  }
) {
  const walletOrigin = new URL(options.walletOrigin).origin;
  const request = createDubheBridgeRequest(method, window.location.origin, params);
  const url = new URL(`${walletOrigin}/bridge/popup`);
  url.searchParams.set('request', encodeBridgeRequest(request));
  url.searchParams.set('returnUrl', options.returnUrl);
  return {
    request,
    url: url.toString(),
  };
}

export function beginDubheWalletBridgeRedirect<M extends DubheBridgeMethod>(
  method: M,
  params: DubheBridgeRequestMap[M],
  options: {
    walletOrigin: string;
    returnUrl: string;
  }
) {
  const redirect = buildDubheWalletBridgeRedirectUrl(method, params, options);
  window.location.assign(redirect.url);
  return redirect.request;
}

export function readDubheWalletBridgeRedirectResponse() {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.name;
  if (!raw.startsWith(DUBHE_WALLET_BRIDGE_RESPONSE_WINDOW_NAME_PREFIX)) {
    return null;
  }

  try {
    return JSON.parse(
      raw.slice(DUBHE_WALLET_BRIDGE_RESPONSE_WINDOW_NAME_PREFIX.length)
    ) as {
      requestId: string;
      payload: DubheBridgeResponse;
    };
  } catch {
    return null;
  }
}

export function clearDubheWalletBridgeRedirectResponse() {
  if (typeof window === 'undefined') {
    return;
  }
  if (window.name.startsWith(DUBHE_WALLET_BRIDGE_RESPONSE_WINDOW_NAME_PREFIX)) {
    window.name = '';
  }
}

export function shouldPreferRedirectBridge() {
  if (typeof window === 'undefined') {
    return false;
  }

  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    ((window.navigator as Navigator & { standalone?: boolean }).standalone ?? false);
  const isTouch =
    window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const isMobileUa = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return Boolean(isStandalone || isTouch || isMobileUa);
}

export function createDubheWalletBridgeClient(options: { walletOrigin: string }) {
  return {
    connect: (accountAddress?: string) =>
      requestDubheWalletBridge('connect', { accountAddress }, options),
    getAccounts: () => requestDubheWalletBridge('getAccounts', {}, options),
    signPersonalMessage: (message: string, accountAddress?: string) =>
      requestDubheWalletBridge('signPersonalMessage', { message, accountAddress }, options),
    signTransaction: (transaction: string, chain: string, accountAddress?: string) =>
      requestDubheWalletBridge(
        'signTransaction',
        { transaction, chain, accountAddress },
        options
      ),
    signAndExecuteTransaction: (
      transaction: string,
      chain: string,
      accountAddress?: string
    ) =>
      requestDubheWalletBridge(
        'signAndExecuteTransaction',
        { transaction, chain, accountAddress },
        options
      ),
  };
}
