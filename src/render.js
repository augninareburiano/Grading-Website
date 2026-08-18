import { getActiveSection } from './state.js';
import { invalidate, consumeStale } from './bus.js';
import { renderSectionSwitcher, renderSectionList } from './sections.js';
import { renderCourse } from './course.js';
import { renderStudents } from './students.js';
import { renderRosterImport } from './roster-import.js';
import { renderCategories } from './categories.js';
import { renderAssignments } from './assignments.js';
import { renderSettings } from './settings.js';
import { renderGradesMatrix } from './grades.js';
import { renderReports } from './reports.js';

/**
 * Redraws the sidebar and whichever page is open, and flags the rest to be
 * redrawn when they are next shown.
 *
 * Redrawing everything was fine at one class of thirty. At 150 students the
 * score matrix alone is tens of thousands of nodes, and rebuilding it on every
 * keystroke in Setup — where it is not even on screen — is most of the cost for
 * none of the benefit.
 *
 * Two places still opt out of a redraw entirely, because it would fight the
 * user: the score matrix patches individual cells as you tab through them, and
 * free-text fields skip themselves while focused.
 */
const PAGES = {
  setup: renderSetupPage,
  grades: renderGradesMatrix,
  reports: renderReports,
  settings: renderSettings
};

let currentPage = 'setup';

/** The sidebar and headings, which are visible on every page. */
function renderChrome() {
  renderSectionSwitcher();
  renderCourse();
}

function renderSetupPage() {
  const active = getActiveSection();
  renderSectionList();
  document.getElementById('courseNameInput').value = active ? active.name : '';
  renderStudents();
  renderRosterImport();
  renderCategories();
  renderAssignments();
}

export function renderAll() {
  renderChrome();

  Object.keys(PAGES).forEach(page => {
    if (page === currentPage) {
      consumeStale(page);
      PAGES[page]();
    } else {
      invalidate(page);
    }
  });
}

/**
 * Called by nav.js when a page becomes visible. Redraws it only if something
 * changed while it was hidden, so flipping between tabs is free.
 */
export function activatePage(page) {
  currentPage = page;
  if (PAGES[page] && consumeStale(page)) PAGES[page]();
}

/** Which page is open — the matrix uses it to skip work it cannot show. */
export function getCurrentPage() {
  return currentPage;
}
