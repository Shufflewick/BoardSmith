# Debug Panel Enhancement Plan

**STATUS: IMPLEMENTED**

Based on comparison between `features/10-debug-panel.md` and current `DebugPanel.vue` implementation.

## Current State

The existing DebugPanel provides:
- ✅ Collapsible drawer UI
- ✅ Player perspective switching
- ✅ Game restart
- ✅ Basic state summary (Game ID, Phase, Current Player)
- ✅ Raw JSON state view
- ✅ Copy/download state

## Implementation Plan

### Phase 1: Expandable State Tree
**Priority: High**

Replace raw JSON with an interactive tree view that:
- Expands/collapses nested objects and arrays
- Shows type indicators (object, array, string, number, boolean)
- Highlights changed values
- Supports search/filter

**Files to modify:**
- `packages/ui/src/components/DebugPanel.vue` - Add TreeNode component

### Phase 2: Action Execution Panel
**Priority: High**

Add ability to:
- List all available actions with their validity status
- Show action selections/parameters
- Execute actions directly from debug panel

**Requires:**
- Access to `gameView.actions` from GameShell
- Selection input components for different types

### Phase 3: Keyboard Shortcuts
**Priority: Medium**

- `D` key to toggle debug panel (when not in input)
- Focus trap when panel is open

### Phase 4: History/Time Travel (Future)
**Priority: Low**

- Track action history
- Scrub through past states
- Requires server-side history API

---

## Implementation Status

### Phase 1: Expandable State Tree ✅ COMPLETE
- [x] Create TreeNode component for recursive rendering (inline in template)
- [x] Replace raw JSON pre with tree view (4 levels deep, then JSON fallback)
- [x] Add expand/collapse all buttons
- [x] Add search functionality
- [x] Color-coded types (string=green, number=blue, boolean=orange, array=purple, object=cyan, null=red)
- [x] Game info summary bar (ID, Phase, Turn)

### Phase 2: Action Execution Panel ✅ COMPLETE
- [x] Add actions prop to DebugPanel
- [x] List available actions with validity
- [x] Execute action on button click (emits `execute-action` event)
- [x] Shows action prompt text

### Phase 3: Keyboard Shortcuts ✅ COMPLETE
- [x] Add keyboard listener for 'D' key
- [x] Ignores keypress when in input fields
- [x] Shows shortcut in Settings tab with kbd styling

### Phase 4: History/Time Travel ⏳ DEFERRED
- Not implementing in this phase

## Files Modified

| File | Changes |
|------|---------|
| `packages/ui/src/components/DebugPanel.vue` | Tree view, action execution, keyboard shortcuts |

## New Features Summary

1. **Expandable State Tree**
   - Click arrows to expand/collapse nodes
   - 4 levels of nesting, then JSON for deeper objects
   - Type-colored values for quick scanning
   - Search box filters visible keys

2. **Action Buttons**
   - Lists game actions from `actions` prop
   - Click to emit `execute-action` event
   - "No actions available" message when empty

3. **Keyboard Shortcut**
   - Press `D` to toggle panel open/close
   - Shown in header and Settings tab

4. **UI Improvements**
   - Wider panel (420px vs 380px)
   - Better button layout in state actions bar
   - Game summary bar at top of tree view
