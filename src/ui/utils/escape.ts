/**
 * Runs `act` for an Escape and marks the event handled (`defaultPrevented`), so a game
 * listening for Escape page-wide can skip one a BoardSmith dialog or popover acted on (#1524).
 * Call it only when the Escape does something; one that does nothing stays unmarked.
 */
export function handleEscape(event: KeyboardEvent, act: () => void): void {
  if (event.key !== 'Escape') return;
  // An Escape inside a game's modal <dialog> closes that dialog, which preventDefault would stop.
  const modal = event.target instanceof Element ? event.target.closest('dialog:modal') : null;
  if (modal && !modal.contains(event.currentTarget as Node)) return;
  event.preventDefault();
  act();
}
