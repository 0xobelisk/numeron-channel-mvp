'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import ProxyOnboardingCard from '@/app/components/ProxyOnboardingCard';
import { DIRECTION, Direction } from '@/game/common/direction';
import { IPropsPhaserGame, IRefPhaserGame } from '@/game/phaser-game';

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
