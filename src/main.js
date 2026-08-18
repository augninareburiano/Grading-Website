import { loadState } from './state.js';
import { onRender } from './bus.js';
import { renderAll } from './render.js';
import { initNav } from './nav.js';
import { initSections } from './sections.js';
import { initCourse } from './course.js';
import { initStudents } from './students.js';
import { initRosterImport } from './roster-import.js';
import { initCategories } from './categories.js';
import { initAssignments } from './assignments.js';
import { initSettings } from './settings.js';
import { initGrades } from './grades.js';
import { initReports } from './reports.js';
import { initStats } from './stats.js';
import { initAuth } from './auth-ui.js';

async function boot() {
  // Any module can call requestRender() after mutating state.
  onRender(renderAll);

  initNav();
  initSections();
  initCourse();
  initStudents();
  initRosterImport();
  initCategories();
  initAssignments();
  initSettings();
  initGrades();
  initReports();
  initStats();

  await loadState();
  renderAll();

  // After the first load, so its auth callback can tell a real sign-in change
  // from the session that boot() already loaded.
  initAuth();
}

boot();
