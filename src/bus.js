/**
 * Lets a module say "state changed, redraw" without importing render.js,
 * which would create an import cycle (render.js already imports every module).
 *
 * It also tracks which pages have fallen out of date. Only the page you are
 * looking at is redrawn when state changes; the others are flagged here and
 * redrawn when you next open them. That is what keeps adding a student from
 * rebuilding a 150-row score matrix nobody is looking at.
 */
const listeners = new Set();

export function onRender(cb) {
  listeners.add(cb);
}

export function requestRender() {
  listeners.forEach(cb => cb());
}

/* ---------- page staleness ---------- */

const stale = new Set();

/**
 * Flags pages as needing a redraw before they are shown again.
 *
 * Most changes go through requestRender() and are handled for you. Call this
 * directly for the edits that deliberately skip a redraw — typing a score
 * patches its own cell in place, but it still changes every report.
 */
export function invalidate(...pages) {
  pages.forEach(page => stale.add(page));
}

/** True if the page needs redrawing, and clears the flag. */
export function consumeStale(page) {
  return stale.delete(page);
}
