import { api } from './api/index.js';
import { uid, showToast } from './utils.js';

/**
 * The whole app's data.
 *
 * sections: [{
 *   id, name,
 *   students:    [{ id, name }],
 *   categories:  [{ id, name, weight }],          weight is a percentage
 *   assignments: [{ id, name, categoryId, max }],
 *   scores:      { "<studentId>_<assignmentId>": { score, excused } }
 * }]
 *
 * Exported as a const and always mutated in place — reassigning it would
 * leave every importing module pointing at the old object.
 */
export const state = {
  activeSectionId: null,
  sections: []
};

export function createSection(name) {
  return { id: uid(), name, students: [], categories: [], assignments: [], scores: {} };
}

export function getActiveSection() {
  return state.sections.find(s => s.id === state.activeSectionId) || null;
}

export function ensureAtLeastOneSection() {
  if (state.sections.length === 0) {
    const s = createSection('Section 1');
    state.sections.push(s);
    state.activeSectionId = s.id;
  } else if (!getActiveSection()) {
    state.activeSectionId = state.sections[0].id;
  }
}

/* ---------- PERSISTENCE ---------- */

let saveTimer = null;

/** Coalesces bursts of edits (typing in the score matrix) into one write. */
export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 400);
}

export async function saveState() {
  try {
    await api.save(state);
    showToast('Saved');
  } catch (e) {
    console.error('Save failed', e);
    showToast('Save failed — check the console');
  }
}

export async function loadState() {
  try {
    const data = await api.load();
    if (data && Array.isArray(data.sections)) {
      state.sections = data.sections;
      state.activeSectionId = data.activeSectionId;
    }
  } catch (e) {
    console.error('Load failed — starting with an empty gradebook', e);
  }
  ensureAtLeastOneSection();
}
