import { DIRECTION, Direction } from '../common/direction';

type VirtualAction = 'space' | 'enter' | 'back' | 'fullscreen';

export class Controls {
  #scene: Phaser.Scene;
  #cursorKeys: Phaser.Types.Input.Keyboard.CursorKeys | undefined;
  #lockPlayerInput: boolean;
  #enterKey: Phaser.Input.Keyboard.Key | undefined;
  #fKey: Phaser.Input.Keyboard.Key | undefined;
  #virtualDirectionPressed: Direction;
  #virtualDirectionJustPressed: Direction;
  #virtualSpaceJustPressed: boolean;
  #virtualEnterJustPressed: boolean;
  #virtualBackJustPressed: boolean;
  #virtualFullscreenJustPressed: boolean;

  constructor(scene: Phaser.Scene) {
    this.#scene = scene;
    this.#cursorKeys = this.#scene.input.keyboard?.createCursorKeys();
    this.#enterKey = this.#scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.#fKey = this.#scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.#lockPlayerInput = false;
    this.#virtualDirectionPressed = DIRECTION.NONE;
    this.#virtualDirectionJustPressed = DIRECTION.NONE;
    this.#virtualSpaceJustPressed = false;
    this.#virtualEnterJustPressed = false;
    this.#virtualBackJustPressed = false;
    this.#virtualFullscreenJustPressed = false;
  }

  setVirtualDirection(direction: Direction): void {
    const resolvedDirection = Object.values(DIRECTION).includes(direction) ? direction : DIRECTION.NONE;
    if (resolvedDirection === this.#virtualDirectionPressed) {
      return;
    }

    this.#virtualDirectionPressed = resolvedDirection;
    if (resolvedDirection !== DIRECTION.NONE) {
      this.#virtualDirectionJustPressed = resolvedDirection;
    }
  }

  clearVirtualDirection(direction?: Direction): void {
    if (direction !== undefined && direction !== this.#virtualDirectionPressed) {
      return;
    }

    this.#virtualDirectionPressed = DIRECTION.NONE;
  }

  pressVirtualAction(action: VirtualAction): void {
    switch (action) {
      case 'space':
        this.#virtualSpaceJustPressed = true;
        return;
      case 'enter':
        this.#virtualEnterJustPressed = true;
        return;
      case 'back':
        this.#virtualBackJustPressed = true;
        return;
      case 'fullscreen':
        this.#virtualFullscreenJustPressed = true;
        return;
      default:
        return;
    }
  }

  resetVirtualInputState(): void {
    this.#virtualDirectionPressed = DIRECTION.NONE;
    this.#virtualDirectionJustPressed = DIRECTION.NONE;
    this.#virtualSpaceJustPressed = false;
    this.#virtualEnterJustPressed = false;
    this.#virtualBackJustPressed = false;
    this.#virtualFullscreenJustPressed = false;
  }

  #consumeVirtualAction(action: VirtualAction): boolean {
    switch (action) {
      case 'space': {
        const pressed = this.#virtualSpaceJustPressed;
        this.#virtualSpaceJustPressed = false;
        return pressed;
      }
      case 'enter': {
        const pressed = this.#virtualEnterJustPressed;
        this.#virtualEnterJustPressed = false;
        return pressed;
      }
      case 'back': {
        const pressed = this.#virtualBackJustPressed;
        this.#virtualBackJustPressed = false;
        return pressed;
      }
      case 'fullscreen': {
        const pressed = this.#virtualFullscreenJustPressed;
        this.#virtualFullscreenJustPressed = false;
        return pressed;
      }
      default:
        return false;
    }
  }

  get isInputLocked(): boolean {
    return this.#lockPlayerInput;
  }

  set lockInput(val: boolean) {
    this.#lockPlayerInput = val;
  }

  wasEnterKeyPressed(): boolean {
    if (this.#enterKey !== undefined && Phaser.Input.Keyboard.JustDown(this.#enterKey)) {
      return true;
    }
    return this.#consumeVirtualAction('enter');
  }

  wasSpaceKeyPressed(): boolean {
    if (this.#cursorKeys !== undefined && Phaser.Input.Keyboard.JustDown(this.#cursorKeys.space)) {
      return true;
    }
    return this.#consumeVirtualAction('space');
  }

  wasBackKeyPressed(): boolean {
    if (this.#cursorKeys !== undefined && Phaser.Input.Keyboard.JustDown(this.#cursorKeys.shift)) {
      return true;
    }
    return this.#consumeVirtualAction('back');
  }

  wasFKeyPressed(): boolean {
    if (this.#fKey !== undefined && Phaser.Input.Keyboard.JustDown(this.#fKey)) {
      return true;
    }
    return this.#consumeVirtualAction('fullscreen');
  }

  getDirectionKeyJustPressed(): Direction {
    let selectedDirection: Direction = DIRECTION.NONE;
    if (this.#cursorKeys !== undefined) {
      if (Phaser.Input.Keyboard.JustDown(this.#cursorKeys.left)) {
        selectedDirection = DIRECTION.LEFT;
      } else if (Phaser.Input.Keyboard.JustDown(this.#cursorKeys.right)) {
        selectedDirection = DIRECTION.RIGHT;
      } else if (Phaser.Input.Keyboard.JustDown(this.#cursorKeys.up)) {
        selectedDirection = DIRECTION.UP;
      } else if (Phaser.Input.Keyboard.JustDown(this.#cursorKeys.down)) {
        selectedDirection = DIRECTION.DOWN;
      }
    }

    if (selectedDirection !== DIRECTION.NONE) {
      return selectedDirection;
    }

    if (this.#virtualDirectionJustPressed !== DIRECTION.NONE) {
      const virtualDirection = this.#virtualDirectionJustPressed;
      this.#virtualDirectionJustPressed = DIRECTION.NONE;
      return virtualDirection;
    }

    return DIRECTION.NONE;
  }

  /** @returns {import('../common/direction').Direction} */
  getDirectionKeyPressedDown() {
    let selectedDirection: Direction = DIRECTION.NONE;
    if (this.#cursorKeys !== undefined) {
      if (this.#cursorKeys.left.isDown) {
        selectedDirection = DIRECTION.LEFT;
      } else if (this.#cursorKeys.right.isDown) {
        selectedDirection = DIRECTION.RIGHT;
      } else if (this.#cursorKeys.up.isDown) {
        selectedDirection = DIRECTION.UP;
      } else if (this.#cursorKeys.down.isDown) {
        selectedDirection = DIRECTION.DOWN;
      }
    }

    if (selectedDirection !== DIRECTION.NONE) {
      return selectedDirection;
    }

    return this.#virtualDirectionPressed;
  }
}
