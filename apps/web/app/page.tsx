'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import ProxyOnboardingCard from '@/app/components/ProxyOnboardingCard';
import { DIRECTION, Direction } from '@/game/common/direction';
import { IPropsPhaserGame, IRefPhaserGame } from '@/game/phaser-game';
import {
  clearDubheConnectIdentity,
  readDubheConnectIdentity,
} from '@/lib/dubhe-connect';
import { resolveCurrentDubheWalletLaunchContext } from '@/lib/dubhe-wallet-launch';

type VirtualAction = 'space' | 'enter' | 'back' | 'fullscreen';

type VirtualControlsBridge = {
  setVirtualDirection?: (direction: Direction) => void;
  clearVirtualDirection?: (direction?: Direction) => void;
  pressVirtualAction?: (action: VirtualAction) => void;
};

const PhaserGame = dynamic<IPropsPhaserGame>(() => import('@/game/phaser-game'), {
  ssr: false,
  // width/height copied from game config in main.ts
  loading: () => <div style={{ width: 1024, height: 576 }}></div>,
});

const isTouchLikeDevice = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || 'ontouchstart' in window);

function Page() {
  // The sprite can only be moved in the MainMenu Scene
  const [, setCanMoveSprite] = useState(false);
  // References to the PhaserGame component (game and scene are exposed)
  const phaserRef = useRef<IRefPhaserGame | null>(null);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);
  const [connectIdentity, setConnectIdentity] = useState(() =>
    readDubheConnectIdentity()
  );
  const [launchContext, setLaunchContext] = useState(() =>
    typeof window === 'undefined' ? null : resolveCurrentDubheWalletLaunchContext()
  );
  const authHref = launchContext?.walletOrigin
    ? `/auth/dubhe?wallet=${encodeURIComponent(launchContext.walletOrigin)}`
    : '/auth/dubhe';

  const getVirtualControls = useCallback((): VirtualControlsBridge | undefined => {
    const scene = phaserRef.current?.scene as { _controls?: VirtualControlsBridge } | null;
    if (scene?._controls) {
      return scene._controls;
    }

    if (typeof window !== 'undefined') {
      return (window as Window & { __numeronVirtualControls?: VirtualControlsBridge }).__numeronVirtualControls;
    }

    return undefined;
  }, []);

  const setVirtualDirection = useCallback(
    (direction: Direction) => {
      getVirtualControls()?.setVirtualDirection?.(direction);
    },
    [getVirtualControls],
  );

  const clearVirtualDirection = useCallback(
    (direction?: Direction) => {
      const controls = getVirtualControls();
      if (!controls) {
        return;
      }

      if (controls.clearVirtualDirection) {
        controls.clearVirtualDirection(direction);
        return;
      }

      controls.setVirtualDirection?.(DIRECTION.NONE);
    },
    [getVirtualControls],
  );

  const pressVirtualAction = useCallback(
    (action: VirtualAction) => {
      getVirtualControls()?.pressVirtualAction?.(action);
    },
    [getVirtualControls],
  );

  useEffect(() => {
    const refreshViewportState = () => {
      setIsTouchDevice(isTouchLikeDevice());
      setIsPortrait(window.innerHeight > window.innerWidth);
    };

    refreshViewportState();
    window.addEventListener('resize', refreshViewportState);
    window.addEventListener('orientationchange', refreshViewportState);

    return () => {
      window.removeEventListener('resize', refreshViewportState);
      window.removeEventListener('orientationchange', refreshViewportState);
    };
  }, []);

  useEffect(() => {
    if (!isTouchDevice) {
      return;
    }

    const releaseDirection = () => {
      clearVirtualDirection();
    };

    window.addEventListener('pointerup', releaseDirection);
    window.addEventListener('pointercancel', releaseDirection);
    window.addEventListener('blur', releaseDirection);

    return () => {
      window.removeEventListener('pointerup', releaseDirection);
      window.removeEventListener('pointercancel', releaseDirection);
      window.removeEventListener('blur', releaseDirection);
    };
  }, [clearVirtualDirection, isTouchDevice]);

  useEffect(() => {
    const refreshIdentity = () => {
      setConnectIdentity(readDubheConnectIdentity());
      setLaunchContext(resolveCurrentDubheWalletLaunchContext());
    };

    refreshIdentity();
    window.addEventListener('focus', refreshIdentity);
    document.addEventListener('visibilitychange', refreshIdentity);

    return () => {
      window.removeEventListener('focus', refreshIdentity);
      document.removeEventListener('visibilitychange', refreshIdentity);
    };
  }, []);

  return (
    <div id="app" className="numeron-app">
      <div
        style={{
          position: 'absolute',
          top: 'calc(10px + env(safe-area-inset-top))',
          left: 'calc(10px + env(safe-area-inset-left))',
          zIndex: 40,
          display: 'grid',
          gap: 6,
          pointerEvents: 'auto',
        }}
      >
        <Link
          href={authHref}
          style={{
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 34,
            borderRadius: 10,
            padding: '0 12px',
            background: 'rgba(15, 23, 42, 0.9)',
            color: '#f8fafc',
            fontSize: 12,
            fontWeight: 800,
            border: '1px solid rgba(148, 163, 184, 0.5)',
            backdropFilter: 'blur(2px)',
          }}
        >
          {connectIdentity ? 'Dubhe Signed In' : 'Dubhe Sign-in'}
        </Link>
        {connectIdentity ? (
          <div
            style={{
              borderRadius: 10,
              border: '1px solid rgba(148, 163, 184, 0.55)',
              background: 'rgba(241, 245, 249, 0.9)',
              color: '#0f172a',
              padding: '8px 10px',
              minWidth: 220,
              display: 'grid',
              gap: 6,
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 700 }}>
              {connectIdentity.address.slice(0, 10)}...{connectIdentity.address.slice(-8)}
            </div>
            <div style={{ color: '#334155' }}>{connectIdentity.network}</div>
            <button
              style={{
                border: '1px solid rgba(248, 113, 113, 0.5)',
                background: 'rgba(255, 241, 242, 0.95)',
                color: '#9f1239',
                borderRadius: 8,
                height: 28,
                padding: '0 8px',
                width: 'fit-content',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
              onClick={() => {
                clearDubheConnectIdentity();
                setConnectIdentity(null);
              }}
            >
              Clear Identity
            </button>
          </div>
        ) : null}
        <ProxyOnboardingCard />
      </div>
      <div className="numeron-game-shell">
        <PhaserGame ref={phaserRef} setCanMoveSprite={setCanMoveSprite} />
        {isTouchDevice && !isPortrait && (
          <div className="numeron-touch-hud" aria-hidden="true">
            <div className="numeron-dpad">
              <span className="numeron-dpad-placeholder"></span>
              <button
                className="numeron-touch-button"
                onPointerDown={event => {
                  event.preventDefault();
                  setVirtualDirection(DIRECTION.UP);
                }}
                onPointerUp={event => {
                  event.preventDefault();
                  clearVirtualDirection(DIRECTION.UP);
                }}
                onPointerCancel={event => {
                  event.preventDefault();
                  clearVirtualDirection(DIRECTION.UP);
                }}
              >
                U
              </button>
              <span className="numeron-dpad-placeholder"></span>
              <button
                className="numeron-touch-button"
                onPointerDown={event => {
                  event.preventDefault();
                  setVirtualDirection(DIRECTION.LEFT);
                }}
                onPointerUp={event => {
                  event.preventDefault();
                  clearVirtualDirection(DIRECTION.LEFT);
                }}
                onPointerCancel={event => {
                  event.preventDefault();
                  clearVirtualDirection(DIRECTION.LEFT);
                }}
              >
                L
              </button>
              <span className="numeron-dpad-placeholder"></span>
              <button
                className="numeron-touch-button"
                onPointerDown={event => {
                  event.preventDefault();
                  setVirtualDirection(DIRECTION.RIGHT);
                }}
                onPointerUp={event => {
                  event.preventDefault();
                  clearVirtualDirection(DIRECTION.RIGHT);
                }}
                onPointerCancel={event => {
                  event.preventDefault();
                  clearVirtualDirection(DIRECTION.RIGHT);
                }}
              >
                R
              </button>
              <span className="numeron-dpad-placeholder"></span>
              <button
                className="numeron-touch-button"
                onPointerDown={event => {
                  event.preventDefault();
                  setVirtualDirection(DIRECTION.DOWN);
                }}
                onPointerUp={event => {
                  event.preventDefault();
                  clearVirtualDirection(DIRECTION.DOWN);
                }}
                onPointerCancel={event => {
                  event.preventDefault();
                  clearVirtualDirection(DIRECTION.DOWN);
                }}
              >
                D
              </button>
              <span className="numeron-dpad-placeholder"></span>
            </div>
            <div className="numeron-action-buttons">
              <button
                className="numeron-touch-button numeron-touch-action"
                onPointerDown={event => {
                  event.preventDefault();
                  pressVirtualAction('space');
                }}
              >
                A
              </button>
              <button
                className="numeron-touch-button numeron-touch-action"
                onPointerDown={event => {
                  event.preventDefault();
                  pressVirtualAction('back');
                }}
              >
                B
              </button>
            </div>
          </div>
        )}
      </div>
      {isTouchDevice && isPortrait && (
        <div className="numeron-rotate-overlay" role="status" aria-live="polite">
          <div className="numeron-rotate-card">
            <p>Rotate to landscape</p>
            <span>Rotate to landscape for best playability.</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default Page;
