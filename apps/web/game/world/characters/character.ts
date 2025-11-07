import { DIRECTION, Direction } from '../../common/direction';
import { getTargetPositionFromGameObjectPositionAndDirection } from '../../utils/grid-utils';
import { exhaustiveGuard } from '../../utils/guard';
import { Coordinate } from '../../types/typedef';
import { Dubhe, SuiTransactionBlockResponse, Transaction, TransactionResult } from '@0xobelisk/sui-client';
import { walletUtils } from '../../utils/wallet-utils';
import { DUBHE_SCHEMA_ID } from 'contracts/deployment';

export interface CharacterIdleFrameConfig {
  LEFT: number;
  RIGHT: number;
  UP: number;
  DOWN: number;
  NONE: number;
}

export interface CharacterConfig {
  scene: Phaser.Scene;
  assetKey: string;
  origin?: Coordinate; // defaults to { x: 0, y: 0 }
  position: Coordinate;
  direction: Direction;
  spriteGridMovementFinishedCallback?: () => void;
  idleFrameConfig: CharacterIdleFrameConfig;
  collisionLayer?: Phaser.Tilemaps.TilemapLayer;
  otherCharactersToCheckForCollisionsWith?: Character[]; // defaults to []
  spriteChangedDirectionCallback?: () => void;
  objectsToCheckForCollisionsWith?: Array<{ position: Coordinate }>;
  spriteGridMovementStartedCallback?: (position: Coordinate) => boolean;
  dubhe?: Dubhe;
  playerAddress?: string; // player address to display above character
  isCurrentPlayer?: boolean; // whether this is the current player
}

export class Character {
  _scene: Phaser.Scene;
  _phaserGameObject: Phaser.GameObjects.Sprite;
  _direction: Direction;
  _isMoving: boolean;
  _isChainMovementPending: boolean;
  _targetPosition: Coordinate;
  _previousTargetPosition: Coordinate;
  _spriteGridMovementFinishedCallback?: () => void;
  _idleFrameConfig: CharacterIdleFrameConfig;
  _origin: Coordinate;
  _collisionLayer?: Phaser.Tilemaps.TilemapLayer;
  _otherCharactersToCheckForCollisionsWith: Character[];
  _spriteChangedDirectionCallback: () => void | undefined;
  _objectsToCheckForCollisionsWith: Array<{ position: Coordinate }>;
  _spriteGridMovementStartedCallback: (position: Coordinate) => boolean | undefined;
  dubhe?: Dubhe;
  _addressLabel?: Phaser.GameObjects.Text;
  _addressLabelContainer?: Phaser.GameObjects.Container;
  _addressLabelBackground?: Phaser.GameObjects.Graphics;
  _currentTween?: Phaser.Tweens.Tween; // Track current movement tween to prevent animation stacking
  _isCurrentPlayer: boolean;

  constructor(config: CharacterConfig) {
    if (this.constructor === Character) {
      throw new Error('Character is an abstract class and cannot be instantiated.');
    }

    this._scene = config.scene;
    this._direction = config.direction;
    this._isMoving = false;
    this._targetPosition = { ...config.position };
    this._previousTargetPosition = { ...config.position };
    this._idleFrameConfig = config.idleFrameConfig;
    this._origin = config.origin ? { ...config.origin } : { x: 0, y: 0 };
    this._collisionLayer = config.collisionLayer;
    this._otherCharactersToCheckForCollisionsWith = config.otherCharactersToCheckForCollisionsWith || [];
    this._phaserGameObject = this._scene.add
      .sprite(config.position.x || 4, config.position.y || 21, config.assetKey, this._getIdleFrame())
      .setOrigin(this._origin.x, this._origin.y);
    this._spriteGridMovementFinishedCallback = config.spriteGridMovementFinishedCallback;
    this._spriteChangedDirectionCallback = config.spriteChangedDirectionCallback;
    this._objectsToCheckForCollisionsWith = config.objectsToCheckForCollisionsWith || [];
    this._spriteGridMovementStartedCallback = config.spriteGridMovementStartedCallback;
    this.dubhe = config.dubhe;
    this._isChainMovementPending = false;
    this._isCurrentPlayer = config.isCurrentPlayer || false;

    // Create address label if playerAddress is provided
    if (config.playerAddress) {
      this._createAddressLabel(config.playerAddress);
    }
  }

  /**
   * Detect address type based on format
   * - Sui: 0x + 64 hex chars (32 bytes)
   * - EVM: 0x + 40 hex chars (20 bytes)
   * - Solana: Base58, no 0x prefix, typically 32-44 chars
   */
  _detectAddressType(address: string): 'sui' | 'evm' | 'solana' {
    console.log('Detecting address type for:', address);

    if (address.startsWith('0x')) {
      // Remove 0x prefix and check length
      const hexPart = address.slice(2);
      console.log('Hex part length:', hexPart.length);

      if (hexPart.length === 64) {
        console.log('Detected as SUI');
        return 'sui'; // 32 bytes = 64 hex chars
      } else if (hexPart.length === 40) {
        console.log('Detected as EVM');
        return 'evm'; // 20 bytes = 40 hex chars
      } else {
        // If 0x prefix but unusual length, assume Sui (more likely)
        console.log('0x prefix but unusual length, defaulting to SUI');
        return 'sui';
      }
    }
    // Solana addresses are Base58 encoded and don't start with 0x
    console.log('Detected as Solana');
    return 'solana';
  }

  /**
   * Get gradient colors based on address type and whether it's current player
   * Returns [startColor, endColor] for gradient
   */
  _getAddressGradientColors(addressType: 'sui' | 'evm' | 'solana'): [number, number] {
    if (this._isCurrentPlayer) {
      return [0xffd700, 0xffa500]; // Gold to orange gradient for current player
    }

    switch (addressType) {
      case 'sui':
        return [0x4da6ff, 0x2b7fcc]; // Sui blue gradient
      case 'evm':
        return [0x9945ff, 0x7722cc]; // EVM purple gradient
      case 'solana':
        return [0x14f195, 0x0ac073]; // Solana green gradient
      default:
        return [0x000000, 0x333333]; // Fallback black to gray
    }
  }

  _createAddressLabel(address: string) {
    // Detect address type
    const addressType = this._detectAddressType(address);
    console.log('Address type:', addressType, 'Is current player:', this._isCurrentPlayer);

    // Display address with type prefix
    const typeLabel = addressType.toUpperCase();
    const displayAddress = `[${typeLabel}] ${address}`;

    // Get gradient colors
    const [startColor, endColor] = this._getAddressGradientColors(addressType);
    console.log('Gradient colors:', startColor.toString(16), 'to', endColor.toString(16));

    // Create text first to measure its dimensions
    const textStyle = {
      fontSize: '12px',
      color: '#ffffff',
      fontFamily: 'Arial',
    };

    this._addressLabel = this._scene.add.text(0, 0, displayAddress, textStyle).setOrigin(0.5, 0.5);

    // Get text bounds
    const textWidth = this._addressLabel.width;
    const textHeight = this._addressLabel.height;
    const paddingX = 8;
    const paddingY = 4;
    const bgWidth = textWidth + paddingX * 2;
    const bgHeight = textHeight + paddingY * 2;
    const borderRadius = 6;

    // Create graphics for gradient background
    this._addressLabelBackground = this._scene.add.graphics();

    // Use fillStyle for solid background (more reliable than fillGradientStyle)
    // We'll use startColor as the main color
    this._addressLabelBackground.fillStyle(startColor, 1.0);
    console.log('Drawing background with color:', startColor.toString(16));

    // Draw rounded rectangle
    this._addressLabelBackground.fillRoundedRect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight, borderRadius);

    // Add gradient effect by drawing a semi-transparent darker overlay on bottom half
    this._addressLabelBackground.fillStyle(endColor, 0.4);
    this._addressLabelBackground.fillRect(-bgWidth / 2, 0, bgWidth, bgHeight / 2);

    // Add a subtle border for better visibility
    this._addressLabelBackground.lineStyle(2, 0xffffff, 0.5);
    this._addressLabelBackground.strokeRoundedRect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight, borderRadius);

    // Create container to hold both background and text
    this._addressLabelContainer = this._scene.add.container(
      this._phaserGameObject.x,
      this._phaserGameObject.y - 20, // Reduced from -35 to -20 to be closer to character
      [this._addressLabelBackground, this._addressLabel],
    );

    this._addressLabelContainer.setDepth(1000);
  }

  _updateAddressLabelPosition() {
    if (this._addressLabelContainer) {
      this._addressLabelContainer.setPosition(
        this._phaserGameObject.x,
        this._phaserGameObject.y - 20, // Reduced from -35 to -20
      );
    }
  }

  destroy() {
    // Destroy address label container and its contents
    if (this._addressLabelContainer) {
      this._addressLabelContainer.destroy();
      this._addressLabelContainer = undefined;
    }
    if (this._addressLabel) {
      this._addressLabel.destroy();
      this._addressLabel = undefined;
    }
    if (this._addressLabelBackground) {
      this._addressLabelBackground.destroy();
      this._addressLabelBackground = undefined;
    }
    if (this._phaserGameObject) {
      this._phaserGameObject.destroy();
    }
  }

  get sprite(): Phaser.GameObjects.Sprite {
    return this._phaserGameObject;
  }

  get isMoving(): boolean {
    return this._isMoving;
  }

  get direction(): Direction {
    return this._direction;
  }

  get isChainMovementPending(): boolean {
    return this._isChainMovementPending;
  }

  moveCharacter(direction: Direction) {
    // 检查游戏对象和场景是否有效
    if (this._isMoving || !this._phaserGameObject || !this._phaserGameObject.scene) {
      return;
    }
    // 检查场景是否处于活动状态
    if (!this._phaserGameObject.scene.scene.isActive()) {
      return;
    }

    // 检查是否有全局锁定
    try {
      // 如果场景有_controls.isInputLocked属性并且为true，禁止移动
      const scene = this._phaserGameObject.scene as any;
      if (scene._controls && scene._controls.isInputLocked) {
        console.log('输入被锁定，禁止移动');
        return;
      }

      // 检查场景是否有wildMonsterEncountered标志
      if (typeof scene.isWildMonsterEncountered === 'function' && scene.isWildMonsterEncountered()) {
        console.log('正在遭遇怪兽，禁止移动');
        return;
      }
    } catch (error) {
      console.warn('检查输入锁定状态时出错:', error);
    }

    this._moveSprite(direction);
  }

  addCharacterToCheckForCollisionsWith(character: Character) {
    this._otherCharactersToCheckForCollisionsWith.push(character);
  }

  update(time: DOMHighResTimeStamp) {
    // 检查游戏对象是否有效
    if (!this._phaserGameObject || !this._phaserGameObject.scene) {
      return;
    }

    if (this._isMoving) {
      return;
    }

    try {
      // 停止当前动画并显示空闲帧
      if (!this._phaserGameObject.anims || !this._phaserGameObject.anims.currentAnim) {
        // 如果没有当前动画，直接设置为默认空闲帧
        this._phaserGameObject.setFrame(this._getIdleFrame());
        return;
      }

      const idleFrame = this._phaserGameObject.anims.currentAnim?.frames[1]?.frame.name;

      try {
        this._phaserGameObject.anims.stop();
      } catch (error) {
        console.warn('停止动画时发生错误:', error);
      }

      if (!idleFrame) {
        // 如果没有找到空闲帧，使用默认空闲帧
        this._phaserGameObject.setFrame(this._getIdleFrame());
        return;
      }

      switch (this._direction) {
        case DIRECTION.DOWN:
        case DIRECTION.LEFT:
        case DIRECTION.RIGHT:
        case DIRECTION.UP:
          try {
            this._phaserGameObject.setFrame(idleFrame);
          } catch (error) {
            console.warn('设置帧时发生错误:', error);
          }
          break;
        case DIRECTION.NONE:
          break;
        default:
          exhaustiveGuard(this._direction);
      }
    } catch (error) {
      console.warn('更新角色状态时发生错误:', error);
    }
  }

  _getIdleFrame() {
    return this._idleFrameConfig[this._direction];
  }

  _moveSprite(direction: Direction) {
    const changedDirection = this._direction !== direction;
    this._direction = direction;

    if (changedDirection) {
      if (this._spriteChangedDirectionCallback !== undefined) {
        this._spriteChangedDirectionCallback();
      }
    }

    if (this._isBlockingTile()) {
      return;
    }

    this._isMoving = true;
    this.#handleSpriteMovement();
  }

  _isBlockingTile() {
    if (this._direction === DIRECTION.NONE) {
      return false;
    }

    // 检查游戏对象是否有效
    if (!this._phaserGameObject || !this._phaserGameObject.scene) {
      return false;
    }

    try {
      const targetPosition = { ...this._targetPosition };
      const updatedPosition = getTargetPositionFromGameObjectPositionAndDirection(targetPosition, this._direction);

      return (
        this.#doesPositionCollideWithCollisionLayer(updatedPosition) ||
        this.#doesPositionCollideWithOtherCharacter(updatedPosition) ||
        this.#doesPositionCollideWithObject(updatedPosition)
      );
    } catch (error) {
      console.warn('检查碰撞时发生错误:', error);
      return false;
    }
  }

  async #handleSpriteMovement() {
    if (this._direction === DIRECTION.NONE) return;

    // 保存原始位置用于回退
    const originalPosition = {
      x: this._phaserGameObject.x,
      y: this._phaserGameObject.y,
    };

    // 更新本地状态和动画
    const updatedPosition = getTargetPositionFromGameObjectPositionAndDirection(this._targetPosition, this._direction);
    this._previousTargetPosition = { ...this._targetPosition };
    this._targetPosition.x = updatedPosition.x;
    this._targetPosition.y = updatedPosition.y;

    if (this._spriteGridMovementStartedCallback) {
      // 如果回调返回false，则阻止移动
      const canMove = this._spriteGridMovementStartedCallback({ ...this._targetPosition });
      if (canMove === false) {
        // 回退targetPosition到原始位置，阻止移动
        this._targetPosition = { ...originalPosition };
        this._isMoving = false;
        return;
      }
    }

    try {
      if (this.dubhe) {
        this._isChainMovementPending = true;

        // 准备交易
        const stepTxB = new Transaction();
        stepTxB.setGasBudget(10000000);

        let direction: number;
        switch (this._direction) {
          case DIRECTION.DOWN:
            direction = 1;
            break;
          case DIRECTION.LEFT:
            direction = 2;
            break;
          case DIRECTION.RIGHT:
            direction = 3;
            break;
          case DIRECTION.UP:
            direction = 0;
            break;
        }

        // 构建交易
        console.log('dubhe shcmeid', DUBHE_SCHEMA_ID);
        await this.dubhe.tx.map_system.move_position({
          tx: stepTxB,
          params: [stepTxB.object(DUBHE_SCHEMA_ID), stepTxB.pure.u8(direction)],
          isRaw: true,
        });

        // 乐观更新：立即开始播放动画，同时在后台处理交易
        const animationDuration = 200;

        // 先立即播放动画，给用户即时反馈
        const animationPromise = new Promise<void>((resolve, reject) => {
          if (!this._scene || !this._scene.add || typeof this._scene.add.tween !== 'function') {
            console.warn('场景或动画功能不可用，可能是场景正在切换');
            resolve();
            return;
          }

          this._scene.add.tween({
            delay: 0,
            duration: animationDuration,
            y: {
              from: this._phaserGameObject.y,
              start: this._phaserGameObject.y,
              to: this._targetPosition.y,
            },
            x: {
              from: this._phaserGameObject.x,
              start: this._phaserGameObject.x,
              to: this._targetPosition.x,
            },
            targets: this._phaserGameObject,
            onUpdate: () => {
              this._updateAddressLabelPosition();
            },
            onComplete: () => {
              this._updateAddressLabelPosition();
              resolve();
            },
          });
        });

        // 同时发送交易（不阻塞动画）
        let transactionSuccess = false;
        const transactionPromise = walletUtils.signAndExecuteTransaction({
          tx: stepTxB,
          onSuccess: (result: any) => {
            console.log(`Move transaction successful:`, result);
            transactionSuccess = true;
          },
          onError: (error: any) => {
            console.error(`Move transaction failed:`, error);
            // 注意：不在这里throw，而是在Promise.all之后处理
          },
        });

        // 等待动画和交易都完成
        await Promise.all([animationPromise, transactionPromise]);

        // 检查交易是否成功
        if (!transactionSuccess) {
          // 交易失败，需要回退角色位置
          console.warn('Transaction failed, reverting character position');
          this._phaserGameObject.x = originalPosition.x;
          this._phaserGameObject.y = originalPosition.y;
          this._updateAddressLabelPosition();
          throw new Error('Transaction failed');
        }

        // 移动成功，更新状态
        this._previousTargetPosition = { ...this._targetPosition };
      } else {
        // 如果没有链上操作，直接执行动画
        await new Promise<void>(resolve => {
          if (!this._scene || !this._scene.add || typeof this._scene.add.tween !== 'function') {
            console.warn('场景或动画功能不可用，可能是场景正在切换');
            resolve();
            return;
          }
          this._scene.add.tween({
            delay: 0,
            duration: 600,
            y: {
              from: this._phaserGameObject.y,
              start: this._phaserGameObject.y,
              to: this._targetPosition.y,
            },
            x: {
              from: this._phaserGameObject.x,
              start: this._phaserGameObject.x,
              to: this._targetPosition.x,
            },
            targets: this._phaserGameObject,
            onUpdate: () => {
              this._updateAddressLabelPosition();
            },
            onComplete: () => {
              this._updateAddressLabelPosition();
              resolve();
            },
          });
        });
      }
    } catch (error) {
      console.error('Movement failed:', error);
      // 回退内部状态
      this._targetPosition = { ...this._previousTargetPosition };
      // 回退角色精灵位置（如果还没回退的话）
      this._phaserGameObject.x = originalPosition.x;
      this._phaserGameObject.y = originalPosition.y;
      this._updateAddressLabelPosition();
    } finally {
      this._isMoving = false;
      this._isChainMovementPending = false;

      if (this._spriteGridMovementFinishedCallback) {
        this._spriteGridMovementFinishedCallback();
      }
    }
  }

  #doesPositionCollideWithCollisionLayer(position: Coordinate) {
    // 检查 _collisionLayer 是否存在且有效
    if (!this._collisionLayer || !this._collisionLayer.layer) {
      return false;
    }

    try {
      const { x, y } = position;
      // 使用安全的方式获取tile
      let tile;
      try {
        tile = this._collisionLayer.getTileAtWorldXY(x, y, true);
      } catch (e) {
        console.warn('获取tile时发生错误，可能是场景正在切换');
        return false;
      }

      if (!tile) {
        return false;
      }

      return tile.index !== -1;
    } catch (error) {
      console.warn('碰撞检测出错，可能是场景正在切换:', error);
      return false;
    }
  }

  #doesPositionCollideWithOtherCharacter(position: Coordinate) {
    const { x, y } = position;
    if (this._otherCharactersToCheckForCollisionsWith.length === 0) {
      return false;
    }

    // checks if the new position that this character wants to move to is the same position that another
    // character is currently at, or was previously at and is moving towards currently
    const collidesWithACharacter = this._otherCharactersToCheckForCollisionsWith.some(character => {
      return (
        (character._targetPosition.x === x && character._targetPosition.y === y) ||
        (character._previousTargetPosition.x === x && character._previousTargetPosition.y === y)
      );
    });
    return collidesWithACharacter;
  }

  #doesPositionCollideWithObject(position: Coordinate): boolean {
    const { x, y } = position;
    if (this._objectsToCheckForCollisionsWith.length === 0) {
      return false;
    }

    const collidesWithObject = this._objectsToCheckForCollisionsWith.some(object => {
      return object.position.x === x && object.position.y === y;
    });
    return collidesWithObject;
  }
}
