/**
 * Brings any previously-saved gradebook up to the current schema.
 *
 * Old saves are real data on someone's laptop, so this is deliberately
 * forgiving: anything unrecognised is replaced with a sane default rather than
 * throwing. `migrate()` is the only thing that should ever build a state object
 * out of untrusted JSON.
 *
 * v1/v2  scores were { score, excused }  — a blank score meant "not graded yet"
 * v3     scores are  { score, status, lateDays } with status graded|missing|excused,
 *        plus course info, per-student ID/email, assignment due date + type,
 *        per-category drop-lowest, and a course-wide grading policy.
 */
import { uid } from './utils.js';

export const SCHEMA_VERSION = 3;

export const DEFAULT_SCALE = [
  { letter: 'A', min: 90 },
  { letter: 'B', min: 80 },
  { letter: 'C', min: 70 },
  { letter: 'D', min: 60 },
  { letter: 'F', min: 0 }
];

export const PLUS_MINUS_SCALE = [
  { letter: 'A+', min: 97 }, { letter: 'A', min: 93 }, { letter: 'A-', min: 90 },
  { letter: 'B+', min: 87 }, { letter: 'B', min: 83 }, { letter: 'B-', min: 80 },
  { letter: 'C+', min: 77 }, { letter: 'C', min: 73 }, { letter: 'C-', min: 70 },
  { letter: 'D+', min: 67 }, { letter: 'D', min: 63 }, { letter: 'D-', min: 60 },
  { letter: 'F', min: 0 }
];

export const ASSIGNMENT_TYPES = ['quiz', 'essay', 'project', 'exam', 'homework', 'other'];

export const ROUNDING_MODES = {
  whole:     { label: 'Whole number (89.5 becomes 90)', digits: 0 },
  tenth:     { label: 'One decimal (89.47 becomes 89.5)', digits: 1 },
  hundredth: { label: 'Two decimals (89.472 becomes 89.47)', digits: 2 }
};

export function defaultGrading() {
  return {
    scale: DEFAULT_SCALE.map(r => ({ ...r })),
    rounding: 'whole',
    latePenalty: { enabled: false, percentPerDay: 10, maxPercent: 100 }
  };
}

export function defaultCourse() {
  return { name: '', term: '' };
}

/* ---------- coercion helpers ---------- */

const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);

/** Number or fallback — rejects NaN/Infinity, which JSON.parse happily produces. */
function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Like num(), but keeps null meaning "no value" instead of coercing it to 0. */
function nullableNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ---------- migration ---------- */

export function migrate(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};

  const state = {
    schemaVersion: SCHEMA_VERSION,
    course: migrateCourse(data.course),
    grading: migrateGrading(data.grading),
    activeSectionId: str(data.activeSectionId) || null,
    sections: Array.isArray(data.sections) ? data.sections.map(migrateSection) : []
  };

  // An activeSectionId left over from a deleted section would render an empty app.
  if (!state.sections.some(s => s.id === state.activeSectionId)) {
    state.activeSectionId = state.sections.length ? state.sections[0].id : null;
  }
  return state;
}

function migrateCourse(course) {
  const c = course && typeof course === 'object' ? course : {};
  return { name: str(c.name), term: str(c.term) };
}

function migrateGrading(grading) {
  const g = grading && typeof grading === 'object' ? grading : {};
  const base = defaultGrading();

  const scale = Array.isArray(g.scale)
    ? g.scale
        .map(r => ({ letter: str(r && r.letter).trim(), min: num(r && r.min, NaN) }))
        .filter(r => r.letter && Number.isFinite(r.min))
        .sort((a, b) => b.min - a.min)
    : [];

  const lp = g.latePenalty && typeof g.latePenalty === 'object' ? g.latePenalty : {};

  return {
    scale: scale.length ? scale : base.scale,
    rounding: ROUNDING_MODES[g.rounding] ? g.rounding : base.rounding,
    latePenalty: {
      enabled: lp.enabled === true,
      percentPerDay: Math.max(0, num(lp.percentPerDay, 10)),
      maxPercent: Math.min(100, Math.max(0, num(lp.maxPercent, 100)))
    }
  };
}

function migrateSection(sec) {
  const s = sec && typeof sec === 'object' ? sec : {};

  const students = (Array.isArray(s.students) ? s.students : []).map(st => ({
    id: str(st && st.id) || uid(),
    name: str(st && st.name, 'Unnamed student'),
    studentId: str(st && st.studentId),
    email: str(st && st.email)
  }));

  const categories = (Array.isArray(s.categories) ? s.categories : []).map(c => ({
    id: str(c && c.id) || uid(),
    name: str(c && c.name, 'Category'),
    weight: Math.max(0, num(c && c.weight, 0)),
    dropLowest: Math.max(0, Math.round(num(c && c.dropLowest, 0)))
  }));

  const categoryIds = new Set(categories.map(c => c.id));
  const assignments = (Array.isArray(s.assignments) ? s.assignments : [])
    .map(a => ({
      id: str(a && a.id) || uid(),
      name: str(a && a.name, 'Assignment'),
      categoryId: str(a && a.categoryId),
      max: Math.max(0, num(a && a.max, 100)),
      dueDate: str(a && a.dueDate),
      type: ASSIGNMENT_TYPES.includes(a && a.type) ? a.type : 'other'
    }))
    // An assignment whose category vanished can never be graded — drop it rather
    // than leave it stranded in the matrix under a blank column header.
    .filter(a => categoryIds.has(a.categoryId));

  return {
    id: str(s.id) || uid(),
    name: str(s.name, 'Section'),
    students,
    categories,
    assignments,
    scores: migrateScores(s.scores, students, assignments)
  };
}

function migrateScores(scores, students, assignments) {
  const src = scores && typeof scores === 'object' ? scores : {};
  const studentIds = new Set(students.map(s => s.id));
  const assignmentIds = new Set(assignments.map(a => a.id));
  const out = {};

  Object.keys(src).forEach(key => {
    // uid() never produces "_", so the first one is the separator.
    const cut = key.indexOf('_');
    if (cut < 0) return;
    const studentId = key.slice(0, cut);
    const assignmentId = key.slice(cut + 1);
    // Drop orphans left behind by a delete that missed its scores.
    if (!studentIds.has(studentId) || !assignmentIds.has(assignmentId)) return;

    const e = src[key] && typeof src[key] === 'object' ? src[key] : {};
    const score = nullableNum(e.score);
    const lateDays = Math.max(0, Math.round(num(e.lateDays, 0)));

    let status;
    if (e.status === 'missing' || e.status === 'excused' || e.status === 'graded') {
      status = e.status;
    } else {
      status = e.excused === true ? 'excused' : 'graded'; // pre-v3 shape
    }

    // A blank, graded, on-time cell carries no information — skip it so saves stay
    // small and "has anything been entered?" checks stay honest.
    if (status === 'graded' && score === null && lateDays === 0) return;

    out[key] = { score, status, lateDays };
  });

  return out;
}
