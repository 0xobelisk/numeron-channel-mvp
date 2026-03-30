import { CHARACTER_ASSET_KEYS } from '../../assets/asset-keys';
import { DIRECTION, Direction } from '../../common/direction';
import { exhaustiveGuard } from '../../utils/guard';
import { Character } from './character';
import { getTargetPositionFromGameObjectPositionAndDirection } from '../../utils/grid-utils';
import { TILE_SIZE } from '../../config';
import { CharacterConfig } from './character';

export type PlayerConfigProps = {
  collisionLayer: Phaser.Tilemaps.TilemapLayer;
  entranceLayer?: Phaser.Tilemaps.ObjectLayer;
  enterEntranceCallback: (entranceName: string, entranceId: string, isBuildingEntrance: boolean) => Promise<void>;
};

export type PlayerConfig = Omit<CharacterConfig, 'assetKey' | 'idleFrameConfig'> & PlayerConfigProps;

export class Player extends Character {
  #entranceLayer: Phaser.Tilemaps.ObjectLayer | undefined;
  #enterEntranceCallback: (entranceName: string, entranceId: string, isBuildingEntrance: boolean) => Promise<void>;

  constructor(config: PlayerConfig) {
    super({
      ...config,
      assetKey: CHARACTER_ASSET_KEYS.PLAYER,
      origin: { x: 0, y: 0.2 },
      idleFrameConfig: {
        DOWN: 7,
        UP: 1,
        NONE: 7,
        LEFT: 10,
        RIGHT: 4,
      },
    });
    this.#entranceLayer = config.entranceLayer;
    this.#enterEntranceCallback = config.enterEntranceCallback;
  }

  async moveCharacter(direction: Direction) {
    try {
      // 首先检查游戏对象和动画是否有效
      if (!this._phaserGameObject || !this._phaserGameObject.scene || !this._phaserGameObject.anims) {
        console.warn('游戏对象或动画系统无效，可能是场景正在切换');
        return;
      }

      super.moveCharacter(direction);

      switch (this._direction) {
        case DIRECTION.DOWN:
        case DIRECTION.LEFT:
        case DIRECTION.RIGHT:
        case DIRECTION.UP:
          try {
            const currentAnimKey = `PLAYER_${this._direction}`;
            const isCurrentAnimPlaying =
              this._phaserGameObject.anims.isPlaying &&
              this._phaserGameObject.anims.currentAnim?.key === currentAnimKey;

            if (!isCurrentAnimPlaying) {
              this._phaserGameObject.play(currentAnimKey);
            }
          } catch (error) {
            console.warn('播放动画时发生错误，可能是场景正在切换:', error);
          }
          break;
        case DIRECTION.NONE:
          break;
        default:
          exhaustiveGuard(this._direction);
      }

      // 验证角色未在移动中且场景和入口层都存在
      if (!this._isMoving && this.#entranceLayer && this._phaserGameObject.scene) {
        const targetPosition = getTargetPositionFromGameObjectPositionAndDirection(
          { x: this._phaserGameObject.x, y: this._phaserGameObject.y },
          this._direction,
        );

        // 检查入口层是否有效
        if (!this.#entranceLayer.objects) {
          return;
        }

        const nearbyEntrance = this.#entranceLayer.objects.find(object => {
          if (!object.x || !object.y) {
            return false;
          }
          return object.x === targetPosition.x && object.y - TILE_SIZE === targetPosition.y;
        });

        if (!nearbyEntrance) {
          return;
        }

        // 确保属性存在
        const properties = nearbyEntrance.properties || [];
        const entranceName = properties.find(property => property.name === 'connects_to')?.value;
        const entranceId = properties.find(property => property.name === 'entrance_id')?.value;
        const isBuildingEntrance = properties.find(property => property.name === 'is_building')?.value || false;

        if (!entranceName || !entranceId) {
          console.warn('入口属性缺失');
          return;
        }

        // 只有当链上移动完成且角色未在移动时才允许传送
        if (!this.isChainMovementPending && !this._isMoving) {
          await this.#enterEntranceCallback(entranceName, entranceId, isBuildingEntrance);
        }
      }
    } catch (error) {
      console.warn('移动或传送过程中发生错误:', error);
    }
  }
}
