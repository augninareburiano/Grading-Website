import { state, getActiveSection, scheduleSave } from './state.js';
import { invalidate } from './bus.js';
import { escapeHtml } from './utils.js';
import { computeStudentGrade, letterGrade, formatPct, scoreOutcome } from './grading.js';

let search = '';
let page = 0;
let pageSize = 50;
let lastSectionId = null;

const PAGE_SIZES = [25, 50, 100, 0]; // 0 means "everyone"

const STATUS_LABELS = {
  graded: '–',
  missing: 'Missing',
  excused: 'Excused'
};

/**
 * The score matrix.
 *
 * Every cell carries three things: the score, a status, and (when the late
 * policy is on) how many days late the work was. Status is the important
 * addition — "nothing entered yet" and "did not hand it in" look the same on
 * paper but pull a grade in completely different directions.
 *
 * Two things keep this affordable at 150 students. Rows are paged, because a
 * full class times a term of assignments is tens of thousands of form controls
 * and no browser enjoys that. And edits patch the DOM in place instead of
 * triggering a redraw: `change` fires as focus leaves a cell, so re-rendering
 * the table would destroy the element the user just tabbed into.
 */
export function initGrades() {
  document.getElementById('studentSearchGrades').addEventListener('input', e => {
    search = e.target.value.toLowerCase();
    page = 0; // a new search starts at the top of its own results
    renderGradesMatrix();
  });

  // Delegated so the matrix can be re-rendered freely without re-binding.
  document.getElementById('gradesMatrix').addEventListener('change', e => {
    const el = e.target;
    if (el.matches('[data-action="score"]')) setScore(el.dataset.key, el.value);
    if (el.matches('[data-action="status"]')) setStatus(el.dataset.key, el.value);
    if (el.matches('[data-action="late"]')) setLate(el.dataset.key, el.value);
  });

  document.getElementById('matrixPager').addEventListener('click', e => {
    const el = e.target.closest('[data-page-nav]');
    if (!el) return;
    page += el.dataset.pageNav === 'next' ? 1 : -1;
    renderGradesMatrix();
    document.querySelector('.matrix-wrap').scrollTop = 0;
  });

  document.getElementById('matrixPageSize').addEventListener('change', e => {
    pageSize = Number(e.target.value) || 0;
    page = 0;
    renderGradesMatrix();
  });
}

function entryFor(section, key) {
  if (!section.scores[key]) section.scores[key] = { score: null, status: 'graded', lateDays: 0 };
  return section.scores[key];
}

function splitKey(key) {
  const cut = key.indexOf('_');
  return { studentId: key.slice(0, cut), assignmentId: key.slice(cut + 1) };
}

function setScore(key, value) {
  const active = getActiveSection();
  if (!active) return;
  const entry = entryFor(active, key);
  const parsed = value === '' ? null : Number(value);
  // No upper clamp — a score above the max is extra credit, which is allowed.
  entry.score = parsed === null || !Number.isFinite(parsed) ? null : Math.max(0, parsed);
  commit(active, key);
}

function setStatus(key, value) {
  const active = getActiveSection();
  if (!active) return;
  const entry = entryFor(active, key);
  entry.status = ['graded', 'missing', 'excused'].includes(value) ? value : 'graded';
  commit(active, key);
}

function setLate(key, value) {
  const active = getActiveSection();
  if (!active) return;
  const entry = entryFor(active, key);
  const days = Number(value);
  entry.lateDays = Number.isFinite(days) ? Math.max(0, Math.round(days)) : 0;
  commit(active, key);
}

/**
 * Saves, then repaints only the cell that changed and the student's final.
 * Nothing else on this page moved — but every report just changed, so those are
 * flagged to redraw when they are next opened.
 */
function commit(active, key) {
  const { studentId, assignmentId } = splitKey(key);
  pruneEmpty(active, key);
  scheduleSave();
  refreshCell(active, studentId, assignmentId);
  refreshFinal(active, studentId);
  invalidate('reports');
}

/** An untouched cell is not worth storing — see the same rule in migrate.js. */
function pruneEmpty(active, key) {
  const entry = active.scores[key];
  if (entry && entry.status === 'graded' && entry.score === null && !entry.lateDays) {
    delete active.scores[key];
  }
}

/* ---------- rendering ---------- */

export function renderGradesMatrix() {
  const active = getActiveSection();
  const table = document.getElementById('gradesMatrix');
  const empty = document.getElementById('matrixEmpty');
  const pager = document.getElementById('matrixPager');

  // Switching sections lands you back at the first page of the new roster.
  if (active && active.id !== lastSectionId) {
    lastSectionId = active.id;
    page = 0;
  }

  if (!active || !active.students.length || !active.assignments.length) {
    table.innerHTML = '';
    pager.style.display = 'none';
    empty.style.display = 'block';
    empty.textContent = 'Add students and assignments in Setup first.';
    return;
  }

  const filtered = active.students.filter(s => s.name.toLowerCase().includes(search));
  if (!filtered.length) {
    table.innerHTML = '';
    pager.style.display = 'none';
    empty.style.display = 'block';
    empty.textContent = 'No students match your search.';
    return;
  }
  empty.style.display = 'none';

  const size = pageSize || filtered.length;
  const pageCount = Math.max(1, Math.ceil(filtered.length / size));
  page = Math.min(Math.max(0, page), pageCount - 1); // a delete can strand you past the end
  const start = page * size;
  const shown = filtered.slice(start, start + size);

  table.innerHTML = header(active) + body(active, shown);
  renderPager(filtered.length, start, shown.length, pageCount);
  renderLegend();
}

function renderPager(total, start, count, pageCount) {
  const pager = document.getElementById('matrixPager');
  // Nothing to page through, and no size worth choosing, so stay out of the way.
  pager.style.display = total <= PAGE_SIZES[0] && pageCount === 1 ? 'none' : '';

  document.getElementById('matrixPagerInfo').textContent =
    `Showing ${start + 1}–${start + count} of ${total} student${total === 1 ? '' : 's'}`;
  document.getElementById('matrixPageLabel').textContent = `Page ${page + 1} of ${pageCount}`;

  pager.querySelector('[data-page-nav="prev"]').disabled = page === 0;
  pager.querySelector('[data-page-nav="next"]').disabled = page >= pageCount - 1;

  const select = document.getElementById('matrixPageSize');
  if (!select.options.length) {
    select.innerHTML = PAGE_SIZES
      .map(n => `<option value="${n}">${n ? n + ' per page' : 'Everyone'}</option>`)
      .join('');
  }
  select.value = String(pageSize);
}

function header(active) {
  const columns = active.assignments.map(a => {
    const cat = active.categories.find(c => c.id === a.categoryId);
    const due = a.dueDate ? `<div class="due-header">due ${escapeHtml(a.dueDate)}</div>` : '';
    return `<th>
      <div class="cat-header">${cat ? escapeHtml(cat.name) : ''}</div>
      ${escapeHtml(a.name)}<br>
      <span class="max-header">${a.max === 0 ? 'bonus' : '/ ' + a.max}</span>
      ${due}
    </th>`;
  }).join('');

  return `<thead><tr><th>Student</th>${columns}<th class="final-header">Final</th></tr></thead>`;
}

function body(active, students) {
  const lateOn = state.grading.latePenalty.enabled;

  return `<tbody>${students.map(student => {
    const cells = active.assignments
      .map(a => cell(active, student.id, a, lateOn))
      .join('');
    return `<tr>
      <td class="student-cell">${escapeHtml(student.name)}</td>
      ${cells}
      ${finalCell(active, student.id)}
    </tr>`;
  }).join('')}</tbody>`;
}

function cell(active, studentId, assignment, lateOn) {
  const key = studentId + '_' + assignment.id;
  const entry = active.scores[key] || { score: null, status: 'graded', lateDays: 0 };
  const outcome = scoreOutcome(entry, assignment, state.grading);
  const scoreDisabled = entry.status !== 'graded';
  const value = entry.score === null || entry.score === undefined ? '' : entry.score;

  const lateField = lateOn ? `
    <input type="number" class="late-input" min="0" step="1" value="${entry.lateDays || ''}"
      data-action="late" data-key="${key}" placeholder="0d" title="Days late"
      ${scoreDisabled ? 'disabled' : ''} aria-label="Days late">` : '';

  return `<td class="cell-${entry.status}" data-cell="${key}">
    <input type="number" class="score-input ${outcome.isExtraCredit ? 'extra-credit' : ''}"
      min="0" step="0.5" value="${value}" ${scoreDisabled ? 'disabled' : ''}
      data-action="score" data-key="${key}" placeholder="—"
      title="${scoreTitle(outcome, assignment)}" aria-label="Score">
    <div class="cell-controls">
      <select class="status-select" data-action="status" data-key="${key}" aria-label="Status">
        ${Object.entries(STATUS_LABELS).map(([v, label]) =>
          `<option value="${v}" ${v === entry.status ? 'selected' : ''}>${label}</option>`
        ).join('')}
      </select>
      ${lateField}
    </div>
  </td>`;
}

function scoreTitle(outcome, assignment) {
  if (outcome.penaltyPct > 0) {
    const counted = Math.round(outcome.earned * 100) / 100;
    return `${outcome.lateDays} day(s) late — ${outcome.penaltyPct}% off, counts as ${counted} / ${assignment.max}`;
  }
  if (outcome.isExtraCredit) return `Above the ${assignment.max} point maximum — counts as extra credit`;
  return '';
}

function finalCell(active, studentId) {
  const { final } = computeStudentGrade(active, studentId, state.grading);
  const lg = letterGrade(final, state.grading);
  return `<td class="final-cell" data-final="${studentId}" style="color:${lg.color};">
    ${formatPct(final, state.grading.rounding)}
    <span class="final-letter">${escapeHtml(lg.letter)}</span>
  </td>`;
}

/* ---------- targeted refreshes ---------- */

function refreshCell(active, studentId, assignmentId) {
  const assignment = active.assignments.find(a => a.id === assignmentId);
  const td = document.querySelector(`[data-cell="${studentId}_${assignmentId}"]`);
  if (!td || !assignment) return;

  const key = studentId + '_' + assignmentId;
  const entry = active.scores[key] || { score: null, status: 'graded', lateDays: 0 };
  const outcome = scoreOutcome(entry, assignment, state.grading);
  const disabled = entry.status !== 'graded';

  td.className = `cell-${entry.status}`;

  const scoreInput = td.querySelector('[data-action="score"]');
  scoreInput.disabled = disabled;
  scoreInput.classList.toggle('extra-credit', outcome.isExtraCredit);
  scoreInput.title = scoreTitle(outcome, assignment);

  const lateInput = td.querySelector('[data-action="late"]');
  if (lateInput) lateInput.disabled = disabled;
}

function refreshFinal(active, studentId) {
  const td = document.querySelector(`[data-final="${studentId}"]`);
  if (!td) return;
  const { final } = computeStudentGrade(active, studentId, state.grading);
  const lg = letterGrade(final, state.grading);
  td.style.color = lg.color;
  td.innerHTML = `${formatPct(final, state.grading.rounding)}<span class="final-letter">${escapeHtml(lg.letter)}</span>`;
}

function renderLegend() {
  const legend = document.getElementById('matrixLegend');
  const late = state.grading.latePenalty;
  const parts = [
    'Blank = not graded yet, and left out of the average',
    'Missing = counts as zero',
    'Excused = left out of the average entirely'
  ];
  if (late.enabled) {
    parts.push(`Days late = −${late.percentPerDay}%/day, up to −${late.maxPercent}%`);
  }
  legend.textContent = parts.join('  ·  ');
}
