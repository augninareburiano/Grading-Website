/**
 * The one place the app talks to storage.
 *
 * Every adapter implements the same two methods:
 *   load()       -> Promise<state | null>   null means "nothing saved yet"
 *   save(state)  -> Promise<void>           throws on failure
 *
 * An adapter that knows who the user is may also expose `auth`:
 *   auth.label            what to call the sign-in button
 *   auth.current()        -> { uid, name, email, photoURL } | null
 *   auth.configError()    -> string | null, why the adapter cannot work
 *   auth.onChange(cb)     -> unsubscribe
 *   auth.signIn() / auth.signOut()
 * The sign-in bar renders only when `api.auth` exists, so the localStorage
 * build shows no account UI at all.
 *
 * Nothing outside this folder should know whether that means localStorage, an
 * HTTP call, or Firestore — swap the adapter, not the UI.
 */
const BACKENDS = ['local', 'firebase', 'remote'];

const requested = import.meta.env.VITE_DATA_BACKEND || 'local';

/**
 * Adapters are imported one branch at a time, compared against a literal.
 * VITE_DATA_BACKEND is inlined at build time, so the branches that were not
 * chosen fold away and their adapters never reach the bundle — a localStorage
 * build ships no Firebase SDK at all.
 */
async function selectAdapter() {
  if (requested === 'firebase') return (await import('./firebase.js')).firebaseAdapter;
  if (requested === 'remote') return (await import('./remote.js')).remoteAdapter;

  if (requested !== 'local') {
    console.warn(
      `Unknown VITE_DATA_BACKEND "${requested}" — falling back to "local". ` +
      `Valid values: ${BACKENDS.join(', ')}.`
    );
  }
  return (await import('./local.js')).localAdapter;
}

/**
 * The top-level await resolves before any importing module runs, so `api` is
 * always ready at the point of use.
 */
export const api = await selectAdapter();
