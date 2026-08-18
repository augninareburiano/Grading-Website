import { loadState } from './state.js';
import { onRender } from './bus.js';
import { renderAll } from './render.js';
import { initNav } from './nav.js';
import { initSections } from './sections.js';
import { initStudents } from './students.js';
import { initCategories } from './categories.js';
import { initAssignments } from './assignments.js';
import { initGrades } from './grades.js';
import { initReports } from './reports.js';

async function boot() {
  // Any module can call requestRender() after mutating state.
  onRender(renderAll);

  initNav();
  initSections();
  initStudents();
  initCategories();
  initAssignments();
  initGrades();
  initReports();

  await loadState();
  renderAll();
}

boot();
