import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The Firebase adapter's failure mode.
 *
 * Real Firestore round trips need a project and are not tested here. What is
 * tested is the path that actually bites during setup and deploys: config that
 * is missing or half-filled. The adapter must stay importable and report the
 * problem in words, because the alternative — throwing at import time — takes
 * the whole app down with a blank page and a stack trace.
 */
describe('firebase adapter without configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  async function adapter() {
    const module = await import('./firebase.js');
    return module.firebaseAdapter;
  }

  it('imports cleanly even with nothing configured', async () => {
    await expect(adapter()).resolves.toBeDefined();
  });

  it('names the variables that are missing', async () => {
    const error = (await adapter()).auth.configError();
    expect(error).toContain('VITE_FIREBASE_API_KEY');
    expect(error).toContain('VITE_FIREBASE_PROJECT_ID');
    expect(error).toContain('.env.local');
  });

  it('still names what is missing when the config is only half filled', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'test.firebaseapp.com');
    const error = (await adapter()).auth.configError();
    expect(error).not.toContain('VITE_FIREBASE_API_KEY');
    expect(error).toContain('VITE_FIREBASE_PROJECT_ID');
    expect(error).toContain('VITE_FIREBASE_APP_ID');
  });

  it('reports no signed-in user rather than throwing', async () => {
    expect((await adapter()).auth.current()).toBeNull();
  });

  it('hands back a no-op unsubscribe when it cannot subscribe', async () => {
    const stop = (await adapter()).auth.onChange(() => {});
    expect(() => stop()).not.toThrow();
  });

  it('fails the load with the configuration message', async () => {
    await expect((await adapter()).load()).rejects.toThrow(/not configured/);
  });

  it('refuses to save rather than silently dropping the data', async () => {
    await expect((await adapter()).save({})).rejects.toThrow();
  });
});

describe('adapter selection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('defaults to localStorage', async () => {
    const { api } = await import('./index.js');
    expect(api.name).toBe('local');
    expect(api.auth).toBeUndefined(); // so no account UI renders
  });

  it('falls back to localStorage on an unknown backend name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('VITE_DATA_BACKEND', 'postgres-please');
    const { api } = await import('./index.js');
    expect(api.name).toBe('local');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('loads the firebase adapter when asked for it', async () => {
    vi.stubEnv('VITE_DATA_BACKEND', 'firebase');
    const { api } = await import('./index.js');
    expect(api.name).toBe('firebase');
    expect(api.auth).toBeDefined();
  });

  it('loads the remote adapter when asked for it', async () => {
    vi.stubEnv('VITE_DATA_BACKEND', 'remote');
    const { api } = await import('./index.js');
    expect(api.name).toBe('remote');
  });
});
