import { state } from './state.js';
import {
  computeStudentGrade,
  letterGrade,
  scoreOutcome,
  assignmentStats,
  roundPct
} from './grading.js';

/**
 * CSV export — for pushing grades into an LMS or keeping a backup that outlives
 * this app. Separate from printing: print is for people, this is for machines.
 *
 * Percentages are written as bare numbers (no % sign) because that is what
 * spreadsheets and LMS importers can actually parse.
 */

/** RFC 4180 quoting: wrap anything with a comma, quote, or newline. */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

function slug(text) {
  return String(text || '')
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'gradebook';
}

/** Excel only reads a CSV as UTF-8 when it starts with a byte-order mark. */
const BOM = String.fromCharCode(0xFEFF);

/**
 * Hands the file to the browser.
 */
function download(filename, csv) {
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileStem(section) {
  return [state.course.name, state.course.term, section.name]
    .filter(Boolean)
    .map(slug)
    .join('-');
}

/** What a single cell says in a spreadsheet: a number, or why there is no number. */
function cellText(outcome) {
  if (outcome.state === 'excused') return 'Excused';
  if (outcome.state === 'missing') return 'Missing';
  if (outcome.state === 'ungraded') return '';
  return round2(outcome.earned);
}

function round2(n) {
  return n === null || n === undefined || !Number.isFinite(n) ? '' : Math.round(n * 100) / 100;
}

/**
 * The whole section: one row per student, one column per assignment, plus the
 * category percentages and the final grade.
 */
export function exportGradebookCsv(section) {
  const grading = state.grading;
  const header = [
    'Student', 'Student ID', 'Email',
    ...section.assignments.map(a => `${a.name} (/${a.max})`),
    ...section.categories.map(c => `${c.name} %`),
    'Final %', 'Letter'
  ];

  const rows = section.students.map(student => {
    const { final, catBreakdown } = computeStudentGrade(section, student.id, grading);
    const scores = section.assignments.map(a =>
      cellText(scoreOutcome(section.scores[student.id + '_' + a.id], a, grading))
    );
    const categoryPcts = section.categories.map(c => {
      const found = catBreakdown.find(b => b.id === c.id);
      return found && found.pct !== null ? round2(found.pct) : '';
    });

    return [
      student.name, student.studentId, student.email,
      ...scores,
      ...categoryPcts,
      final === null ? '' : roundPct(final, grading.rounding),
      letterGrade(final, grading).letter
    ];
  });

  const meta = [
    ['Course', state.course.name || ''],
    ['Term', state.course.term || ''],
    ['Section', section.name],
    ['Exported', new Date().toISOString().slice(0, 10)],
    []
  ];

  download(`${fileStem(section)}-grades.csv`, toCsv([...meta, header, ...rows]));
}

/** One assignment, every student — the sheet you hand back with a quiz. */
export function exportAssignmentCsv(section, assignment) {
  const grading = state.grading;
  const stats = assignmentStats(section, assignment, grading);

  const rows = stats.rows.map(({ student, outcome }) => [
    student.name,
    student.studentId,
    cellText(outcome),
    assignment.max,
    outcome.state,
    outcome.lateDays || 0,
    outcome.state === 'graded' && assignment.max > 0
      ? round2((outcome.earned / assignment.max) * 100)
      : ''
  ]);

  const meta = [
    ['Assignment', assignment.name],
    ['Category', (section.categories.find(c => c.id === assignment.categoryId) || {}).name || ''],
    ['Type', assignment.type],
    ['Due', assignment.dueDate || ''],
    ['Out of', assignment.max],
    ['Mean', round2(stats.meanPoints)],
    ['Median', round2(stats.medianPoints)],
    ['High', round2(stats.highPoints)],
    ['Low', round2(stats.lowPoints)],
    []
  ];

  const header = ['Student', 'Student ID', 'Score', 'Out of', 'Status', 'Days late', 'Percent'];
  download(`${fileStem(section)}-${slug(assignment.name)}.csv`, toCsv([...meta, header, ...rows]));
}
