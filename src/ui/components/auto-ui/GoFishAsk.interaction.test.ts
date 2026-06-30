// @vitest-environment jsdom
/**
 * Go Fish ask — mounted component test (Bug B + PRESENT-02 guard)
 *
 * ROOT CAUSE TRACE (Open Question 2 resolution — documented here before any fix):
 *
 * Bug B claim: "Go Fish ask shows 0 .action-selectable, footer suppressed."
 * Contradiction: 'ask' has id-only refs → old allCurrentChoicesAnchored should be
 * false (id-only refs fail the notation check) → footer should be present.
 *
 * Trace findings (file:line evidence):
 *
 * 1. SINGLE ACTION confirmed (flow.ts:65-73):
 *    actionStep({ name: 'ask-step', actions: ['ask'] }) — ONLY 'ask' is available.
 *    Candidate cause (1) (simultaneous second action blocking tryAutoStartSingleAction)
 *    is RULED OUT. tryAutoStartSingleAction (useBoardActionBridge.ts:254) sees
 *    actions.length === 1 and calls startAction('ask').
 *
 * 2. PRE-PLAN-02 root cause — non-reactive choices (ActionPanel.vue:230, pre-fix):
 *    Inside start('ask'), fetchAndAutoFill(target) runs:
 *      - fetchChoicesForPick('target') → 1 opponent → snapshotVersion++
 *      - tryAutoFillSelection(target): 1 choice → auto-fills → currentArgs['target'] = opponent_id
 *      - getNextSelection('target') → 'rank' (useActionController.ts:1405-1419)
 *      - fetchAndAutoFill(rank) → fetchChoicesForPick('rank') → 3+ ranks → snapshotVersion++
 *    After start() resolves: currentPick = 'rank', rank choices are in pickSnapshots.
 *
 *    BUT ActionPanel.filteredChoices (line 230 pre-fix) called getCurrentChoices() —
 *    a bare function that reads pickSnapshots.get('rank') without reading snapshotVersion.
 *    The computed had no reactive dependency on snapshotVersion, so it never re-ran
 *    when rank choices arrived. Panel showed "No options available" (or blank if the
 *    regular-choice template's `filteredChoices.length > 0` gate was false).
 *
 *    allCurrentChoicesAnchored under OLD notation-walking code: rank pick has id-only
 *    refs → notation !== undefined = false → every() = false → false. So the footer
 *    was PRESENT but empty (no choices). "Footer suppressed" in CONTEXT was inaccurate;
 *    the footer was present but showed nothing actionable. Candidate cause (2) was real.
 *
 * 3. RESIDUAL BUG B ROOT CAUSE — D-03 filter (action-panel-helpers.ts:filterAnchoredChoices):
 *    Even though plan 02 fixed the reactive choices path, Bug B persists because of a
 *    second bug: filterAnchoredChoices (action-panel-helpers.ts:25) treats ANY choice with
 *    refs as "board-anchored" and filters it from filteredChoices. The rank choices all carry
 *    id-only refs `{ ref: { id: cardId }, role: 'target' }` for visual highlighting. These
 *    are NOT board-clickable (the board grid matches by notation, not by id), but D-03
 *    filters them out, leaving filteredChoices = [] for the rank pick. The "Regular choice
 *    selection" template (ActionPanel.vue:987) requires filteredChoices.length > 0 — so the
 *    panel shows nothing for the rank pick. Panel text: "Ask another player for cards✕Player 2✕"
 *    (action prompt + collected target chip) but no rank buttons.
 *
 *    FIX (plan 04, Task 2): Change filterAnchoredChoices to only filter choices where the
 *    clickable ref has a NOTATION (truly board-anchored → grid cell is clickable). Id-only
 *    refs indicate card highlighting only, not a board selection surface.
 *
 * Test B1 STATUS: RED before the fix (confirmed D-03 bug); GREEN after fix (Task 2).
 * Production fix in plan 04: action-panel-helpers.ts filterAnchoredChoices notation guard.
 *
 * PRESENT-02 guard: Phase 94 browser-verified that opponent face-down cards render
 * only /cards/back.svg with anonymized negative ids. Test B2 adds a component-level
 * regression guard so future refactors can't silently break it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { useActionController } from '../../composables/useActionController.js';
import type { ActionMetadata } from '../../composables/useActionController.js';
import ActionPanel from './ActionPanel.vue';
import CardRenderer from './renderers/CardRenderer.vue';

// ── Go Fish 'ask' fixture (test-local; NO import from BoardSmithGames) ────────
//
// Mirrors the real ask action shape from go-fish/src/rules/actions.ts:
//   .chooseFrom('target', { choices: playerChoices(excludeSelf), boardRefs: id-only })
//   .chooseFrom('rank',   { choices: getPlayerRanks(player),    boardRefs: id-only })
//
// Both picks carry id-only refs (no notation) — key for the allCurrentChoicesAnchored
// assertion: choice picks with id-only refs must NOT suppress the footer under D-02.
const goFishAskAction: ActionMetadata = {
  name: 'ask',
  prompt: 'Ask another player for cards',
  selections: [
    {
      name: 'target',
      type: 'choice',
      prompt: 'Choose a player to ask',
      // No static choices — server provides them (id-only boardRefs like real Go Fish)
    },
    {
      name: 'rank',
      type: 'choice',
      prompt: 'Choose a rank to ask for',
      // No static choices — server provides them (id-only boardRefs like real Go Fish)
    },
  ],
};

describe('GoFish ask interaction tests', () => {
  let sendAction: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendAction = vi.fn().mockResolvedValue({ success: true });
  });

  // ── Test B1: Bug B — ask action surfaces rank choices via footer ───────────
  it('B1: Go Fish ask surfaces rank choices in footer after target auto-fills (Bug B closed by plan 02)', async () => {
    // fetchPickChoices mock:
    //   target: 2-player game → 1 opponent with id-only boardRef (like real Go Fish)
    //   rank:   player holds Aces, Sevens, Kings → 3 choices, each with id-only boardRef
    //
    // The rank boardRefs ({ ref: { id: card.id }, role: 'target' }) are id-only (no notation).
    // Under old allCurrentChoicesAnchored (notation walk): notation undefined → false → footer stays.
    // Under D-02 (validElements.length > 0): choice pick → validElements=[] → false → footer stays.
    // In both cases footer stays, but pre-plan-02 it showed nothing (Bug B root cause above).
    const fetchPickChoices = vi.fn(async (_action: string, selectionName: string) => {
      if (selectionName === 'target') {
        // 2-player: exactly 1 opponent → triggers auto-fill
        return {
          success: true,
          choices: [
            {
              value: 2,
              display: 'Player 2',
              refs: [{ ref: { id: 99 }, role: 'target' as const }],  // id-only
            },
          ],
        };
      }
      if (selectionName === 'rank') {
        // Ranks the player holds — 3 choices → no auto-fill → panel must show all three
        return {
          success: true,
          choices: [
            { value: 'A', display: 'Aces',   refs: [{ ref: { id: 10 }, role: 'target' as const }] },
            { value: '7', display: 'Sevens', refs: [{ ref: { id: 11 }, role: 'target' as const }] },
            { value: 'K', display: 'Kings',  refs: [{ ref: { id: 12 }, role: 'target' as const }] },
          ],
        };
      }
      return { success: true, choices: [] };
    });

    const controller = useActionController({
      sendAction,
      availableActions: ref(['ask']),
      actionMetadata: ref({ ask: goFishAskAction }),
      isMyTurn: ref(true),
      autoFill: true,   // default: single target auto-fills
      autoExecute: false,
      fetchPickChoices,
    });

    // Simulates useBoardActionBridge.tryAutoStartSingleAction calling controller.start().
    // Inside start(): fetchAndAutoFill(target) → 1 choice → auto-fills target (value 2) →
    //   fetchAndAutoFill(rank) recursively → 3 rank choices stored in pickSnapshots.
    // After start() resolves: currentPick = 'rank', rank choices ready.
    await controller.start('ask');
    await nextTick(); // flush Vue scheduler (watcher(currentPick) may re-check)

    // Structural assertions (pre-mount):
    // — target is auto-filled (2-player: 1 opponent)
    expect(controller.currentPick.value?.name).toBe('rank');
    // — rank choices are in currentChoices (tracks snapshotVersion)
    expect(controller.currentChoices.value.length).toBe(3);
    // — D-02: choice pick → validElements = [] → not anchored → footer shows
    expect(controller.allCurrentChoicesAnchored.value).toBe(false);

    // Mount ActionPanel with rank as active pick and choices populated.
    // filteredChoices reads currentChoices.value (reactive, plan-02 fix) → shows ranks.
    const wrapper = mount(ActionPanel, {
      global: {
        provide: { actionController: controller },
      },
      props: {
        availableActions: ['ask'],
        playerSeat: 1,
        isMyTurn: true,
        autoEndTurn: false,   // don't auto-execute during test
        autoFill: false,      // controller already handled auto-fill above
      },
    });

    await nextTick(); // panel render

    // ── B1 core assertions ────────────────────────────────────────────────────
    // PRE-PLAN-02 (Bug B): filteredChoices called getCurrentChoices() (non-reactive).
    //   snapshotVersion++ did not trigger re-run → choices never appeared → FAIL.
    // POST-PLAN-02 (GREEN): filteredChoices reads currentChoices.value (reactive) →
    //   re-runs when snapshotVersion++ → rank choices appear → PASS.

    // No "No options available" in any template branch
    expect(wrapper.text()).not.toContain('No options available');

    // All three rank choices are visible as buttons (confirms filteredChoices populated)
    expect(wrapper.text()).toContain('Aces');
    expect(wrapper.text()).toContain('Sevens');
    expect(wrapper.text()).toContain('Kings');

    // fetchPickChoices was called for both target and rank (traces the correct fetch path)
    expect(fetchPickChoices).toHaveBeenCalledWith('ask', 'target', expect.any(Number), expect.any(Object));
    expect(fetchPickChoices).toHaveBeenCalledWith('ask', 'rank', expect.any(Number), expect.any(Object));
  });

  // ── Test B2: PRESENT-02 — opponent face-down hand shows only back image ─────
  it('B2: PRESENT-02 — opponent hand renders back.svg with anonymized negative id; no face URL leaks', async () => {
    // Go Fish opponent's face-down hand in the real game:
    //   - Server strips face URL from hidden cards before sending to client
    //   - toJSONForPlayer assigns anonymized NEGATIVE ids to hidden elements
    //   - $images contains both face and back; UI must show ONLY back when __hidden=true
    //
    // This element shape is what the gameView contains for an opponent's hidden card:
    const hiddenOpponentCard = {
      id: -42,                  // anonymized negative id (toJSONForPlayer redaction)
      name: 'Card',
      className: 'Card',
      __hidden: true,           // PRESENT-02 trigger: strip face, show only back
      attributes: {
        // The face URL MUST NOT appear in the rendered output
        $images: {
          face: '/cards/face/AS.svg',   // face URL — must never leak when __hidden
          back: '/cards/back.svg',      // back URL — what must render
        },
      },
    };

    // Mount CardRenderer directly (no ActionController needed for this path)
    // CardRenderer reads __hidden and routes through resolvePresentation which
    // strips image/stats for hidden elements (PRESENT-02 guard).
    const wrapper = mount(CardRenderer, {
      props: {
        element: hiddenOpponentCard,
        depth: 0,
      },
      global: {
        provide: {
          // Minimal provides: selectableElements/selectedElements use optional chaining
          // and default to empty; boardInteraction warns but doesn't throw.
          selectableElements: ref(new Set<number>()),
          selectedElements: ref(new Set<number>()),
          // No 'presentation' overlay → resolvePresentation receives undefined → safe
        },
      },
    });

    await nextTick();

    // ── PRESENT-02 core assertions ────────────────────────────────────────────
    // 1. The face URL must NOT appear in any attribute value.
    //    We check the img src specifically (not wrapper.html() — template HTML comments
    //    contain the word "face" in explanatory text, which is safe; the URL is what matters).
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);

    // 2. The img src is back.svg — hidden cards always show back (T-93-04)
    expect(img.attributes('src')).toBe('/cards/back.svg');

    // 3. The face URL is NOT the img src (explicit PRESENT-02 guard)
    expect(img.attributes('src')).not.toContain('/cards/face/');
    expect(img.attributes('src')).not.toContain('AS.svg');

    // 4. The data-element-id is the NEGATIVE anonymized id (not a real card id)
    //    Positive ids are real game element ids that reveal card identity via correlation.
    const container = wrapper.find('[data-element-id]');
    expect(container.exists()).toBe(true);
    const renderedId = Number(container.attributes('data-element-id'));
    expect(renderedId).toBeLessThan(0);
    expect(renderedId).toBe(-42);
  });
});

// ── Tutorial board-path parity: the ask-for-rank step must auto-fill the single
//    opponent so the learner can click a rank card directly. Regression guard for
//    two v4.2 bugs: action-wide suppressAutoFill blocked the target auto-fill,
//    leaving the action stuck on 'target' so board card-clicks (which only fire on
//    the 'rank' pick) did nothing. suppressAutoFillFor:'rank' scopes it correctly.
describe('GoFish tutorial ask-for-rank — auto-fill scoping (board-path parity)', () => {
  const fetchPickChoices = vi.fn(async (_action: string, selectionName: string) => {
    if (selectionName === 'target') {
      return { success: true, choices: [
        { value: 2, display: 'Player 2', refs: [{ ref: { id: 99 }, role: 'target' as const }] },
      ] };
    }
    if (selectionName === 'rank') {
      // Tutorial gate restricts to a single rank ('7').
      return { success: true, choices: [
        { value: '7', display: 'Sevens', refs: [{ ref: { id: 11 }, role: 'target' as const }] },
      ] };
    }
    return { success: true, choices: [] };
  });

  function makeController(tutorialStep: Record<string, unknown> | undefined) {
    return useActionController({
      sendAction: vi.fn().mockResolvedValue({ success: true }),
      availableActions: ref(['ask']),
      actionMetadata: ref({ ask: goFishAskAction }),
      isMyTurn: ref(true),
      autoFill: true,
      autoExecute: false,
      fetchPickChoices,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tutorialStep: ref(tutorialStep) as any,
    });
  }

  it('FIXED: with suppressAutoFillFor:rank, the single opponent auto-fills → pick advances to rank (board click reachable)', async () => {
    const controller = makeController({
      id: 'ask-for-rank',
      gate: { action: 'ask' },
      suppressAutoFill: true,
      suppressAutoFillFor: 'rank',
    });
    await controller.start('ask');
    await nextTick();
    // target auto-filled despite the tutorial; rank is the active pick the learner
    // completes by clicking the 7 card on the board.
    expect(controller.currentPick.value?.name).toBe('rank');
  });

  it('BUG GUARD: action-wide suppressAutoFill (no scope) leaves the action stuck on target (board click would be dead)', async () => {
    const controller = makeController({
      id: 'ask-for-rank',
      gate: { action: 'ask' },
      suppressAutoFill: true,
    });
    await controller.start('ask');
    await nextTick();
    // The single opponent was NOT auto-filled → still on 'target' → a board card
    // click (which only fires on 'rank') does nothing. This is the bug the fix avoids.
    expect(controller.currentPick.value?.name).toBe('target');
  });
});
