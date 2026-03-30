import { dataManager } from './utils/data-manager';
import { walletUtils } from './utils/wallet-utils';
import { SCENE_KEYS } from './scenes/scene-keys';
import { WorldScene } from './scenes/world-scene';
import { generateBrowserIdentity } from '@/lib/browser-identity';

type DebugDirection = 'LEFT' | 'RIGHT' | 'UP' | 'DOWN';

type DebugFeedEntry = {
  sequence: number;
  summary: string;
  detail?: string;
  source: string;
  observedAtMs: number;
  displayText: string;
};

type DebugWorldPlayerState = {
  x: number;
  y: number;
  moving: boolean;
  chainMovementPending: boolean;
  direction: unknown;
};

type MovementPhaseTimings = {
  fastPathLatencyMs: number | null;
  submitAckLatencyMs: number | null;
  settlementLatencyMs: number | null;
  fastPathEntry: DebugFeedEntry | null;
  submitAckEntry: DebugFeedEntry | null;
  settlementEntry: DebugFeedEntry | null;
};

type WaitForFeedEntryOptions = {
  afterSequence?: number;
  summaries?: string[];
  source?: string;
  detail?: string;
  timeoutMs?: number;
};

type MeasureMovePipelineOptions = {
  fastPathTimeoutMs?: number;
  submitAckTimeoutMs?: number;
  settlementTimeoutMs?: number;
  settlementDetail?: string;
};

type DebugWorldScene = WorldScene & {
  debugMove?: (direction: DebugDirection) => Promise<unknown>;
  debugRegisterCurrentPlayer?: (timeoutMs?: number) => Promise<unknown>;
  debugPrepareForBenchmark?: (timeoutMs?: number) => Promise<unknown>;
  debugGetAvailableMoveDirections?: (directions?: DebugDirection[]) => DebugDirection[];
  debugState?: () => unknown;
};

type DebugRegisterProbeResult = {
  rawAccountKey: string;
  contractAccountKey: string;
  submitResult: unknown;
  rawAccountPosition: unknown;
  contractAccountPosition: unknown;
  waitedPosition: unknown;
  state: DebugState;
};

type DebugState = {
  activeSceneKeys: string[];
  currentPlayer: string;
  selectedPlayer: string | null;
  world: {
    scene: string;
    area: string | null;
    currentPlayer: string;
    player: DebugWorldPlayerState | null;
    otherPlayers: number;
    subscriptionActive: boolean;
    feedEntries: string[];
    feedDebugEntries?: DebugFeedEntry[];
  } | null;
};

type DebugPlayerIdentity = {
  address: string;
  secretKey: string;
  source: string;
  state: DebugState;
};

declare global {
  interface Window {
    __numeronDebug?: {
      getState: () => DebugState;
      getActiveSceneKeys: () => string[];
      setChannelUrl: (channelUrl: string) => DebugState;
      getChannelUrl: () => string;
      getRegisterSenderAddress: () => string;
      getCurrentPlayerContractKey: () => string;
      setCurrentPlayer: (address: string) => DebugState;
      setCurrentPlayerSecretKey: (secretKey: string) => DebugState;
      createRandomPlayer: () => DebugPlayerIdentity;
      setRegisterSenderAddress: (address: string | null) => DebugState;
      selectCurrentPlayerAndEnterWorld: () => Promise<DebugState>;
      enterWorldAs: (address: string) => Promise<DebugState>;
      queryPosition: (account?: string) => Promise<unknown>;
      registerCurrentPlayer: (timeoutMs?: number) => Promise<DebugRegisterProbeResult>;
      prepareCurrentPlayerForBenchmark: (timeoutMs?: number) => Promise<DebugState>;
      getAvailableMoveDirections: (directions?: DebugDirection[]) => DebugDirection[];
      move: (direction: DebugDirection) => Promise<DebugState>;
      waitForFeedEntry: (options?: WaitForFeedEntryOptions) => Promise<{
        entry: DebugFeedEntry;
        state: DebugState;
      }>;
      measureMoveSettlement: (
        direction: DebugDirection,
        options?: WaitForFeedEntryOptions,
      ) => Promise<{
        direction: DebugDirection;
        latencyMs: number;
        matchedEntry: DebugFeedEntry;
        beforeState: DebugState;
        finalState: DebugState;
      }>;
      measureMovePipeline: (
        direction: DebugDirection,
        options?: MeasureMovePipelineOptions,
      ) => Promise<{
        direction: DebugDirection;
        beforeState: DebugState;
        finalState: DebugState;
        phases: MovementPhaseTimings;
      }>;
    };
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => Promise<void>;
  }
}

function getWorldScene(game: Phaser.Game): DebugWorldScene | null {
  const scene = game.scene.getScene(SCENE_KEYS.WORLD_SCENE);
  if (!scene || !scene.scene.isActive()) {
    return null;
  }

  return scene as DebugWorldScene;
}

function buildDebugState(game: Phaser.Game): DebugState {
  const worldScene = getWorldScene(game);

  return {
    activeSceneKeys: game.scene.getScenes(true).map(scene => scene.scene.key),
    currentPlayer: walletUtils.getCurrentAccount().address,
    selectedPlayer: walletUtils.getSelectedPlayer(),
    world: worldScene?.debugState?.() ?? null,
  };
}

async function waitForWorldReady(game: Phaser.Game, timeoutMs = 20_000): Promise<DebugState> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = buildDebugState(game);
    if (state.world?.player && state.world.subscriptionActive) {
      return state;
    }
    await new Promise(resolve => window.setTimeout(resolve, 50));
  }

  return buildDebugState(game);
}

function getFeedDebugEntries(state: DebugState): DebugFeedEntry[] {
  return state.world?.feedDebugEntries ?? [];
}

function findMatchingFeedEntry(state: DebugState, options: WaitForFeedEntryOptions = {}) {
  const entries = getFeedDebugEntries(state);

  return entries.find(entry => {
    if (options.afterSequence != null && entry.sequence <= options.afterSequence) {
      return false;
    }

    if (options.source && entry.source !== options.source) {
      return false;
    }

    if (options.detail && entry.detail !== options.detail) {
      return false;
    }

    if (options.summaries && options.summaries.length > 0 && !options.summaries.includes(entry.summary)) {
      return false;
    }

    return true;
  });
}

function didMoveAttemptStart(beforeState: DebugState, afterState: DebugState, afterSequence: number) {
  const beforePlayer = beforeState.world?.player;
  const afterPlayer = afterState.world?.player;
  const newEntries = getFeedDebugEntries(afterState).filter(entry => entry.sequence > afterSequence);

  if (!beforePlayer || !afterPlayer) {
    return newEntries.length > 0;
  }

  const positionChanged = beforePlayer.x !== afterPlayer.x || beforePlayer.y !== afterPlayer.y;
  const movementPending = Boolean(afterPlayer.moving || afterPlayer.chainMovementPending);
  const movementFeedSeen = newEntries.some(
    entry =>
      entry.source === 'fast_path' ||
      entry.source === 'submit_ack' ||
      entry.summary === 'submit_error' ||
      entry.summary === 'register_error',
  );

  return positionChanged || movementPending || movementFeedSeen;
}

function shouldTreatMoveTimeoutAsBlockedOrIgnored(
  beforeState: DebugState,
  afterState: DebugState,
  afterSequence: number,
  detail?: string,
) {
  const beforePlayer = beforeState.world?.player;
  const afterPlayer = afterState.world?.player;

  if (!beforePlayer || !afterPlayer) {
    return false;
  }

  const newEntries = getFeedDebugEntries(afterState).filter(entry => entry.sequence > afterSequence);
  const ownRelevantEntrySeen = newEntries.some(entry => {
    if (detail && entry.detail !== detail) {
      return false;
    }

    return (
      entry.source === 'fast_path' ||
      entry.source === 'submit_ack' ||
      entry.summary === 'position' ||
      entry.summary === 'submit_error'
    );
  });

  const positionUnchanged = beforePlayer.x === afterPlayer.x && beforePlayer.y === afterPlayer.y;
  const movementIdle = !afterPlayer.moving && !afterPlayer.chainMovementPending;

  return positionUnchanged && movementIdle && !ownRelevantEntrySeen;
}

function stopSceneIfRunning(game: Phaser.Game, sceneKey: string) {
  if (game.scene.isActive(sceneKey) || game.scene.isSleeping(sceneKey)) {
    game.scene.stop(sceneKey);
  }
}

export function installDevHarness(game: Phaser.Game) {
  const enableDebugHarness =
    process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_ENABLE_NUMERON_DEBUG === 'true';

  if (!enableDebugHarness || typeof window === 'undefined') {
    return;
  }

  const waitForFeedEntry = async (options: WaitForFeedEntryOptions = {}) => {
    const timeoutMs = options.timeoutMs ?? 8000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const state = buildDebugState(game);
      const entry = findMatchingFeedEntry(state, options);
      if (entry) {
        return { entry, state };
      }
      await new Promise(resolve => window.setTimeout(resolve, 50));
    }

    throw new Error(
      `Timed out waiting for feed entry: ${JSON.stringify({
        afterSequence: options.afterSequence ?? null,
        summaries: options.summaries ?? null,
        source: options.source ?? null,
        detail: options.detail ?? null,
        timeoutMs,
      })}`,
    );
  };

  const waitForOptionalFeedEntry = async (options: WaitForFeedEntryOptions = {}) => {
    try {
      const { entry } = await waitForFeedEntry(options);
      return entry;
    } catch {
      return null;
    }
  };

  const enterWorld = async () => {
    const currentPlayer = walletUtils.getCurrentAccount().address;
    walletUtils.setCurrentPlayer(currentPlayer);
    await dataManager.startNewGame();

    [
      SCENE_KEYS.TITLE_SCENE,
      SCENE_KEYS.PLAYER_SELECT_SCENE,
      SCENE_KEYS.WORLD_SCENE,
      SCENE_KEYS.CUTSCENE_SCENE,
      SCENE_KEYS.DIALOG_SCENE,
      SCENE_KEYS.CHAT_SCENE,
    ].forEach(sceneKey => stopSceneIfRunning(game, sceneKey));

    game.scene.start(SCENE_KEYS.WORLD_SCENE);
    return waitForWorldReady(game);
  };

  const enterWorldAs = async (address: string) => {
    walletUtils.setCurrentPlayer(address);
    await dataManager.startNewGame();

    [
      SCENE_KEYS.TITLE_SCENE,
      SCENE_KEYS.PLAYER_SELECT_SCENE,
      SCENE_KEYS.WORLD_SCENE,
      SCENE_KEYS.CUTSCENE_SCENE,
      SCENE_KEYS.DIALOG_SCENE,
      SCENE_KEYS.CHAT_SCENE,
    ].forEach(sceneKey => stopSceneIfRunning(game, sceneKey));

    game.scene.start(SCENE_KEYS.WORLD_SCENE);
    return waitForWorldReady(game);
  };

  const prepareCurrentPlayerForBenchmark = async (timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const worldScene = getWorldScene(game);
      if (!worldScene?.debugPrepareForBenchmark) {
        await new Promise(resolve => window.setTimeout(resolve, 100));
        continue;
      }

      try {
        await worldScene.debugPrepareForBenchmark(timeoutMs);
        return buildDebugState(game);
      } catch (error) {
        if (
          error instanceof Error &&
          /World player is not initialized yet|World scene is not active yet/.test(error.message)
        ) {
          await new Promise(resolve => window.setTimeout(resolve, 100));
          continue;
        }

        throw error;
      }
    }

    throw new Error(`Timed out preparing current player for benchmark after ${timeoutMs}ms`);
  };

  window.__numeronDebug = {
    getState: () => buildDebugState(game),
    getActiveSceneKeys: () => game.scene.getScenes(true).map(scene => scene.scene.key),
    setChannelUrl: channelUrl => {
      walletUtils.setChannelUrl(channelUrl);
      const worldScene = getWorldScene(game);
      if (worldScene?.dubhe) {
        worldScene.dubhe.updateConfig({ channelUrl });
      }
      return buildDebugState(game);
    },
    getChannelUrl: () => walletUtils.getChannelUrl(),
    getRegisterSenderAddress: () => walletUtils.getRegisterSenderAddress(),
    getCurrentPlayerContractKey: () => walletUtils.getCurrentAccountContractKey(),
    setCurrentPlayer: address => {
      walletUtils.setCurrentPlayer(address);
      return buildDebugState(game);
    },
    setCurrentPlayerSecretKey: secretKey => {
      walletUtils.setCurrentPlayerSecretKey(secretKey);
      return buildDebugState(game);
    },
    createRandomPlayer: () => {
      const identity = generateBrowserIdentity();
      walletUtils.setCurrentPlayerSecretKey(identity.secretKey);
      return {
        ...identity,
        state: buildDebugState(game),
      };
    },
    setRegisterSenderAddress: address => {
      walletUtils.setRegisterSenderAddress(address);
      return buildDebugState(game);
    },
    selectCurrentPlayerAndEnterWorld: enterWorld,
    enterWorldAs,
    queryPosition: async account => {
      return walletUtils.dubhe.queryChannelTable({
        account: account ?? walletUtils.getCurrentAccountContractKey(),
        table: 'position',
        key: [],
      });
    },
    registerCurrentPlayer: async (timeoutMs = 10_000) => {
      const worldScene = getWorldScene(game);
      if (!worldScene?.debugRegisterCurrentPlayer) {
        throw new Error('World scene is not active yet');
      }

      const result = (await worldScene.debugRegisterCurrentPlayer(timeoutMs)) as Omit<
        DebugRegisterProbeResult,
        'state'
      >;

      return {
        ...result,
        state: buildDebugState(game),
      };
    },
    prepareCurrentPlayerForBenchmark,
    getAvailableMoveDirections: directions => {
      const worldScene = getWorldScene(game);
      if (!worldScene?.debugGetAvailableMoveDirections) {
        throw new Error('World scene is not active yet');
      }

      return worldScene
        .debugGetAvailableMoveDirections(directions)
        .filter((direction): direction is DebugDirection => direction !== 'NONE');
    },
    move: async direction => {
      const worldScene = getWorldScene(game);
      if (!worldScene?.debugMove) {
        throw new Error('World scene is not active yet');
      }

      await worldScene.debugMove(direction);
      return buildDebugState(game);
    },
    waitForFeedEntry,
    measureMoveSettlement: async (direction, options = {}) => {
      const beforeState = buildDebugState(game);
      const beforeEntries = getFeedDebugEntries(beforeState);
      const afterSequence = beforeEntries.at(-1)?.sequence ?? 0;
      const start = performance.now();

      const worldScene = getWorldScene(game);
      if (!worldScene?.debugMove) {
        throw new Error('World scene is not active yet');
      }

      await worldScene.debugMove(direction);
      const immediateState = buildDebugState(game);

      if (!didMoveAttemptStart(beforeState, immediateState, afterSequence)) {
        throw new Error(`Move did not start: blocked_or_ignored (${direction})`);
      }

      let entry;
      let state;

      try {
        ({ entry, state } = await waitForFeedEntry({
          afterSequence,
          source: options.source ?? 'subscription',
          summaries: options.summaries ?? ['position'],
          detail: options.detail,
          timeoutMs: options.timeoutMs,
        }));
      } catch (error) {
        const finalState = buildDebugState(game);
        if (
          shouldTreatMoveTimeoutAsBlockedOrIgnored(
            beforeState,
            finalState,
            afterSequence,
            options.detail,
          )
        ) {
          throw new Error(`Move did not settle: blocked_or_ignored (${direction})`);
        }

        throw error;
      }

      return {
        direction,
        latencyMs: performance.now() - start,
        matchedEntry: entry,
        beforeState,
        finalState: state,
      };
    },
    measureMovePipeline: async (direction, options = {}) => {
      const beforeState = buildDebugState(game);
      const beforeEntries = getFeedDebugEntries(beforeState);
      const afterSequence = beforeEntries.at(-1)?.sequence ?? 0;
      const startedAtMs = Date.now();

      const worldScene = getWorldScene(game);
      if (!worldScene?.debugMove) {
        throw new Error('World scene is not active yet');
      }

      await worldScene.debugMove(direction);
      const immediateState = buildDebugState(game);

      if (!didMoveAttemptStart(beforeState, immediateState, afterSequence)) {
        throw new Error(`Move did not start: blocked_or_ignored (${direction})`);
      }

      const [fastPathEntry, submitAckEntry, settlementEntry] = await Promise.all([
        waitForOptionalFeedEntry({
          afterSequence,
          source: 'fast_path',
          summaries: ['fast_path'],
          timeoutMs: options.fastPathTimeoutMs ?? 1000,
        }),
        waitForOptionalFeedEntry({
          afterSequence,
          source: 'submit_ack',
          summaries: ['submit'],
          timeoutMs: options.submitAckTimeoutMs ?? 4000,
        }),
        waitForOptionalFeedEntry({
          afterSequence,
          source: 'subscription',
          summaries: ['position'],
          detail: options.settlementDetail,
          timeoutMs: options.settlementTimeoutMs ?? 8000,
        }),
      ]);

      return {
        direction,
        beforeState,
        finalState: buildDebugState(game),
        phases: {
          fastPathLatencyMs: fastPathEntry ? fastPathEntry.observedAtMs - startedAtMs : null,
          submitAckLatencyMs: submitAckEntry ? submitAckEntry.observedAtMs - startedAtMs : null,
          settlementLatencyMs: settlementEntry ? settlementEntry.observedAtMs - startedAtMs : null,
          fastPathEntry,
          submitAckEntry,
          settlementEntry,
        },
      };
    },
  };

  window.render_game_to_text = () => JSON.stringify(buildDebugState(game));
  window.advanceTime = async ms => {
    await new Promise(resolve => window.setTimeout(resolve, ms));
  };
}
