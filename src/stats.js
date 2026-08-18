import { state, getActiveSection } from './state.js';
import {
  assignmentStats,
  classFinalStats,
  formatPct,
  formatPoints,
  letterGrade
} from './grading.js';
import { escapeHtml, showToast } from './utils.js';
import { exportAssignmentCsv } from './export.js';

/**
 * Class statistics and the single-assignment breakdown.
 *
 * The point of these numbers is diagnostic: an assignment where the class
 * average collapses is usually a problem with the assignment, not with thirty
 * students at once. Averages therefore cover graded work only — counting
 * not-yet-handed-in work as zero would make every freshly set task look like a
 * disaster on the day it is created.
 */

let selectedAssignmentId = null;

export function initStats() {
  document.getElementById('assignmentPicker').addEventListener('change', e => {
    selectedAssignmentId = e.target.value;
    renderAssignmentPanel();
  });

  document.getElementById('exportAssignmentBtn').addEventListener('click', () => {
    const active = getActiveSection();
    const assignment = currentAssignment(active);
    if (!active || !assignment) {
      showToast('Pick an assignment first');
      return;
    }
    exportAssignmentCsv(active, assignment);
    showToast('CSV downloaded');
  });

  // Clicking a row in the statistics table jumps to that assignment's detail.
  document.getElementById('statsTable').addEventListener('click', e => {
    const row = e.target.closest('[data-assignment-id]');
    if (!row) return;
    selectedAssignmentId = row.dataset.assignmentId;
    document.querySelector('#reportTabs [data-panel="assignment"]').click();
  });
}

function currentAssignment(active) {
  if (!active) return null;
  return active.assignments.find(a => a.id === selectedAssignmentId)
    || active.assignments[0]
    || null;
}

/* ---------- panel: class statistics ---------- */

export function renderStatsPanel() {
  const active = getActiveSection();
  const summary = document.getElementById('statsSummary');
  const table = document.getElementById('statsTable');
  const empty = document.getElementById('statsEmpty');

  if (!active || !active.students.length || !active.assignments.length) {
    summary.innerHTML = '';
    table.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = 'Add students, assignments, and a few scores to see class statistics.';
    return;
  }
  empty.style.display = 'none';

  summary.innerHTML = classSummary(active);

  const rows = active.assignments.map(assignment => {
    const stats = assignmentStats(active, assignment, state.grading);
    const category = active.categories.find(c => c.id === assignment.categoryId);
    return `<tr data-assignment-id="${assignment.id}" title="Open this assignment's breakdown">
      <td>
        <span class="link-ish">${escapeHtml(assignment.name)}</span>
        ${hardFlag(stats)}
      </td>
      <td><span class="pill">${category ? escapeHtml(category.name) : '—'}</span></td>
      <td class="muted">${escapeHtml(assignment.type)}</td>
      <td class="mono muted">${escapeHtml(assignment.dueDate || '—')}</td>
      <td class="num mono">${assignment.max === 0 ? 'bonus' : assignment.max}</td>
      <td class="num mono">${stats.gradedCount}</td>
      <td class="num mono ${stats.missingCount ? 'warn-text' : 'muted'}">${stats.missingCount}</td>
      <td class="num mono muted">${stats.excusedCount}</td>
      <td class="num mono">${formatPoints(stats.meanPoints)}</td>
      <td class="num mono">${formatPoints(stats.medianPoints)}</td>
      <td class="num mono">${formatPoints(stats.highPoints)}</td>
      <td class="num mono">${formatPoints(stats.lowPoints)}</td>
      <td class="num mono strong">${formatPct(stats.meanPct, state.grading.rounding)}</td>
    </tr>`;
  }).join('');

  table.innerHTML = `<thead><tr>
      <th>Assignment</th><th>Category</th><th>Type</th><th>Due</th>
      <th class="num">Out of</th>
      <th class="num">Graded</th><th class="num">Missing</th><th class="num">Excused</th>
      <th class="num">Mean</th><th class="num">Median</th><th class="num">High</th><th class="num">Low</th>
      <th class="num">Mean %</th>
    </tr></thead><tbody>${rows}</tbody>`;
}

/** Flags an assignment the class as a whole struggled with. */
function hardFlag(stats) {
  if (stats.meanPct === null || stats.gradedCount < 3) return '';
  if (stats.meanPct >= 60) return '';
  return `<span class="flag flag-missing" title="The class average on this one is ${Math.round(stats.meanPct)}% — worth a second look at the assignment itself.">low average</span>`;
}

function classSummary(active) {
  const stats = classFinalStats(active, state.grading);
  const rounding = state.grading.rounding;

  const tiles = [
    ['Students', `${stats.total}`, `${stats.gradedCount} with a grade`],
    ['Class average', formatPct(stats.meanPct, rounding), letterFor(stats.meanPct)],
    ['Median', formatPct(stats.medianPct, rounding), letterFor(stats.medianPct)],
    ['High', formatPct(stats.highPct, rounding), letterFor(stats.highPct)],
    ['Low', formatPct(stats.lowPct, rounding), letterFor(stats.lowPct)]
  ];

  return tiles.map(([label, value, note]) => `<div class="stat-tile">
    <div class="st-label">${label}</div>
    <div class="st-value">${value}</div>
    <div class="st-note">${escapeHtml(note)}</div>
  </div>`).join('');
}

function letterFor(pct) {
  return pct === null ? 'no grades yet' : letterGrade(pct, state.grading).letter;
}

/* ---------- panel: one assignment across the class ---------- */

export function renderAssignmentPanel() {
  const active = getActiveSection();
  const picker = document.getElementById('assignmentPicker');
  const body = document.getElementById('assignmentReport');
  const empty = document.getElementById('assignmentEmpty');

  if (!active || !active.assignments.length) {
    picker.innerHTML = '<option value="">No assignments yet</option>';
    body.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = 'Add an assignment in Setup to see how the class did on it.';
    return;
  }
  empty.style.display = 'none';

  const assignment = currentAssignment(active);
  selectedAssignmentId = assignment.id;

  picker.innerHTML = active.assignments
    .map(a => `<option value="${a.id}" ${a.id === assignment.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`)
    .join('');

  const stats = assignmentStats(active, assignment, state.grading);
  const category = active.categories.find(c => c.id === assignment.categoryId);
  const rounding = state.grading.rounding;

  const meta = [
    category ? escapeHtml(category.name) : 'no category',
    escapeHtml(assignment.type),
    assignment.max === 0 ? 'extra credit only' : `out of ${assignment.max}`,
    assignment.dueDate ? `due ${escapeHtml(assignment.dueDate)}` : 'no due date'
  ].join('  ·  ');

  const tiles = [
    ['Mean', formatPoints(stats.meanPoints), formatPct(stats.meanPct, rounding)],
    ['Median', formatPoints(stats.medianPoints), formatPct(stats.medianPct, rounding)],
    ['High', formatPoints(stats.highPoints), formatPct(stats.highPct, rounding)],
    ['Low', formatPoints(stats.lowPoints), formatPct(stats.lowPct, rounding)],
    ['Graded', `${stats.gradedCount}`, `of ${stats.total}`],
    ['Missing', `${stats.missingCount}`, stats.excusedCount ? `${stats.excusedCount} excused` : 'counts as zero']
  ].map(([label, value, note]) => `<div class="stat-tile">
    <div class="st-label">${label}</div>
    <div class="st-value">${value}</div>
    <div class="st-note">${note}</div>
  </div>`).join('');

  // Highest first, so the shape of the class is readable at a glance; ungraded
  // and excused sink to the bottom where they read as "nothing to see".
  const ranked = [...stats.rows].sort((a, b) => rank(b) - rank(a));

  const rows = ranked.map(({ student, outcome }) => `<tr>
    <td>${escapeHtml(student.name)}</td>
    <td class="mono muted">${escapeHtml(student.studentId || '—')}</td>
    <td class="num mono">${scoreText(outcome, assignment)}</td>
    <td class="num mono">${outcome.state === 'graded' && assignment.max > 0
      ? formatPct((outcome.earned / assignment.max) * 100, rounding)
      : '—'}</td>
    <td>${statusBadge(outcome)}</td>
  </tr>`).join('');

  body.innerHTML = `
    <div class="assignment-head">
      <h4>${escapeHtml(assignment.name)}</h4>
      <div class="assignment-meta">${meta}</div>
    </div>
    <div class="stat-row">${tiles}</div>
    <table class="sheet-table">
      <thead><tr>
        <th>Student</th><th>ID</th><th class="num">Score</th><th class="num">%</th><th>Status</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function rank(row) {
  if (row.outcome.state === 'graded') return row.outcome.earned;
  if (row.outcome.state === 'missing') return -1;
  return -2; // ungraded and excused
}

function scoreText(outcome, assignment) {
  if (outcome.state === 'graded') {
    const points = formatPoints(outcome.earned);
    return assignment.max === 0 ? `+${points}` : `${points} / ${assignment.max}`;
  }
  if (outcome.state === 'missing') return `0 / ${assignment.max}`;
  return '—';
}

function statusBadge(outcome) {
  if (outcome.state === 'missing') return '<span class="flag flag-missing">missing</span>';
  if (outcome.state === 'excused') return '<span class="flag flag-excused">excused</span>';
  if (outcome.state === 'ungraded') return '<span class="flag">not graded</span>';
  if (outcome.penaltyPct > 0) {
    return `<span class="flag flag-late">${outcome.lateDays}d late · −${outcome.penaltyPct}%</span>`;
  }
  if (outcome.isExtraCredit) return '<span class="flag flag-bonus">extra credit</span>';
  return '';
}
