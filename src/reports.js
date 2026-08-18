import { state, getActiveSection } from './state.js';
import {
  computeStudentGrade,
  letterGrade,
  formatPct,
  classFinalStats
} from './grading.js';
import { escapeHtml, showToast } from './utils.js';
import { exportGradebookCsv } from './export.js';
import { renderStatsPanel, renderAssignmentPanel } from './stats.js';
import { courseHeading } from './course.js';

let search = '';
let panel = 'students';

const PANELS = {
  students: renderStudentReports,
  sheet: renderGradeSheet,
  stats: renderStatsPanel,
  assignment: renderAssignmentPanel
};

/**
 * The reports page: four views over the same numbers.
 *
 *   students    one card per student, the thing you hand to a parent
 *   sheet       the whole class on one printable page
 *   stats       per-assignment averages, for spotting a quiz that went wrong
 *   assignment  one assignment across the whole class
 *
 * Only the visible panel is rendered, and printing prints whichever one is
 * open — so "print" means "print what I am looking at".
 */
export function initReports() {
  document.getElementById('studentSearchReports').addEventListener('input', e => {
    search = e.target.value.toLowerCase();
    renderReports();
  });

  document.getElementById('printBtn').addEventListener('click', () => window.print());

  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    const active = getActiveSection();
    if (!active || !active.students.length) {
      showToast('Nothing to export yet');
      return;
    }
    exportGradebookCsv(active);
    showToast('CSV downloaded');
  });

  document.getElementById('reportTabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-panel]');
    if (!btn) return;
    panel = btn.dataset.panel;
    renderReports();
  });
}

export function renderReports() {
  const active = getActiveSection();

  document.getElementById('reportSub').textContent = active
    ? `${active.name} — weighted final grades, class statistics, and printable sheets.`
    : '';

  // The student search only applies to the two student-listing panels.
  const searchable = panel === 'students' || panel === 'sheet';
  document.getElementById('reportSearchBox').style.display = searchable ? '' : 'none';

  document.querySelectorAll('#reportTabs [data-panel]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === panel);
  });
  document.querySelectorAll('[data-panel-body]').forEach(el => {
    el.style.display = el.dataset.panelBody === panel ? '' : 'none';
  });

  document.querySelectorAll('[data-course-heading]').forEach(el => {
    const heading = courseHeading();
    el.textContent = heading;
    el.style.display = heading ? '' : 'none';
  });

  (PANELS[panel] || renderStudentReports)();
}

/** Students matching the search box, or all of them when it is empty. */
export function visibleStudents(active) {
  if (!search) return active.students;
  return active.students.filter(s =>
    s.name.toLowerCase().includes(search) ||
    String(s.studentId || '').toLowerCase().includes(search)
  );
}

function emptyMessage(active, node, list) {
  if (!active || !active.students.length) {
    node.style.display = 'block';
    node.textContent = 'Nothing to report yet — add students, categories, and scores first.';
    return true;
  }
  if (!list.length) {
    node.style.display = 'block';
    node.textContent = 'No students match your search.';
    return true;
  }
  node.style.display = 'none';
  return false;
}

/* ---------- panel: per-student reports ---------- */

function renderStudentReports() {
  const active = getActiveSection();
  const list = document.getElementById('reportList');
  const empty = document.getElementById('reportEmpty');
  const students = active ? visibleStudents(active) : [];

  if (emptyMessage(active, empty, students)) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = students.map(student => {
    const { final, catBreakdown } = computeStudentGrade(active, student.id, state.grading);
    const lg = letterGrade(final, state.grading);

    const breakdown = catBreakdown.length
      ? catBreakdown.map(c => `<span class="bd-item">
          ${escapeHtml(c.name)}
          <b>${formatPct(c.pct, state.grading.rounding)}</b>
          <i>${c.weight}%${c.droppedCount ? ` · ${c.droppedCount} dropped` : ''}</i>
        </span>`).join('')
      : '<span class="bd-item">No categories set up</span>';

    return `<div class="grade-card">
      <div class="gc-main">
        <div class="name">
          ${escapeHtml(student.name)}
          ${student.studentId ? `<span class="sid">${escapeHtml(student.studentId)}</span>` : ''}
        </div>
        <div class="breakdown">${breakdown}</div>
        ${flagLine(active, student.id)}
      </div>
      <div class="gc-grade">
        <div class="grade-badge" style="background:${lg.color}22;color:${lg.color};">
          ${formatPct(final, state.grading.rounding)}
        </div>
        <div class="grade-letter" style="color:${lg.color};">${escapeHtml(lg.letter)}</div>
      </div>
    </div>`;
  }).join('');
}

/** Counts of the things a teacher needs to chase, or nothing when all is well. */
function flagLine(active, studentId) {
  let missing = 0;
  let excused = 0;
  let ungraded = 0;

  active.assignments.forEach(a => {
    const entry = active.scores[studentId + '_' + a.id];
    if (!entry || (entry.status === 'graded' && entry.score === null)) ungraded++;
    else if (entry.status === 'missing') missing++;
    else if (entry.status === 'excused') excused++;
  });

  const parts = [];
  if (missing) parts.push(`<span class="flag flag-missing">${missing} missing</span>`);
  if (excused) parts.push(`<span class="flag flag-excused">${excused} excused</span>`);
  if (ungraded) parts.push(`<span class="flag">${ungraded} not graded yet</span>`);
  return parts.length ? `<div class="flags">${parts.join('')}</div>` : '';
}

/* ---------- panel: printable class grade sheet ---------- */

function renderGradeSheet() {
  const active = getActiveSection();
  const wrap = document.getElementById('gradeSheet');
  const empty = document.getElementById('sheetEmpty');
  const students = active ? visibleStudents(active) : [];

  if (emptyMessage(active, empty, students)) {
    wrap.innerHTML = '';
    return;
  }

  const head = `<tr>
    <th style="width:26px;">#</th>
    <th>Student</th>
    <th>ID</th>
    ${active.categories.map(c => `<th class="num">${escapeHtml(c.name)}<br><span class="wt">${c.weight}%</span></th>`).join('')}
    <th class="num">Final</th>
    <th class="num">Letter</th>
  </tr>`;

  const rows = students.map((student, i) => {
    const { final, catBreakdown } = computeStudentGrade(active, student.id, state.grading);
    const lg = letterGrade(final, state.grading);
    return `<tr>
      <td class="muted">${i + 1}</td>
      <td>${escapeHtml(student.name)}</td>
      <td class="mono muted">${escapeHtml(student.studentId || '—')}</td>
      ${catBreakdown.map(c => `<td class="num mono">${formatPct(c.pct, state.grading.rounding)}</td>`).join('')}
      <td class="num mono strong">${formatPct(final, state.grading.rounding)}</td>
      <td class="num strong" style="color:${lg.color};">${escapeHtml(lg.letter)}</td>
    </tr>`;
  }).join('');

  const stats = classFinalStats(active, state.grading);
  const span = 3 + active.categories.length;
  const summary = `<tr class="sheet-summary">
    <td colspan="${span}">Class average · median · high · low</td>
    <td class="num mono" colspan="2">
      ${formatPct(stats.meanPct, state.grading.rounding)} ·
      ${formatPct(stats.medianPct, state.grading.rounding)} ·
      ${formatPct(stats.highPct, state.grading.rounding)} ·
      ${formatPct(stats.lowPct, state.grading.rounding)}
    </td>
  </tr>`;

  wrap.innerHTML = `<table class="sheet-table">
    <thead>${head}</thead>
    <tbody>${rows}${summary}</tbody>
  </table>
  <p class="sheet-note">
    ${students.length} of ${active.students.length} students shown ·
    ${stats.gradedCount} with a grade so far ·
    ${escapeHtml(scaleSummary())}
  </p>`;
}

/** "A ≥ 90, B ≥ 80, …" — printed under the sheet so the cutoffs travel with it. */
export function scaleSummary() {
  return state.grading.scale
    .map(row => `${row.letter} ${row.min}+`)
    .join(', ');
}

