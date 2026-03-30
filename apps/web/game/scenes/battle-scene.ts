import { BattleMenu } from '../battle/ui/menu/battle-menu';
import { SCENE_KEYS } from './scene-keys';
import { DIRECTION } from '../common/direction';
import { EnemyBattleMonster } from '../battle/monsters/enemy-battle-monster';
import { PlayerBattleMonster } from '../battle/monsters/player-battle-monster';
import { StateMachine } from '../utils/state-machine';
import { Background } from '../battle/background';
import { ATTACK_TARGET, AttackManager } from '../battle/attacks/attack-manager';
import { createSceneTransition } from '../utils/scene-transition';
import { DATA_MANAGER_STORE_KEYS, dataManager } from '../utils/data-manager';
import { BATTLE_SCENE_OPTIONS } from '../common/options';
import { BaseScene } from './base-scene';
import { DataUtils } from '../utils/data-utils';
import { AUDIO_ASSET_KEYS, BATTLE_ASSET_KEYS } from '../assets/asset-keys';
import { playBackgroundMusic, playSoundFx } from '../utils/audio-utils';
import { calculateExpGainedFromMonster, handleMonsterGainingExperience } from '../utils/leveling-utils';
import { ITEM_CATEGORY, Monster, Item } from '../types/typedef';
import { exhaustiveGuard } from '../utils/guard';
import { Ball } from '../battle/ball';
import { sleep } from '../utils/time-utils';
import { generateUuid } from '../utils/random';
import { calculateMonsterCaptureResults } from '../utils/catch-utils';
import { BattleSceneMenuOptions } from '../common/options';
import { WorldSceneData } from './world-scene';
import { MonsterPartySceneData } from './monster-party-scene';
import { StatChanges } from '../utils/leveling-utils';
import { SuiTransactionBlockResponse, Transaction } from '@0xobelisk/sui-client';
import { walletUtils } from '../utils/wallet-utils';

const BATTLE_STATES = Object.freeze({
  INTRO: 'INTRO',
  PRE_BATTLE_INFO: 'PRE_BATTLE_INFO',
  BRING_OUT_MONSTER: 'BRING_OUT_MONSTER',
  PLAYER_INPUT: 'PLAYER_INPUT',
  ENEMY_INPUT: 'ENEMY_INPUT',
  BATTLE: 'BATTLE',
  POST_ATTACK_CHECK: 'POST_ATTACK_CHECK',
  FINISHED: 'FINISHED',
  FLEE_ATTEMPT: 'FLEE_ATTEMPT',
  GAIN_EXPERIENCE: 'GAIN_EXPERIENCE',
  SWITCH_MONSTER: 'SWITCH_MONSTER',
  USED_ITEM: 'USED_ITEM',
  HEAL_ITEM_USED: 'HEAL_ITEM_USED',
  CAPTURE_ITEM_USED: 'CAPTURE_ITEM_USED',
  CAUGHT_MONSTER: 'CAUGHT_MONSTER',
  CURRENCY_ITEM_USED: 'CURRENCY_ITEM_USED',
  MEDICINE_ITEM_USED: 'MEDICINE_ITEM_USED',
  SCROLL_ITEM_USED: 'SCROLL_ITEM_USED',
  BALL_ITEM_USED: 'BALL_ITEM_USED',
  TREASURE_CHEST_ITEM_USED: 'TREASURE_CHEST_ITEM_USED',
});

export type BattleSceneData = {
  playerMonsters: Monster[];
  enemyMonsters: Monster[];
  playerMonsterId: number;
};

export type BattleSceneWasResumedData = {
  wasMonsterSelected: boolean;
  selectedMonsterIndex?: number;
  wasItemUsed: boolean;
  item?: Item;
};

export class BattleScene extends BaseScene {
  #battleMenu: BattleMenu;
  #activeEnemyMonster: EnemyBattleMonster;
  #activePlayerMonster: PlayerBattleMonster;
  #activePlayerAttackIndex: number;
  #battleStateMachine: StateMachine;
  #attackManager: AttackManager;
  #skipAnimations: boolean;
  #activeEnemyAttackIndex: number;
  #sceneData: BattleSceneData;
  #activePlayerMonsterPartyIndex: number;
  #playerKnockedOut: boolean;
  #switchingActiveMonster: boolean;
  #activeMonsterKnockedOut: boolean;
  #availableMonstersUiContainer: Phaser.GameObjects.Container;
  #monsterCaptured: boolean;
  #ball: Ball;

  constructor() {
    super({
      key: SCENE_KEYS.BATTLE_SCENE,
    });
  }

  init(data: BattleSceneData) {
    super.init(data);
    this.#sceneData = data;

    // added for testing from preload scene
    if (Object.keys(data).length === 0) {
      this.#sceneData = {
        enemyMonsters: [DataUtils.getMonsterById(this, 2)],
        playerMonsters: [...dataManager.store.get(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY)],
        playerMonsterId: data.playerMonsterId,
      };
    }

    this.#activePlayerAttackIndex = -1;
    this.#activeEnemyAttackIndex = -1;
    this.#activePlayerMonsterPartyIndex = 0;
    this.#skipAnimations = true;
    this.#playerKnockedOut = false;
    this.#switchingActiveMonster = false;
    this.#activeMonsterKnockedOut = false;
    this.#monsterCaptured = false;

    const chosenBattleSceneOption: BattleSceneMenuOptions | undefined = dataManager.store.get(
      DATA_MANAGER_STORE_KEYS.OPTIONS_BATTLE_SCENE_ANIMATIONS,
    );
    if (chosenBattleSceneOption === undefined || chosenBattleSceneOption === BATTLE_SCENE_OPTIONS.ON) {
      this.#skipAnimations = false;
    }
  }

  async create() {
    super.create();

    // create main background
    const background = new Background(this);
    background.showForest();

    // create the player and enemy monsters
    this.#activeEnemyMonster = new EnemyBattleMonster({
      scene: this,
      monsterDetails: this.#sceneData.enemyMonsters[0],
      skipBattleAnimations: this.#skipAnimations,
    });
    // find first monster in party that is able to battle
    // const eligibleMonsterIndex = this.#sceneData.playerMonsters.findIndex(monster => monster.currentHp > 0);
    const eligibleMonsterIndex = this.#sceneData.playerMonsters.findIndex(
      monster => monster.monsterId === this.#sceneData.playerMonsterId,
    );
    // const eligibleMonsterIndex = this.#sceneData.playerMonsters.findIndex(monster => monster.id === this.#sceneData.playerMonsterId);
    console.log('this.#sceneData.playerMonsters', this.#sceneData.playerMonsters);
    console.log('eligibleMonsterIndex', eligibleMonsterIndex);
    console.log('this.#sceneData.playerMonsterId', this.#sceneData.playerMonsterId);
    this.#activePlayerMonsterPartyIndex = eligibleMonsterIndex;
    this.#activePlayerMonster = new PlayerBattleMonster({
      scene: this,
      monsterDetails: this.#sceneData.playerMonsters[this.#activePlayerMonsterPartyIndex],
      skipBattleAnimations: this.#skipAnimations,
    });

    // render out the main info and sub info panes
    this.#battleMenu = new BattleMenu(this, this.#activePlayerMonster, this.#skipAnimations);
    this.#createBattleStateMachine();
    this.#attackManager = new AttackManager(this, this.#skipAnimations);
    this.#createAvailableMonstersUi();
    this.#ball = new Ball({
      scene: this,
      assetKey: BATTLE_ASSET_KEYS.DAMAGED_BALL,
      assetFrame: 0,
      scale: 0.1,
      skipBattleAnimations: this.#skipAnimations,
    });
    this._controls.lockInput = true;

    // add audio
    playBackgroundMusic(this, AUDIO_ASSET_KEYS.BATTLE);
  }

  async update() {
    super.update();

    await this.#battleStateMachine.update();

    if (this._controls.isInputLocked) {
      return;
    }

    const wasSpaceKeyPressed = this._controls.wasSpaceKeyPressed();
    // limit input based on the current battle state we are in
    // if we are not in the right battle state, return early and do not process input
    if (
      wasSpaceKeyPressed &&
      (this.#battleStateMachine.currentStateName === BATTLE_STATES.PRE_BATTLE_INFO ||
        this.#battleStateMachine.currentStateName === BATTLE_STATES.POST_ATTACK_CHECK ||
        this.#battleStateMachine.currentStateName === BATTLE_STATES.GAIN_EXPERIENCE ||
        this.#battleStateMachine.currentStateName === BATTLE_STATES.SWITCH_MONSTER ||
        this.#battleStateMachine.currentStateName === BATTLE_STATES.CAPTURE_ITEM_USED ||
        this.#battleStateMachine.currentStateName === BATTLE_STATES.BALL_ITEM_USED ||
        this.#battleStateMachine.currentStateName === BATTLE_STATES.FLEE_ATTEMPT)
    ) {
      this.#battleMenu.handlePlayerInput('OK');
      return;
    }
    if (this.#battleStateMachine.currentStateName !== BATTLE_STATES.PLAYER_INPUT) {
      return;
    }

    if (wasSpaceKeyPressed) {
      this.#battleMenu.handlePlayerInput('OK');

      // check if the player used an item
      if (this.#battleMenu.wasItemUsed) {
        this.#battleStateMachine.setState(BATTLE_STATES.ENEMY_INPUT);
        return;
      }

      // check if the player attempted to flee
      if (this.#battleMenu.isAttemptingToFlee) {
        this.#battleStateMachine.setState(BATTLE_STATES.FLEE_ATTEMPT);
        return;
      }

      // check if the player attempted to switch monsters
      if (this.#battleMenu.isAttemptingToSwitchMonsters) {
        this.#battleStateMachine.setState(BATTLE_STATES.SWITCH_MONSTER);
        return;
      }

      // check if the player selected an attack, and start battle sequence for the fight
      if (this.#battleMenu.selectedAttack === undefined) {
        return;
      }
      this.#activePlayerAttackIndex = this.#battleMenu.selectedAttack;

      if (!this.#activePlayerMonster.attacks[this.#activePlayerAttackIndex]) {
        return;
      }

      console.log(
        `Player selected the following move: ${this.#activePlayerMonster.attacks[this.#activePlayerAttackIndex].name}`,
      );
      this.#battleMenu.hideMonsterAttackSubMenu();
      this.#battleStateMachine.setState(BATTLE_STATES.ENEMY_INPUT);
      return;
    }

    if (this._controls.wasBackKeyPressed()) {
      this.#battleMenu.handlePlayerInput('CANCEL');
      return;
    }

    const selectedDirection = this._controls.getDirectionKeyJustPressed();
    if (selectedDirection !== DIRECTION.NONE) {
      this.#battleMenu.handlePlayerInput(selectedDirection);
    }
  }

  #playerAttack(callback: () => void) {
    if (this.#activePlayerMonster.isFainted) {
      callback();
      return;
    }

    this.#battleMenu.updateInfoPaneMessageNoInputRequired(
      `${this.#activePlayerMonster.name} used ${this.#activePlayerMonster.attacks[this.#activePlayerAttackIndex].name}`,
      () => {
        // play attack animation based on the selected attack
        // when attack is finished, play damage animation and then update health bar
        this.time.delayedCall(500, () => {
          this.time.delayedCall(100, () => {
            playSoundFx(this, this.#activePlayerMonster.attacks[this.#activePlayerAttackIndex].audioKey);
          });
          this.#attackManager.playAttackAnimation(
            this.#activePlayerMonster.attacks[this.#activePlayerAttackIndex].animationName,
            ATTACK_TARGET.ENEMY,
            () => {
              this.#activeEnemyMonster.playTakeDamageAnimation(() => {
                this.#activeEnemyMonster.takeDamage(this.#activePlayerMonster.baseAttack, () => {
                  callback();
                });
              });
            },
          );
        });
      },
    );
  }

  #enemyAttack(callback: () => void) {
    if (this.#activeEnemyMonster.isFainted) {
      callback();
      return;
    }

    this.#battleMenu.updateInfoPaneMessageNoInputRequired(
      `foe ${this.#activeEnemyMonster.name} used ${
        this.#activeEnemyMonster.attacks[this.#activeEnemyAttackIndex].name
      }`,
      () => {
        // play attack animation based on the selected attack
        // when attack is finished, play damage animation and then update health bar
        this.time.delayedCall(500, () => {
          this.time.delayedCall(100, () => {
            playSoundFx(this, this.#activeEnemyMonster.attacks[this.#activeEnemyAttackIndex].audioKey);
          });
          this.#attackManager.playAttackAnimation(
            this.#activeEnemyMonster.attacks[this.#activeEnemyAttackIndex].animationName,
            ATTACK_TARGET.PLAYER,
            () => {
              this.#activePlayerMonster.playTakeDamageAnimation(() => {
                this.#activePlayerMonster.takeDamage(this.#activeEnemyMonster.baseAttack, () => {
                  callback();
                });
              });
            },
          );
        });
      },
    );
  }

  #postBattleSequenceCheck() {
    // update monster details in scene data and data manager to align with changes from battle
    this.#sceneData.playerMonsters[this.#activePlayerMonsterPartyIndex].currentHp = this.#activePlayerMonster.currentHp;
    dataManager.store.set(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY, this.#sceneData.playerMonsters);

    if (this.#monsterCaptured) {
      // enemy monster was captured
      this.#activeEnemyMonster.playDeathAnimation(() => {
        this.#battleMenu.updateInfoPaneMessagesAndWaitForInput([`You caught ${this.#activeEnemyMonster.name}.`], () => {
          this.#battleStateMachine.setState(BATTLE_STATES.GAIN_EXPERIENCE);
        });
      });
      return;
    }

    if (this.#activeEnemyMonster.isFainted) {
      // play monster fainted animation and wait for animation to finish
      this.#activeEnemyMonster.playDeathAnimation(() => {
        this.#battleMenu.updateInfoPaneMessagesAndWaitForInput(
          [`Wild ${this.#activeEnemyMonster.name} fainted.`],
          () => {
            this.#battleStateMachine.setState(BATTLE_STATES.GAIN_EXPERIENCE);
          },
        );
      });
      return;
    }

    if (this.#activePlayerMonster.isFainted) {
      // play monster fainted animation and wait for animation to finish
      this.#activePlayerMonster.playDeathAnimation(() => {
        // update ui to show monster fainted
        (
          this.#availableMonstersUiContainer.getAt(this.#activePlayerMonsterPartyIndex) as Phaser.GameObjects.Image
        ).setAlpha(0.4);

        // check to see if we have other monsters that are able to battle
        const hasOtherActiveMonsters = this.#sceneData.playerMonsters.some(monster => {
          return (
            monster.id !== this.#sceneData.playerMonsters[this.#activePlayerMonsterPartyIndex].id &&
            monster.currentHp > 0
          );
        });

        // if not, player faints and battle is over
        if (!hasOtherActiveMonsters) {
          this.#battleMenu.updateInfoPaneMessagesAndWaitForInput(
            [`${this.#activePlayerMonster.name} fainted.`, 'You have no more monsters, escaping to safety...'],
            () => {
              this.#playerKnockedOut = true;
              this.#battleStateMachine.setState(BATTLE_STATES.FINISHED);
            },
          );
          return;
        }

        // we have active monsters, so show message about monster fainting and then show monster party scene
        // so player can choose next monster
        this.#battleMenu.updateInfoPaneMessagesAndWaitForInput(
          [`${this.#activePlayerMonster.name} fainted.`, 'Choose another monster to continue the battle.'],
          () => {
            this.#activeMonsterKnockedOut = true;
            this.#battleStateMachine.setState(BATTLE_STATES.SWITCH_MONSTER);
          },
        );
      });
      return;
    }

    this.#battleStateMachine.setState(BATTLE_STATES.PLAYER_INPUT);
  }

  #transitionToNextScene() {
    const sceneDataToPass: WorldSceneData = {
      isPlayerKnockedOut: this.#playerKnockedOut,
    };

    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(SCENE_KEYS.WORLD_SCENE, sceneDataToPass);
    });
  }

  #createBattleStateMachine() {
    /**
     * General state flow for battle scene
     *
     * scene transition to the battle menu
     * battle states
     * intro -> setup everything that is needed
     * pre-battle -> animations as characters and stuff appears
     * monster info text renders onto the page & wait for player input
     * any key press, and now menu stuff shows up
     * player_turn -> choose what to do, wait for input from player
     * enemy_turn -> random choice,
     * battle_fight -> enemy and player options evaluated, play each attack animation
     * battle_fight_post_check -> see if one of the characters died, repeat
     */

    this.#battleStateMachine = new StateMachine('battle', this);

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.INTRO,
      onEnter: async () => {
        // wait for any scene setup and transitions to complete
        createSceneTransition(this, {
          skipSceneTransition: this.#skipAnimations,
          callback: () => {
            this.#battleStateMachine.setState(BATTLE_STATES.PRE_BATTLE_INFO);
          },
        });
      },
    });

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.PRE_BATTLE_INFO,
      onEnter: async () => {
        // wait for enemy monster to appear on the screen and notify player about the wild monster
        this.#activeEnemyMonster.playMonsterAppearAnimation(() => {
          this.#activeEnemyMonster.playMonsterHealthBarAppearAnimation(() => {});
          this._controls.lockInput = false;
          this.#battleMenu.updateInfoPaneMessagesAndWaitForInput(
            [`wild ${this.#activeEnemyMonster.name} appeared!`],
            () => {
              // wait for text animation to complete and move to next state
              this.#battleStateMachine.setState(BATTLE_STATES.BRING_OUT_MONSTER);
            },
          );
        });
      },
    });

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.BRING_OUT_MONSTER,
      onEnter: async () => {
        // wait for player monster to appear on the screen and notify the player about monster
        this.#activePlayerMonster.playMonsterAppearAnimation(() => {
          this.#activePlayerMonster.playMonsterHealthBarAppearAnimation(() => {
            this.#availableMonstersUiContainer.setAlpha(1);
          });
          this.#battleMenu.updateInfoPaneMessageNoInputRequired(`go ${this.#activePlayerMonster.name}!`, () => {
            // wait for text animation to complete and move to next state
            this.time.delayedCall(1200, () => {
              if (this.#switchingActiveMonster && !this.#activeMonsterKnockedOut) {
                this.#battleStateMachine.setState(BATTLE_STATES.ENEMY_INPUT);
                return;
              }

              this.#switchingActiveMonster = false;
              this.#activeMonsterKnockedOut = false;
              this.#battleStateMachine.setState(BATTLE_STATES.PLAYER_INPUT);
            });
          });
        });
      },
    });

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.PLAYER_INPUT,
      onEnter: async () => {
        this.#battleMenu.showMainBattleMenu();
      },
    });

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.ENEMY_INPUT,
      onEnter: async () => {
        // pick a random move for the enemy monster, and in the future implement some type of AI behavior
        this.#activeEnemyAttackIndex = this.#activeEnemyMonster.pickRandomMove();
        this.#battleStateMachine.setState(BATTLE_STATES.BATTLE);
      },
    });

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.BATTLE,
      onEnter: async () => {
        // general battle flow
        // show attack used, brief pause
        // then play attack animation, brief pause
        // then play damage animation, brief pause
        // then play health bar animation, brief pause
        // then repeat the steps above for the other monster

        // if item was used, only have enemy attack
        if (this.#battleMenu.wasItemUsed) {
          this.#battleStateMachine.setState(BATTLE_STATES.USED_ITEM);
          return;
        }

        // if player failed to flee, only have enemy attack
        if (this.#battleMenu.isAttemptingToFlee) {
          this.time.delayedCall(500, () => {
            this.#enemyAttack(() => {
              this.#battleStateMachine.setState(BATTLE_STATES.POST_ATTACK_CHECK);
            });
          });
          return;
        }

        // if player switched active monster, only have enemy attack
        if (this.#switchingActiveMonster) {
          this.time.delayedCall(500, () => {
            this.#enemyAttack(() => {
              this.#switchingActiveMonster = false;
              this.#battleStateMachine.setState(BATTLE_STATES.POST_ATTACK_CHECK);
            });
          });
          return;
        }

        // const randomNumber = Phaser.Math.Between(0, 1);
        // if (randomNumber === 0) {

        const tx = new Transaction();
        await this._dubhe.tx.numeron_encounter_system.battle({
          tx,
          params: [tx.object(this._dubheSchemaId), tx.object(this._schemaId), tx.object.random()],
          isRaw: true,
        });
        await walletUtils.signAndExecuteTransaction({
          tx,
          onSuccess: async (result: any) => {
            console.log(`Transaction successful:`, result);

            this.#playerAttack(() => {
              this.#enemyAttack(() => {
                this.#battleStateMachine.setState(BATTLE_STATES.POST_ATTACK_CHECK);
              });
            });
            await this._dubhe.waitForTransaction(result.digest);
          },
          onError: (error: any) => {
            console.error(`Transaction failed:`, error);
          },
        });
        return;
        // }
        // this.#enemyAttack(() => {
        //   this.#playerAttack(() => {
        //     this.#battleStateMachine.setState(BATTLE_STATES.POST_ATTACK_CHECK);
        //   });
        // });
      },
    });

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.POST_ATTACK_CHECK,
      onEnter: async () => {
        this.#postBattleSequenceCheck();
      },
    });

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.FINISHED,
      onEnter: async () => {
        // update the data manager with latest monster data
        dataManager.store.set(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY, this.#sceneData.playerMonsters);
        this.#transitionToNextScene();
      },
    });

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.FLEE_ATTEMPT,
      onEnter: async () => {
        const tx = new Transaction();
        await this._dubhe.tx.numeron_encounter_system.flee({
          tx,
          params: [tx.object(this._dubheSchemaId), tx.object(this._schemaId), tx.pure.bool(true)],
          isRaw: true,
        });
        let fleeSuccess = false;
        await walletUtils.signAndExecuteTransaction({
          tx,
          onSuccess: async (result: any) => {
            console.log(`Transaction successful:`, result);
            await this._dubhe.waitForTransaction(result.digest);
            fleeSuccess = true;
          },
          onError: (error: any) => {
            console.error(`Transaction failed:`, error);
          },
        });

        if (fleeSuccess) {
          console.log('Escape successful, preparing to switch scenes');
          this.#battleMenu.updateInfoPaneMessageNoInputRequired('You got away safely!', () => {
            playSoundFx(this, AUDIO_ASSET_KEYS.FLEE);
            this.time.delayedCall(500, () => {
              this.#battleStateMachine.setState(BATTLE_STATES.FINISHED);
            });
          });
          return;
        }

        this.#battleMenu.updateInfoPaneMessagesAndWaitForInput(['You failed to run away...'], () => {
          this.time.delayedCall(200, () => {
            this.#battleStateMachine.setState(BATTLE_STATES.PLAYER_INPUT);
          });
        });
      },
    });

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.GAIN_EXPERIENCE,
      onEnter: async () => {
        // update exp bar based on experience gained, then transition to finished state
        const gainedExpForActiveMonster = calculateExpGainedFromMonster(
          this.#activeEnemyMonster.baseExpValue,
          this.#activeEnemyMonster.level,
          true,
        );
        const gainedExpForInactiveMonster = calculateExpGainedFromMonster(
          this.#activeEnemyMonster.baseExpValue,
          this.#activeEnemyMonster.level,
          false,
        );

        const messages: string[] = [];
        let didActiveMonsterLevelUp = false;
        this.#sceneData.playerMonsters.forEach((monster, index) => {
          // ensure only monsters that are not knocked out gain exp
          if (this.#sceneData.playerMonsters[index].currentHp <= 0) {
            return;
          }

          let statChanges: StatChanges;
          const monsterMessages: string[] = [];
          if (index === this.#activePlayerMonsterPartyIndex) {
            statChanges = this.#activePlayerMonster.updateMonsterExp(gainedExpForActiveMonster);
            monsterMessages.push(
              `${this.#sceneData.playerMonsters[index].name} gained ${gainedExpForActiveMonster} exp.`,
            );
            if (statChanges.level !== 0) {
              didActiveMonsterLevelUp = true;
            }
          } else {
            statChanges = handleMonsterGainingExperience(
              this.#sceneData.playerMonsters[index],
              gainedExpForInactiveMonster,
            );
            monsterMessages.push(
              `${this.#sceneData.playerMonsters[index].name} gained ${gainedExpForInactiveMonster} exp.`,
            );
          }
          if (statChanges !== undefined && statChanges.level !== 0) {
            monsterMessages.push(
              `${this.#sceneData.playerMonsters[index].name} level increased to ${
                this.#sceneData.playerMonsters[index].currentLevel
              }!`,
              `${this.#sceneData.playerMonsters[index].name} attack increased by ${
                statChanges.attack
              } and health increased by ${statChanges.health}`,
            );
          }

          if (index === this.#activePlayerMonsterPartyIndex) {
            messages.unshift(...monsterMessages);
          } else {
            messages.push(...monsterMessages);
          }
        });

        this._controls.lockInput = true;
        this.#activePlayerMonster.updateMonsterExpBar(didActiveMonsterLevelUp, false, () => {
          this.#battleMenu.updateInfoPaneMessagesAndWaitForInput(messages, () => {
            this.time.delayedCall(200, () => {
              if (this.#monsterCaptured) {
                this.#battleStateMachine.setState(BATTLE_STATES.CAUGHT_MONSTER);
                return;
              }
              this.#battleStateMachine.setState(BATTLE_STATES.FINISHED);
            });
          });
          this._controls.lockInput = false;
        });
      },
    });

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.SWITCH_MONSTER,
      onEnter: async () => {
        // check to see if the player has other monsters they can switch to
        const hasOtherActiveMonsters = this.#sceneData.playerMonsters.some(monster => {
          return (
            monster.monsterId !== this.#sceneData.playerMonsters[this.#activePlayerMonsterPartyIndex].monsterId &&
            monster.currentHp > 0
          );
        });
        if (!hasOtherActiveMonsters) {
          this.#battleMenu.updateInfoPaneMessagesAndWaitForInput(
            ['You have no other monsters able to fight in your party'],
            () => {
              this.#battleStateMachine.setState(BATTLE_STATES.PLAYER_INPUT);
            },
          );
          return;
        }

        // otherwise, there are other available monsters to switch to, need to show ui so player can select monster
        // pause this scene and launch the monster party scene
        const sceneDataToPass: MonsterPartySceneData = {
          previousSceneName: SCENE_KEYS.BATTLE_SCENE,
          activeBattleMonsterPartyIndex: this.#activePlayerMonsterPartyIndex,
          activeMonsterKnockedOut: this.#activeMonsterKnockedOut,
          isBattling: true,
        };
        this.scene.launch(SCENE_KEYS.MONSTER_PARTY_SCENE, sceneDataToPass);
        this.scene.pause(SCENE_KEYS.BATTLE_SCENE);
      },
    });

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.USED_ITEM,
      onEnter: async () => {
        switch (this.#battleMenu.itemUsed.category) {
          case ITEM_CATEGORY.CAPTURE:
            this.#battleStateMachine.setState(BATTLE_STATES.CAPTURE_ITEM_USED);
            break;
          case ITEM_CATEGORY.HEAL:
            this.#battleStateMachine.setState(BATTLE_STATES.HEAL_ITEM_USED);
            break;
          case ITEM_CATEGORY.Currency:
            this.#battleStateMachine.setState(BATTLE_STATES.CURRENCY_ITEM_USED);
            break;
          case ITEM_CATEGORY.Medicine:
            this.#battleStateMachine.setState(BATTLE_STATES.MEDICINE_ITEM_USED);
            break;
          case ITEM_CATEGORY.Scroll:
            this.#battleStateMachine.setState(BATTLE_STATES.SCROLL_ITEM_USED);
            break;
          case ITEM_CATEGORY.Ball:
            this.#battleStateMachine.setState(BATTLE_STATES.BALL_ITEM_USED);
            break;
          case ITEM_CATEGORY.TreasureChest:
            this.#battleStateMachine.setState(BATTLE_STATES.TREASURE_CHEST_ITEM_USED);
            break;
          default:
            exhaustiveGuard(this.#battleMenu.itemUsed.category);
        }
      },
    });

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.HEAL_ITEM_USED,
      onEnter: async () => {
        this.#activePlayerMonster.updateMonsterHealth(
          (dataManager.store.get(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY) as Monster[])[
            this.#activePlayerMonsterPartyIndex
          ].currentHp,
        );
        this.time.delayedCall(500, () => {
          this.#enemyAttack(() => {
            this.#battleStateMachine.setState(BATTLE_STATES.POST_ATTACK_CHECK);
          });
        });
      },
    });

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.BALL_ITEM_USED,
      onEnter: async () => {
        const tx = new Transaction();
        let txResponse: SuiTransactionBlockResponse;
        await this._dubhe.tx.numeron_encounter_system.capture({
          tx,
          params: [
            tx.object(this._dubheSchemaId),
            tx.object(this._schemaId),
            tx.object.random(),
            tx.pure.u256(this.#battleMenu.itemUsed.id),
          ],
          isRaw: true,
        });

        await walletUtils.signAndExecuteTransaction({
          tx,
          onSuccess: async (result: any) => {
            console.log(`Transaction successful:`, result);

            const animationsPromise = (async () => {
              await this.#ball.playThrowBallAnimation();
              await this.#activeEnemyMonster.playCatchAnimation();
            })();

            const waitTxPromise = (async () => {
              txResponse = await this._dubhe.waitForTransaction(result.digest);
            })();

            await Promise.all([animationsPromise, waitTxPromise]);

            const catchEvent = txResponse.events?.find(event =>
              event.type.includes('monster_catch_attempt_event')
            );

            if (!catchEvent) {
              console.error('Capture event data not found');
              return;
            }

            console.log('catchEvent', catchEvent);

            // Determine capture result based on event data
            const catchResult = (catchEvent.parsedJson as { result: Record<string, unknown> }).result;
            const wasCaptured = Object.keys(catchResult)[0] === 'Caught';

            // Determine ball shake count based on result
            let numberOfShakes = 0;
            if (wasCaptured) {
              numberOfShakes = 3; // Shake 3 times for successful capture
            } else {
              // Simulate different shake counts for failed capture based on randomness
              const randomValue = Math.random();
              if (randomValue < 0.3) {
                numberOfShakes = 2;
              } else if (randomValue < 0.6) {
                numberOfShakes = 1;
              }
            }

            if (numberOfShakes > 0) {
              await this.#ball.playShakeBallAnimation(numberOfShakes - 1);
            } else {
              await this.#ball.playShakeBallAnimation(0);
            }

            if (wasCaptured) {
              this.#monsterCaptured = true;
              await dataManager.updateMonsters();
              this.#battleStateMachine.setState(BATTLE_STATES.POST_ATTACK_CHECK);
              return;
            }

            await sleep(500, this);
            this.#ball.hide();
            await this.#activeEnemyMonster.playCatchAnimationFailed();

            this.#battleMenu.updateInfoPaneMessagesAndWaitForInput(['The wild monster breaks free!'], () => {
              this.time.delayedCall(500, () => {
                this.#enemyAttack(() => {
                  this.#battleStateMachine.setState(BATTLE_STATES.POST_ATTACK_CHECK);
                });
              });
            });
          },
          onError: (error: any) => {
            console.error(`Transaction failed:`, error);
          },
        });
      },
    });

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.CAUGHT_MONSTER,
      onEnter: async () => {
        // add monster to the players party
        const updatedMonster: Monster = {
          ...this.#sceneData.enemyMonsters[0],
          id: generateUuid(),
          currentHp: this.#activeEnemyMonster.currentHp,
        };
        this.#sceneData.playerMonsters.push(updatedMonster);

        this.#battleStateMachine.setState(BATTLE_STATES.FINISHED);
      },
    });

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.MEDICINE_ITEM_USED,
      onEnter: async () => {
        let updatedHp = (dataManager.store.get(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY) as Monster[])[
          this.#activePlayerMonsterPartyIndex
        ].currentHp;
        console.log('this.#activePlayerMonsterPartyIndex', this.#activePlayerMonsterPartyIndex);
        console.log(
          'monster',
          (dataManager.store.get(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY) as Monster[])[
            this.#activePlayerMonsterPartyIndex
          ],
        );
        console.log('updatedHp', updatedHp);

        // this.#activePlayerMonster.updateMonsterHealth(updatedHp);
        // this.#battleStateMachine.setState(BATTLE_STATES.POST_ATTACK_CHECK);

        this.#activePlayerMonster.updateMonsterHealth(
          (dataManager.store.get(DATA_MANAGER_STORE_KEYS.MONSTERS_IN_PARTY) as Monster[])[
            this.#activePlayerMonsterPartyIndex
          ].currentHp,
        );
        this.time.delayedCall(500, () => {
          this.#enemyAttack(() => {
            this.#battleStateMachine.setState(BATTLE_STATES.POST_ATTACK_CHECK);
          });
        });
      },
    });

    this.#battleStateMachine.addState({
      name: BATTLE_STATES.SCROLL_ITEM_USED,
      onEnter: async () => {
        const tx = new Transaction();
        await this._dubhe.tx.numeron_encounter_system.flee({
          tx,
          params: [tx.object(this._dubheSchemaId), tx.object(this._schemaId), tx.pure.bool(true)],
          isRaw: true,
        });
        let fleeSuccess = false;
        await walletUtils.signAndExecuteTransaction({
          tx,
          onSuccess: async (result: any) => {
            console.log(`Transaction successful:`, result);
            await this._dubhe.waitForTransaction(result.digest);
            fleeSuccess = true;
          },
          onError: (error: any) => {
            console.error(`Transaction failed:`, error);
          },
        });

        if (fleeSuccess) {
          console.log('Escape successful, preparing to switch scenes');
          this.#battleMenu.updateInfoPaneMessageNoInputRequired('You got away safely!', () => {
            playSoundFx(this, AUDIO_ASSET_KEYS.FLEE);
            this.time.delayedCall(500, () => {
              this.#battleStateMachine.setState(BATTLE_STATES.FINISHED);
            });
          });
          return;
        }

        this.#battleMenu.updateInfoPaneMessagesAndWaitForInput(['You failed to run away...'], () => {
          this.time.delayedCall(200, () => {
            this.#battleStateMachine.setState(BATTLE_STATES.PLAYER_INPUT);
          });
        });
      },
    });

    // start state machine
    this.#battleStateMachine.setState(BATTLE_STATES.INTRO);
  }

  handleSceneResume(sys: Phaser.Scenes.Systems, data?: BattleSceneWasResumedData | undefined) {
    super.handleSceneResume(sys, data);

    if (!data || !data.wasMonsterSelected || data.selectedMonsterIndex === undefined) {
      this.#battleStateMachine.setState(BATTLE_STATES.PLAYER_INPUT);
      return;
    }

    this._controls.lockInput = true;
    this.#switchingActiveMonster = true;

    // if monster was selected, then we need to play animation for switching monsters and let enemy monster attack
    // if previous monster was not knocked out
    this.#activePlayerMonster.playDeathAnimation(() => {
      this.#activePlayerMonsterPartyIndex = data.selectedMonsterIndex;
      this.#activePlayerMonster.switchMonster(this.#sceneData.playerMonsters[data.selectedMonsterIndex]);
      this.#battleMenu.updateMonsterAttackSubMenu();
      this._controls.lockInput = false;
      this.#battleStateMachine.setState(BATTLE_STATES.BRING_OUT_MONSTER);
    });
  }

  #createAvailableMonstersUi() {
    this.#availableMonstersUiContainer = this.add.container(this.scale.width - 24, 304, []);
    this.#sceneData.playerMonsters.forEach((monster, index) => {
      const alpha = monster.currentHp > 0 ? 1 : 0.4;
      const ball = this.add
        .image(30 * -index, 0, BATTLE_ASSET_KEYS.BALL_THUMBNAIL, 0)
        .setScale(0.8)
        .setAlpha(alpha);
      this.#availableMonstersUiContainer.add(ball);
    });
    this.#availableMonstersUiContainer.setAlpha(0);
  }
}
