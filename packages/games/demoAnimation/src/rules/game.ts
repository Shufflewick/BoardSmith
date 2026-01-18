/**
 * Demo Animation - Game
 *
 * A demo showcasing all BoardSmith animation capabilities.
 * Uses 4 generic zones (A/B face-up, C/D face-down) instead of game-specific zones.
 * Actions are named after the animation feature they demonstrate.
 */

import { Game, Player as BasePlayer, type GameOptions } from '@boardsmith/engine';
import { Card, Zone } from './elements.js';
import { createGameFlow } from './flow.js';
import {
  createAutoFlyUpUpAction,
  createAutoFlyDownDownAction,
  createAutoFlyFlipAction,
  createFlipReorderAction,
  createFlyToStatAction,
  createActionTriggerAction,
  createCardFlipAction,
  createDragDropAction,
} from './actions.js';

export interface DemoGameOptions extends GameOptions {
  seed?: string;
  /** Number of players (default: 1 for this demo) */
  playerCount?: number;
}

export class DemoPlayer extends BasePlayer<DemoGame, DemoPlayer> {
  score: number = 0;
}

export class DemoGame extends Game<DemoGame, DemoPlayer> {
  /** Face-up zone A (top-left) */
  zoneA!: Zone;
  /** Face-up zone B (top-right) */
  zoneB!: Zone;
  /** Face-down zone C (bottom-left) */
  zoneC!: Zone;
  /** Face-down zone D (bottom-right) */
  zoneD!: Zone;

  constructor(options: DemoGameOptions) {
    super(options);

    // Register element classes
    this.registerElements([Card, Zone]);

    // Create 4 zones
    this.zoneA = this.create(Zone, 'zone-a', { faceUp: true });
    this.zoneB = this.create(Zone, 'zone-b', { faceUp: true });
    this.zoneC = this.create(Zone, 'zone-c', { faceUp: false });
    this.zoneD = this.create(Zone, 'zone-d', { faceUp: false });

    // Create 16 cards and distribute evenly (4 per zone)
    const suits = ['H', 'D', 'C', 'S'] as const;
    const ranks = ['A', '2', '3', '4'] as const;
    const allCards: Card[] = [];

    for (const suit of suits) {
      for (const rank of ranks) {
        const card = this.create(Card, `${rank}${suit}`, { suit, rank });
        allCards.push(card);
      }
    }

    // Shuffle cards before distributing
    for (let i = allCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allCards[i], allCards[j]] = [allCards[j], allCards[i]];
    }

    // Distribute 4 cards to each zone
    const zones = [this.zoneA, this.zoneB, this.zoneC, this.zoneD];
    for (let i = 0; i < allCards.length; i++) {
      const zone = zones[Math.floor(i / 4)];
      const card = allCards[i];
      card.faceUp = zone.faceUp;
      card.putInto(zone);
    }

    // Register all actions
    this.registerAction(createAutoFlyUpUpAction(this));
    this.registerAction(createAutoFlyDownDownAction(this));
    this.registerAction(createAutoFlyFlipAction(this));
    this.registerAction(createFlipReorderAction(this));
    this.registerAction(createFlyToStatAction(this));
    this.registerAction(createActionTriggerAction(this));
    this.registerAction(createCardFlipAction(this));
    this.registerAction(createDragDropAction(this));

    // Set up game flow
    this.setFlow(createGameFlow(this));
  }

  /** Get all face-up zones */
  get faceUpZones(): Zone[] {
    return [this.zoneA, this.zoneB];
  }

  /** Get all face-down zones */
  get faceDownZones(): Zone[] {
    return [this.zoneC, this.zoneD];
  }

  /** Get all zones */
  get allZones(): Zone[] {
    return [this.zoneA, this.zoneB, this.zoneC, this.zoneD];
  }

  override isFinished(): boolean {
    // Demo never ends - it's a sandbox
    return false;
  }

  override getWinners(): DemoPlayer[] {
    return [];
  }
}

// Set PlayerClass after both classes are defined
DemoGame.PlayerClass = DemoPlayer;
