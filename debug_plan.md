# Debug Panel Enhancement Plan

**STATUS: IN PROGRESS**

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

### Phase 1: Expandable State Tree ⏳ IN PROGRESS
- [ ] Create TreeNode component for recursive rendering
- [ ] Replace raw JSON pre with tree view
- [ ] Add expand/collapse all buttons
- [ ] Add search functionality

### Phase 2: Action Execution Panel ⏳ PENDING
- [ ] Add actions prop to DebugPanel
- [ ] List available actions with validity
- [ ] Create selection input components
- [ ] Execute action on button click

### Phase 3: Keyboard Shortcuts ⏳ PENDING
- [ ] Add keyboard listener for 'D' key
- [ ] Emit toggle event from GameShell

### Phase 4: History/Time Travel ⏳ DEFERRED
- Not implementing in this phase

## Files Modified

| File | Changes |
|------|---------|
| `packages/ui/src/components/DebugPanel.vue` | Tree view, action execution, keyboard shortcuts |
