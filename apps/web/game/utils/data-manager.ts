import { DIRECTION, Direction } from '../common/direction';
import { TEXT_SPEED, TILE_SIZE } from '../config';
import {
  TextSpeedMenuOptions,
  BattleSceneMenuOptions,
  BattleStyleMenuOptions,
  SoundMenuOptions,
  VolumeMenuOptions,
  MenuColorOptions,
  TEXT_SPEED_OPTIONS,
  BATTLE_SCENE_OPTIONS,
  BATTLE_STYLE_OPTIONS,
  SOUND_OPTIONS,
} from '../common/options';
import { exhaustiveGuard } from './guard';
import { DataUtils } from './data-utils';
import {
  GAME_FLAG,
  Monster,
  Inventory,
  GameFlag,
  InventoryItem,
  Item,
  LOCATION_TYPE,
  ITEM_EFFECT,
  ITEM_CATEGORY,
  ItemCategory,
} from '../types/typedef';
import { bcs, Dubhe } from '@0xobelisk/sui-client';
import { NETWORK, PACKAGE_ID } from 'contracts/deployment';
import { walletUtils } from './wallet-utils';

const LOCAL_STORAGE_KEY = 'MONSTER_TAMER_DATA';

export type PlayerLocation = {
  area: string;
  isInterior: boolean;
};

export type MonsterData = {
  inParty: Monster[];
};

export type EncounterData = {
  monsterId: number;
  playerMonsterId: number;
  isBattling: boolean;
};

export type EncounterMonsterData = {
  monster: Monster;
  playerMonsterId: number;
  isBattling: boolean;
};

export interface GlobalState {
  player: {
    position: {
      x: number;
      y: number;
    };
    direction: Direction;
    location: PlayerLocation;
  };
  options: {
    textSpeed: TextSpeedMenuOptions;
    battleSceneAnimations: BattleSceneMenuOptions;
    battleStyle: BattleStyleMenuOptions;
    sound: SoundMenuOptions;
    volume: VolumeMenuOptions;
    menuColor: MenuColorOptions;
  };
  gameStarted: boolean;
  monsters: MonsterData;
  inventory: Inventory;
  itemsPickedUp: number[];
  viewedEvents: number[];
  flags: GameFlag[];
}

export const initialState: GlobalState = {
  player: {
    position: {
      x: 1 * TILE_SIZE,
      y: 1 * TILE_SIZE,
    },
    direction: DIRECTION.DOWN,
    location: {
      area: 'main_1',
      isInterior: false,
    },
  },
  options: {
    textSpeed: TEXT_SPEED_OPTIONS.MID,
    battleSceneAnimations: BATTLE_SCENE_OPTIONS.ON,
    battleStyle: BATTLE_STYLE_OPTIONS.SHIFT,
    sound: SOUND_OPTIONS.ON,
    volume: 4,
    menuColor: 0,
  },
  gameStarted: false,
  monsters: {
    inParty: [],
  },
  inventory: [
    {
      item: {
        id: 1,
      },
      quantity: 10,
    },
    {
      item: {
        id: 2,
      },
      quantity: 5,
    },
  ],
  itemsPickedUp: [],
  viewedEvents: [],
  flags: [],
};

export const DATA_MANAGER_STORE_KEYS = Object.freeze({
  PLAYER_POSITION: 'PLAYER_POSITION',
  PLAYER_DIRECTION: 'PLAYER_DIRECTION',
  PLAYER_LOCATION: 'PLAYER_LOCATION',
  OPTIONS_TEXT_SPEED: 'OPTIONS_TEXT_SPEED',
  OPTIONS_BATTLE_SCENE_ANIMATIONS: 'OPTIONS_BATTLE_SCENE_ANIMATIONS',
  OPTIONS_BATTLE_STYLE: 'OPTIONS_BATTLE_STYLE',
  OPTIONS_SOUND: 'OPTIONS_SOUND',
  OPTIONS_VOLUME: 'OPTIONS_VOLUME',
  OPTIONS_MENU_COLOR: 'OPTIONS_MENU_COLOR',
  GAME_STARTED: 'GAME_STARTED',
  MONSTERS_IN_PARTY: 'MONSTERS_IN_PARTY',
  INVENTORY: 'INVENTORY',
  ITEMS_PICKED_UP: 'ITEMS_PICKED_UP',
  VIEWED_EVENTS: 'VIEWED_EVENTS',
  FLAGS: 'FLAGS',
});

class DataManager extends Phaser.Events.EventEmitter {
  #store: Phaser.Data.DataManager;
  dubhe: Dubhe;
  schemaId: string;

  constructor() {
    super();
    this.#store = new Phaser.Data.DataManager(this);
    // initialize state with initial values
    // this.#updateDataManger(initialState);
    const dubhe = new Dubhe({
      networkType: NETWORK,
      packageId: PACKAGE_ID,
      secretKey: process.env.NEXT_PUBLIC_PRIVATE_KEY
    });
    this.dubhe = dubhe;
  }

  get store(): Phaser.Data.DataManager {
    return this.#store;
  }

  loadData() {
    // attempt to load data from browser storage and populate the data manager
    if (typeof Storage === 'undefined') {
      console.warn(
        `[${DataManager.name}:loadData] localStorage is not supported, will not be able to save and load data.`,
      );
      return;
    }

    const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedData === null) {
      return;
    }
    try {
      // TODO: we should add error handling and data validation at this step to make sure we get the data we expect.
      const parsedData: GlobalState = JSON.parse(savedData);
      console.log('parsedData', parsedData);
      // update the state with the saved data
      this.#updateDataManger(parsedData);
    } catch (error) {
      console.warn(
        `[${DataManager.name}:loadData] encountered an error while attempting to load and parse saved data.`,
      );
    }
  }

  async saveData() {
    // attempt to storage data in browser storage from data manager
    if (typeof Storage === 'undefined') {
      console.warn(
        `[${DataManager.name}:saveData] localStorage is not supported, will not be able to save and load data.`,
      );
      return;
    }
    const dataToSave = await this.#dataManagerDataToGlobalStateObject();
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(dataToSave));
  }

  async startNewGame() {
    // get existing data before resetting all of the data, so we can persist options data
    const existingData = await this.#dataManagerDataToGlobalStateObject();
    existingData.player.position = { ...existingData.player.position };
    existingData.monsters = {
      inParty: [...existingData.monsters.inParty],
    };
    existingData.viewedEvents = [...existingData.viewedEvents];
    existingData.player.location = { ...existingData.player.location };

    existingData.player.direction = initialState.player.direction;
    existingData.gameStarted = initialState.gameStarted;
    existingData.inventory = initialState.inventory;
    existingData.itemsPickedUp = [...initialState.itemsPickedUp];
    existingData.flags = [...initialState.flags];

    this.#store.reset();
    this.#updateDataManger(existingData);
    this.saveData();
  }

  getAnimatedTextSpeed(): number {
    const chosenTextSpeed: TextSpeedMenuOptions | undefined = this.#store.get(
      DATA_MANAGER_STORE_KEYS.OPTIONS_TEXT_SPEED,
    );
    if (chosenTextSpeed === undefined) {
      return TEXT_SPEED.MEDIUM;
    }

    switch (chosenTextSpeed) {
      case TEXT_SPEED_OPTIONS.FAST:
        return TEXT_SPEED.FAST;
      case TEXT_SPEED_OPTIONS.MID:
        return TEXT_SPEED.MEDIUM;
      case TEXT_SPEED_OPTIONS.SLOW:
        return TEXT_SPEED.SLOW;
      default:
        exhaustiveGuard(chosenTextSpeed);
    }
  }

  updateInventory(items: InventoryItem[]) {
    const inventory = items.map(item => {
      return {
        item: {
          id: item.item.id,
        },
        quantity: item.quantity,
      };
    });
    this.#store.set(DATA_MANAGER_STORE_KEYS.INVENTORY, inventory);
  }

  addItem(item: Item, quantity: number) {
    const inventory: Inventory = this.#store.get(DATA_MANAGER_STORE_KEYS.INVENTORY);
    const existingItem = inventory.find(inventoryItem => {
      return inventoryItem.item.id === item.id;
    });
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      inventory.push({
        item,
        quantity,
      });
    }
    this.#store.set(DATA_MANAGER_STORE_KEYS.INVENTORY, inventory);
  }

  addItemPickedUp(itemId: number) {
    const itemsPickedUp: number[] = this.#store.get(DATA_MANAGER_STORE_KEYS.ITEMS_PICKED_UP) || [];
    itemsPickedUp.push(itemId);
    this.#store.set(DATA_MANAGER_STORE_KEYS.ITEMS_PICKED_UP, itemsPickedUp);
  }

  isPartyFull(): boolean {
    const partySize = this.#store.get(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY).length;
    return partySize === 6;
  }

  viewedEvent(eventId: number) {
    const viewedEvents: Set<number> = new Set(this.#store.get(DATA_MANAGER_STORE_KEYS.VIEWED_EVENTS) || []);
    viewedEvents.add(eventId);
    this.#store.set(DATA_MANAGER_STORE_KEYS.VIEWED_EVENTS, Array.from(viewedEvents));
  }

  getFlags(): Set<string> {
    return new Set(this.#store.get(DATA_MANAGER_STORE_KEYS.FLAGS) || []);
  }

  addFlag(flag: GameFlag) {
    const existingFlags: Set<string> = new Set(this.#store.get(DATA_MANAGER_STORE_KEYS.FLAGS) || []);
    existingFlags.add(flag);
    this.#store.set(DATA_MANAGER_STORE_KEYS.FLAGS, Array.from(existingFlags));
  }

  removeFlag(flag: GameFlag) {
    const existingFlags: Set<string> = new Set(this.#store.get(DATA_MANAGER_STORE_KEYS.FLAGS) || []);
    existingFlags.delete(flag);
    this.#store.set(DATA_MANAGER_STORE_KEYS.FLAGS, Array.from(existingFlags));
  }

  #updateDataManger(data: GlobalState) {
    this.#store.set({
      [DATA_MANAGER_STORE_KEYS.PLAYER_POSITION]: data.player.position,
      [DATA_MANAGER_STORE_KEYS.PLAYER_DIRECTION]: data.player.direction,
      [DATA_MANAGER_STORE_KEYS.PLAYER_LOCATION]: data.player.location,
      [DATA_MANAGER_STORE_KEYS.OPTIONS_TEXT_SPEED]: data.options.textSpeed,
      [DATA_MANAGER_STORE_KEYS.OPTIONS_BATTLE_SCENE_ANIMATIONS]: data.options.battleSceneAnimations,
      [DATA_MANAGER_STORE_KEYS.OPTIONS_BATTLE_STYLE]: data.options.battleStyle,
      [DATA_MANAGER_STORE_KEYS.OPTIONS_SOUND]: data.options.sound,
      [DATA_MANAGER_STORE_KEYS.OPTIONS_VOLUME]: data.options.volume,
      [DATA_MANAGER_STORE_KEYS.OPTIONS_MENU_COLOR]: data.options.menuColor,
      [DATA_MANAGER_STORE_KEYS.GAME_STARTED]: data.gameStarted,
      [DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY]: data.monsters.inParty,
      [DATA_MANAGER_STORE_KEYS.INVENTORY]: data.inventory,
      [DATA_MANAGER_STORE_KEYS.ITEMS_PICKED_UP]: data.itemsPickedUp || [...initialState.itemsPickedUp],
      [DATA_MANAGER_STORE_KEYS.VIEWED_EVENTS]: data.viewedEvents || [...initialState.viewedEvents],
      [DATA_MANAGER_STORE_KEYS.FLAGS]: data.flags || [...initialState.flags],
    });
  }

  async initializeData(data: GlobalState) {
    await this.updatePlayerPosition();

    this.#store.set({
      [DATA_MANAGER_STORE_KEYS.PLAYER_DIRECTION]: data.player.direction,
      [DATA_MANAGER_STORE_KEYS.OPTIONS_TEXT_SPEED]: data.options.textSpeed,
      [DATA_MANAGER_STORE_KEYS.OPTIONS_BATTLE_SCENE_ANIMATIONS]: data.options.battleSceneAnimations,
      [DATA_MANAGER_STORE_KEYS.OPTIONS_BATTLE_STYLE]: data.options.battleStyle,
      [DATA_MANAGER_STORE_KEYS.OPTIONS_SOUND]: data.options.sound,
      [DATA_MANAGER_STORE_KEYS.OPTIONS_VOLUME]: data.options.volume,
      [DATA_MANAGER_STORE_KEYS.OPTIONS_MENU_COLOR]: data.options.menuColor,
      [DATA_MANAGER_STORE_KEYS.GAME_STARTED]: data.gameStarted,
      [DATA_MANAGER_STORE_KEYS.INVENTORY]: data.inventory,
      [DATA_MANAGER_STORE_KEYS.ITEMS_PICKED_UP]: data.itemsPickedUp || [...initialState.itemsPickedUp],
      [DATA_MANAGER_STORE_KEYS.VIEWED_EVENTS]: data.viewedEvents || [...initialState.viewedEvents],
      [DATA_MANAGER_STORE_KEYS.FLAGS]: data.flags || [...initialState.flags],
    });
  }

  async #dataManagerDataToGlobalStateObject(): Promise<GlobalState> {
    const playerPosition = await this.updatePlayerPosition();
    return {
      player: {
        position: {
          x: playerPosition.x,
          y: playerPosition.y,
          // x: Number(playerPosition.value.x) * TILE_SIZE,
          // y: Number(playerPosition.value.y) * TILE_SIZE,
        },
        direction: this.#store.get(DATA_MANAGER_STORE_KEYS.PLAYER_DIRECTION),
        location: playerPosition.location,
      },
      options: {
        textSpeed: this.#store.get(DATA_MANAGER_STORE_KEYS.OPTIONS_TEXT_SPEED),
        battleSceneAnimations: this.#store.get(DATA_MANAGER_STORE_KEYS.OPTIONS_BATTLE_SCENE_ANIMATIONS),
        battleStyle: this.#store.get(DATA_MANAGER_STORE_KEYS.OPTIONS_BATTLE_STYLE),
        sound: this.#store.get(DATA_MANAGER_STORE_KEYS.OPTIONS_SOUND),
        volume: this.#store.get(DATA_MANAGER_STORE_KEYS.OPTIONS_VOLUME),
        menuColor: this.#store.get(DATA_MANAGER_STORE_KEYS.OPTIONS_MENU_COLOR),
      },
      gameStarted: this.#store.get(DATA_MANAGER_STORE_KEYS.GAME_STARTED),
      monsters: {
        inParty: [],
      },
      inventory: this.#store.get(DATA_MANAGER_STORE_KEYS.INVENTORY),
      itemsPickedUp: [...(this.#store.get(DATA_MANAGER_STORE_KEYS.ITEMS_PICKED_UP) || [])],
      viewedEvents: [...(this.#store.get(DATA_MANAGER_STORE_KEYS.VIEWED_EVENTS) || [])],
      flags: [...(this.#store.get(DATA_MANAGER_STORE_KEYS.FLAGS) || [])],
    };
  }

  async updatePlayerPosition(): Promise<{ x: number; y: number; location: PlayerLocation }> {
    // const playerPosition = await this.dubhe.getStorageItem({
    //   name: 'position',
    //   key1: walletUtils.getCurrentAccount().address,
    // });

    const address = walletUtils.getCurrentAccount().address;
    console.log('address', address);
    const playerPositionData = await walletUtils.dubhe.queryChannelTable({
      table: 'position',
      key: [],
    });

    console.log('playerPositionData', playerPositionData);



  // console.log('getTableData', getTableData);
  const xData = Uint8Array.from(playerPositionData.data[0]);
  const yData = Uint8Array.from(playerPositionData.data[1]);

  // const parsedStringList = bcs.vector(bcs.u64()).parse(datares);
  const x = bcs.u64().parse(xData);
  const y = bcs.u64().parse(yData);
  console.log('x', x);
  console.log('y', y);

  const playerPosition = {
    x,
    y,
  };
    console.log('playerPosition', playerPosition);
    console.log('walletUtils.getCurrentAccount().address', walletUtils.getCurrentAccount().address);

    if (playerPosition) {
      this.#store.set({
        [DATA_MANAGER_STORE_KEYS.PLAYER_POSITION]: {
          x: Number(playerPosition.x) * TILE_SIZE,
          y: Number(playerPosition.y) * TILE_SIZE,
        },
      });

      this.#store.set({
        [DATA_MANAGER_STORE_KEYS.PLAYER_LOCATION]: LOCATION_TYPE[0],
      });

      return {
        x: Number(playerPosition.x) * TILE_SIZE,
        y: Number(playerPosition.y) * TILE_SIZE,
        location: LOCATION_TYPE[0],
      };
    }
    console.log('=========playerPosition not found');
    return { x: 0, y: 0, location: { area: 'main_1', isInterior: false } };
  }

  async getAllPlayersPositions(): Promise<Array<{ player: string; x: number; y: number }>> {
    try {
      // NOTE: Currently using single player query as a temporary solution
      // until multi-player query is supported
      const currentPlayer = walletUtils.getCurrentAccount().address;
      
      const playerPositionData = await walletUtils.dubhe.queryChannelTable({
        table: 'position',
        key: [],
      });
      console.log('========= getAllPlayersPositions - Raw data:', playerPositionData);

      if (!playerPositionData || !playerPositionData.data) {
        console.warn('========= No position data found');
        return [];
      }

      // Parse x and y coordinates using bcs
      const xData = Uint8Array.from(playerPositionData.data[0]);
      const yData = Uint8Array.from(playerPositionData.data[1]);
      
      const x = bcs.u64().parse(xData);
      const y = bcs.u64().parse(yData);
      
      const result = [{
        player: currentPlayer,
        x: Number(x) * TILE_SIZE,
        y: Number(y) * TILE_SIZE,
      }];
      
      console.log('========= Processed player positions:', result);
      return result;
    } catch (error) {
      console.error('Failed to fetch all players positions:', error);
      return [];
    }
  }
}

export const dataManager = new DataManager();
