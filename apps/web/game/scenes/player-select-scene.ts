import { SCENE_KEYS } from './scene-keys';
import { UI_ASSET_KEYS, TITLE_ASSET_KEYS } from '../assets/asset-keys';
import { KENNEY_FUTURE_NARROW_FONT_NAME } from '../assets/font-keys';
import { NineSlice } from '../utils/nine-slice';
import { dataManager, initialState } from '../utils/data-manager';
import { walletUtils } from '../utils/wallet-utils';
import { BaseScene } from './base-scene';
import { DIRECTION } from '../common/direction';

const MENU_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = Object.freeze({
  fontFamily: KENNEY_FUTURE_NARROW_FONT_NAME,
  color: '#4D4A49',
  fontSize: '24px',
});

const TITLE_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = Object.freeze({
  fontFamily: KENNEY_FUTURE_NARROW_FONT_NAME,
  color: '#FFFFFF',
  fontSize: '32px',
});

interface PlayerOption {
  address: string;
  displayAddress: string;
  x: number;
  y: number;
}

export class PlayerSelectScene extends BaseScene {
  #cursorPhaserImageGameObject: Phaser.GameObjects.Image;
  #selectedIndex: number = 0;
  #playerOptions: PlayerOption[] = [];
  #nineSliceMenu: NineSlice;
  #menuTexts: Phaser.GameObjects.Text[] = [];
  #isLoading: boolean = true;
  #loadingText: Phaser.GameObjects.Text;

  constructor() {
    super({ key: SCENE_KEYS.PLAYER_SELECT_SCENE });
  }

  init() {
    super.init();

    this.#nineSliceMenu = new NineSlice({
      cornerCutSize: 32,
      textureManager: this.sys.textures,
      assetKeys: [UI_ASSET_KEYS.MENU_BACKGROUND],
    });
  }

  async create() {
    super.create();

    this.#selectedIndex = 0;
    this.#playerOptions = [];
    this.#menuTexts = [];
    this.#isLoading = true;

    // Create background
    this.add.image(0, 0, TITLE_ASSET_KEYS.BACKGROUND).setOrigin(0).setScale(0.58);

    // Create title
    const titleText = this.add
      .text(this.scale.width / 2, 100, 'Browser Player', TITLE_TEXT_STYLE)
      .setOrigin(0.5);

    // Create loading text
    this.#loadingText = this.add
      .text(this.scale.width / 2, 300, 'Preparing local session wallet...', MENU_TEXT_STYLE)
      .setOrigin(0.5);

    // Load the browser-local player identity.
    await this.#loadPlayers();
  }

  async #loadPlayers() {
    try {
      const currentPlayer = walletUtils.getCurrentAccount().address;
      console.log('[PlayerSelectScene] Using browser identity:', currentPlayer);

      this.#playerOptions = [
        {
          address: currentPlayer,
          displayAddress: this.#formatAddress(currentPlayer),
          x: 0,
          y: 0,
        },
      ];

      // Remove loading text
      this.#loadingText.destroy();

      // Create player selection menu
      this.#createPlayerMenu();
      this.#isLoading = false;
    } catch (error) {
      console.error('[PlayerSelectScene] Failed to load players:', error);
      this.#loadingText.setText('Failed to load players!');
      this.#isLoading = false;
    }
  }

  #formatAddress(address: string): string {
    // Detect address type using walletUtils
    const addressType = walletUtils.detectChainType(address);
    const typeLabel = typeof addressType === 'string' ? addressType.toUpperCase() : 'UNKNOWN';
    
    if (address.length <= 10) {
      return `[${typeLabel}] ${address}`;
    }
    return `[${typeLabel}] ${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }

  #createPlayerMenu() {
    const menuBgWidth = 600;
    const menuItemHeight = 60;
    const menuPadding = 20;
    const menuBgHeight = this.#playerOptions.length * menuItemHeight + menuPadding * 2;

    // Create menu background
    const menuBgContainer = this.#nineSliceMenu.createNineSliceContainer(
      this,
      menuBgWidth,
      menuBgHeight,
      UI_ASSET_KEYS.MENU_BACKGROUND,
    );

    const menuContainer = this.add.container(0, 0, [menuBgContainer]);
    menuContainer.setPosition(this.scale.width / 2 - menuBgWidth / 2, 200);

    // Create player options
    this.#playerOptions.forEach((player, index) => {
      const yPos = menuPadding + index * menuItemHeight + menuItemHeight / 2;
      const text = this.add
        .text(menuBgWidth / 2, yPos, player.displayAddress, MENU_TEXT_STYLE)
        .setOrigin(0.5);

      menuBgContainer.add(text);
      this.#menuTexts.push(text);

      // Store position for cursor
      player.x = 100;
      player.y = yPos;
    });

    // Create cursor
    const cursorX = this.#playerOptions[0].x;
    const cursorY = this.#playerOptions[0].y;
    this.#cursorPhaserImageGameObject = this.add
      .image(cursorX, cursorY, UI_ASSET_KEYS.CURSOR)
      .setOrigin(0.5)
      .setScale(2.5);
    menuBgContainer.add(this.#cursorPhaserImageGameObject);

    // Add cursor animation
    this.tweens.add({
      delay: 0,
      duration: 500,
      repeat: -1,
      x: {
        from: cursorX,
        start: cursorX,
        to: cursorX + 3,
      },
      targets: this.#cursorPhaserImageGameObject,
    });

    // Add instructions
    const instructionsText = this.add
      .text(
        this.scale.width / 2,
        200 + menuBgHeight + 30,
        'This browser keeps its own temporary key. Press Space to enter.',
        {
          fontFamily: KENNEY_FUTURE_NARROW_FONT_NAME,
          color: '#FFFFFF',
          fontSize: '18px',
        },
      )
      .setOrigin(0.5);

    // Setup fade out callback
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, async () => {
      const selectedPlayer = this.#playerOptions[this.#selectedIndex];
      console.log('[PlayerSelectScene] Selected player:', selectedPlayer.address);

      // Set the selected player in wallet utils
      walletUtils.setCurrentPlayer(selectedPlayer.address);

      // Start new game and wait for store hydration before booting world scene.
      try {
        await dataManager.startNewGame();
      } catch (error) {
        console.error('[PlayerSelectScene] startNewGame failed, falling back to initial state', error);
        await dataManager.initializeData(initialState);
      }

      // Transition to world scene
      this.scene.start(SCENE_KEYS.WORLD_SCENE);
    });
  }

  update() {
    super.update();

    if (this._controls.isInputLocked || this.#isLoading || this.#playerOptions.length === 0) {
      return;
    }

    // Handle up/down selection
    const selectedDirection = this._controls.getDirectionKeyJustPressed();

    if (selectedDirection === DIRECTION.UP && this.#selectedIndex > 0) {
      this.#selectedIndex -= 1;
      this.#updateCursorPosition();
      return;
    }

    if (selectedDirection === DIRECTION.DOWN && this.#selectedIndex < this.#playerOptions.length - 1) {
      this.#selectedIndex += 1;
      this.#updateCursorPosition();
      return;
    }

    // Handle selection confirmation
    const wasSpaceKeyPressed = this._controls.wasSpaceKeyPressed();
    if (wasSpaceKeyPressed) {
      this.cameras.main.fadeOut(500, 0, 0, 0);
      this._controls.lockInput = true;
      return;
    }
  }

  #updateCursorPosition() {
    const selectedOption = this.#playerOptions[this.#selectedIndex];
    const targetY = selectedOption.y;

    // Animate cursor to new position
    this.tweens.add({
      targets: this.#cursorPhaserImageGameObject,
      y: targetY,
      duration: 200,
      ease: 'Power2',
    });
  }
}
