import { api } from './api/index.js';
import { uid, showToast } from './utils.js';
import { migrate, defaultCourse, defaultGrading, SCHEMA_VERSION } from './migrate.js';

/**
 * The whole app's data.
 *
 * {
 *   schemaVersion,
 *   course:  { name, term },                        // shown on every printed report
 *   grading: { scale, rounding, latePenalty },      // course-wide policy
 *   activeSectionId,
 *   sections: [{
 *     id, name,
 *     students:    [{ id, name, studentId, email }],
 *     categories:  [{ id, name, weight, dropLowest }],   weight is a percentage
 *     assignments: [{ id, name, categoryId, max, dueDate, type }],
 *     scores:      { "<studentId>_<assignmentId>": { score, status, lateDays } }
 *   }]
 * }
 *
 * Exported as a const and always mutated in place — reassigning it would leave
 * every importing module pointing at the old object.
 */
export const state = {
  schemaVersion: SCHEMA_VERSION,
  course: defaultCourse(),
  grading: defaultGrading(),
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
  clearTimeout(saveTimer); // a manual save cancels the pending debounced one
  try {
    await api.save(state);
    showToast('Saved');
  } catch (e) {
    console.error('Save failed', e);
    // Surface the reason — with a backend this is usually "signed out" or offline,
    // and a bare "Save failed" sends people hunting through the console.
    showToast(`Save failed — ${e.message || 'check the console'}`);
  }
}

/** Replaces everything in place from a loaded (and migrated) snapshot. */
function adopt(snapshot) {
  state.schemaVersion = snapshot.schemaVersion;
  state.course = snapshot.course;
  state.grading = snapshot.grading;
  state.activeSectionId = snapshot.activeSectionId;
  state.sections = snapshot.sections;
}

export async function loadState() {
  try {
    const data = await api.load();
    // migrate() also normalises a fresh/empty load, so there is one code path.
    adopt(migrate(data));
  } catch (e) {
    console.error('Load failed — starting with an empty gradebook', e);
    adopt(migrate(null));
    showToast(`Could not load — ${e.message || 'starting empty'}`);
  }
  ensureAtLeastOneSection();
}
