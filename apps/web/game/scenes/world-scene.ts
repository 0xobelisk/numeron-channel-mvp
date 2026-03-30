import { AUDIO_ASSET_KEYS, WORLD_ASSET_KEYS } from '../assets/asset-keys';
import { SCENE_KEYS } from './scene-keys';
import { Player } from '../world/characters/player';
import { DIRECTION, Direction } from '../common/direction';
import { ENABLE_ZONE_DEBUGGING, TILED_COLLISION_LAYER_ALPHA, TILE_SIZE } from '../config';
import { DATA_MANAGER_STORE_KEYS, dataManager, initialState } from '../utils/data-manager';
import {
  getTargetDirectionFromGameObjectPosition,
  getTargetPathToGameObject,
  getTargetPositionFromGameObjectPositionAndDirection,
} from '../utils/grid-utils';
import { CANNOT_READ_SIGN_TEXT, SAMPLE_TEXT } from '../utils/text-utils';
import { NPC, NPC_MOVEMENT_PATTERN } from '../world/characters/npc';
import { BaseScene } from './base-scene';
import { DataUtils } from '../utils/data-utils';
import { playBackgroundMusic, playSoundFx } from '../utils/audio-utils';
import { weightedRandom } from '../utils/random';
import { Item } from '../world/item';
import { ENCOUNTER_TILE_TYPE, GAME_EVENT_TYPE, MAP_ID_TYPE, NPC_EVENT_TYPE } from '../types/typedef';
import { exhaustiveGuard } from '../utils/guard';
import { sleep } from '../utils/time-utils';
import { CutsceneScene } from './cutscene-scene';
import { DialogScene } from './dialog-scene';
import { BattleSceneData } from './battle-scene';
import { NPCPath, NpcMovementPattern } from '../world/characters/npc';
import {
  Monster,
  GameEventAddNpc,
  EncounterTileType,
  Coordinate,
  GameEventRemoveFlag,
  GameEventAddFlag,
  GameEventGiveMonster,
  GameEventTalkToPlayer,
  GameEventRetracePath,
  GameEventRemoveNpc,
  GameEventMoveToPlayer,
} from '../types/typedef';
import { PlayerLocation } from '../utils/data-manager';
import { Dubhe, loadMetadata, SuiMoveNormalizedModules, Transaction, bcs, fromHex, toHex } from '@0xobelisk/sui-client';
import { buildChannelDappKey, subscribeChannel, type ChannelEventEnvelope } from '@/lib/channel-events';
import { DUBHE_SCHEMA_ID, NETWORK, PACKAGE_ID } from '@/config/contractDeployment';
import { ChatScene } from './chat-scene';
import { MessageType } from './chat-scene';
import { walletUtils } from '../utils/wallet-utils';
import contractMetadata from 'contracts/metadata.json';

export type TiledObjectProperty = {
  name: string;
  type: string;
  value: any;
};

const TILED_SIGN_PROPERTY = Object.freeze({
  MESSAGE: 'message',
});

const CUSTOM_TILED_TYPES = Object.freeze({
  NPC: 'npc',
  NPC_PATH: 'npc_path',
});

const TILED_NPC_PROPERTY = Object.freeze({
  MOVEMENT_PATTERN: 'movement_pattern',
  FRAME: 'frame',
  ID: 'id',
});

const TILED_ENCOUNTER_PROPERTY = Object.freeze({
  AREA: 'area',
  TILE_TYPE: 'tileType',
});

const TILED_ITEM_PROPERTY = Object.freeze({
  ITEM_ID: 'item_id',
  ID: 'id',
});

const TILED_AREA_METADATA_PROPERTY = Object.freeze({
  FAINT_LOCATION: 'faint_location',
  ID: 'id',
});

const TILED_EVENT_PROPERTY = Object.freeze({
  ID: 'id',
});

export type WorldSceneData = {
  isPlayerKnockedOut?: boolean;
  area?: string;
  isInterior?: boolean;
};

type TransactionFeedSource = 'fast_path' | 'submit_ack' | 'subscription' | 'intent' | 'system';

type MovementIntentPayload = {
  player: string;
  x: number;
  y: number;
  direction?: Direction;
};

type TransactionFeedDebugEntry = {
  sequence: number;
  summary: string;
  detail?: string;
  source: TransactionFeedSource;
  observedAtMs: number;
  displayText: string;
};

function parsePositiveIntEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseNonNegativeIntEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

const IS_DEV_RUNTIME = process.env.NODE_ENV !== 'production';
const ENABLE_NUMERON_DEBUG = process.env.NEXT_PUBLIC_ENABLE_NUMERON_DEBUG === 'true';
const ENABLE_TRANSACTION_FEED_UI = process.env.NEXT_PUBLIC_CHANNEL_FEED_UI
  ? process.env.NEXT_PUBLIC_CHANNEL_FEED_UI === 'true'
  : IS_DEV_RUNTIME || ENABLE_NUMERON_DEBUG;
const ENABLE_CHANNEL_VERBOSE_LOGS = process.env.NEXT_PUBLIC_CHANNEL_VERBOSE_LOGS
  ? process.env.NEXT_PUBLIC_CHANNEL_VERBOSE_LOGS === 'true'
  : IS_DEV_RUNTIME;
const ENABLE_ITEM_DROPPED_SUBSCRIPTION = process.env.NEXT_PUBLIC_CHANNEL_ITEM_DROPPED
  ? process.env.NEXT_PUBLIC_CHANNEL_ITEM_DROPPED === 'true'
  : ENABLE_NUMERON_DEBUG;
const REMOTE_PLAYER_INTENT_MOVE_DURATION_MS = Number(process.env.NEXT_PUBLIC_REMOTE_INTENT_MOVE_DURATION_MS || 56);
const REMOTE_PLAYER_TTL_MS = parsePositiveIntEnv(process.env.NEXT_PUBLIC_REMOTE_PLAYER_TTL_MS, 20_000);
const REMOTE_PLAYER_CLEANUP_INTERVAL_MS = parsePositiveIntEnv(
  process.env.NEXT_PUBLIC_REMOTE_PLAYER_CLEANUP_INTERVAL_MS,
  1_000,
);
const MAX_REMOTE_PLAYERS = parseNonNegativeIntEnv(process.env.NEXT_PUBLIC_MAX_REMOTE_PLAYERS, 16);
const REMOTE_LABELS_DEFAULT_VISIBLE = process.env.NEXT_PUBLIC_REMOTE_LABELS_DEFAULT_VISIBLE === 'true';
const REMOTE_LABEL_DISTANCE_TILES = parsePositiveIntEnv(process.env.NEXT_PUBLIC_REMOTE_LABEL_DISTANCE_TILES, 3);
const REMOTE_LABEL_DISTANCE_PX = REMOTE_LABEL_DISTANCE_TILES * TILE_SIZE;
const REMOTE_LABEL_DISTANCE_PX_SQUARED = REMOTE_LABEL_DISTANCE_PX * REMOTE_LABEL_DISTANCE_PX;
const REMOTE_LABEL_VISIBILITY_UPDATE_INTERVAL_MS = parsePositiveIntEnv(
  process.env.NEXT_PUBLIC_REMOTE_LABEL_UPDATE_INTERVAL_MS,
  120,
);
const CHANNEL_DAPP_KEY = buildChannelDappKey(PACKAGE_ID);
const REGISTER_POSITION_WAIT_TIMEOUT_MS = 10_000;
const REGISTER_POSITION_POLL_INTERVAL_MS = 250;
const REGISTER_SPAWN_POINTS = [
  { x: 1, y: 1 },
  { x: 4, y: 1 },
  { x: 7, y: 1 },
  { x: 10, y: 1 },
  { x: 1, y: 2 },
  { x: 4, y: 2 },
  { x: 7, y: 2 },
  { x: 10, y: 2 },
  { x: 1, y: 4 },
  { x: 4, y: 4 },
  { x: 7, y: 4 },
  { x: 10, y: 4 },
  { x: 1, y: 5 },
  { x: 4, y: 5 },
  { x: 7, y: 5 },
  { x: 10, y: 5 },
] as const;

function getRegisterSpawnPoint(accountKey: string) {
  let hash = 0;
  for (const char of accountKey.replace(/^0x/, '').toLowerCase()) {
    hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  }

  return REGISTER_SPAWN_POINTS[hash % REGISTER_SPAWN_POINTS.length];
}

function normalizePlayerAccount(address: string) {
  return address.replace(/^0x/, '').toLowerCase();
}

function toCanonicalPlayerAddress(address: string) {
  return `0x${normalizePlayerAccount(address)}`;
}

/*
  Our scene will be 16 x 9 (1024 x 576 pixels)
  each grid size will be 64 x 64 pixels
*/

export class WorldScene extends BaseScene {
  #player: Player;
  #collisionLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  #encounterLayers: Phaser.Tilemaps.TilemapLayer[];
  #wildMonsterEncountered: boolean;
  #signLayer: Phaser.Tilemaps.ObjectLayer | undefined;
  #dialogUi: DialogScene;
  #chatUi: ChatScene;
  #npcs: NPC[];
  #npcPlayerIsInteractingWith: NPC | undefined;
  #sceneData: WorldSceneData;
  #items: Item[];
  #entranceLayer: Phaser.Tilemaps.ObjectLayer | undefined;
  #lastNpcEventHandledIndex: number;
  #isProcessingNpcEvent: boolean;
  #eventZones: Record<string, Phaser.GameObjects.Zone>;
  #debugEventZoneObjects: Record<string, Phaser.GameObjects.Rectangle>;
  #rectangleForOverlapCheck1: Phaser.Geom.Rectangle;
  #rectangleForOverlapCheck2: Phaser.Geom.Rectangle;
  #rectangleOverlapResult: Phaser.Geom.Rectangle;
  #gfx: Phaser.GameObjects.Graphics;
  #currentCutSceneId: number | undefined;
  #isProcessingCutSceneEvent: boolean;
  #lastCutSceneEventHandledIndex: number;
  #specialEncounterTileImageGameObjectGroup: Phaser.GameObjects.Group;
  #encounterZonePlayerIsEntering: Phaser.Tilemaps.TilemapLayer | undefined;
  dubhe: Dubhe;
  schemaId: string;
  subscription: (() => void) | null = null;
  #otherPlayers: Map<string, Player> = new Map();
  #otherPlayerLastSeenMs: Map<string, number> = new Map();
  #lastOtherPlayerCleanupAtMs: number = 0;
  #lastRemoteLabelUpdateAtMs: number = 0;
  #transactionFeedContainer: Phaser.GameObjects.Container | null = null;
  #transactionFeedTexts: Phaser.GameObjects.Text[] = [];
  #transactionFeedDebugEntries: TransactionFeedDebugEntry[] = [];
  #maxFeedItems: number = 8;
  #nextTransactionFeedSequence: number = 1;

  constructor() {
    super({
      key: SCENE_KEYS.WORLD_SCENE,
    });
  }

  #debugLog(...args: unknown[]) {
    if (!ENABLE_CHANNEL_VERBOSE_LOGS) {
      return;
    }

    console.log('[WorldScene]', ...args);
  }

  async init(data: WorldSceneData) {
    super.init(data);
    this.#sceneData = data;

    // handle when some of the fields for scene data are not populated, default to values provided, otherwise use safe defaults
    const storeLocation = dataManager.store.get(DATA_MANAGER_STORE_KEYS.PLAYER_LOCATION) as
      | PlayerLocation
      | undefined;
    const areaCandidate = this.#sceneData?.area ?? storeLocation?.area ?? initialState.player.location.area;
    const area =
      typeof areaCandidate === 'string' && areaCandidate.trim().length > 0
        ? areaCandidate
        : initialState.player.location.area;
    let isInterior = this.#sceneData?.isInterior;
    if (isInterior === undefined) {
      isInterior = storeLocation?.isInterior ?? initialState.player.location.isInterior;
    }
    const isPlayerKnockedOut = this.#sceneData?.isPlayerKnockedOut || false;

    this.#sceneData = {
      area,
      isInterior,
      isPlayerKnockedOut,
    };

    // update player location, and map data if the player was knocked out in a battle
    if (this.#sceneData.isPlayerKnockedOut) {
      // get the nearest knocked out spawn location from the map meta data
      let map = this.make.tilemap({ key: `${this.#sceneData.area.toUpperCase()}_LEVEL` });
      const areaMetaDataProperties = map.getObjectLayer('Area-Metadata').objects[0].properties;
      const knockOutSpawnLocation = (areaMetaDataProperties as TiledObjectProperty[]).find(
        property => property.name === TILED_AREA_METADATA_PROPERTY.FAINT_LOCATION,
      )?.value;

      // check to see if the level data we need to load is different and load that map to get player spawn data
      if (
        typeof knockOutSpawnLocation === 'string' &&
        knockOutSpawnLocation.trim().length > 0 &&
        knockOutSpawnLocation !== this.#sceneData.area
      ) {
        this.#sceneData.area = knockOutSpawnLocation;
        map = this.make.tilemap({ key: `${this.#sceneData.area.toUpperCase()}_LEVEL` });
      }

      // set players spawn location to that map and finds the revive location based on that object
      const reviveLocation = map.getObjectLayer('Revive-Location').objects[0];
      dataManager.store.set(DATA_MANAGER_STORE_KEYS.PLAYER_POSITION, {
        x: reviveLocation.x,
        y: reviveLocation.y - TILE_SIZE,
      });
      dataManager.store.set(DATA_MANAGER_STORE_KEYS.PLAYER_DIRECTION, DIRECTION.UP);
    }

    dataManager.store.set(DATA_MANAGER_STORE_KEYS.PLAYER_LOCATION, {
      area: this.#sceneData.area,
      isInterior: this.#sceneData.isInterior,
    } as PlayerLocation);

    this.#wildMonsterEncountered = false;
    this.#npcPlayerIsInteractingWith = undefined;
    this.#npcs = []; // Initialize npcs as empty array
    this.#items = [];
    this.#lastNpcEventHandledIndex = -1;
    this.#isProcessingNpcEvent = false;
    this.#encounterLayers = [];
    this.#signLayer = undefined;
    this.#entranceLayer = undefined;
    this.#eventZones = {};
    this.#debugEventZoneObjects = {};
    this.#rectangleForOverlapCheck1 = undefined;
    this.#rectangleForOverlapCheck2 = undefined;
    this.#rectangleOverlapResult = undefined;
    this.#gfx = undefined;
    this.#currentCutSceneId = undefined;
    this.#isProcessingCutSceneEvent = false;
    this.#lastCutSceneEventHandledIndex = -1;
    this.#specialEncounterTileImageGameObjectGroup = undefined;
    this.#encounterZonePlayerIsEntering = undefined;
    this.#otherPlayers = new Map();
    this.#otherPlayerLastSeenMs = new Map();
    this.#lastOtherPlayerCleanupAtMs = 0;
    this.#lastRemoteLabelUpdateAtMs = 0;
    this.#transactionFeedTexts = [];
    this.#transactionFeedDebugEntries = [];
    this.#nextTransactionFeedSequence = 1;
  }

  async create() {
    super.create();

    // create rectangles for checking for overlaps between game objects, added so we can recycle game objects
    this.#rectangleForOverlapCheck1 = new Phaser.Geom.Rectangle();
    this.#rectangleForOverlapCheck2 = new Phaser.Geom.Rectangle();
    this.#rectangleOverlapResult = new Phaser.Geom.Rectangle();
    // 使用walletUtils获取账户信息
    const currentAccount = walletUtils.getCurrentAccount();
    this.#debugLog('currentAccount', currentAccount);
    // create map and collision layer
    const map = this.make.tilemap({ key: `${this.#sceneData.area.toUpperCase()}_LEVEL` });
    // The first parameter is the name of the tileset in Tiled and the second parameter is the key
    // of the tileset image used when loading the file in preload.
    const collisionTiles = map.addTilesetImage('collision', WORLD_ASSET_KEYS.WORLD_COLLISION);
    if (!collisionTiles) {
      console.log(`[${WorldScene.name}:create] encountered error while creating collision tiles from tiled`);
      return;
    }
    const collisionLayer = map.createLayer('Collision', collisionTiles, 0, 0);
    if (!collisionLayer) {
      console.log(`[${WorldScene.name}:create] encountered error while creating collision layer using data from tiled`);
      return;
    }
    collisionLayer.setAlpha(TILED_COLLISION_LAYER_ALPHA).setDepth(2);
    this.#collisionLayer = collisionLayer;

    // create interactive layer
    const hasSignLayer = map.getObjectLayer('Sign') !== null;
    if (hasSignLayer) {
      this.#signLayer = map.getObjectLayer('Sign');
    }

    // create layer for scene transitions entrances
    const hasSceneTransitionLayer = map.getObjectLayer('Scene-Transitions') !== null;
    if (hasSceneTransitionLayer) {
      this.#entranceLayer = map.getObjectLayer('Scene-Transitions');
    }

    // create collision layer for encounters
    this.#createEncounterAreas(map);

    const channelUrl = walletUtils.getChannelUrl();
    const dubhe = new Dubhe({
      networkType: NETWORK,
      packageId: PACKAGE_ID,
      metadata: contractMetadata as SuiMoveNormalizedModules,
      secretKey: walletUtils.getSigningSecretKey(),
      channelUrl,
    });

    this.dubhe = dubhe;
    // let have_player = await walletUtils.graphqlClient.getTableByCondition('position', {
    //   player: walletUtils.getCurrentAccount().address,
    // });
    const currentPlayerAddress = walletUtils.getCurrentAccount().address;
    const currentPlayerContractKey = walletUtils.getCurrentAccountContractKey();
    let initialLookupFailed = false;
    let have_player;
    try {
      have_player = await walletUtils.dubhe.queryChannelTable({
        account: currentPlayerContractKey,
        table: 'position',
        key: [],
      });
    } catch (error) {
      initialLookupFailed = true;
      console.warn('initial player lookup failed, treating player as unregistered', error);
      have_player = null;
    }

    this.#debugLog('have_player', have_player);
    if (!initialLookupFailed && (!have_player?.message || !have_player?.data?.[0] || !have_player?.data?.[1])) {
      this.#debugLog('registering missing player', currentPlayerAddress);
      await this.registerNewPlayer(dubhe);
      await this.#waitForRegisteredPlayerPosition(currentPlayerContractKey);
    }
    // Check if in teleport state
    const isTeleporting = dataManager.store.get('IS_TELEPORTING');
    this.#debugLog('isTeleporting', isTeleporting);

    if (!isTeleporting) {
      await dataManager.updatePlayerPosition();
    } else {
      // Clear teleport state
      dataManager.store.set('IS_TELEPORTING', undefined);
    }

    if (!this.#sceneData.isInterior) {
      this.cameras.main.setBounds(0, 0, 1280, 2176);
    }
    this.cameras.main.setZoom(0.8);
    this.add.image(0, 0, `${this.#sceneData.area.toUpperCase()}_BACKGROUND`, 0).setOrigin(0);
    // create items and collisions
    this.#createItems(map);
    // create npcs
    // this.#createNPCs(map);

    // Get current player address for display
    this.#player = new Player({
      scene: this,
      position: dataManager.store.get(DATA_MANAGER_STORE_KEYS.PLAYER_POSITION),
      direction: dataManager.store.get(DATA_MANAGER_STORE_KEYS.PLAYER_DIRECTION) ?? DIRECTION.DOWN,
      collisionLayer: collisionLayer,
      spriteGridMovementFinishedCallback: () => {
        this.#handlePlayerMovementUpdate();
      },
      spriteChangedDirectionCallback: () => {
        this.#handlePlayerDirectionUpdate();
      },
      otherCharactersToCheckForCollisionsWith: this.#npcs,
      objectsToCheckForCollisionsWith: this.#items,
      entranceLayer: this.#entranceLayer,
      enterEntranceCallback: async (entranceName, entranceId, isBuildingEntrance) => {
        await this.#handleEntranceEnteredCallback(entranceName, entranceId, isBuildingEntrance);
      },
      spriteGridMovementStartedCallback: position => {
        return this.#handlePlayerMovementStarted(position);
      },
      dubhe,
      playerAddress: currentPlayerAddress,
      isCurrentPlayer: true, // Mark as current player for gold background
    });

    // Set depth to ensure player is visible above background
    this.#player.sprite.setDepth(1);
    this.#player.setAddressLabelVisible(true);

    this.cameras.main.startFollow(this.#player.sprite);

    // Load and create other players
    await this.#loadOtherPlayers(collisionLayer);

    // Subscribe after world and player state are fully initialized.
    await this.subscribeToEvents();

    // // update our collisions with npcs
    // this.#npcs.forEach(npc => {
    //   npc.addCharacterToCheckForCollisionsWith(this.#player);
    // });

    // create foreground for depth
    this.add.image(0, 0, `${this.#sceneData.area.toUpperCase()}_FOREGROUND`, 0).setOrigin(0).setDepth(10);

    // create event zones
    this.#createEventEncounterZones(map);

    if (ENABLE_ZONE_DEBUGGING) {
      // used for debugging the overlaps for event zones
      this.#gfx = this.add.graphics({ lineStyle: { width: 4, color: 0x00ffff } });
    }

    this.cameras.main.fadeIn(1000, 0, 0, 0, (camera, progress) => {
      if (progress === 1) {
        // if the player was knocked out, we want to lock input, heal player, and then have npc show message
        if (this.#sceneData.isPlayerKnockedOut) {
          this.#healPlayerParty();
          this.#dialogUi.showDialogModal([
            'It looks like your team put up quite a fight...',
            'I went ahead and healed them up for you.',
          ]);
        }
      }
    });
    dataManager.store.set(DATA_MANAGER_STORE_KEYS.GAME_STARTED, true);

    // add audio
    playBackgroundMusic(this, AUDIO_ASSET_KEYS.MAIN);
    // add UI scene for cutscene and dialog
    this.scene.launch(SCENE_KEYS.CUTSCENE_SCENE);
    this.scene.launch(SCENE_KEYS.DIALOG_SCENE);

    // Check chat scene status to properly reuse or initialize it
    if (this.scene.isSleeping(SCENE_KEYS.CHAT_SCENE)) {
      // If scene is in sleep state, wake it up instead of recreating
      this.scene.wake(SCENE_KEYS.CHAT_SCENE);
      this.scene.bringToTop(SCENE_KEYS.CHAT_SCENE);
      this.#chatUi = this.scene.get(SCENE_KEYS.CHAT_SCENE) as ChatScene;
    } else if (this.scene.isActive(SCENE_KEYS.CHAT_SCENE)) {
      // If scene is already active, use it directly
      this.scene.bringToTop(SCENE_KEYS.CHAT_SCENE);
      this.#chatUi = this.scene.get(SCENE_KEYS.CHAT_SCENE) as ChatScene;
    } else {
      // Scene doesn't exist or isn't running, need to initialize it
      if (!this.game.scene.getScene(SCENE_KEYS.CHAT_SCENE)) {
        this.#debugLog('Adding Chat Scene to game');
        this.game.scene.add(SCENE_KEYS.CHAT_SCENE, ChatScene);
      }

      // Launch chat scene
      this.scene.launch(SCENE_KEYS.CHAT_SCENE);
      this.#chatUi = this.scene.get(SCENE_KEYS.CHAT_SCENE) as ChatScene;
      this.scene.bringToTop(SCENE_KEYS.CHAT_SCENE);
    }

    this.#dialogUi = this.scene.get(SCENE_KEYS.DIALOG_SCENE) as DialogScene;

    this.#specialEncounterTileImageGameObjectGroup = this.add.group({ classType: Phaser.GameObjects.Image });

    // Initialize transaction feed display
    this.#createTransactionFeed();

    // const hasEncounter = await dataManager.hasEncounter();
    // if (hasEncounter) {
    // }
  }

  async #waitForRegisteredPlayerPosition(playerAccountKey: string, timeoutMs = REGISTER_POSITION_WAIT_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    let consecutiveLookupFailures = 0;

    while (Date.now() < deadline) {
      try {
        const playerPosition = await walletUtils.dubhe.queryChannelTable({
          account: playerAccountKey,
          table: 'position',
          key: [],
        });

        if (playerPosition?.message && playerPosition?.data?.[0] && playerPosition?.data?.[1]) {
          return playerPosition;
        }
        consecutiveLookupFailures = 0;
      } catch (error) {
        consecutiveLookupFailures += 1;
        this.#debugLog('waiting for registered player position', { playerAccountKey, error });
        if (consecutiveLookupFailures >= 2) {
          console.warn(
            `[${WorldScene.name}] Aborting registered player wait after repeated lookup failures for ${playerAccountKey}.`,
          );
          return null;
        }
      }

      await sleep(REGISTER_POSITION_POLL_INTERVAL_MS, this);
    }

    console.warn(
      `[${WorldScene.name}] Timed out waiting for registered player position for ${playerAccountKey}; continuing with fallback spawn.`,
    );
    return null;
  }

  async update(time: DOMHighResTimeStamp) {
    if (!this.#player) {
      return;
    }

    super.update(time);
    const nowMs = Date.now();

    if (nowMs - this.#lastOtherPlayerCleanupAtMs >= REMOTE_PLAYER_CLEANUP_INTERVAL_MS) {
      this.#lastOtherPlayerCleanupAtMs = nowMs;
      this.#pruneRemotePlayers(nowMs);
    }
    this.#updateRemotePlayerLabelVisibility(nowMs);

    if (this.#wildMonsterEncountered) {
      // If the player is encountering a monster, only update player state, don't process any input
      this.#player.update(time);
      return;
    }

    // Check chat interface status - if chat input is active, don't process world scene input
    const chatScene = this.scene.get(SCENE_KEYS.CHAT_SCENE) as ChatScene;
    if (chatScene && chatScene.isInputActive) {
      // Only update game objects, don't process input
      this.#player.update(time);
      // this.#npcs.forEach(npc => {
      //   npc.update(time);
      // });
      return;
    }

    const wasSpaceKeyPressed = this._controls.wasSpaceKeyPressed();
    const selectedDirectionPressedOnce = this._controls.getDirectionKeyJustPressed();

    if (this.#isProcessingCutSceneEvent) {
      this.#player.update(time);
      // this.#npcs.forEach(npc => {
      //   npc.update(time);
      // });
      if (wasSpaceKeyPressed && this.#npcPlayerIsInteractingWith) {
        await this.#handlePlayerInteraction();
      }
      return;
    }

    // For channel-backed movement, only accept discrete direction presses.
    // This avoids flooding v2/submit when a key is held down.
    if (selectedDirectionPressedOnce !== DIRECTION.NONE && !this.#isPlayerInputLocked()) {
      void this.#player.moveCharacter(selectedDirectionPressedOnce);
    }

    if (wasSpaceKeyPressed && !this.#player.isMoving) {
      await this.#handlePlayerInteraction();
    }

    this.#player.update(time);

    // Update other players
    this.#otherPlayers.forEach(otherPlayer => {
      otherPlayer.update(time);
    });

    // this.#npcs.forEach(npc => {
    //   npc.update(time);
    // });

    // Ensure chat scene stays in the foreground, but don't repeatedly launch it
    if (this.scene.isActive(SCENE_KEYS.CHAT_SCENE)) {
      this.scene.bringToTop(SCENE_KEYS.CHAT_SCENE);
    } else if (this.scene.isSleeping(SCENE_KEYS.CHAT_SCENE)) {
      this.scene.wake(SCENE_KEYS.CHAT_SCENE);
      this.scene.bringToTop(SCENE_KEYS.CHAT_SCENE);
    }
  }

  /**
   * Handles real-time game events through channel subscription
   */
  async subscribeToEvents() {
    try {
      // First check if there's an existing subscription, if so close it
      if (this.subscription) {
        try {
          this.subscription();
          this.#debugLog('Closed previous channel subscription to prevent duplicate messages');
        } catch (closeError) {
          console.warn('Failed to close channel subscription:', closeError);
        }
      }

      this.#debugLog('starting channel subscriptions');

      const onError = (error: Error) => {
        console.error('❌ Subscription error:', error);
      };
      const onClose = () => {
        this.#debugLog('Subscription connection closed');
      };
      const onOpen = (label: string) => {
        this.#debugLog(`Successfully connected to ${label} channel subscription`);
      };

      const subscriptions = [
        this.dubhe.subscribeChannelTable(
          { table: 'position' },
          {
            onOpen: () => onOpen('position'),
            onError,
            onClose,
            onMessage: data => {
              const accountLabel = data.account ? `${data.account.slice(0, 6)}...${data.account.slice(-4)}` : 'unknown';
              this.addTransactionFeedEntry(data.table, accountLabel, 'subscription');

              try {
                const xData = Uint8Array.from(data.value[0] || []);
                const yData = Uint8Array.from(data.value[1] || []);
                if (xData.length === 0 || yData.length === 0) {
                  return;
                }

                const x = Number(bcs.u64().parse(xData));
                const y = Number(bcs.u64().parse(yData));
                const playerAddress = data.account.startsWith('0x') ? data.account : `0x${data.account}`;
                if (playerAddress === walletUtils.getCurrentAccount().address) {
                  this.#syncCurrentPlayerPosition(x, y);
                  return;
                }

                void this.#handleOtherPlayerPositionUpdate({
                  player: playerAddress,
                  x,
                  y,
                });
              } catch (error) {
                console.error('Failed to parse position data:', error);
                console.error('Raw value:', data.value);
              }
            },
          },
        ),
        subscribeChannel<ChannelEventEnvelope>({
          channelUrl: walletUtils.getChannelUrl(),
          spec: {
            topics: ['movement_intent'],
            filters: {
              dapp_key: CHANNEL_DAPP_KEY,
            },
            semantics: 'Ephemeral',
          },
          handlers: {
            onOpen: () => onOpen('movement_intent'),
            onError,
            onClose,
            onMessage: event => {
              const payload = (event.payload ?? {}) as Partial<MovementIntentPayload>;
              const playerAddress =
                typeof payload.player === 'string'
                  ? payload.player
                  : typeof event.metadata?.player === 'string'
                    ? event.metadata.player
                    : '';

              if (!playerAddress) {
                return;
              }

              const accountLabel = `${playerAddress.slice(0, 6)}...${playerAddress.slice(-4)}`;
              this.addTransactionFeedEntry(event.topic, accountLabel, 'intent');

              void this.#handleOtherPlayerMovementIntent({
                player: playerAddress,
                x: Number(payload.x),
                y: Number(payload.y),
                direction: this.#normalizeDirection(payload.direction),
              });
            },
          },
        }),
      ];

      if (ENABLE_ITEM_DROPPED_SUBSCRIPTION) {
        subscriptions.push(
          this.dubhe.subscribeChannelTable(
            { table: 'item_dropped' },
            {
              onOpen: () => onOpen('item_dropped'),
              onError,
              onClose,
              onMessage: data => {
                const accountLabel = data.account
                  ? `${data.account.slice(0, 6)}...${data.account.slice(-4)}`
                  : 'unknown';
                this.addTransactionFeedEntry(data.table, accountLabel, 'subscription');

                try {
                  const playerData = Uint8Array.from(data.value[0]);
                  const itemTypeData = Uint8Array.from(data.value[1]);

                  const Address = bcs.bytes(32).transform({
                    input: (val: string) => fromHex(val),
                    output: val => toHex(val),
                  });

                  const player = Address.parse(playerData);
                  const ItemTypeBcs = bcs.enum('ItemType', {
                    Ball: null,
                    Currency: null,
                    Food: null,
                    Material: null,
                    Medicine: null,
                    Scroll: null,
                    SkillBook: null,
                    TreasureChest: null,
                  });

                  const itemType = ItemTypeBcs.parse(itemTypeData);

                  this.#handleItemDroppedEvent({
                    player,
                    item_type: itemType.$kind,
                  });
                } catch (error) {
                  console.error('Failed to parse item_dropped data:', error);
                  console.error('Table:', data.table);
                  console.error('Raw value:', data.value);
                }
              },
            },
          ),
        );
      }

      const unsubscribes = await Promise.all(subscriptions);

      this.subscription = () => {
        unsubscribes.forEach(unsubscribe => unsubscribe());
      };
      this.#debugLog('channel subscription started successfully');
    } catch (error) {
      console.error('Failed to subscribe to channel events:', error);
    }
  }

  /**
   * Registers a new player in the game
   * @param dubhe - Dubhe client instance
   */
  registerNewPlayer = async (dubhe: Dubhe) => {
    try {
      const currentPlayerAddress = walletUtils.getCurrentAccount().address;
      const currentPlayerContractKey = walletUtils.getCurrentAccountContractKey();
      const spawnPoint = getRegisterSpawnPoint(currentPlayerContractKey);
      const registerTx = new Transaction();
      const params = [
        registerTx.object(this._dubheSchemaId),
        registerTx.pure.string(currentPlayerContractKey),
        registerTx.pure.u64(spawnPoint.x),
        registerTx.pure.u64(spawnPoint.y),
      ];
      registerTx.setGasBudget(100000000);
      await dubhe.tx.map_system.force_register({
        tx: registerTx,
        params,
        isRaw: true,
      });
      this.addTransactionFeedEntry(
        'register_intent',
        `${currentPlayerAddress} -> ${currentPlayerContractKey} @ ${spawnPoint.x},${spawnPoint.y}`,
        'system',
      );
      return await walletUtils.signAndExecuteTransaction({
        tx: registerTx,
        channelSender: walletUtils.getRegisterSenderAddress(),
        onSuccess: async result => {
          this.addTransactionFeedEntry('register_submit', result.digest ?? 'ok', 'submit_ack');
        },
        onError: error => {
          console.error('Failed to register player:', error);
          this.addTransactionFeedEntry(
            'register_error',
            error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
            'system',
          );
        },
      });
    } catch (error) {
      console.error('Register player error:', error);
      throw error;
    }
  };

  async #handlePlayerInteraction() {
    if (this.#dialogUi.isAnimationPlaying) {
      return;
    }

    if (this.#dialogUi.isVisible && !this.#dialogUi.moreMessagesToShow) {
      this.#dialogUi.hideDialogModal();
      if (this.#currentCutSceneId !== undefined) {
        this.#isProcessingCutSceneEvent = false;
        this.#handleCutSceneInteraction();
      }
      if (this.#npcPlayerIsInteractingWith) {
        this.#handleNpcInteraction();
      }
      return;
    }

    if (this.#dialogUi.isVisible && this.#dialogUi.moreMessagesToShow) {
      this.#dialogUi.showNextMessage();
      return;
    }

    // get players current direction and check 1 tile over in that direction to see if there is an object that can be interacted with
    const { x, y } = this.#player.sprite;
    const targetPosition = getTargetPositionFromGameObjectPositionAndDirection({ x, y }, this.#player.direction);

    // check for sign, and display appropriate message if player is not facing up
    const nearbySign = this.#signLayer?.objects.find(object => {
      if (!object.x || !object.y) {
        return false;
      }

      // In Tiled, the x value is how far the object starts from the left, and the y is the bottom of tiled object that is being added
      return object.x === targetPosition.x && object.y - TILE_SIZE === targetPosition.y;
    });

    if (nearbySign) {
      const props: TiledObjectProperty[] = nearbySign.properties;
      const msg: string = props.find(prop => prop.name === TILED_SIGN_PROPERTY.MESSAGE)?.value;

      const usePlaceholderText = this.#player.direction !== DIRECTION.UP;
      let textToShow = CANNOT_READ_SIGN_TEXT;
      if (!usePlaceholderText) {
        textToShow = msg || SAMPLE_TEXT;
      }
      this.#dialogUi.showDialogModal([textToShow]);
      return;
    }

    // NPC interaction removed - not needed for multiplayer
    // const nearbyNpc = this.#npcs.find(npc => {
    //   return npc.sprite.x === targetPosition.x && npc.sprite.y === targetPosition.y;
    // });
    // if (nearbyNpc) {
    //   nearbyNpc.facePlayer(this.#player.direction);
    //   nearbyNpc.isTalkingToPlayer = true;
    //   this.#npcPlayerIsInteractingWith = nearbyNpc;
    //   this.#handleNpcInteraction();
    //   return;
    // }

    // check for a nearby item and display message about player finding the item
    let nearbyItemIndex: number | undefined;
    const nearbyItem = this.#items.find((item, index) => {
      if (item.position.x === targetPosition.x && item.position.y === targetPosition.y) {
        nearbyItemIndex = index;
        return true;
      }
      return false;
    });
    if (nearbyItem) {
      // add item to inventory and display message to player
      nearbyItem.gameObject.destroy();
      this.#items.splice(nearbyItemIndex, 1);
      dataManager.addItemPickedUp(nearbyItem.id);
    }
  }

  #handlePlayerMovementUpdate() {
    // update player position on global data store
    dataManager.store.set(DATA_MANAGER_STORE_KEYS.PLAYER_POSITION, {
      x: this.#player.sprite.x,
      y: this.#player.sprite.y,
    });

    // check to see if the player encountered cut scene zone
    this.#player.sprite.getBounds(this.#rectangleForOverlapCheck1);
    for (const zone of Object.values(this.#eventZones)) {
      // get the bounds of the player and zone for checking for overlap
      zone.getBounds(this.#rectangleForOverlapCheck2);

      // reset rectangle overlap size, needed since method below will
      // return the original rectangle unmodified if a previous match
      // was found.
      this.#rectangleOverlapResult.setSize(0, 0);
      Phaser.Geom.Intersects.GetRectangleIntersection(
        this.#rectangleForOverlapCheck1,
        this.#rectangleForOverlapCheck2,
        this.#rectangleOverlapResult,
      );

      if (ENABLE_ZONE_DEBUGGING) {
        // for debugging the overlap checks for the events
        this.#gfx.clear();
        this.#gfx.strokeRectShape(this.#rectangleOverlapResult);
      }

      const isOverlapping =
        this.#rectangleOverlapResult.width >= TILE_SIZE - 10 && this.#rectangleOverlapResult.height >= TILE_SIZE - 10;

      if (isOverlapping) {
        const eventId = parseInt(zone.name, 10);
        const eventData = DataUtils.getEventData(this, eventId);
        const currentGameFlags = dataManager.getFlags();
        const eventRequirementsMet = eventData.requires.every(flag => {
          return currentGameFlags.has(flag);
        });
        if (eventRequirementsMet) {
          this.#currentCutSceneId = parseInt(zone.name, 10);
          this.#startCutScene();
          break;
        }
      }
    }
    if (this.#currentCutSceneId !== undefined) {
      return;
    }
    if (this.#encounterLayers.length === 0) {
      return;
    }
    this.#handlePlayerMovementInEncounterZone();
  }

  async #handlePlayerMovementInEncounterZone() {
    // 如果已经遇到怪兽，直接返回，禁止处理移动
    if (this.#wildMonsterEncountered) {
      return;
    }

    // cleanup any special tiles that are not at the players current position
    if (
      this.#specialEncounterTileImageGameObjectGroup &&
      this.#specialEncounterTileImageGameObjectGroup.getChildren &&
      typeof this.#specialEncounterTileImageGameObjectGroup.getChildren === 'function'
    ) {
      try {
        const children = this.#specialEncounterTileImageGameObjectGroup.getChildren();
        if (Array.isArray(children)) {
          children.forEach((child: Phaser.GameObjects.Image) => {
            if (!child || !child.active) {
              return;
            }
            if (child.x === this.#player.sprite.x && child.y === this.#player.sprite.y) {
              child.visible = true;
              return;
            }
            child.active = false;
            child.visible = false;
          });
        }
      } catch (error) {
        console.error('处理特殊遭遇区域图块时出错:', error);
      }
    }

    if (this.#encounterZonePlayerIsEntering === undefined) {
      return;
    }

    this.#debugLog('player is in an encounter zone');

    // 检查是否已经锁定输入或者已经进入战斗状态
    if (this._controls.isInputLocked || this.#wildMonsterEncountered) {
      return;
    }

    // const hasEncounter = await dataManager.hasEncounter();
    // if (hasEncounter) {
    //   console.log(`[${WorldScene.name}:handlePlayerMovementInEncounterZone] player has encountered a wild monster`);
    // }
    // this.#wildMonsterEncountered = Math.random() < 0.2;

    // if (wildMonsterEncountered) {

    // }
  }

  #isPlayerInputLocked(): boolean {
    const isDialogVisible = this.#dialogUi ? this.#dialogUi.isVisible : false;

    return (
      this._controls.isInputLocked ||
      isDialogVisible ||
      this.#isProcessingNpcEvent ||
      this.#currentCutSceneId !== undefined
    );
  }

  #createNPCs(map: Phaser.Tilemaps.Tilemap) {
    this.#npcs = [];

    const npcLayers = map.getObjectLayerNames().filter(layerName => layerName.includes('NPC'));
    npcLayers.forEach(layerName => {
      const layer = map.getObjectLayer(layerName);
      const npcObject = layer.objects.find(obj => {
        return obj.type === CUSTOM_TILED_TYPES.NPC;
      });
      if (!npcObject || npcObject.x === undefined || npcObject.y === undefined) {
        return;
      }

      // get the path objects for this npc
      const pathObjects = layer.objects.filter(obj => {
        return obj.type === CUSTOM_TILED_TYPES.NPC_PATH;
      });
      const npcPath: NPCPath = {
        0: { x: npcObject.x, y: npcObject.y - TILE_SIZE },
      };
      pathObjects.forEach(obj => {
        if (obj.x === undefined || obj.y === undefined) {
          return;
        }
        npcPath[parseInt(obj.name, 10)] = { x: obj.x, y: obj.y - TILE_SIZE };
      });

      const npcMovement: NpcMovementPattern =
        (npcObject.properties as TiledObjectProperty[]).find(
          property => property.name === TILED_NPC_PROPERTY.MOVEMENT_PATTERN,
        )?.value || 'IDLE';

      const npcId: number = (npcObject.properties as TiledObjectProperty[]).find(
        property => property.name === TILED_NPC_PROPERTY.ID,
      )?.value;
      const npcDetails = DataUtils.getNpcData(this, npcId);

      // In Tiled, the x value is how far the object starts from the left, and the y is the bottom of tiled object that is being added
      const npc = new NPC({
        scene: this,
        position: { x: npcObject.x, y: npcObject.y - TILE_SIZE },
        direction: DIRECTION.DOWN,
        frame: npcDetails.frame,
        npcPath,
        movementPattern: npcMovement,
        events: npcDetails.events,
        animationKeyPrefix: npcDetails.animationKeyPrefix,
        id: npcId,
      });
      this.#npcs.push(npc);
    });
  }

  #handlePlayerDirectionUpdate() {
    // update player direction on global data store
    dataManager.store.set(DATA_MANAGER_STORE_KEYS.PLAYER_DIRECTION, this.#player.direction);
  }

  async #healPlayerParty() {
    // heal all monsters in party
    // const monsters: Monster[] = dataManager.store.get(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY);
    // monsters.forEach(monster => {
    //   monster.currentHp = monster.maxHp;
    // });
    // dataManager.store.set(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY, monsters);
  }

  #trackOtherPlayerActivity(playerAddress: string, observedAtMs = Date.now()) {
    this.#otherPlayerLastSeenMs.set(playerAddress, observedAtMs);
  }

  #removeOtherPlayer(playerAddress: string, reason: 'ttl_expired' | 'cap_exceeded' | 'invalid_entry') {
    const existingPlayer = this.#otherPlayers.get(playerAddress);
    if (existingPlayer) {
      existingPlayer.destroy();
      this.#otherPlayers.delete(playerAddress);
    }
    this.#otherPlayerLastSeenMs.delete(playerAddress);
    this.#debugLog(`Removed remote player (${reason}): ${playerAddress}`);
  }

  #clearOtherPlayers(reason: 'ttl_expired' | 'cap_exceeded' | 'invalid_entry') {
    for (const playerAddress of this.#otherPlayers.keys()) {
      this.#removeOtherPlayer(playerAddress, reason);
    }
  }

  #pruneRemotePlayers(nowMs: number) {
    if (!this.#otherPlayers || this.#otherPlayers.size === 0) {
      return;
    }

    if (MAX_REMOTE_PLAYERS === 0) {
      this.#clearOtherPlayers('cap_exceeded');
      return;
    }

    for (const [address, lastSeenMs] of this.#otherPlayerLastSeenMs.entries()) {
      if (!this.#otherPlayers.has(address)) {
        this.#otherPlayerLastSeenMs.delete(address);
        continue;
      }

      if (nowMs - lastSeenMs > REMOTE_PLAYER_TTL_MS) {
        this.#removeOtherPlayer(address, 'ttl_expired');
      }
    }

    if (this.#otherPlayers.size <= MAX_REMOTE_PLAYERS) {
      return;
    }

    const playerSprite = this.#player?.sprite;
    const rankedPlayers = Array.from(this.#otherPlayers.entries()).map(([address, otherPlayer]) => {
      const lastSeenMs = this.#otherPlayerLastSeenMs.get(address) ?? 0;
      const distanceSquared = playerSprite
        ? Phaser.Math.Distance.Squared(playerSprite.x, playerSprite.y, otherPlayer.sprite.x, otherPlayer.sprite.y)
        : Number.POSITIVE_INFINITY;

      return {
        address,
        lastSeenMs,
        distanceSquared,
      };
    });

    rankedPlayers.sort((a, b) => {
      if (a.distanceSquared !== b.distanceSquared) {
        return a.distanceSquared - b.distanceSquared;
      }
      return b.lastSeenMs - a.lastSeenMs;
    });

    const keepAddresses = new Set(rankedPlayers.slice(0, MAX_REMOTE_PLAYERS).map(item => item.address));
    for (const rankedPlayer of rankedPlayers) {
      if (!keepAddresses.has(rankedPlayer.address)) {
        this.#removeOtherPlayer(rankedPlayer.address, 'cap_exceeded');
      }
    }
  }

  #updateRemotePlayerLabelVisibility(nowMs: number) {
    if (nowMs - this.#lastRemoteLabelUpdateAtMs < REMOTE_LABEL_VISIBILITY_UPDATE_INTERVAL_MS) {
      return;
    }
    this.#lastRemoteLabelUpdateAtMs = nowMs;

    if (!this.#player) {
      return;
    }

    const playerSprite = this.#player.sprite;
    this.#player.setAddressLabelVisible(true);

    for (const otherPlayer of this.#otherPlayers.values()) {
      const isWithinLabelRange =
        Phaser.Math.Distance.Squared(playerSprite.x, playerSprite.y, otherPlayer.sprite.x, otherPlayer.sprite.y) <=
        REMOTE_LABEL_DISTANCE_PX_SQUARED;
      otherPlayer.setAddressLabelVisible(REMOTE_LABELS_DEFAULT_VISIBLE || isWithinLabelRange);
    }
  }

  async #loadOtherPlayers(collisionLayer: Phaser.Tilemaps.TilemapLayer) {
    try {
      if (MAX_REMOTE_PLAYERS === 0) {
        this.#clearOtherPlayers('cap_exceeded');
        this.#debugLog('Remote player rendering is disabled by NEXT_PUBLIC_MAX_REMOTE_PLAYERS=0');
        return;
      }

      const currentPlayerAddress = walletUtils.getCurrentAccount().address;
      const currentPlayerAccount = normalizePlayerAccount(currentPlayerAddress);
      this.#debugLog('Current player address:', currentPlayerAddress);

      const allPlayersPositions = await dataManager.getAllPlayersPositions();
      this.#debugLog('Total players found:', allPlayersPositions.length);

      const currentPlayerPosition = this.#player?.sprite
        ? { x: this.#player.sprite.x, y: this.#player.sprite.y }
        : dataManager.store.get(DATA_MANAGER_STORE_KEYS.PLAYER_POSITION);
      const sortedRemotePlayers = allPlayersPositions
        .filter(playerPos => normalizePlayerAccount(playerPos.player) !== currentPlayerAccount)
        .sort((a, b) => {
          const aX = Number(a?.x);
          const aY = Number(a?.y);
          const bX = Number(b?.x);
          const bY = Number(b?.y);

          const aDistance = Number.isFinite(aX) && Number.isFinite(aY)
            ? Phaser.Math.Distance.Squared(currentPlayerPosition.x, currentPlayerPosition.y, aX, aY)
            : Number.POSITIVE_INFINITY;
          const bDistance = Number.isFinite(bX) && Number.isFinite(bY)
            ? Phaser.Math.Distance.Squared(currentPlayerPosition.x, currentPlayerPosition.y, bX, bY)
            : Number.POSITIVE_INFINITY;
          return aDistance - bDistance;
        })
        .slice(0, MAX_REMOTE_PLAYERS);

      // Create player sprites for selected nearby players
      let otherPlayersCount = 0;
      for (const playerPos of sortedRemotePlayers) {
        const canonicalPlayerAddress = toCanonicalPlayerAddress(playerPos.player);
        const x = Number(playerPos?.x);
        const y = Number(playerPos?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          this.#debugLog(`Skipping invalid player position for: ${canonicalPlayerAddress}`);
          continue;
        }

        // Create a Player instance for other players
        const otherPlayer = new Player({
          scene: this,
          position: { x, y },
          direction: DIRECTION.DOWN,
          collisionLayer: collisionLayer,
          otherCharactersToCheckForCollisionsWith: this.#npcs,
          objectsToCheckForCollisionsWith: this.#items,
          entranceLayer: this.#entranceLayer,
          enterEntranceCallback: async () => {}, // Other players don't trigger entrance events
          playerAddress: canonicalPlayerAddress,
          isCurrentPlayer: false, // Mark as other player for colored backgrounds
        });

        // Set depth to ensure other players are visible
        otherPlayer.sprite.setDepth(1);
        otherPlayer.setAddressLabelVisible(REMOTE_LABELS_DEFAULT_VISIBLE);

        this.#otherPlayers.set(canonicalPlayerAddress, otherPlayer);
        this.#trackOtherPlayerActivity(canonicalPlayerAddress);
        otherPlayersCount++;
        this.#debugLog(`Created player sprite #${otherPlayersCount} for: ${canonicalPlayerAddress}`);
      }

      this.#pruneRemotePlayers(Date.now());
      this.#updateRemotePlayerLabelVisibility(Date.now());
      this.#debugLog(`Finished loading ${otherPlayersCount} other players`);
    } catch (error) {
      console.error('Failed to load other players:', error);
    }
  }

  #normalizeDirection(direction: unknown): Direction {
    if (
      direction === DIRECTION.UP ||
      direction === DIRECTION.DOWN ||
      direction === DIRECTION.LEFT ||
      direction === DIRECTION.RIGHT
    ) {
      return direction;
    }

    return DIRECTION.NONE;
  }

  async #handleOtherPlayerMovementIntent(intentData: MovementIntentPayload) {
    if (MAX_REMOTE_PLAYERS === 0) {
      return;
    }

    if (!Number.isFinite(intentData.x) || !Number.isFinite(intentData.y)) {
      return;
    }

    await this.#handleOtherPlayerPositionUpdate(intentData, {
      authoritative: false,
      durationMs: REMOTE_PLAYER_INTENT_MOVE_DURATION_MS,
    });
  }

  async #handleOtherPlayerPositionUpdate(
    positionData: any,
    options: {
      authoritative?: boolean;
      durationMs?: number;
    } = {},
  ) {
    try {
      if (MAX_REMOTE_PLAYERS === 0) {
        return;
      }

      const authoritative = options.authoritative ?? true;
      const currentPlayerAddress = walletUtils.getCurrentAccount().address;
      const currentPlayerAccount = normalizePlayerAccount(currentPlayerAddress);
      const rawPlayerAddress = typeof positionData?.player === 'string' ? positionData.player : '';
      if (!rawPlayerAddress) {
        return;
      }
      const playerAddress = toCanonicalPlayerAddress(rawPlayerAddress);
      const nowMs = Date.now();

      // Skip if this is the current player
      if (normalizePlayerAccount(playerAddress) === currentPlayerAccount) {
        return;
      }

      const tileX = Number(positionData?.x);
      const tileY = Number(positionData?.y);
      if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) {
        return;
      }

      const x = tileX * TILE_SIZE;
      const y = tileY * TILE_SIZE;
      this.#otherPlayers ||= new Map();
      this.#trackOtherPlayerActivity(playerAddress, nowMs);

      // Check if we already have this player
      const existingPlayer = this.#otherPlayers.get(playerAddress);

      if (existingPlayer) {
        // Update existing player's position with animation
        const sprite = existingPlayer.sprite;
        const isAlreadyAtTarget = existingPlayer._targetPosition.x === x && existingPlayer._targetPosition.y === y;
        const isAlreadyAtPosition = sprite.x === x && sprite.y === y;

        if (isAlreadyAtTarget || isAlreadyAtPosition) {
          existingPlayer._targetPosition = { x, y };
          existingPlayer._previousTargetPosition = { x, y };

          if (authoritative && isAlreadyAtPosition) {
            existingPlayer._updateAddressLabelPosition();
          }
          return;
        }

        // Stop any existing tween to prevent animation stacking
        if (existingPlayer._currentTween && existingPlayer._currentTween.isPlaying()) {
          existingPlayer._currentTween.stop();
          existingPlayer._currentTween = undefined;
        }

        // Calculate movement direction based on position change
        const dx = x - sprite.x;
        const dy = y - sprite.y;
        let direction: Direction = this.#normalizeDirection(positionData.direction);

        if (direction === DIRECTION.NONE) {
          // Determine direction based on the larger delta
          if (Math.abs(dx) > Math.abs(dy)) {
            direction = dx > 0 ? DIRECTION.RIGHT : DIRECTION.LEFT;
          } else if (Math.abs(dy) > 0) {
            direction = dy > 0 ? DIRECTION.DOWN : DIRECTION.UP;
          }
        }

        // Update player direction
        if (direction !== DIRECTION.NONE) {
          existingPlayer._direction = direction;

          // Play walking animation based on direction
          const animKey = `PLAYER_${direction}`;
          try {
            if (sprite.anims && (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== animKey)) {
              sprite.play(animKey);
            }
          } catch (error) {
            console.warn(`Failed to play animation ${animKey}:`, error);
          }
        }

        // Calculate distance to determine appropriate animation duration
        const distance = Phaser.Math.Distance.Between(sprite.x, sprite.y, x, y);
        const duration = options.durationMs ?? Phaser.Math.Clamp(distance * 1.4, 90, 240);

        // Mark player as moving
        existingPlayer._isMoving = true;
        existingPlayer._previousTargetPosition = { ...existingPlayer._targetPosition };
        existingPlayer._targetPosition = { x, y };

        // Create new tween and store reference
        existingPlayer._currentTween = this.add.tween({
          targets: sprite,
          x: x,
          y: y,
          duration: duration,
          ease: 'Linear',
          onUpdate: () => {
            existingPlayer._updateAddressLabelPosition();
          },
          onComplete: () => {
            existingPlayer._updateAddressLabelPosition();
            // Stop walking animation and show idle frame
            existingPlayer._isMoving = false;
            existingPlayer._previousTargetPosition = { x, y };
            existingPlayer._targetPosition = { x, y };
            try {
              if (sprite.anims && sprite.anims.currentAnim) {
                sprite.anims.stop();
                sprite.setFrame(existingPlayer._getIdleFrame());
              }
            } catch (error) {
              console.warn('Failed to stop animation:', error);
            }
            // Clear tween reference when animation completes
            existingPlayer._currentTween = undefined;
          },
        });
      } else {
        // Create new player if they don't exist
        const collisionLayer = this.#player?._collisionLayer ?? this.#collisionLayer;
        if (!collisionLayer) {
          return;
        }
        const newPlayer = new Player({
          scene: this,
          position: { x, y },
          direction: DIRECTION.DOWN,
          collisionLayer: collisionLayer,
          otherCharactersToCheckForCollisionsWith: this.#npcs,
          objectsToCheckForCollisionsWith: this.#items,
          entranceLayer: this.#entranceLayer,
          enterEntranceCallback: async () => {},
          playerAddress: playerAddress,
          isCurrentPlayer: false, // Mark as other player for colored backgrounds
        });

        // Set depth to ensure new player is visible
        newPlayer.sprite.setDepth(1);
        newPlayer.setAddressLabelVisible(REMOTE_LABELS_DEFAULT_VISIBLE);

        this.#otherPlayers.set(playerAddress, newPlayer);
        this.#debugLog(`Created new player sprite for: ${playerAddress} at position (${x}, ${y})`);
        this.#pruneRemotePlayers(nowMs);
      }
    } catch (error) {
      console.error('Failed to update other player position:', error);
    }
  }

  #syncCurrentPlayerPosition(x: number, y: number) {
    if (!this.#player) {
      return;
    }

    const worldX = x * TILE_SIZE;
    const worldY = y * TILE_SIZE;

    dataManager.store.set(DATA_MANAGER_STORE_KEYS.PLAYER_POSITION, {
      x: worldX,
      y: worldY,
    });

    if (this.#player.isMoving) {
      return;
    }

    if (this.#player.sprite.x === worldX && this.#player.sprite.y === worldY) {
      return;
    }

    this.#player.sprite.x = worldX;
    this.#player.sprite.y = worldY;
    this.#player._targetPosition = { x: worldX, y: worldY };
    this.#player._previousTargetPosition = { x: worldX, y: worldY };
    this.#player._updateAddressLabelPosition();
  }

  /**
   * Handle item dropped events from subscription
   * @param itemDropData - The item drop data from the subscription
   */
  async #handleItemDroppedEvent(itemDropData: any) {
    try {
      this.#debugLog('Item dropped event received:', itemDropData);

      // Extract item information from the data
      const itemType = itemDropData.item_type || itemDropData.itemType;
      const playerAddress = itemDropData.player;
      const quantity = itemDropData.quantity || 1;

      if (!itemType) {
        console.warn('Item dropped event missing item_type:', itemDropData);
        return;
      }

      // Format the message based on whether it's the current player or another player
      const currentPlayerAddress = walletUtils.getCurrentAccount().address;
      let message: string;

      if (playerAddress === currentPlayerAddress) {
        // Current player dropped an item
        message = `You dropped: ${itemType}${quantity > 1 ? ` x${quantity}` : ''}`;
      } else {
        // Another player dropped an item
        const shortAddress = playerAddress ? `${playerAddress.slice(0, 6)}...${playerAddress.slice(-4)}` : 'Someone';
        message = `${shortAddress} dropped: ${itemType}${quantity > 1 ? ` x${quantity}` : ''}`;
      }

      // Ensure chat UI is initialized
      if (!this.#chatUi) {
        this.#chatUi = this.scene.get(SCENE_KEYS.CHAT_SCENE) as ChatScene;

        if (!this.scene.isActive(SCENE_KEYS.CHAT_SCENE)) {
          this.#debugLog('Starting chat scene for item drop notification...');
          this.scene.launch(SCENE_KEYS.CHAT_SCENE);
          // Wait for scene initialization
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Send message to chat with ITEM type for green color highlighting
      if (this.#chatUi && typeof this.#chatUi.addMessage === 'function') {
        this.#chatUi.addMessage(message, MessageType.ITEM);
        this.#debugLog(`Item drop message sent: ${message}`);
      } else {
        console.warn('Unable to send item drop message: ChatUI not properly initialized');
      }
    } catch (error) {
      console.error('Failed to handle item dropped event:', error);
    }
  }

  #createItems(map: Phaser.Tilemaps.Tilemap) {
    const itemObjectLayer = map.getObjectLayer('Item');
    if (!itemObjectLayer) {
      return;
    }
    const items = itemObjectLayer.objects;
    const validItems = items.filter(item => {
      return item.x !== undefined && item.y !== undefined;
    });

    const itemsPickedUp: number[] = dataManager.store.get(DATA_MANAGER_STORE_KEYS.ITEMS_PICKED_UP) || [];

    for (const tiledItem of validItems) {
      const itemId: number = (tiledItem.properties as TiledObjectProperty[]).find(
        property => property.name === TILED_ITEM_PROPERTY.ITEM_ID,
      )?.value;

      const id: number = (tiledItem.properties as TiledObjectProperty[]).find(
        property => property.name === TILED_ITEM_PROPERTY.ID,
      )?.value;

      if (itemsPickedUp.includes(id)) {
        continue;
      }

      // create object
      const item = new Item({
        scene: this,
        position: {
          x: tiledItem.x,
          y: tiledItem.y - TILE_SIZE,
        },
        itemId,
        id,
      });
      this.#items.push(item);
    }
  }
  async #handleEntranceEnteredCallback(entranceName: string, entranceId: string, isBuildingEntrance: boolean) {
    // Get player's monsters and check if they all have no HP
    const playerMonsters: Monster[] = dataManager.store.get(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY);
    // If there are monsters and all of them have no HP, don't allow teleporting
    const allMonstersNoHp = playerMonsters.length > 0 && playerMonsters.every(monster => monster.currentHp <= 0);

    if (allMonstersNoHp) {
      this.#dialogUi.showDialogModal([
        'Your monsters have all lost their fighting ability...',
        'Please heal your monsters before trying to teleport.',
      ]);
      return;
    }

    if (playerMonsters.length === 0) {
      this.#dialogUi.showDialogModal([
        'You have no monsters in your party...',
        'Please claim monster to your party before trying to teleport.',
      ]);
      return;
    }

    try {
      this._controls.lockInput = true;

      // 创建交易
      const tx = new Transaction();
      await this.dubhe.tx.numeron_map_system.teleport({
        tx,
        params: [tx.object(this._dubheSchemaId), tx.object(this.schemaId)],
        isRaw: true,
      });

      // 先等待交易完成
      await walletUtils.signAndExecuteTransaction({
        tx,
        onSuccess: async (result: any) => {
          this.#debugLog('Teleport transaction successful:', result);

          // 交易完成后再进行场景切换
          await new Promise<void>(resolve => {
            this.cameras.main.fadeOut(1200, 0, 0, 0, async (camera, progress) => {
              if (progress === 1) {
                // 获取地图和入口数据
                const map = this.make.tilemap({ key: `${entranceName.toUpperCase()}_LEVEL` });
                const entranceObjectLayer = map.getObjectLayer('Scene-Transitions');
                const entranceObject = entranceObjectLayer.objects.find(object => {
                  const tempEntranceName = object.properties.find(property => property.name === 'connects_to').value;
                  const tempEntranceId = object.properties.find(property => property.name === 'entrance_id').value;
                  return tempEntranceName === this.#sceneData.area && tempEntranceId === entranceId;
                });

                // 计算新位置
                let newX = entranceObject.x;
                let newY = entranceObject.y - TILE_SIZE;
                if (this.#player.direction === DIRECTION.UP) {
                  newY -= TILE_SIZE;
                }
                if (this.#player.direction === DIRECTION.DOWN) {
                  newY += TILE_SIZE;
                }

                this.#debugLog('setting player position to', {
                  x: newX,
                  y: newY,
                });

                // 存储新位置
                dataManager.store.set(DATA_MANAGER_STORE_KEYS.PLAYER_POSITION, {
                  x: newX,
                  y: newY,
                });

                // 添加一个标记表示正在传送中
                dataManager.store.set('IS_TELEPORTING', true);

                const dataToPass: WorldSceneData = {
                  area: entranceName,
                  isInterior: isBuildingEntrance,
                };

                // 在启动新场景前保持聊天场景状态，避免重新初始化
                if (this.scene.isActive(SCENE_KEYS.CHAT_SCENE)) {
                  this.scene.sleep(SCENE_KEYS.CHAT_SCENE);
                }

                this.scene.start(SCENE_KEYS.WORLD_SCENE, dataToPass);
                resolve();
              }
            });
          });
        },
        onError: (error: any) => {
          console.error(`Teleport transaction failed:`, error);
          this._controls.lockInput = false;
          throw error;
        },
      });
    } catch (error) {
      console.error('Teleport failed:', error);
      this._controls.lockInput = false;
      throw error;
    }
  }

  #handleNpcInteraction() {
    if (this.#isProcessingNpcEvent) {
      return;
    }

    // check to see if the npc has any events associated with them
    const isMoreEventsToProcess = this.#npcPlayerIsInteractingWith.events.length - 1 !== this.#lastNpcEventHandledIndex;

    if (!isMoreEventsToProcess) {
      this.#npcPlayerIsInteractingWith.isTalkingToPlayer = false;
      this.#npcPlayerIsInteractingWith = undefined;
      this.#lastNpcEventHandledIndex = -1;
      this.#isProcessingNpcEvent = false;
      return;
    }

    // get the next event from the queue and process for this npc
    this.#lastNpcEventHandledIndex += 1;
    const eventToHandle = this.#npcPlayerIsInteractingWith.events[this.#lastNpcEventHandledIndex];
    const eventType = eventToHandle.type;

    // check to see if this event should be handled based on story flags
    const currentGameFlags = dataManager.getFlags();
    const eventRequirementsMet = eventToHandle.requires.every(flag => {
      if (flag.startsWith('!')) {
        const actualFlag = flag.substring(1);
        return !currentGameFlags.has(actualFlag);
      }
      return currentGameFlags.has(flag);
    });

    if (!eventRequirementsMet) {
      // jump to next event
      this.#handleNpcInteraction();
      return;
    }

    switch (eventType) {
      case NPC_EVENT_TYPE.MESSAGE:
        this.#dialogUi.showDialogModal(eventToHandle.data.messages);
        break;
      case NPC_EVENT_TYPE.HEAL:
        this.#isProcessingNpcEvent = true;
        this.#healPlayerParty();
        this.#isProcessingNpcEvent = false;
        this.#handleNpcInteraction();
        break;
      case NPC_EVENT_TYPE.SCENE_FADE_IN_AND_OUT:
        this.#isProcessingNpcEvent = true;
        // lock input, and wait for scene to fade in and out
        this.cameras.main.fadeOut(eventToHandle.data.fadeOutDuration, 0, 0, 0, (fadeOutCamera, fadeOutProgress) => {
          if (fadeOutProgress !== 1) {
            return;
          }
          this.time.delayedCall(eventToHandle.data.waitDuration, () => {
            this.cameras.main.fadeIn(eventToHandle.data.fadeInDuration, 0, 0, 0, (fadeInCamera, fadeInProgress) => {
              if (fadeInProgress !== 1) {
                return;
              }
              this.#isProcessingNpcEvent = false;
              this.#handleNpcInteraction();
            });
          });
        });
        // TODO: play audio cue
        break;
      default:
        exhaustiveGuard(eventType);
    }
  }

  /**
   * Creates the Phaser Zone game objects based on the `Events` tilemap data from the Tiled Map.
   * These game objects are used for creating the various in game events and cut scenes for the game.
   * The Zone game objects allow for us to check for overlaps between the player and the area that
   * is defined in the map data.
   */
  #createEventEncounterZones(map: Phaser.Tilemaps.Tilemap) {
    const eventObjectLayer = map.getObjectLayer('Events');
    if (!eventObjectLayer) {
      return;
    }
    const events = eventObjectLayer.objects;
    const validEvents = events.filter(event => {
      return event.x !== undefined && event.y !== undefined;
    });

    const playerMonsters: Monster[] = dataManager.store.get(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY);

    if (playerMonsters.length === 0) {
      dataManager.store.set(DATA_MANAGER_STORE_KEYS.VIEWED_EVENTS, []);
    }

    const viewedEvents: string[] = dataManager.store.get(DATA_MANAGER_STORE_KEYS.VIEWED_EVENTS);
    for (const tiledEvent of validEvents) {
      const eventId: string = (tiledEvent.properties as TiledObjectProperty[]).find(
        property => property.name === TILED_EVENT_PROPERTY.ID,
      )?.value;
      if (viewedEvents.includes(eventId)) {
        continue;
      }

      const eventZone = this.add
        .zone(tiledEvent.x, tiledEvent.y - TILE_SIZE * 2, tiledEvent.width, tiledEvent.height)
        .setOrigin(0)
        .setName(eventId);
      this.#eventZones[eventId] = eventZone;

      if (ENABLE_ZONE_DEBUGGING) {
        const debugZoneRectangle = this.add
          .rectangle(eventZone.x, eventZone.y, eventZone.width, eventZone.height, 0xff0000, 0.5)
          .setOrigin(0);
        this.#debugEventZoneObjects[eventId] = debugZoneRectangle;
      }
    }
  }

  async #startCutScene() {
    this.#isProcessingCutSceneEvent = true;
    await (this.scene.get(SCENE_KEYS.CUTSCENE_SCENE) as CutsceneScene).startCutScene();
    await sleep(500, this);
    this.#isProcessingCutSceneEvent = false;
    this.#handleCutSceneInteraction();
  }

  async #handleCutSceneInteraction() {
    if (this.#isProcessingCutSceneEvent) {
      return;
    }
    if (this.#currentCutSceneId === undefined) {
      return;
    }

    const eventsToProcess = DataUtils.getEventData(this, this.#currentCutSceneId);

    // check to see if the cut scene has any more events to be processed
    const isMoreEventsToProcess = eventsToProcess.events.length - 1 !== this.#lastCutSceneEventHandledIndex;
    if (!isMoreEventsToProcess) {
      // once we are done processing the events for the cutscene, we need to do the following:
      //   1. update our data manager to show we watched the event
      //   2. cleanup zone game object used for the event and overlap detection
      //   3. reset our current cut scene property
      //   4. remove the cut scene bars from the scene
      this.#lastCutSceneEventHandledIndex = -1;
      this.#isProcessingCutSceneEvent = false;
      dataManager.viewedEvent(this.#currentCutSceneId);
      this.#eventZones[this.#currentCutSceneId].destroy();
      delete this.#eventZones[this.#currentCutSceneId];
      if (ENABLE_ZONE_DEBUGGING) {
        this.#gfx.clear();
        this.#debugEventZoneObjects[this.#currentCutSceneId].destroy();
        delete this.#debugEventZoneObjects[this.#currentCutSceneId];
      }
      this.#currentCutSceneId = undefined;

      await (this.scene.get(SCENE_KEYS.CUTSCENE_SCENE) as CutsceneScene).endCutScene();
      await sleep(500, this);
      return;
    }

    // get the next event from the queue and process for this npc
    this.#lastCutSceneEventHandledIndex += 1;
    const eventToHandle = eventsToProcess.events[this.#lastCutSceneEventHandledIndex];
    const eventType = eventToHandle.type;
    const monstersInParty = dataManager.store.get(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY);
    this.#isProcessingCutSceneEvent = true;
    switch (eventType) {
      case GAME_EVENT_TYPE.ADD_NPC:
        this.#createNpcForCutScene(eventToHandle);
        break;
      case GAME_EVENT_TYPE.MOVE_TO_PLAYER:
        this.#moveNpcToPlayer(eventToHandle);
        break;
      case GAME_EVENT_TYPE.RETRACE_PATH:
        this.#haveNpcRetracePath(eventToHandle);
        break;
      case GAME_EVENT_TYPE.REMOVE_NPC:
        this.#removeNpcForCutScene(eventToHandle);
        break;
      case GAME_EVENT_TYPE.TALK_TO_PLAYER:
        // if (monstersInParty.length === 0) {
        this.#haveNpcTalkToPlayer(eventToHandle);
        // } else {
        //   console.log('You already talked to your mom');
        // }
        break;
      case GAME_EVENT_TYPE.GIVE_MONSTER:
        // if (monstersInParty.length === 0) {
        this.#addMonsterFromNpc(eventToHandle);
        // } else {
        //   console.log('You already have a monster in your party');
        // }
        break;
      case GAME_EVENT_TYPE.ADD_FLAG:
        this.#addGameFlag(eventToHandle);
        break;
      case GAME_EVENT_TYPE.REMOVE_FLAG:
        this.#removeGameFlag(eventToHandle);
        break;
      default:
        exhaustiveGuard(eventType);
    }
  }

  #createNpcForCutScene(gameEvent: GameEventAddNpc) {
    const npc = new NPC({
      scene: this,
      position: { x: gameEvent.data.x * TILE_SIZE, y: gameEvent.data.y * TILE_SIZE },
      direction: gameEvent.data.direction,
      frame: gameEvent.data.frame,
      npcPath: {
        0: { x: gameEvent.data.x * TILE_SIZE, y: gameEvent.data.y * TILE_SIZE },
      },
      movementPattern: NPC_MOVEMENT_PATTERN.IDLE,
      events: [],
      animationKeyPrefix: gameEvent.data.animationKeyPrefix,
      id: gameEvent.data.id,
    });
    this.#npcs.push(npc);
    npc.addCharacterToCheckForCollisionsWith(this.#player);

    this.#isProcessingCutSceneEvent = false;
    this.#handleCutSceneInteraction();
  }

  async #moveNpcToPlayer(gameEvent: GameEventMoveToPlayer) {
    const targetNpc = this.#npcs.find(npc => npc.id === gameEvent.data.id);
    if (targetNpc === undefined) {
      this.#isProcessingCutSceneEvent = false;
      this.#handleCutSceneInteraction();
      return;
    }

    // determine direction to move based on distance from player
    const targetPath = getTargetPathToGameObject(targetNpc.sprite, this.#player.sprite);
    const pathToFollow = targetPath.pathToFollow.splice(0, targetPath.pathToFollow.length - 1);

    // if npc is already next to player, just update directions
    if (pathToFollow.length === 0) {
      await this.#player.moveCharacter(getTargetDirectionFromGameObjectPosition(this.#player.sprite, targetNpc.sprite));
      targetNpc.facePlayer(this.#player.direction);
      this.#isProcessingCutSceneEvent = false;
      this.#handleCutSceneInteraction();
      return;
    }

    // move npc according to the path
    const npcPath: NPCPath = {
      0: { x: targetNpc.sprite.x, y: targetNpc.sprite.y },
    };
    pathToFollow.forEach((coordinate, index) => {
      npcPath[index + 1] = coordinate;
    });

    targetNpc.finishedMovementCallback = async () => {
      if (
        pathToFollow[pathToFollow.length - 1].x === targetNpc.sprite.x &&
        pathToFollow[pathToFollow.length - 1].y === targetNpc.sprite.y
      ) {
        await this.#player.moveCharacter(
          getTargetDirectionFromGameObjectPosition(this.#player.sprite, targetNpc.sprite),
        );
        targetNpc.facePlayer(this.#player.direction);
        this.time.delayedCall(500, () => {
          this.#isProcessingCutSceneEvent = false;
          this.#handleCutSceneInteraction();
        });
      }
    };
    targetNpc.npcMovementPattern = NPC_MOVEMENT_PATTERN.SET_PATH;
    targetNpc.npcPath = npcPath;
    targetNpc.resetMovementTime();
  }

  #haveNpcRetracePath(gameEvent: GameEventRetracePath) {
    const targetNpc = this.#npcs.find(npc => npc.id === gameEvent.data.id);
    if (targetNpc === undefined) {
      this.#isProcessingCutSceneEvent = false;
      this.#handleCutSceneInteraction();
      return;
    }

    // have npc retrace their steps by reversing the existing npc path
    const updatedPath: NPCPath = {};
    const pathKeys = Object.keys(targetNpc.npcPath).reverse();

    pathKeys.forEach((pathKey, index) => {
      updatedPath[index] = targetNpc.npcPath[pathKey];
    });

    // if npc is already next to player, there will be only 1 position in the npc path
    // when this happens, we need to just updates the npcs direction
    if (pathKeys.length === 1) {
      targetNpc.facePlayer(gameEvent.data.direction);
      this.time.delayedCall(500, () => {
        this.#isProcessingCutSceneEvent = false;
        this.#handleCutSceneInteraction();
      });
      return;
    }

    targetNpc.finishedMovementCallback = () => {
      if (
        updatedPath[pathKeys.length - 1].x === targetNpc.sprite.x &&
        updatedPath[pathKeys.length - 1].y === targetNpc.sprite.y
      ) {
        this.time.delayedCall(500, () => {
          this.#isProcessingCutSceneEvent = false;
          this.#handleCutSceneInteraction();
        });
      }
    };

    targetNpc.npcMovementPattern = NPC_MOVEMENT_PATTERN.SET_PATH;
    targetNpc.npcPath = updatedPath;
    targetNpc.resetMovementTime();
  }

  #removeNpcForCutScene(gameEvent: GameEventRemoveNpc) {
    // once we are done with an npc for a cutscene, we can remove that npc
    // from our npc array and then start the cleanup process of destroying the game object
    const npcToRemoveIndex = this.#npcs.findIndex(npc => npc.id === gameEvent.data.id);
    let npcToRemove: NPC | undefined;
    if (npcToRemoveIndex !== -1) {
      npcToRemove = this.#npcs.splice(npcToRemoveIndex)[0];
    }
    this.time.delayedCall(100, () => {
      if (npcToRemove !== undefined) {
        npcToRemove.sprite.destroy();
      }
      this.#isProcessingCutSceneEvent = false;
      this.#handleCutSceneInteraction();
    });
  }

  #haveNpcTalkToPlayer(gameEvent: GameEventTalkToPlayer) {
    const targetNpc = this.#npcs.find(npc => npc.id === gameEvent.data.id);
    if (targetNpc === undefined) {
      this.#isProcessingCutSceneEvent = false;
      this.#handleCutSceneInteraction();
      return;
    }

    targetNpc.isTalkingToPlayer = true;
    this.#npcPlayerIsInteractingWith = targetNpc;
    this.#dialogUi.showDialogModal(gameEvent.data.messages);
  }

  async #addMonsterFromNpc(gameEvent: GameEventGiveMonster) {
    // TODO: add check to see if party is full and do something with 7th monster that is being added
    if (dataManager.store.get(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY).length === 0) {
      this.#debugLog('Adding monster to party');
      const tx = new Transaction();
      await this.dubhe.tx.numeron_monster_system.claim_monster({
        tx,
        params: [tx.object(DUBHE_SCHEMA_ID), tx.object(this.schemaId)],
        isRaw: true,
      });
      await walletUtils.signAndExecuteTransaction({
        tx,
        onSuccess: async (result: any) => {
          this.#debugLog('Transaction successful:', result);
        },
        onError: (error: any) => {
          console.error(`Transaction failed:`, error);
        },
      });
    } else {
      this.#debugLog('You already have a monster in your party');
    }

    // const monstersInParty: Monster[] = dataManager.store.get(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY);
    // const newMonster = DataUtils.getMonsterById(this, gameEvent.data.id);
    // monstersInParty.push(newMonster);
    // dataManager.store.set(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY, monstersInParty);
    this.#isProcessingCutSceneEvent = false;
    this.#handleCutSceneInteraction();
  }

  #addGameFlag(gameEvent: GameEventAddFlag) {
    dataManager.addFlag(gameEvent.data.flag);
    this.#isProcessingCutSceneEvent = false;
    this.#handleCutSceneInteraction();
  }

  #removeGameFlag(gameEvent: GameEventRemoveFlag) {
    dataManager.removeFlag(gameEvent.data.flag);
    this.#isProcessingCutSceneEvent = false;
    this.#handleCutSceneInteraction();
  }

  #createEncounterAreas(map: Phaser.Tilemaps.Tilemap) {
    const encounterLayers = map.getTileLayerNames().filter(layerName => layerName.includes('Encounter'));
    if (encounterLayers.length > 0) {
      const encounterTiles = map.addTilesetImage('encounter', WORLD_ASSET_KEYS.WORLD_ENCOUNTER_ZONE);
      if (!encounterTiles) {
        console.log(`[${WorldScene.name}:create] encountered error while creating encounter tiles from tiled`);
        return;
      }

      encounterLayers.forEach(layerName => {
        const layer = map.createLayer(layerName, encounterTiles, 0, 0);
        layer.setAlpha(TILED_COLLISION_LAYER_ALPHA).setDepth(2);
        this.#encounterLayers.push(layer);
      });
    }
  }

  #handlePlayerMovementStarted(position: Coordinate) {
    this.#encounterZonePlayerIsEntering = undefined;

    let encounterTile;
    let isEnteringEncounter = false;
    this.#encounterLayers.some(encounterLayer => {
      encounterTile = encounterLayer.getTileAtWorldXY(position.x, position.y, true);
      if (encounterTile.index !== -1) {
        this.#encounterZonePlayerIsEntering = encounterLayer;
        isEnteringEncounter = true;
        return true;
      }
      return false;
    });

    // 只在"刚进入草丛"时做宠物检查
    if (isEnteringEncounter) {
      const playerMonsters: Monster[] = dataManager.store.get(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY);
      if (playerMonsters.length === 0) {
        this.#dialogUi.showDialogModal([
          "You don't have any monsters...",
          'Please obtain a monster before entering the grass.',
        ]);
        this.#encounterZonePlayerIsEntering = undefined;
        return false;
      }
      const allMonstersNoHp = playerMonsters.every(monster => monster.currentHp <= 0);
      if (allMonstersNoHp) {
        this.#dialogUi.showDialogModal([
          'All your monsters have lost their fighting ability...',
          'Please heal your monsters before entering the grass.',
        ]);
        this.#encounterZonePlayerIsEntering = undefined;
        return false;
      }
    }

    if (this.#encounterZonePlayerIsEntering === undefined) {
      if (this.#player.direction === DIRECTION.DOWN) {
        // if player is moving in the down direction, hide current tile so player does not move under it
        this.#hideSpecialEncounterTiles();
      }
      return;
    }

    this.#debugLog('player is moving to an encounter zone');
    // check the tile type for the encounter the player is moving through and play related effects
    this.#handleEncounterTileTypeEffects(this.#encounterZonePlayerIsEntering, encounterTile, this.#player.direction);
  }

  /**
   * Plays the associated special effects when player is about to move through a particular tile type.
   * Example, when moving through the grass, we play a sound effect and show an additional
   * game object to make it look like the player is moving through the grass.
   */
  #handleEncounterTileTypeEffects(
    encounterLayer: Phaser.Tilemaps.TilemapLayer,
    encounterTile: Phaser.Tilemaps.Tile,
    playerDirection: Direction,
  ) {
    const encounterTileType: EncounterTileType = (encounterLayer.layer.properties as TiledObjectProperty[]).find(
      property => property.name === TILED_ENCOUNTER_PROPERTY.TILE_TYPE,
    ).value;

    switch (encounterTileType) {
      case ENCOUNTER_TILE_TYPE.GRASS:
        // create grass sprite for when player moves through grass
        const object: Phaser.GameObjects.Image = this.#specialEncounterTileImageGameObjectGroup
          .getFirstDead(true, encounterTile.pixelX, encounterTile.pixelY, WORLD_ASSET_KEYS.GRASS, 1, true)
          .setOrigin(0)
          .setVisible(true)
          .setActive(true);
        if (playerDirection === DIRECTION.DOWN || playerDirection === DIRECTION.UP) {
          object.visible = false;
        }
        playSoundFx(this, AUDIO_ASSET_KEYS.GRASS);
        break;
      case ENCOUNTER_TILE_TYPE.NONE:
        break;
      default:
        exhaustiveGuard(encounterTileType);
    }

    if (playerDirection !== DIRECTION.DOWN) {
      return;
    }
    this.#hideSpecialEncounterTiles();
  }

  #hideSpecialEncounterTiles() {
    if (
      !this.#specialEncounterTileImageGameObjectGroup ||
      typeof this.#specialEncounterTileImageGameObjectGroup.getChildren !== 'function'
    ) {
      return;
    }

    this.#specialEncounterTileImageGameObjectGroup.getChildren().some((child: Phaser.GameObjects.Image) => {
      if (!child.active) {
        return false;
      }
      if (child.x === this.#player.sprite.x && child.y === this.#player.sprite.y) {
        child.active = false;
        child.visible = false;
        return true;
      }
      return false;
    });
  }

  // 玩家发送聊天消息的方法
  async sendChatMessage(message: string) {
    try {
      if (!message || !message.trim()) return;

      // 确保 #chatUi 已初始化
      if (!this.#chatUi) {
        this.#chatUi = this.scene.get(SCENE_KEYS.CHAT_SCENE) as ChatScene;

        if (!this.scene.isActive(SCENE_KEYS.CHAT_SCENE)) {
          this.#debugLog('Starting chat scene...');
          this.scene.launch(SCENE_KEYS.CHAT_SCENE);

          // 等待场景初始化完成
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // 再次检查chatUi是否正确初始化
      if (this.#chatUi && typeof this.#chatUi.addMessage === 'function') {
        this.#chatUi.addMessage(message, MessageType.PLAYER);
      } else {
        console.warn('无法发送消息: ChatUI未正确初始化');
      }
    } catch (error) {
      console.error('发送聊天消息失败:', error);
    }
  }

  // 添加公共方法供其他类检查战斗状态
  isWildMonsterEncountered(): boolean {
    return this.#wildMonsterEncountered;
  }

  /**
   * Create transaction feed display in top-right corner
   */
  #createTransactionFeed() {
    this.#transactionFeedTexts = [];
    this.#transactionFeedDebugEntries = [];
    this.#nextTransactionFeedSequence = 1;

    if (!ENABLE_TRANSACTION_FEED_UI) {
      return;
    }

    // Create container for the transaction feed
    this.#transactionFeedContainer = this.add.container(0, 0);
    this.#transactionFeedContainer.setScrollFactor(0);
    this.#transactionFeedContainer.setDepth(1000);

    // Create background rectangle with transparency
    const feedWidth = 400;
    const feedHeight = 300;
    const padding = 10;

    // Position in top-right corner (accounting for camera zoom)
    const x = this.cameras.main.width / this.cameras.main.zoom - feedWidth - padding;
    const y = padding;

    const background = this.add.rectangle(0, 0, feedWidth, feedHeight, 0x000000, 0.6);
    background.setOrigin(0, 0);
    background.setStrokeStyle(2, 0x00ff00, 0.8);

    // Add title
    const title = this.add
      .text(feedWidth / 2, 15, 'Transaction Feed', {
        fontSize: '16px',
        color: '#00ff00',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);

    this.#transactionFeedContainer.add([background, title]);
    this.#transactionFeedContainer.setPosition(x, y);
  }

  addTransactionFeedEntry(summary: string, detail?: string, source: TransactionFeedSource = 'system') {
    this.#addTransactionToFeed(summary, detail, source);
  }

  debugState() {
    const player = this.#player
      ? {
          x: this.#player.sprite.x,
          y: this.#player.sprite.y,
          moving: this.#player.isMoving,
          chainMovementPending: this.#player.isChainMovementPending,
          direction: this.#player.direction,
        }
      : null;

    return {
      scene: this.scene.key,
      area: this.#sceneData?.area ?? null,
      currentPlayer: walletUtils.getCurrentAccount().address,
      player,
      otherPlayers: this.#otherPlayers?.size ?? 0,
      subscriptionActive: typeof this.subscription === 'function',
      feedEntries: this.#transactionFeedDebugEntries?.map(entry => entry.displayText) ?? [],
      feedDebugEntries:
        this.#transactionFeedDebugEntries?.map(entry => ({
          ...entry,
        })) ?? [],
    };
  }

  async debugMove(direction: Direction) {
    if (!this.#player) {
      throw new Error('World player is not initialized yet');
    }

    await this.#player.moveCharacter(direction);
    return this.debugState();
  }

  async debugRegisterCurrentPlayer(timeoutMs = REGISTER_POSITION_WAIT_TIMEOUT_MS) {
    const rawAccountKey = walletUtils.getCurrentAccount().address;
    const contractAccountKey = walletUtils.getCurrentAccountContractKey();
    const queryPosition = async (account: string) => {
      try {
        return await walletUtils.dubhe.queryChannelTable({
          account,
          table: 'position',
          key: [],
        });
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };

    const submitResult = await this.registerNewPlayer(this.dubhe);
    const rawAccountPosition = await queryPosition(rawAccountKey);
    const contractAccountPosition = await queryPosition(contractAccountKey);
    const waitedPosition = await this.#waitForRegisteredPlayerPosition(contractAccountKey, timeoutMs);

    return {
      rawAccountKey,
      contractAccountKey,
      submitResult,
      rawAccountPosition,
      contractAccountPosition,
      waitedPosition,
      state: this.debugState(),
    };
  }

  async debugPrepareForBenchmark(timeoutMs = 5000) {
    if (!this.#player) {
      throw new Error('World player is not initialized yet');
    }

    const deadline = Date.now() + timeoutMs;
    const finalizeBenchmarkState = () => {
      this._controls.lockInput = false;
      this.#isProcessingNpcEvent = false;
      this.#isProcessingCutSceneEvent = false;
      this.#npcPlayerIsInteractingWith = undefined;
      this.#currentCutSceneId = undefined;
      this.#dialogUi?.hideDialogModal();

      [
        SCENE_KEYS.TITLE_SCENE,
        SCENE_KEYS.CUTSCENE_SCENE,
        SCENE_KEYS.DIALOG_SCENE,
        SCENE_KEYS.CHAT_SCENE,
      ].forEach(sceneKey => {
        if (this.scene.isActive(sceneKey) || this.scene.isSleeping(sceneKey)) {
          this.scene.stop(sceneKey);
        }
      });

      return this.debugState();
    };

    while (Date.now() < deadline) {
      if (!this.#dialogUi) {
        await sleep(100, this);
        continue;
      }

      if (!this.#isPlayerInputLocked()) {
        return finalizeBenchmarkState();
      }

      await this.#handlePlayerInteraction();
      await sleep(100, this);
    }

    return finalizeBenchmarkState();
  }

  debugGetAvailableMoveDirections(
    preferredDirections: Direction[] = [DIRECTION.RIGHT, DIRECTION.DOWN, DIRECTION.LEFT, DIRECTION.UP],
  ) {
    if (!this.#player) {
      return [];
    }

    const playerPosition = {
      x: this.#player.sprite.x,
      y: this.#player.sprite.y,
    };

    return preferredDirections.filter(direction => {
      if (direction === DIRECTION.NONE) {
        return false;
      }

      const targetPosition = getTargetPositionFromGameObjectPositionAndDirection(playerPosition, direction);

      if (this.#collisionLayer) {
        const collisionTile = this.#collisionLayer.getTileAtWorldXY(targetPosition.x, targetPosition.y, true);
        if (collisionTile && collisionTile.index !== -1) {
          return false;
        }
      }

      for (const otherPlayer of this.#otherPlayers.values()) {
        if (otherPlayer.sprite.x === targetPosition.x && otherPlayer.sprite.y === targetPosition.y) {
          return false;
        }
      }

      for (const item of this.#items) {
        if (item.position.x === targetPosition.x && item.position.y === targetPosition.y) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Add a transaction or table update to the feed display
   * @param summary - Main label to display
   * @param detail - Optional secondary detail line
   */
  #addTransactionToFeed(summary: string, detail?: string, source: TransactionFeedSource = 'system') {
    this.#transactionFeedTexts ||= [];
    this.#transactionFeedDebugEntries ||= [];
    this.#nextTransactionFeedSequence ||= 1;

    const feedWidth = 400;
    const padding = 5;
    const lineHeight = 28;
    const startY = 45;

    // Remove oldest item if at max capacity
    if (this.#transactionFeedTexts.length >= this.#maxFeedItems) {
      const oldestText = this.#transactionFeedTexts.shift();
      if (oldestText) {
        oldestText.destroy();
      }
      this.#transactionFeedDebugEntries.shift();
    }

    // Move existing texts down
    this.#transactionFeedTexts.forEach((text, index) => {
      text.setY(startY + (index + 1) * lineHeight);
      // Fade out older items
      const alpha = 1 - (index + 1) * 0.1;
      text.setAlpha(Math.max(alpha, 0.3));
    });

    // Create timestamp
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const formatValue = (value: string) => {
      if (!value) {
        return value;
      }
      if (value.length <= 24) {
        return value;
      }
      return `${value.substring(0, 10)}...${value.substring(value.length - 6)}`;
    };

    let displayText = `[${timeStr}] ${formatValue(summary)}`;
    if (detail) {
      displayText = `[${timeStr}] ${formatValue(summary)}\n  ${formatValue(detail)}`;
    }

    this.#transactionFeedDebugEntries.push({
      sequence: this.#nextTransactionFeedSequence,
      summary,
      detail,
      source,
      observedAtMs: Date.now(),
      displayText,
    });
    this.#nextTransactionFeedSequence += 1;

    if (!ENABLE_TRANSACTION_FEED_UI || !this.#transactionFeedContainer) {
      return;
    }

    // Create new text for this transaction
    const newText = this.add
      .text(padding, startY, displayText, {
        fontSize: '12px',
        color: '#00ff00',
        fontFamily: 'monospace',
        wordWrap: { width: feedWidth - padding * 2 },
      })
      .setOrigin(0, 0)
      .setAlpha(1);

    // Add to container and array
    this.#transactionFeedContainer.add(newText);
    this.#transactionFeedTexts.push(newText);

    // Add fade-in animation for the new item
    this.tweens.add({
      targets: newText,
      alpha: { from: 0, to: 1 },
      duration: 300,
      ease: 'Power2',
    });
  }
}
