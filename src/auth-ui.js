import { api } from './api/index.js';
import { loadState } from './state.js';
import { requestRender } from './bus.js';
import { escapeHtml, showToast } from './utils.js';

/**
 * Account UI for adapters that have accounts.
 *
 * `api.auth` is optional — the localStorage build has no such thing, and in
 * that case none of this renders. Everything here talks to the adapter through
 * that interface, so swapping Firebase for something else does not touch it.
 *
 * The uid is tracked so a sign-in or sign-out reloads the gradebook exactly
 * once. Without that guard the callback that fires on subscribe would re-run
 * the load that boot() just did.
 */
let knownUid = null;

export function initAuth() {
  const box = document.getElementById('authBox');
  const banner = document.getElementById('authBanner');

  if (!api.auth) {
    box.style.display = 'none';
    banner.style.display = 'none';
    return;
  }

  box.style.display = '';
  box.addEventListener('click', async e => {
    const el = e.target.closest('[data-auth]');
    if (!el) return;
    if (el.dataset.auth === 'in') await signIn();
    if (el.dataset.auth === 'out') await signOut();
  });
  banner.addEventListener('click', async e => {
    if (e.target.closest('[data-auth="in"]')) await signIn();
  });

  const configError = api.auth.configError ? api.auth.configError() : null;
  if (configError) {
    renderConfigError(configError);
    return;
  }

  const user = api.auth.current();
  knownUid = user ? user.uid : null;
  renderAuth(user);

  api.auth.onChange(async next => {
    const uid = next ? next.uid : null;
    renderAuth(next);
    if (uid === knownUid) return; // same session, nothing to reload
    knownUid = uid;
    await loadState();
    requestRender();
    showToast(next ? `Signed in as ${next.name}` : 'Signed out');
  });
}

async function signIn() {
  try {
    await api.auth.signIn();
  } catch (e) {
    console.error('Sign-in failed', e);
    // A blocked popup is by far the most common cause and is invisible otherwise.
    const hint = String(e.code || '').includes('popup')
      ? 'the popup was blocked — allow popups for this site'
      : e.message || 'see the console';
    showToast(`Sign-in failed — ${hint}`);
  }
}

async function signOut() {
  if (!confirm('Sign out? Your gradebook stays saved to your account.')) return;
  try {
    await api.auth.signOut();
  } catch (e) {
    console.error('Sign-out failed', e);
    showToast('Sign-out failed — see the console');
  }
}

function renderAuth(user) {
  const box = document.getElementById('authBox');
  const banner = document.getElementById('authBanner');

  if (user) {
    box.innerHTML = `<div class="auth-user">
      ${user.photoURL
        ? `<img class="auth-avatar" src="${escapeHtml(user.photoURL)}" alt="">`
        : `<div class="auth-avatar auth-avatar-fallback">${escapeHtml(user.name.charAt(0).toUpperCase())}</div>`}
      <div class="auth-txt">
        <div class="auth-name">${escapeHtml(user.name)}</div>
        <div class="auth-sub">Synced to your account</div>
      </div>
      <button class="btn-icon" data-auth="out" title="Sign out">⎋</button>
    </div>`;
    banner.style.display = 'none';
    return;
  }

  box.innerHTML = `<button class="btn auth-signin" data-auth="in">
    Sign in with ${escapeHtml(api.auth.label || 'your account')}
  </button>
  <div class="auth-sub" style="margin-top:6px;">Sign in to load and save your gradebook.</div>`;

  banner.style.display = '';
  banner.innerHTML = `<span>You are signed out — changes will not be saved.</span>
    <button class="btn" data-auth="in">Sign in</button>`;
}

function renderConfigError(message) {
  const box = document.getElementById('authBox');
  const banner = document.getElementById('authBanner');

  box.innerHTML = `<div class="auth-sub">Backend unavailable.</div>`;
  banner.style.display = '';
  banner.className = 'auth-banner auth-banner-error no-print';
  banner.innerHTML = `<span><b>Firebase is not set up.</b> ${escapeHtml(message)}</span>`;
}
