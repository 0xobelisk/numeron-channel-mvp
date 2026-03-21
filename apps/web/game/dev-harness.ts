import { dataManager } from './utils/data-manager';
import { walletUtils } from './utils/wallet-utils';
import { SCENE_KEYS } from './scenes/scene-keys';
import { WorldScene } from './scenes/world-scene';

type DebugDirection = 'LEFT' | 'RIGHT' | 'UP' | 'DOWN';

type DebugFeedEntry = {
  sequence: number;
  summary: string;
  detail?: string;
  source: string;
  observedAtMs: number;
  displayText: string;
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
  debugState?: () => unknown;
};

type DebugState = {
  activeSceneKeys: string[];
  currentPlayer: string;
  selectedPlayer: string | null;
  world: {
    scene: string;
    area: string | null;
    currentPlayer: string;
    player: unknown;
    otherPlayers: number;
    subscriptionActive: boolean;
    feedEntries: string[];
    feedDebugEntries?: DebugFeedEntry[];
  } | null;
};

declare global {
  interface Window {
    __numeronDebug?: {
      getState: () => DebugState;
      getActiveSceneKeys: () => string[];
      setChannelUrl: (channelUrl: string) => DebugState;
      getChannelUrl: () => string;
      setCurrentPlayer: (address: string) => DebugState;
      setCurrentPlayerSecretKey: (secretKey: string) => DebugState;
      setRegisterSenderAddress: (address: string | null) => DebugState;
      selectCurrentPlayerAndEnterWorld: () => Promise<DebugState>;
      enterWorldAs: (address: string) => Promise<DebugState>;
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

async function waitForWorldReady(game: Phaser.Game, timeoutMs = 10000): Promise<DebugState> {
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

function stopSceneIfRunning(game: Phaser.Game, sceneKey: string) {
  if (game.scene.isActive(sceneKey) || game.scene.isSleeping(sceneKey)) {
    game.scene.stop(sceneKey);
  }
}

export function installDevHarness(game: Phaser.Game) {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') {
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

  window.__numeronDebug = {
    getState: () => buildDebugState(game),
    getActiveSceneKeys: () => game.scene.getScenes(true).map(scene => scene.scene.key),
    setChannelUrl: channelUrl => {
      walletUtils.setChannelUrl(channelUrl);
      const worldScene = getWorldScene(game);
      if (worldScene?.dubhe) {
        worldScene.dubhe.setChannelUrl(channelUrl);
      }
      return buildDebugState(game);
    },
    getChannelUrl: () => walletUtils.getChannelUrl(),
    setCurrentPlayer: address => {
      walletUtils.setCurrentPlayer(address);
      return buildDebugState(game);
    },
    setCurrentPlayerSecretKey: secretKey => {
      walletUtils.setCurrentPlayerSecretKey(secretKey);
      return buildDebugState(game);
    },
    setRegisterSenderAddress: address => {
      walletUtils.setRegisterSenderAddress(address);
      return buildDebugState(game);
    },
    selectCurrentPlayerAndEnterWorld: enterWorld,
    enterWorldAs,
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
      const afterSequence =
        beforeEntries.length > 0 ? beforeEntries[beforeEntries.length - 1].sequence : 0;
      const start = performance.now();

      const worldScene = getWorldScene(game);
      if (!worldScene?.debugMove) {
        throw new Error('World scene is not active yet');
      }

      await worldScene.debugMove(direction);

      const { entry, state } = await waitForFeedEntry({
        afterSequence,
        source: options.source ?? 'subscription',
        summaries: options.summaries ?? ['position'],
        detail: options.detail,
        timeoutMs: options.timeoutMs,
      });

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
      const afterSequence =
        beforeEntries.length > 0 ? beforeEntries[beforeEntries.length - 1].sequence : 0;
      const startedAtMs = Date.now();

      const worldScene = getWorldScene(game);
      if (!worldScene?.debugMove) {
        throw new Error('World scene is not active yet');
      }

      await worldScene.debugMove(direction);

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
