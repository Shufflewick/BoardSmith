/**
 * Demo Animation - Actions
 *
 * Each action is named after the BoardSmith animation composable it demonstrates:
 * - autoFlyUpUp: useAutoFlyingElements (face-up to face-up, no flip)
 * - autoFlyDownDown: useAutoFlyingElements (face-down to face-down, no flip)
 * - autoFlyFlip: useAutoFlyingElements (face-up to face-down, card flips during flight)
 * - flipReorder: useAutoFLIP (cards reorder within a zone)
 * - flyToStat: useAutoFlyToStat (card flies to player stat display)
 * - actionTrigger: useActionAnimations (pre-action capture, post-action animation)
 * - cardFlip: Card flip animation (toggle face state in place)
 */

import { Action, type ActionDefinition } from '@boardsmith/engine';
import type { DemoGame, DemoPlayer } from './game.js';
import { Card, Zone } from './elements.js';

/**
 * AUTO-FLY (UP→UP) - Move a card between face-up zones A ↔ B
 * Animation: useAutoFlyingElements with ID-based tracking, no flip
 */
export function createAutoFlyUpUpAction(game: DemoGame): ActionDefinition {
  return Action.create('autoFlyUpUp')
    .prompt('Move card between face-up zones (A ↔ B)')
    .fromElements<Card>('card', {
      prompt: 'Select a card to move',
      elements: () => [
        ...game.zoneA.all(Card),
        ...game.zoneB.all(Card),
      ],
      display: (card) => `${card.rank}${card.suit}`,
      boardRef: (card) => ({ id: card.id }),
    })
    .condition({
      'has cards in face-up zones': () => {
        return game.zoneA.count(Card) > 0 || game.zoneB.count(Card) > 0;
      },
    })
    .execute((args, ctx) => {
      const card = args.card as Card;
      const currentZone = card.parent as Zone;

      // Move to the other face-up zone
      const targetZone = currentZone === game.zoneA ? game.zoneB : game.zoneA;
      card.putInto(targetZone);

      game.message(`[useAutoFlyingElements] Moved ${card.rank}${card.suit} from ${currentZone.name} to ${targetZone.name}`);
      return { success: true };
    });
}

/**
 * AUTO-FLY (DOWN→DOWN) - Move a card between face-down zones C ↔ D
 * Animation: useAutoFlyingElements with count-based tracking, no flip
 */
export function createAutoFlyDownDownAction(game: DemoGame): ActionDefinition {
  return Action.create('autoFlyDownDown')
    .prompt('Move card between face-down zones (C ↔ D)')
    .fromElements<Card>('card', {
      prompt: 'Select a card to move',
      elements: () => [
        ...game.zoneC.all(Card),
        ...game.zoneD.all(Card),
      ],
      display: (card) => `Card in ${(card.parent as Zone)?.name || 'unknown'}`,
      boardRef: (card) => ({ id: card.id }),
    })
    .condition({
      'has cards in face-down zones': () => {
        return game.zoneC.count(Card) > 0 || game.zoneD.count(Card) > 0;
      },
    })
    .execute((args, ctx) => {
      const card = args.card as Card;
      const currentZone = card.parent as Zone;

      // Move to the other face-down zone
      const targetZone = currentZone === game.zoneC ? game.zoneD : game.zoneC;
      card.putInto(targetZone);

      game.message(`[useAutoFlyingElements] Moved a card from ${currentZone.name} to ${targetZone.name}`);
      return { success: true };
    });
}

/**
 * AUTO-FLY + FLIP - Move a card between face-up zone A and face-down zone C
 * Animation: useAutoFlyingElements with flip during flight (toPrivate/toPublic)
 */
export function createAutoFlyFlipAction(game: DemoGame): ActionDefinition {
  return Action.create('autoFlyFlip')
    .prompt('Move card between A ↔ C (flips during flight)')
    .fromElements<Card>('card', {
      prompt: 'Select a card to move and flip',
      elements: () => [
        ...game.zoneA.all(Card),
        ...game.zoneC.all(Card),
      ],
      display: (card) => {
        if (card.faceUp) {
          return `${card.rank}${card.suit} (face-up in A)`;
        }
        return `Card in C (face-down)`;
      },
      boardRef: (card) => ({ id: card.id }),
    })
    .condition({
      'has cards in A or C': () => {
        return game.zoneA.count(Card) > 0 || game.zoneC.count(Card) > 0;
      },
    })
    .execute((args, ctx) => {
      const card = args.card as Card;
      const currentZone = card.parent as Zone;

      // Move to the other zone and flip
      const targetZone = currentZone === game.zoneA ? game.zoneC : game.zoneA;
      card.faceUp = targetZone.faceUp;
      card.putInto(targetZone);

      const flipDir = targetZone.faceUp ? 'revealed' : 'hidden';
      game.message(`[useAutoFlyingElements+flip] Card ${flipDir} as it flew to ${targetZone.name}`);
      return { success: true };
    });
}

/**
 * FLIP REORDER - Shuffle cards within a selected zone
 * Animation: useAutoFLIP - in-place reordering animation
 */
export function createFlipReorderAction(game: DemoGame): ActionDefinition {
  return Action.create('flipReorder')
    .prompt('Shuffle cards within a zone')
    .chooseFrom<string>('zone', {
      prompt: 'Select a zone to shuffle',
      choices: () => {
        const zones: string[] = [];
        if (game.zoneA.count(Card) > 1) zones.push('zone-a');
        if (game.zoneB.count(Card) > 1) zones.push('zone-b');
        if (game.zoneC.count(Card) > 1) zones.push('zone-c');
        if (game.zoneD.count(Card) > 1) zones.push('zone-d');
        return zones;
      },
      display: (zoneName) => {
        const labels: Record<string, string> = {
          'zone-a': 'Zone A (face-up)',
          'zone-b': 'Zone B (face-up)',
          'zone-c': 'Zone C (face-down)',
          'zone-d': 'Zone D (face-down)',
        };
        return labels[zoneName] || zoneName;
      },
    })
    .condition({
      'has zone with multiple cards': () => {
        return game.allZones.some(z => z.count(Card) > 1);
      },
    })
    .execute((args) => {
      const zoneName = args.zone as string;
      const zoneMap: Record<string, Zone> = {
        'zone-a': game.zoneA,
        'zone-b': game.zoneB,
        'zone-c': game.zoneC,
        'zone-d': game.zoneD,
      };
      const zone = zoneMap[zoneName];
      if (zone) {
        zone.shuffle();
        game.message(`[useAutoFLIP] Shuffled cards in ${zone.name}`);
      }
      return { success: true };
    });
}

/**
 * FLY TO STAT - Remove a card and watch it fly to the player panel
 * Animation: useAutoFlyToStat - card flies to player stat in the sidebar
 */
export function createFlyToStatAction(game: DemoGame): ActionDefinition {
  return Action.create('flyToStat')
    .prompt('Remove card (flies to player panel)')
    .fromElements<Card>('card', {
      prompt: 'Select a card to remove',
      elements: () => [
        ...game.zoneA.all(Card),
        ...game.zoneB.all(Card),
      ],
      display: (card) => `${card.rank}${card.suit} (${card.pointValue} pts)`,
      boardRef: (card) => ({ id: card.id }),
    })
    .condition({
      'has cards in face-up zones': () => {
        return game.zoneA.count(Card) > 0 || game.zoneB.count(Card) > 0;
      },
    })
    .execute((args, ctx) => {
      const player = ctx.player as DemoPlayer;
      const card = args.card as Card;
      const points = card.pointValue;

      player.score += points;
      card.remove();

      game.message(`[useAutoFlyToStat] Scored ${card.rank}${card.suit} for ${points} points!`);
      return { success: true };
    });
}

/**
 * ACTION-TRIGGER - Move a card using action animation hook
 * Animation: useActionAnimations - pre-action capture, post-action animation
 *
 * Moves from Zone A to Zone B (demonstrating action-triggered animation)
 */
export function createActionTriggerAction(game: DemoGame): ActionDefinition {
  return Action.create('actionTrigger')
    .prompt('Move card with action-triggered animation')
    .fromElements<Card>('card', {
      prompt: 'Select a card from Zone A',
      elements: () => [...game.zoneA.all(Card)],
      display: (card) => `${card.rank}${card.suit}`,
      boardRef: (card) => ({ id: card.id }),
    })
    .condition({
      'has cards in Zone A': () => game.zoneA.count(Card) > 0,
    })
    .execute((args) => {
      const card = args.card as Card;
      card.putInto(game.zoneB);
      game.message(`[useActionAnimations] Moved ${card.rank}${card.suit} to Zone B`);
      return { success: true };
    });
}

/**
 * DRAG-DROP - Drag a card from one zone and drop it in another
 * Animation: useDragDrop composable for custom UI drag-drop
 *
 * This demonstrates the useDragDrop composable which provides:
 * - dragProps(ref) - Props to make elements draggable
 * - dropProps(ref) - Props to make elements drop targets
 * - isDragging(ref) - Check if element is being dragged
 * - isDropTarget(ref) - Check if element is valid drop target
 */
export function createDragDropAction(game: DemoGame): ActionDefinition {
  return Action.create('dragDrop')
    .prompt('Drag a card to another zone')
    .fromElements<Card>('card', {
      prompt: 'Drag a card...',
      elements: () => [
        ...game.zoneA.all(Card),
        ...game.zoneB.all(Card),
        ...game.zoneC.all(Card),
        ...game.zoneD.all(Card),
      ],
      display: (card) => {
        if (card.faceUp) {
          return `${card.rank}${card.suit}`;
        }
        return `Card (face-down)`;
      },
      boardRef: (card) => ({ id: card.id }),
    })
    .fromElements<Zone>('targetZone', {
      prompt: '...and drop it here',
      elements: (args) => {
        const card = args.card as Card | undefined;
        if (!card?.parent) {
          // During availability checking, card may not be resolved yet
          return game.allZones;
        }
        const currentZone = card.parent as Zone;
        // Return all zones except the current one
        return game.allZones.filter(z => z !== currentZone);
      },
      display: (zone) => {
        const labels: Record<string, string> = {
          'zone-a': 'Zone A (face-up)',
          'zone-b': 'Zone B (face-up)',
          'zone-c': 'Zone C (face-down)',
          'zone-d': 'Zone D (face-down)',
        };
        return labels[zone.name] || zone.name;
      },
      boardRef: (zone) => ({ name: zone.name }),
    })
    .condition({
      'has cards': () => game.allZones.some(z => z.count(Card) > 0),
    })
    .execute((args) => {
      const card = args.card as Card;
      const targetZone = args.targetZone as Zone;
      const sourceZone = card.parent as Zone;

      // Update card face state based on target zone
      card.faceUp = targetZone.faceUp;
      card.putInto(targetZone);

      const flipMsg = sourceZone.faceUp !== targetZone.faceUp ? ' (flipped!)' : '';
      game.message(`[useDragDrop] Dragged card from ${sourceZone.name} to ${targetZone.name}${flipMsg}`);
      return { success: true };
    });
}

/**
 * CARD FLIP - Toggle a card's face-up/face-down state in place
 * Animation: Card flip in overlay (no movement, just flip)
 */
export function createCardFlipAction(game: DemoGame): ActionDefinition {
  return Action.create('cardFlip')
    .prompt('Flip a card in place')
    .fromElements<Card>('card', {
      prompt: 'Select a card to flip',
      elements: () => [
        ...game.zoneA.all(Card),
        ...game.zoneB.all(Card),
        ...game.zoneC.all(Card),
        ...game.zoneD.all(Card),
      ],
      display: (card) => {
        if (card.faceUp) {
          return `${card.rank}${card.suit} (face-up)`;
        }
        return `Card (face-down)`;
      },
      boardRef: (card) => ({ id: card.id }),
    })
    .condition({
      'has cards': () => game.allZones.some(z => z.count(Card) > 0),
    })
    .execute((args) => {
      const card = args.card as Card;
      card.faceUp = !card.faceUp;
      const state = card.faceUp ? 'face-up' : 'face-down';
      game.message(`[CardFlip] Flipped card to ${state}`);
      return { success: true };
    });
}
