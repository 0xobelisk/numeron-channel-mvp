'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CSSProperties, useEffect, useMemo, useState } from 'react';
import {
  buildIdentityFromSession,
  createDubheConnectClient,
  DubheConnectSession,
  getConfiguredConnectRelayOrigin,
  parseDubheConnectCallbackUrl,
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

function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
}

export default function DubheAuthCallbackPage() {
  const router = useRouter();
  const [session, setSession] = useState<DubheConnectSession | null>(null);
  const [status, setStatus] = useState('Restoring sign-in session...');
  const [error, setError] = useState<string | null>(null);
  const [verifiedAddress, setVerifiedAddress] = useState<string | null>(null);
  const callbackInfo = useMemo(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    return parseDubheConnectCallbackUrl(window.location.href);
  }, []);

  useEffect(() => {
    if (!callbackInfo) {
      setError('Invalid callback params: missing session or relay.');
      setStatus('Failed to restore sign-in.');
      return;
    }

    if (typeof window !== 'undefined' && callbackInfo.callbackOrigin !== window.location.origin) {
      setError('Callback origin does not match this app.');
      setStatus('Failed to restore sign-in.');
      return;
    }

    const relayOrigin = getConfiguredConnectRelayOrigin(callbackInfo.relayOrigin);
    const client = createDubheConnectClient({ relayOrigin });
    let active = true;

    void (async () => {
      try {
        setStatus('Fetching session from relay...');
        const nextSession = validateDubheConnectSession(
          await client.getSession(callbackInfo.sessionId),
          {
            expectedSessionId: callbackInfo.sessionId,
            expectedRelayOrigin: callbackInfo.relayOrigin,
            expectedCallbackOrigin:
              typeof window === 'undefined' ? undefined : window.location.origin,
          }
        );
        if (!active) {
          return;
        }

        setSession(nextSession);
        if (nextSession.status === 'approved') {
          const verification = await verifyDubheConnectSession(nextSession);
          if (!active) {
            return;
          }
          const identity = buildIdentityFromSession(nextSession, verification);
          saveDubheConnectIdentity(identity);
          setVerifiedAddress(verification.address);
          setStatus(`Signed in: ${shorten(verification.address)} (signature verified)`);
          setError(null);
          return;
        }

        if (nextSession.status === 'rejected') {
          setStatus('Sign-in was rejected.');
          setError(nextSession.rejectionReason ?? null);
          return;
        }

        if (nextSession.status === 'expired') {
          setStatus('Sign-in session expired. Please start again.');
          return;
        }

        setStatus('Session is still waiting for wallet approval. Please go back and retry.');
      } catch (restoreError) {
        if (!active) {
          return;
        }
        setError(restoreError instanceof Error ? restoreError.message : 'Failed to restore session.');
        setStatus('Failed to restore sign-in.');
      }
    })();

    return () => {
      active = false;
    };
  }, [callbackInfo]);

  useEffect(() => {
    if (!verifiedAddress) {
      return;
    }

    const timer = window.setTimeout(() => {
      router.replace('/');
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [router, verifiedAddress]);

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <h1 style={styles.title}>Dubhe Connect Callback</h1>
        <div style={styles.status}>{status}</div>

        {error ? <div style={styles.error}>{error}</div> : null}

        {session ? (
          <section style={styles.card}>
            <div><strong>Session:</strong> {session.id}</div>
            <div><strong>Status:</strong> {session.status}</div>
            <div><strong>App:</strong> {session.request.appName}</div>
            <div><strong>Network:</strong> {session.request.network}</div>
            <div><strong>Approved:</strong> {session.result?.approvedAt ? formatTime(session.result.approvedAt) : '-'}</div>
            <div><strong>Relay:</strong> {callbackInfo?.relayOrigin}</div>
          </section>
        ) : null}

        <div style={styles.actions}>
          <Link href="/" style={styles.linkBtn}>Back to game</Link>
          <Link href="/auth/dubhe" style={styles.linkBtnSecondary}>Sign in again</Link>
        </div>
      </div>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    background: 'linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)',
    padding: 20,
  },
  shell: {
    width: 'min(720px, 100%)',
    borderRadius: 16,
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    padding: 16,
    display: 'grid',
    gap: 10,
  },
  title: {
    margin: 0,
    fontSize: 30,
    lineHeight: 1.1,
    color: '#0f172a',
    fontFamily: 'Kenney-Future-Narrow, sans-serif',
  },
  status: {
    borderRadius: 10,
    border: '1px solid #dbeafe',
    background: '#eff6ff',
    color: '#1e3a8a',
    padding: '10px 12px',
    fontSize: 14,
    fontWeight: 700,
  },
  error: {
    borderRadius: 10,
    border: '1px solid #fecaca',
    background: '#fff1f2',
    color: '#9f1239',
    padding: '10px 12px',
    fontSize: 13,
    lineHeight: 1.5,
  },
  card: {
    borderRadius: 12,
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    padding: 12,
    display: 'grid',
    gap: 6,
    color: '#0f172a',
    fontSize: 13,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  linkBtn: {
    textDecoration: 'none',
    borderRadius: 10,
    height: 36,
    padding: '0 12px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f172a',
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 800,
  },
  linkBtnSecondary: {
    textDecoration: 'none',
    borderRadius: 10,
    height: 36,
    padding: '0 12px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid #cbd5e1',
    background: '#f8fafc',
    color: '#0f172a',
    fontSize: 13,
    fontWeight: 700,
  },
};
