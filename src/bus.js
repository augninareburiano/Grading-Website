/**
 * Lets a module say "state changed, redraw" without importing render.js,
 * which would create an import cycle (render.js already imports every module).
 */
const listeners = new Set();

export function onRender(cb) {
  listeners.add(cb);
}

export function requestRender() {
  listeners.forEach(cb => cb());
}
