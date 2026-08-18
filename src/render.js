import { getActiveSection } from './state.js';
import { renderSectionSwitcher, renderSectionList } from './sections.js';
import { renderStudents } from './students.js';
import { renderCategories } from './categories.js';
import { renderAssignments } from './assignments.js';
import { renderGradesMatrix } from './grades.js';
import { renderReports } from './reports.js';

/**
 * Redraws everything. Cheap at classroom scale, and it means no module has to
 * know which other views its change affects.
 */
export function renderAll() {
  const active = getActiveSection();

  renderSectionSwitcher();
  renderSectionList();
  document.getElementById('courseNameInput').value = active ? active.name : '';
  renderStudents();
  renderCategories();
  renderAssignments();
  renderGradesMatrix();
  renderReports();
}
