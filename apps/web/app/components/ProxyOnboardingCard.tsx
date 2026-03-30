'use client';

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Transaction } from '@0xobelisk/sui-client';
import {
  ConnectButton,
  useCurrentAccount,
  useCurrentWallet,
  useSignAndExecuteTransaction,
} from '@mysten/dapp-kit';
import {
  FRAMEWORK_PACKAGE_ID,
  NETWORK,
  PACKAGE_ID,
  PROXY_DAPP_HUB_ID,
} from '@/config/contractDeployment';
import {
  appendCreateProxyTx,
  appendRemoveProxyTx,
  getDubheProxyRuntimeStatus,
  getDubheProxyBinding,
  hasDubheProxy,
  isDubheProxyActive,
} from '@/lib/dubhe-proxy';
import { DEFAULT_DUBHE_WALLET_ORIGIN } from '@/lib/dubhe-connect';
import {
  resolveCurrentDubheWalletLaunchContext,
  type DubheWalletLaunchContext,
} from '@/lib/dubhe-wallet-launch';
import {
  beginDubheWalletBridgeRedirect,
  clearDubheWalletBridgeRedirectResponse,
  createDubheWalletBridgeClient,
  readDubheWalletBridgeRedirectResponse,
  shouldPreferRedirectBridge,
} from '@/lib/dubhe-wallet-bridge';
import {
  clearNumeronProxyContext,
  readNumeronProxyContext,
  saveNumeronProxyContext,
} from '@/lib/proxy-context';
import { walletUtils } from '@/game/utils/wallet-utils';

const MIST_PER_SUI = BigInt(1_000_000_000);
const MS_PER_HOUR = 3_600_000;
const PROXY_PENDING_ACTION_STORAGE_KEY = 'NUMERON_PROXY_PENDING_ACTION_V1';

type ProxyState = {
  exists: boolean;
  active: boolean;
  owner: string | null;
  expiresAt: number | null;
};

type ProxyRuntimeState = {
  checked: boolean;
  available: boolean;
  reason: string | null;
};

type PendingProxyAction =
  | {
      requestId: string;
      action: 'fund';
      ownerAddress: string;
    }
  | {
      requestId: string;
      action: 'create';
      ownerAddress: string;
      expiresAt: number;
      walletOrigin: string;
    }
  | {
      requestId: string;
      action: 'remove';
      ownerAddress: string;
    };

function shorten(value: string, start = 10, end = 8) {
  if (value.length <= start + end + 3) {
    return value;
  }
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function formatExpiry(ms: number | null) {
  if (!ms) {
    return '-';
  }
  return new Date(ms).toLocaleString();
}

function readPendingProxyAction(): PendingProxyAction | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(PROXY_PENDING_ACTION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PendingProxyAction) : null;
  } catch {
    return null;
  }
}

function writePendingProxyAction(action: PendingProxyAction | null) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!action) {
    window.sessionStorage.removeItem(PROXY_PENDING_ACTION_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(PROXY_PENDING_ACTION_STORAGE_KEY, JSON.stringify(action));
}

export default function ProxyOnboardingCard() {
  const currentAccount = useCurrentAccount();
  const { connectionStatus } = useCurrentWallet();
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();
  const [launchContext, setLaunchContext] = useState<DubheWalletLaunchContext | null>(null);
  const [storedProxyContext, setStoredProxyContext] = useState<ReturnType<typeof readNumeronProxyContext>>(null);
  const [isClientReady, setIsClientReady] = useState(false);
  const [proxyState, setProxyState] = useState<ProxyState>({
    exists: false,
    active: false,
    owner: null,
    expiresAt: null,
  });
  const [proxyBalance, setProxyBalance] = useState<string>('0');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [proxyRuntime, setProxyRuntime] = useState<ProxyRuntimeState>({
    checked: false,
    available: false,
    reason: null,
  });

  const browserWalletChain = currentAccount?.chains?.find((chain) => chain.startsWith('sui:')) ?? null;
  const browserWalletNetwork = browserWalletChain?.slice('sui:'.length) ?? null;
  const connectedBrowserWallet = connectionStatus === 'connected' && Boolean(currentAccount?.address);
  const ownerAddress = connectedBrowserWallet
    ? currentAccount?.address ?? null
    : launchContext?.walletAddress ??
      storedProxyContext?.ownerAddress ??
      null;
  const walletOrigin =
    launchContext?.walletOrigin ??
    storedProxyContext?.walletOrigin ??
    DEFAULT_DUBHE_WALLET_ORIGIN;
  const walletNetwork =
    (connectedBrowserWallet ? browserWalletNetwork : null) ??
    launchContext?.walletNetwork ??
    NETWORK;
  const proxyAddress = walletUtils.getSignerAddress();
  const bridgeClient = useMemo(() => createDubheWalletBridgeClient({ walletOrigin }), [walletOrigin]);
  const canUseProxy = proxyRuntime.available && Boolean(FRAMEWORK_PACKAGE_ID);
  const canUseBrowserWallet = connectedBrowserWallet && currentAccount?.address === ownerAddress;

  const executeOwnerTransaction = async ({
    tx,
    pending,
  }: {
    tx: Transaction;
    pending?: PendingProxyAction;
  }) => {
    if (canUseBrowserWallet && currentAccount) {
      await signAndExecuteTransaction({
        transaction: tx,
        chain: `sui:${walletNetwork}`,
        account: currentAccount,
      });
      return 'browser-wallet' as const;
    }

    if (shouldPreferRedirectBridge()) {
      const request = beginDubheWalletBridgeRedirect(
        'signAndExecuteTransaction',
        {
          transaction: await tx.toJSON(),
          chain: `sui:${walletNetwork}`,
          accountAddress: ownerAddress!,
        },
        {
          walletOrigin,
          returnUrl: window.location.href,
        }
      );
      if (pending) {
        writePendingProxyAction({
          ...pending,
          requestId: request.id,
        });
      }
      return 'redirect-bridge' as const;
    }

    await bridgeClient.signAndExecuteTransaction(
      await tx.toJSON(),
      `sui:${walletNetwork}`,
      ownerAddress!
    );
    return 'wallet-bridge' as const;
  };

  const refreshLaunchState = () => {
    setLaunchContext(resolveCurrentDubheWalletLaunchContext());
    setStoredProxyContext(readNumeronProxyContext());
  };

  const refreshProxyBalance = async () => {
    try {
      const balance = await walletUtils.dubhe.client().getBalance({
        owner: proxyAddress,
        coinType: '0x2::sui::SUI',
      });
      setProxyBalance((Number(balance.totalBalance) / 1_000_000_000).toFixed(4));
    } catch {
      setProxyBalance('0');
    }
  };

  const refreshProxyState = async () => {
    if (!ownerAddress || !FRAMEWORK_PACKAGE_ID) {
      setProxyState({ exists: false, active: false, owner: null, expiresAt: null });
      setProxyRuntime({ checked: true, available: false, reason: null });
      walletUtils.resetCurrentPlayerToBootstrap();
      return;
    }

    try {
      const runtimeStatus = await getDubheProxyRuntimeStatus({
        dubhe: walletUtils.dubhe,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
      });
      setProxyRuntime({ checked: true, ...runtimeStatus });

      if (!runtimeStatus.available) {
        clearNumeronProxyContext();
        walletUtils.resetCurrentPlayerToBootstrap();
        setProxyState({ exists: false, active: false, owner: null, expiresAt: null });
        return;
      }

      const exists = await hasDubheProxy({
        dubhe: walletUtils.dubhe,
        dappHubId: PROXY_DAPP_HUB_ID,
        proxyAddress,
        packageId: PACKAGE_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
      });

      if (!exists) {
        clearNumeronProxyContext();
        walletUtils.resetCurrentPlayerToBootstrap();
        setProxyState({ exists: false, active: false, owner: null, expiresAt: null });
        return;
      }

      const binding = await getDubheProxyBinding({
        dubhe: walletUtils.dubhe,
        dappHubId: PROXY_DAPP_HUB_ID,
        proxyAddress,
        packageId: PACKAGE_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
      });
      const active = binding
        ? await isDubheProxyActive({
            dubhe: walletUtils.dubhe,
            dappHubId: PROXY_DAPP_HUB_ID,
            proxyAddress,
            packageId: PACKAGE_ID,
            frameworkPackageId: FRAMEWORK_PACKAGE_ID,
          })
        : false;

      if (binding && active) {
        walletUtils.setCurrentPlayer(binding.owner);
        saveNumeronProxyContext({
          version: 1,
          ownerAddress: binding.owner,
          proxyAddress,
          walletOrigin,
          expiresAt: binding.expiresAt,
          approvedAt: new Date().toISOString(),
        });
      } else {
        clearNumeronProxyContext();
        walletUtils.resetCurrentPlayerToBootstrap();
      }

      setProxyState({
        exists,
        active,
        owner: binding?.owner ?? null,
        expiresAt: binding?.expiresAt ?? null,
      });
    } catch (error) {
      setProxyRuntime({
        checked: true,
        available: false,
        reason: error instanceof Error ? error.message : 'Failed to query Dubhe proxy runtime.',
      });
      setStatus(error instanceof Error ? error.message : 'Failed to query proxy status.');
    }
  };

  useEffect(() => {
    setIsClientReady(true);
    refreshLaunchState();
    window.addEventListener('focus', refreshLaunchState);
    document.addEventListener('visibilitychange', refreshLaunchState);
    return () => {
      window.removeEventListener('focus', refreshLaunchState);
      document.removeEventListener('visibilitychange', refreshLaunchState);
    };
  }, []);

  useEffect(() => {
    const redirected = readDubheWalletBridgeRedirectResponse();
    const pending = readPendingProxyAction();

    if (!redirected || !pending || redirected.requestId !== pending.requestId) {
      return;
    }

    clearDubheWalletBridgeRedirectResponse();
    writePendingProxyAction(null);

    if (!redirected.payload.ok) {
      const failure = redirected.payload as {
        ok: false;
        error: {
          message: string;
        };
      };
      setStatus(failure.error.message || 'Wallet bridge request failed.');
      return;
    }

    if (pending.action === 'fund') {
      setStatus('1 SUI transferred to the proxy signer.');
      window.setTimeout(() => {
        void refreshProxyBalance();
      }, 1200);
      return;
    }

    if (pending.action === 'create') {
      saveNumeronProxyContext({
        version: 1,
        ownerAddress: pending.ownerAddress,
        proxyAddress,
        walletOrigin: pending.walletOrigin,
        expiresAt: pending.expiresAt,
        approvedAt: new Date().toISOString(),
      });
      walletUtils.setCurrentPlayer(pending.ownerAddress);
      setStatus('Proxy binding created. Reloading Numeron so gameplay switches to the owner identity.');
      window.setTimeout(() => window.location.reload(), 900);
      return;
    }

    clearNumeronProxyContext();
    walletUtils.resetCurrentPlayerToBootstrap();
    setStatus('Proxy binding removed. Reloading Numeron back to the local burner identity.');
    window.setTimeout(() => window.location.reload(), 900);
  }, [proxyAddress]);

  useEffect(() => {
    void refreshProxyBalance();
  }, [proxyAddress]);

  useEffect(() => {
    void refreshProxyState();
  }, [ownerAddress, proxyAddress, walletOrigin]);

  const fundProxy = async () => {
    if (!ownerAddress) {
      return;
    }

    try {
      setBusyAction('fund');
      const tx = new Transaction();
      tx.setGasBudget(BigInt(2_000_000));
      tx.transferObjects([tx.splitCoins(tx.gas, [MIST_PER_SUI])], proxyAddress);
      const route = await executeOwnerTransaction({
        tx,
        pending: {
          requestId: '',
          action: 'fund',
          ownerAddress,
        },
      });
      if (route === 'redirect-bridge') {
        return;
      }
      setStatus('1 SUI transferred to the proxy signer.');
      window.setTimeout(() => {
        void refreshProxyBalance();
      }, 1200);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to fund proxy signer.');
    } finally {
      setBusyAction(null);
    }
  };

  const createProxy = async () => {
    if (!ownerAddress || !FRAMEWORK_PACKAGE_ID || !proxyRuntime.available) {
      return;
    }

    try {
      setBusyAction('create');
      const expiresAt = Date.now() + 24 * MS_PER_HOUR;
      const tx = new Transaction();
      await appendCreateProxyTx({
        tx,
        dappHubId: PROXY_DAPP_HUB_ID,
        ownerAddress,
        proxySecretKey: walletUtils.getSigningSecretKey(),
        packageId: PACKAGE_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
        expiresAt,
      });
      const route = await executeOwnerTransaction({
        tx,
        pending: {
          requestId: '',
          action: 'create',
          ownerAddress,
          expiresAt,
          walletOrigin,
        },
      });
      if (route === 'redirect-bridge') {
        return;
      }
      saveNumeronProxyContext({
        version: 1,
        ownerAddress,
        proxyAddress,
        walletOrigin,
        expiresAt,
        approvedAt: new Date().toISOString(),
      });
      walletUtils.setCurrentPlayer(ownerAddress);
      setStatus('Proxy binding created. Reloading Numeron so gameplay switches to the owner identity.');
      await refreshProxyState();
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to create proxy binding.');
    } finally {
      setBusyAction(null);
    }
  };

  const removeProxy = async () => {
    if (!ownerAddress || !FRAMEWORK_PACKAGE_ID || !proxyRuntime.available) {
      return;
    }

    try {
      setBusyAction('remove');
      const tx = new Transaction();
      appendRemoveProxyTx({
        tx,
        dappHubId: PROXY_DAPP_HUB_ID,
        proxyAddress,
        packageId: PACKAGE_ID,
        frameworkPackageId: FRAMEWORK_PACKAGE_ID,
      });
      const route = await executeOwnerTransaction({
        tx,
        pending: {
          requestId: '',
          action: 'remove',
          ownerAddress,
        },
      });
      if (route === 'redirect-bridge') {
        return;
      }
      clearNumeronProxyContext();
      walletUtils.resetCurrentPlayerToBootstrap();
      setStatus('Proxy binding removed. Reloading Numeron back to the local burner identity.');
      await refreshProxyState();
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to remove proxy binding.');
    } finally {
      setBusyAction(null);
    }
  };

  const showWalletHint = !ownerAddress;

  return (
    <div
      style={{
        borderRadius: 12,
        border: '1px solid rgba(148, 163, 184, 0.55)',
        background: 'rgba(248, 250, 252, 0.94)',
        color: '#0f172a',
        padding: '10px 12px',
        minWidth: 280,
        maxWidth: 340,
        display: 'grid',
        gap: 8,
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 13 }}>Wallet Proxy</div>
      <div style={{ color: '#334155', lineHeight: 1.5 }}>
        Owner: {ownerAddress ? shorten(ownerAddress) : 'Not connected'}
      </div>
      <div style={{ color: '#334155', lineHeight: 1.5 }}>
        Signer: {shorten(proxyAddress)} ({proxyBalance} SUI)
      </div>
      <div style={{ color: '#334155', lineHeight: 1.5 }}>
        Status:{' '}
        {proxyState.active
          ? `Active until ${formatExpiry(proxyState.expiresAt)}`
          : proxyState.exists
            ? 'Binding exists but is inactive/expired'
            : 'No binding'}
      </div>
      {storedProxyContext ? (
        <div style={{ color: '#475569', lineHeight: 1.5 }}>
          Stored owner: {shorten(storedProxyContext.ownerAddress)}
        </div>
      ) : null}
      {!FRAMEWORK_PACKAGE_ID ? (
        <div style={{ color: '#9f1239', lineHeight: 1.5 }}>
          Missing a Dubhe framework package id. Set <code>NEXT_PUBLIC_DUBHE_FRAMEWORK_PACKAGE_ID</code>{' '}
          if this environment should use a non-default package.
        </div>
      ) : null}
      {FRAMEWORK_PACKAGE_ID && proxyRuntime.checked && !proxyRuntime.available ? (
        <div style={{ color: '#9f1239', lineHeight: 1.5 }}>{proxyRuntime.reason}</div>
      ) : null}
      {showWalletHint ? (
        <div style={{ color: '#334155', lineHeight: 1.5 }}>
          Connect a browser Sui wallet or open Numeron from Dubhe Wallet first.
        </div>
      ) : null}
      {isClientReady && !currentAccount ? (
        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <ConnectButton />
        </div>
      ) : null}
      {status ? <div style={{ color: '#1d4ed8', lineHeight: 1.5 }}>{status}</div> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          onClick={() => void fundProxy()}
          disabled={!ownerAddress || Boolean(busyAction)}
          style={buttonStyle('#15803d')}
        >
          {busyAction === 'fund' ? 'Funding...' : 'Fund 1 SUI'}
        </button>
        <button
          type="button"
          onClick={() => void createProxy()}
          disabled={!ownerAddress || !canUseProxy || Boolean(busyAction)}
          style={buttonStyle('#7c3aed')}
        >
          {busyAction === 'create' ? 'Creating...' : proxyState.active ? 'Refresh Proxy' : 'Create Proxy'}
        </button>
        <button
          type="button"
          onClick={() => void removeProxy()}
          disabled={!ownerAddress || !proxyState.exists || Boolean(busyAction)}
          style={buttonStyle('#b91c1c')}
        >
          {busyAction === 'remove' ? 'Removing...' : 'Remove Proxy'}
        </button>
      </div>
    </div>
  );
}

function buttonStyle(background: string) {
  return {
    border: 'none',
    borderRadius: 8,
    height: 30,
    padding: '0 10px',
    background,
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  } satisfies CSSProperties;
}
