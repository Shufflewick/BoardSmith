import { Action, type ActionDefinition } from '@boardsmith/engine';
import type { GoFishGame } from './game.js';
import { Card, GoFishPlayer, Hand } from './elements.js';

/**
 * Format a hand as a readable string showing all cards
 */
function formatHand(hand: Hand): string {
  const cards = [...hand.all(Card)];
  if (cards.length === 0) return '(empty)';
  return cards.map(c => `${c.rank}${c.suit}`).sort().join(', ');
}

/**
 * Format cards of a specific rank
 */
function formatCards(cards: Card[]): string {
  if (cards.length === 0) return '(none)';
  return cards.map(c => `${c.rank}${c.suit}`).join(', ');
}

/**
 * Create the "ask" action for Go Fish
 *
 * The ask action allows a player to:
 * 1. Choose another player (target)
 * 2. Choose a rank they hold in their hand
 * 3. If target has cards of that rank, they give all of them
 * 4. If not, the asking player "goes fish" (draws from pond)
 * 5. If the drawn card matches the requested rank, they get another turn
 */
export function createAskAction(game: GoFishGame): ActionDefinition {
  return Action.create('ask')
    .prompt('Ask another player for cards')
    .chooseFrom('target', {
      prompt: 'Choose a player to ask',
      choices: (ctx) => game.playerChoices({ excludeSelf: true, currentPlayer: ctx.player }),
      boardRefs: (choice: { value: number; display: string }, ctx) => {
        const targetPlayer = game.getPlayer(choice.value) as GoFishPlayer;
        const hand = game.getPlayerHand(targetPlayer);
        return {
          targetRef: {
            id: hand.id,
          },
        };
      },
    })
    .chooseFrom<string>('rank', {
      prompt: 'Choose a rank to ask for',
      choices: (ctx) => game.getPlayerRanks(ctx.player as GoFishPlayer),
      display: (rank) => {
        const names: Record<string, string> = {
          'A': 'Aces', '2': 'Twos', '3': 'Threes', '4': 'Fours',
          '5': 'Fives', '6': 'Sixes', '7': 'Sevens', '8': 'Eights',
          '9': 'Nines', '10': 'Tens', 'J': 'Jacks', 'Q': 'Queens', 'K': 'Kings'
        };
        return names[rank] ?? rank;
      },
      boardRefs: (rank, ctx) => {
        const player = ctx.player as GoFishPlayer;
        const hand = game.getPlayerHand(player);
        const cards = [...hand.all(Card)].filter(c => c.rank === rank);
        // Link to the first card of this rank (all cards of same rank are equivalent)
        if (cards.length > 0) {
          return {
            targetRef: {
              id: cards[0].id,
            },
          };
        }
        // Return empty refs if no cards found (shouldn't happen since choices are based on player's ranks)
        return {};
      },
    })
    .condition((ctx) => game.canPlayerTakeAction(ctx.player as GoFishPlayer))
    .execute((args, ctx) => {
      const player = ctx.player as GoFishPlayer;
      // After extractChoiceValue, args.target is just the position number
      const targetPosition = args.target as number;
      const target = game.getPlayer(targetPosition) as GoFishPlayer;
      const rank = args.rank as string;

      // Get hands for logging
      const playerHand = game.getPlayerHand(player);
      const targetHand = game.getPlayerHand(target);

      // LOG: Action being taken
      game.message(`--- ACTION: ${player.name} asks ${target.name} for ${rank}s ---`);

      // LOG: Both hands BEFORE the action
      game.message(`BEFORE - ${player.name}'s hand (${playerHand.count(Card)} cards): ${formatHand(playerHand)}`);
      game.message(`BEFORE - ${target.name}'s hand (${targetHand.count(Card)} cards): ${formatHand(targetHand)}`);

      // Check if target has the requested rank
      const targetCards = game.getCardsOfRank(target, rank);

      // LOG: What target has of requested rank
      game.message(`${target.name}'s ${rank}s: ${formatCards(targetCards)} (${targetCards.length} total)`);

      if (targetCards.length > 0) {
        // Target has the cards - transfer them
        game.message(`TRANSFER: Moving ${targetCards.length} card(s) from ${target.name} to ${player.name}`);

        for (const card of targetCards) {
          game.message(`  Moving ${card.rank}${card.suit} to ${player.name}`);
          card.putInto(playerHand);
        }

        // LOG: Both hands AFTER the transfer
        game.message(`AFTER - ${player.name}'s hand (${playerHand.count(Card)} cards): ${formatHand(playerHand)}`);
        game.message(`AFTER - ${target.name}'s hand (${targetHand.count(Card)} cards): ${formatHand(targetHand)}`);

        game.message(`RESULT: ${player.name} got ${targetCards.length} ${rank}(s) from ${target.name}!`);

        // Check for books after receiving cards
        const books = game.checkForBooks(player);

        if (books.length > 0) {
          game.message(`AFTER BOOKS - ${player.name}'s hand (${playerHand.count(Card)} cards): ${formatHand(playerHand)}`);
        }

        return {
          success: true,
          data: {
            gotCards: true,
            cardsReceived: targetCards.length,
            formedBooks: books,
            extraTurn: true,
          },
          message: `Got ${targetCards.length} ${rank}(s) from ${target.name}`,
        };
      } else {
        // Go Fish!
        game.message(`GO FISH: ${target.name} has no ${rank}s`);

        const pondCount = game.pond.count(Card);
        game.message(`Pond has ${pondCount} cards remaining`);

        const drawnCard = game.drawFromPond(player);

        if (drawnCard) {
          const drewMatch = drawnCard.rank === rank;
          game.message(`DRAW: ${player.name} drew ${drawnCard.rank}${drawnCard.suit} from pond`);

          // LOG: Hand AFTER drawing
          game.message(`AFTER DRAW - ${player.name}'s hand (${playerHand.count(Card)} cards): ${formatHand(playerHand)}`);

          if (drewMatch) {
            game.message(`LUCKY: Drew the requested rank! ${player.name} gets another turn.`);
          } else {
            game.message(`RESULT: No match. Turn passes to next player.`);
          }

          // Check for books after drawing
          const books = game.checkForBooks(player);

          if (books.length > 0) {
            game.message(`AFTER BOOKS - ${player.name}'s hand (${playerHand.count(Card)} cards): ${formatHand(playerHand)}`);
          }

          return {
            success: true,
            data: {
              gotCards: false,
              goFish: true,
              drewMatch,
              formedBooks: books,
              extraTurn: drewMatch,
            },
            message: drewMatch
              ? `Go Fish! Drew a ${rank} - another turn!`
              : `Go Fish! Drew from the pond.`,
          };
        } else {
          // Pond is empty
          game.message(`POND EMPTY: ${player.name}'s turn ends with no draw.`);

          return {
            success: true,
            data: {
              gotCards: false,
              goFish: true,
              pondEmpty: true,
              extraTurn: false,
            },
            message: 'Go Fish! But the pond is empty.',
          };
        }
      }
    });
}
