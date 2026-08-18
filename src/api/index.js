/**
 * The one place the app talks to storage.
 *
 * Every adapter implements the same two methods:
 *   load()       -> Promise<state | null>   null means "nothing saved yet"
 *   save(state)  -> Promise<void>           throws on failure
 *
 * Nothing outside this folder should know whether that means localStorage,
 * an HTTP call, or something else — swap the adapter, not the UI.
 */
import { localAdapter } from './local.js';
import { remoteAdapter } from './remote.js';

const adapters = {
  local: localAdapter,
  remote: remoteAdapter
};

const requested = import.meta.env.VITE_DATA_BACKEND || 'local';

if (!adapters[requested]) {
  console.warn(`Unknown VITE_DATA_BACKEND "${requested}" — falling back to "local".`);
}

export const api = adapters[requested] || localAdapter;
