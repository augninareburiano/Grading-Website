/**
 * HTTP adapter for a future backend. Not active until you set
 * VITE_DATA_BACKEND=remote in .env.local.
 *
 * It expects two endpoints:
 *   GET  {VITE_API_URL}/gradebook  -> 200 with the state JSON, or 404 if none saved yet
 *   PUT  {VITE_API_URL}/gradebook  -> accepts the state JSON as the body
 *
 * The shape on the wire is exactly the `state` object from state.js, so a
 * server can start as a thin JSON store and grow real tables later without
 * the UI changing.
 */
const BASE = import.meta.env.VITE_API_URL || '/api';

export const remoteAdapter = {
  name: 'remote',

  async load() {
    const res = await fetch(`${BASE}/gradebook`, { credentials: 'include' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Load failed: ${res.status} ${res.statusText}`);
    return res.json();
  },

  async save(state) {
    const res = await fetch(`${BASE}/gradebook`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(state)
    });
    if (!res.ok) throw new Error(`Save failed: ${res.status} ${res.statusText}`);
  }
};
