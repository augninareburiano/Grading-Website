/**
 * Browser-local adapter. Works today, no server needed.
 * Data lives in this browser only — clearing site data wipes it.
 */
const STORAGE_KEY = 'grading-system-data-v2';

export const localAdapter = {
  name: 'local',

  async load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  },

  async save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
};
