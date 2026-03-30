'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CSSProperties, Suspense, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import clientConfig from '@/config/clientConfig';
import {
  buildIdentityFromSession,
  clearDubheConnectIdentity,
  createDubheConnectClient,
  DEFAULT_DUBHE_CONNECT_STATEMENT,
  DubheConnectSession,
  getConfiguredConnectRelayOrigin,
  getConfiguredWalletOrigin,
  isDubheConnectExpired,
  readDubheConnectIdentity,
  saveDubheConnectIdentity,
  validateDubheConnectSession,
  verifyDubheConnectSession,
} from '@/lib/dubhe-connect';

function shorten(value: string, start = 10, end = 8) {
  if (value.length <= start + end + 3) {
    return value;
  }
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function formatSeconds(value: number) {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
}

function DubheAuthPageContent() {
  const searchParams = useSearchParams();
  const relayOverride = searchParams.get('relay');
  const walletOverride = searchParams.get('wallet');
  const relayOrigin = useMemo(() => getConfiguredConnectRelayOrigin(relayOverride), [relayOverride]);
  const walletOrigin = useMemo(() => getConfiguredWalletOrigin(walletOverride), [walletOverride]);
  const client = useMemo(
    () => createDubheConnectClient({ relayOrigin }),
    [relayOrigin]
  );

  const [session, setSession] = useState<DubheConnectSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Ready.');
  const [busy, setBusy] = useState<'create' | 'poll' | 'copy' | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [identity, setIdentity] = useState(() => readDubheConnectIdentity());

  const sanitizeSession = (nextSession: DubheConnectSession, expectedSessionId?: string) =>
    validateDubheConnectSession(nextSession, {
      expectedSessionId,
      expectedRelayOrigin: relayOrigin,
      expectedWalletOrigin: walletOrigin,
      expectedCallbackOrigin:
        typeof window === 'undefined' ? undefined : window.location.origin,
    });

  const createSession = async () => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      setBusy('create');
      setStatus('Creating sign-in session...');
      const appOrigin = window.location.origin;
      const callbackUrl = new URL('/auth/dubhe/callback', appOrigin).toString();
      const nextSession = sanitizeSession(
        await client.createSession({
          appName: 'Numeron',
          origin: appOrigin,
          network: clientConfig.SUI_NETWORK_NAME,
          walletOrigin,
          callbackUrl,
          statement: DEFAULT_DUBHE_CONNECT_STATEMENT,
          expiresInMs: 5 * 60 * 1000,
        })
      );
      setSession(nextSession);
      setStatus('Session created. Continue on this device or scan with your phone.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to create session.');
    } finally {
      setBusy(null);
    }
  };

  const refreshSession = async () => {
    if (!session) {
      return;
    }

    try {
      setBusy('poll');
      const next = sanitizeSession(await client.getSession(session.id), session.id);
      setSession(next);

      if (next.status === 'approved') {
        const verification = await verifyDubheConnectSession(next);
        const nextIdentity = buildIdentityFromSession(next, verification);
        saveDubheConnectIdentity(nextIdentity);
        setIdentity(nextIdentity);
        setStatus(`Signed in: ${shorten(verification.address)} (signature verified)`);
      } else if (next.status === 'rejected') {
        setStatus(next.rejectionReason ?? 'This session was rejected.');
      } else if (isDubheConnectExpired(next)) {
        setStatus('Session expired. Please create a new session.');
      } else {
        setStatus('Session is still waiting for wallet approval.');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to refresh session.');
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    if (!session?.approvalUrl) {
      return;
    }

    try {
      setBusy('copy');
      await navigator.clipboard.writeText(session.approvalUrl);
      setStatus('Sign-in link copied.');
    } catch {
      setStatus('Copy failed. Please copy the link manually.');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!session?.approvalUrl) {
      setQrDataUrl(null);
      return;
    }

    let active = true;
    void QRCode.toDataURL(session.approvalUrl, {
      margin: 1,
      width: 680,
      color: {
        dark: '#111827',
        light: '#ffffff',
      },
    }).then(dataUrl => {
      if (active) {
        setQrDataUrl(dataUrl);
      }
    });

    return () => {
      active = false;
    };
  }, [session?.approvalUrl]);

  useEffect(() => {
    if (!session?.request.expiresAt) {
      setSecondsRemaining(null);
      return;
    }

    const tick = () => {
      const seconds = Math.ceil(
        (new Date(session.request.expiresAt).getTime() - Date.now()) / 1000
      );
      setSecondsRemaining(Math.max(0, seconds));
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [session?.request.expiresAt]);

  useEffect(() => {
    if (!session?.id || session.status !== 'pending') {
      return;
    }

    const timer = window.setInterval(() => {
      void client
        .getSession(session.id)
        .then(nextSession => sanitizeSession(nextSession, session.id))
        .then(async trustedSession => {
          setSession(trustedSession);
          if (trustedSession.status !== 'approved') {
            return;
          }
          const verification = await verifyDubheConnectSession(trustedSession);
          const nextIdentity = buildIdentityFromSession(trustedSession, verification);
          saveDubheConnectIdentity(nextIdentity);
          setIdentity(nextIdentity);
          setStatus(`Signed in: ${shorten(verification.address)} (signature verified)`);
        })
        .catch(error => {
          setStatus(error instanceof Error ? error.message : 'Session polling failed.');
        });
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [client, session?.id, session?.status]);

  const sessionExpired = session ? isDubheConnectExpired(session) : false;
  const statusColor =
    session?.status === 'approved'
      ? '#065f46'
      : session?.status === 'rejected'
        ? '#991b1b'
        : sessionExpired
          ? '#92400e'
          : '#1d4ed8';

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.headerRow}>
          <Link href="/" style={styles.backLink}>Back to game</Link>
          <div style={styles.titleWrap}>
            <h1 style={styles.title}>Dubhe Connect Sign-in</h1>
            <p style={styles.sub}>Same-device redirect + cross-device QR scan are both supported.</p>
          </div>
        </div>

        <section style={styles.card}>
          <div style={styles.metaGrid}>
            <div><strong>Relay:</strong> <code>{relayOrigin}</code></div>
            <div><strong>Wallet:</strong> <code>{walletOrigin}</code></div>
            <div><strong>Network:</strong> <code>{clientConfig.SUI_NETWORK_NAME}</code></div>
            <div><strong>Callback:</strong> <code>/auth/dubhe/callback</code></div>
          </div>
          <div style={styles.actions}>
            <button style={styles.primaryBtn} onClick={() => void createSession()} disabled={Boolean(busy)}>
              {busy === 'create' ? 'Creating...' : 'Create Sign-in Session'}
            </button>
            <button
              style={styles.secondaryBtn}
              disabled={!session?.approvalUrl}
              onClick={() => {
                if (!session?.approvalUrl) {
                  return;
                }
                window.location.assign(session.approvalUrl);
              }}
            >
              Continue on This Device
            </button>
            <button style={styles.secondaryBtn} disabled={!session?.id || Boolean(busy)} onClick={() => void refreshSession()}>
              {busy === 'poll' ? 'Refreshing...' : 'Refresh Status'}
            </button>
            <button style={styles.secondaryBtn} disabled={!session?.approvalUrl || Boolean(busy)} onClick={() => void handleCopy()}>
              {busy === 'copy' ? 'Copying...' : 'Copy Sign-in Link'}
            </button>
          </div>
          <div style={{ ...styles.status, color: statusColor }}>{status}</div>
        </section>

        {session ? (
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Current Session</h2>
            <div style={styles.metaGrid}>
              <div><strong>ID:</strong> {session.id}</div>
              <div><strong>Status:</strong> {session.status}</div>
              <div><strong>Time Left:</strong> {secondsRemaining == null ? '-' : formatSeconds(secondsRemaining)}</div>
              <div><strong>Expires At:</strong> {formatTime(session.request.expiresAt)}</div>
            </div>
            <div style={styles.linkWrap}>
              <strong>Sign-in Link:</strong>
              <div style={styles.linkText}>{session.approvalUrl}</div>
            </div>
            {qrDataUrl ? (
              <div style={styles.qrWrap}>
                <img src={qrDataUrl} alt="Dubhe Connect QR" style={styles.qrImage} />
                <div style={styles.qrHint}>Open Dubhe Wallet on phone and scan to approve.</div>
              </div>
            ) : null}
          </section>
        ) : null}

        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Current Identity</h2>
          {identity ? (
            <>
              <div style={styles.metaGrid}>
                <div><strong>Address:</strong> {identity.address}</div>
                <div><strong>App:</strong> {identity.appName}</div>
                <div><strong>Network:</strong> {identity.network}</div>
                <div><strong>Approved:</strong> {formatTime(identity.approvedAt)}</div>
              </div>
              <button
                style={styles.dangerBtn}
                onClick={() => {
                  clearDubheConnectIdentity();
                  setIdentity(null);
                  setStatus('Local identity cleared.');
                }}
              >
                Clear Identity
              </button>
            </>
          ) : (
            <div style={styles.emptyText}>No saved Dubhe Connect identity.</div>
          )}
        </section>

        <section style={styles.noteCard}>
          <strong>Note:</strong> Dubhe Connect gives Numeron a verified wallet identity. If the game is opened from Dubhe Wallet, Numeron can also use the wallet bridge to create a proxy signer once, then keep gameplay on the local burner/proxy signer without repeated wallet confirmations.
        </section>
      </div>
    </main>
  );
}

export default function DubheAuthPage() {
  return (
    <Suspense fallback={<main style={styles.page}>Loading...</main>}>
      <DubheAuthPageContent />
    </Suspense>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    padding: '20px 14px 40px',
    background: 'linear-gradient(180deg, #f3f6ff 0%, #ecf3ff 100%)',
    overflowY: 'auto',
  },
  shell: {
    width: '100%',
    maxWidth: 980,
    margin: '0 auto',
    display: 'grid',
    gap: 12,
  },
  headerRow: {
    display: 'grid',
    gap: 8,
  },
  backLink: {
    width: 'fit-content',
    textDecoration: 'none',
    color: '#1e3a8a',
    fontWeight: 700,
    fontSize: 14,
  },
  titleWrap: {
    display: 'grid',
    gap: 4,
  },
  title: {
    margin: 0,
    fontSize: 30,
    lineHeight: 1.1,
    color: '#0f172a',
    fontWeight: 800,
    fontFamily: 'Kenney-Future-Narrow, sans-serif',
  },
  sub: {
    margin: 0,
    color: '#334155',
    fontSize: 13,
  },
  card: {
    borderRadius: 14,
    background: '#ffffff',
    border: '1px solid #dbe5f3',
    padding: 14,
    display: 'grid',
    gap: 10,
  },
  noteCard: {
    borderRadius: 14,
    background: '#fff9e8',
    border: '1px solid #f4e0a8',
    padding: 12,
    color: '#713f12',
    fontSize: 13,
    lineHeight: 1.5,
  },
  cardTitle: {
    margin: 0,
    fontSize: 20,
    lineHeight: 1.1,
    color: '#0f172a',
    fontWeight: 800,
    fontFamily: 'Kenney-Future-Narrow, sans-serif',
  },
  metaGrid: {
    display: 'grid',
    gap: 6,
    color: '#1e293b',
    fontSize: 13,
    lineHeight: 1.5,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  primaryBtn: {
    border: 0,
    borderRadius: 10,
    height: 36,
    padding: '0 12px',
    background: '#0f172a',
    color: '#fff',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  },
  secondaryBtn: {
    border: '1px solid #cbd5e1',
    borderRadius: 10,
    height: 36,
    padding: '0 12px',
    background: '#f8fafc',
    color: '#0f172a',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  dangerBtn: {
    border: '1px solid #fecaca',
    borderRadius: 10,
    height: 36,
    width: 'fit-content',
    padding: '0 12px',
    background: '#fff1f2',
    color: '#9f1239',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  status: {
    borderRadius: 10,
    background: '#eef4ff',
    border: '1px solid #d8e5fb',
    padding: '8px 10px',
    fontSize: 13,
    fontWeight: 700,
  },
  linkWrap: {
    display: 'grid',
    gap: 6,
    color: '#0f172a',
    fontSize: 13,
  },
  linkText: {
    borderRadius: 10,
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    padding: 10,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    lineHeight: 1.45,
    wordBreak: 'break-all',
  },
  qrWrap: {
    display: 'grid',
    justifyItems: 'center',
    gap: 8,
    borderRadius: 12,
    border: '1px dashed #cbd5e1',
    padding: 12,
    background: '#fafcff',
  },
  qrImage: {
    width: 'min(72vw, 320px)',
    height: 'auto',
    borderRadius: 10,
    border: '1px solid #e2e8f0',
    background: '#fff',
  },
  qrHint: {
    color: '#475569',
    fontSize: 12,
  },
  emptyText: {
    color: '#475569',
    fontSize: 13,
  },
};
