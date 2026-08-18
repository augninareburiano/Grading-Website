/**
 * Firebase adapter — Firestore for the data, Google sign-in for who owns it.
 *
 * Each teacher's whole gradebook is one document at `gradebooks/{uid}`. That
 * keeps the load()/save() contract the rest of the app already speaks, and the
 * security rule that goes with it is a one-liner (see README). A classroom-sized
 * gradebook is far below Firestore's 1MB document ceiling; if a school ever
 * outgrows it, the split is per-section documents behind this same interface.
 *
 * Nothing here runs until the adapter is actually selected — api/index.js
 * imports it dynamically, so a localStorage build never ships the SDK.
 */
import { initializeApp, getApps } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut
} from 'firebase/auth';
import {
  doc,
  getDoc,
  initializeFirestore,
  persistentLocalCache,
  setDoc
} from 'firebase/firestore';

const CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const REQUIRED = ['apiKey', 'authDomain', 'projectId', 'appId'];

let services = null;

/**
 * Built on first use rather than at import time, so a missing key surfaces as a
 * readable message in the UI instead of a blank page and a stack trace.
 */
function firebase() {
  if (services) return services;

  const missing = REQUIRED.filter(key => !CONFIG[key]);
  if (missing.length) {
    throw new Error(
      `Firebase is not configured — missing ${missing
        .map(k => 'VITE_FIREBASE_' + k.replace(/[A-Z]/g, c => '_' + c).toUpperCase())
        .join(', ')}. Copy .env.example to .env.local and fill it in.`
    );
  }

  const app = getApps().length ? getApps()[0] : initializeApp(CONFIG);
  services = {
    app,
    auth: getAuth(app),
    // The local cache lets a teacher keep entering grades through a dead wifi
    // patch; writes queue and flush when the connection comes back.
    db: initializeFirestore(app, { localCache: persistentLocalCache() })
  };
  return services;
}

/** Resolves once the SDK has decided whether a session is already signed in. */
function firstAuthResult() {
  const { auth } = firebase();
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(auth, user => { stop(); resolve(user); }, reject);
  });
}

function gradebookRef(uid) {
  return doc(firebase().db, 'gradebooks', uid);
}

function shape(user) {
  if (!user) return null;
  return {
    uid: user.uid,
    name: user.displayName || user.email || 'Signed in',
    email: user.email || '',
    photoURL: user.photoURL || ''
  };
}

export const firebaseAdapter = {
  name: 'firebase',

  async load() {
    const user = await firstAuthResult();
    // Signed out is not an error — the app renders empty behind the sign-in prompt.
    if (!user) return null;
    const snap = await getDoc(gradebookRef(user.uid));
    return snap.exists() ? snap.data() : null;
  },

  async save(state) {
    const user = firebase().auth.currentUser;
    if (!user) throw new Error('signed out');
    // Firestore rejects undefined, and the state object is plain JSON by
    // construction — this round trip is the cheap guarantee of that.
    await setDoc(gradebookRef(user.uid), JSON.parse(JSON.stringify(state)));
  },

  /**
   * Optional capability. api/index.js documents it: adapters that can identify a
   * user expose `auth`, and the sign-in bar renders only when this is present.
   */
  auth: {
    label: 'Google',

    current() {
      try {
        return shape(firebase().auth.currentUser);
      } catch {
        return null; // unconfigured — configError() has the detail
      }
    },

    /** The reason the adapter is unusable, or null when it is fine. */
    configError() {
      try {
        firebase();
        return null;
      } catch (e) {
        return e.message;
      }
    },

    onChange(callback) {
      try {
        return onAuthStateChanged(firebase().auth, user => callback(shape(user)));
      } catch {
        return () => {};
      }
    },

    async signIn() {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(firebase().auth, provider);
      return shape(result.user);
    },

    async signOut() {
      await fbSignOut(firebase().auth);
    }
  }
};
