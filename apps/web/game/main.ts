import { PreloadScene } from '@/game/scenes/preload-scene';
import { BattleScene } from '@/game/scenes/battle-scene';
import { SCENE_KEYS } from '@/game/scenes/scene-keys';
import { WorldScene } from '@/game/scenes/world-scene';
import { TitleScene } from './scenes/title-scene';
import { PlayerSelectScene } from './scenes/player-select-scene';
import { OptionsScene } from './scenes/options-scene';
import { TestScene } from './scenes/test-scene';
import { MonsterPartyScene } from './scenes/monster-party-scene';
import { MonsterDetailsScene } from './scenes/monster-details-scene';
import { InventoryScene } from './scenes/inventory-scene';
import { CutsceneScene } from './scenes/cutscene-scene';
import { DialogScene } from './scenes/dialog-scene';
import { ChatScene } from './scenes/chat-scene';

export default function StartGame(parent: string) {
  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    pixelArt: false,
    scale: {
      parent,
      width: 1024,
      height: 576,
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    backgroundColor: '#000000',
  });

  game.scene.add(SCENE_KEYS.PRELOAD_SCENE, PreloadScene);
  game.scene.add(SCENE_KEYS.WORLD_SCENE, WorldScene);
  game.scene.add(SCENE_KEYS.BATTLE_SCENE, BattleScene);
  game.scene.add(SCENE_KEYS.TITLE_SCENE, TitleScene);
  game.scene.add(SCENE_KEYS.PLAYER_SELECT_SCENE, PlayerSelectScene);
  game.scene.add(SCENE_KEYS.OPTIONS_SCENE, OptionsScene);
  game.scene.add(SCENE_KEYS.TEST_SCENE, TestScene);
  game.scene.add(SCENE_KEYS.MONSTER_PARTY_SCENE, MonsterPartyScene);
  game.scene.add(SCENE_KEYS.MONSTER_DETAILS_SCENE, MonsterDetailsScene);
  game.scene.add(SCENE_KEYS.INVENTORY_SCENE, InventoryScene);
  game.scene.add(SCENE_KEYS.CUTSCENE_SCENE, CutsceneScene);
  game.scene.add(SCENE_KEYS.DIALOG_SCENE, DialogScene);
  game.scene.add(SCENE_KEYS.CHAT_SCENE, ChatScene);
  game.scene.start(SCENE_KEYS.PRELOAD_SCENE);
  return game;
}
