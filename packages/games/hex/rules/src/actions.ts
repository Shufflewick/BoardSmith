import { Action, type ActionDefinition } from '@boardsmith/engine';
import type { HexGame } from './game.js';
import { Cell, Stone, HexPlayer } from './elements.js';

/**
 * Create the "place stone" action
 * Player selects an empty cell to place their stone
 */
export function createPlaceStoneAction(game: HexGame): ActionDefinition {
  return Action.create('placeStone')
    .prompt('Place a stone on an empty cell')
    .chooseElement<Cell>('cell', {
      prompt: 'Select a cell',
      elementClass: Cell,
      filter: (element, ctx) => {
        const cell = element as Cell;
        return cell.isEmpty();
      },
      display: (cell, ctx) => {
        return cell.notation;
      },
      boardRef: (cell, ctx) => {
        return {
          id: cell.id,
          notation: cell.notation,
        };
      },
    })
    .execute((args, ctx) => {
      const player = ctx.player as HexPlayer;
      const cell = args.cell as Cell;

      // Create a stone for this player
      const stone = cell.create(Stone, `stone-${player.position}-${player.stonesPlaced}`, {
        player: player,
      });

      player.stonesPlaced++;

      // Add game message
      game.message(`${player.name} placed a stone at (${cell.q}, ${cell.r})`);

      // Check for win
      const board = game.board;
      if (board && board.checkWin(player)) {
        game.message(`${player.name} wins by connecting their edges!`);
        game.setWinner(player);
      }

      return {
        success: true,
        data: {
          cell: cell.notation,
          player: player.name,
        },
        message: `Placed stone at (${cell.q}, ${cell.r})`,
      };
    });
}
