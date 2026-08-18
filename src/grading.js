/**
 * Pure grade math — no DOM, no state import. Everything it needs is passed in,
 * which keeps it the easy part of the app to reason about and the part that is
 * actually unit tested (see grading.test.js).
 *
 * The rules it implements, in the order they apply:
 *   1. Each cell resolves to one of four states — see scoreOutcome().
 *   2. Late work loses percentPerDay of its points per day, capped at maxPercent.
 *   3. Within a category, the N lowest-scoring counted assignments are dropped.
 *   4. A category is sum(earned) / sum(possible) over what is left.
 *   5. The final grade is the weighted mean of the categories that have data,
 *      with the remaining weights re-normalised.
 *   6. The result is rounded once, and the letter comes from the rounded number.
 */
import { ROUNDING_MODES, DEFAULT_SCALE } from './migrate.js';

/** What a cell can be. `graded` with a blank score means "not marked yet". */
export const SCORE_STATUSES = ['graded', 'missing', 'excused'];

const EMPTY_ENTRY = { score: null, status: 'graded', lateDays: 0 };

/**
 * How much of a late score is forfeited, as a percentage of the points earned.
 * Returns 0 whenever the policy is off, so callers never special-case it.
 */
export function latePenaltyPct(lateDays, latePenalty) {
  if (!latePenalty || latePenalty.enabled !== true) return 0;
  const days = Math.max(0, Math.round(Number(lateDays) || 0));
  if (days === 0) return 0;
  const perDay = Math.max(0, Number(latePenalty.percentPerDay) || 0);
  const cap = Math.min(100, Math.max(0, Number(latePenalty.maxPercent) || 0));
  return Math.min(perDay * days, cap);
}

/**
 * Resolve one student's cell on one assignment.
 *
 *   ungraded  nothing entered yet     — excluded from the denominator
 *   excused   does not apply to them  — excluded from the denominator
 *   missing   not turned in           — zero earned, still in the denominator
 *   graded    a real score            — earned (after any late penalty) / max
 *
 * `ungraded` vs `missing` is the distinction that keeps a student who joined
 * mid-term from being punished for assignments they were never set.
 */
export function scoreOutcome(entry, assignment, grading) {
  const e = entry || EMPTY_ENTRY;
  const possible = Math.max(0, Number(assignment && assignment.max) || 0);
  const raw = e.score === null || e.score === undefined ? null : Number(e.score);
  const base = { raw, possible, penaltyPct: 0, lateDays: 0, isExtraCredit: false };

  if (e.status === 'excused') {
    return { ...base, state: 'excused', counts: false, earned: 0, possible: 0 };
  }
  if (e.status === 'missing') {
    return { ...base, state: 'missing', counts: true, earned: 0 };
  }
  if (raw === null || !Number.isFinite(raw)) {
    return { ...base, state: 'ungraded', counts: false, earned: 0, possible: 0 };
  }

  const lateDays = Math.max(0, Math.round(Number(e.lateDays) || 0));
  const penaltyPct = latePenaltyPct(lateDays, grading && grading.latePenalty);
  // Penalties scale the points earned; they can never push a score below zero.
  const earned = Math.max(0, raw * (1 - penaltyPct / 100));

  return {
    ...base,
    state: 'graded',
    counts: true,
    earned,
    lateDays,
    penaltyPct,
    // Scores above the max are allowed on purpose — that is how extra credit works.
    isExtraCredit: possible > 0 && raw > possible
  };
}

/**
 * One category's percentage for one student.
 *
 * Assignments are dropped lowest-first by their own percentage, so a zero for
 * missing work goes before a weak-but-real score. At least one counted
 * assignment always survives — dropping the only quiz a student has taken would
 * silently erase the category instead of helping them.
 */
export function categoryResult(section, studentId, category, grading) {
  const rows = section.assignments
    .filter(a => a.categoryId === category.id)
    .map(a => ({
      assignment: a,
      outcome: scoreOutcome(section.scores[studentId + '_' + a.id], a, grading)
    }));

  const counted = rows.filter(r => r.outcome.counts);
  const dropCount = Math.min(
    Math.max(0, Math.round(Number(category.dropLowest) || 0)),
    Math.max(0, counted.length - 1)
  );

  // Pure extra-credit work (max 0) has no percentage to rank, and dropping it
  // would only ever hurt — sort it to the top so it is never chosen.
  const ranked = [...counted].sort((a, b) => ratio(a.outcome) - ratio(b.outcome));
  const dropped = ranked.slice(0, dropCount);
  const kept = ranked.slice(dropCount);

  const earned = kept.reduce((sum, r) => sum + r.outcome.earned, 0);
  const possible = kept.reduce((sum, r) => sum + r.outcome.possible, 0);

  return {
    id: category.id,
    name: category.name,
    weight: Number(category.weight) || 0,
    pct: possible > 0 ? (earned / possible) * 100 : null,
    earned,
    possible,
    countedCount: counted.length,
    droppedCount: dropped.length,
    droppedIds: new Set(dropped.map(r => r.assignment.id)),
    rows
  };
}

function ratio(outcome) {
  return outcome.possible > 0 ? outcome.earned / outcome.possible : Infinity;
}

/**
 * Weighted final grade for one student in one section.
 *
 * Categories with nothing counted are skipped and the remaining weights are
 * re-normalised, so a half-finished term reads as a real percentage instead of
 * being dragged toward zero. `final` is null when nothing counts yet — callers
 * must render that as an em dash rather than 0%.
 */
export function computeStudentGrade(section, studentId, grading) {
  const catBreakdown = [];
  let weightedSum = 0;
  let weightUsed = 0;

  section.categories.forEach(cat => {
    const result = categoryResult(section, studentId, cat, grading);
    catBreakdown.push(result);
    if (result.pct !== null && result.weight > 0) {
      weightedSum += result.pct * (result.weight / 100);
      weightUsed += result.weight;
    }
  });

  const final = weightUsed > 0 ? weightedSum / (weightUsed / 100) : null;
  return {
    final,
    rounded: roundPct(final, grading && grading.rounding),
    weightUsed,
    catBreakdown
  };
}

/* ---------- presentation-independent formatting ---------- */

export function roundingDigits(rounding) {
  return (ROUNDING_MODES[rounding] || ROUNDING_MODES.whole).digits;
}

export function roundPct(pct, rounding) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  const factor = 10 ** roundingDigits(rounding);
  // The epsilon keeps 89.5 from rounding down through binary float error.
  return Math.round((pct + Number.EPSILON) * factor) / factor;
}

/** The one place "no data" turns into an em dash. */
export function formatPct(pct, rounding) {
  const rounded = roundPct(pct, rounding);
  if (rounded === null) return '—';
  return rounded.toFixed(roundingDigits(rounding)) + '%';
}

/** Trims float noise off point totals without forcing decimals on whole numbers. */
export function formatPoints(points) {
  if (points === null || points === undefined || !Number.isFinite(points)) return '—';
  return String(Math.round(points * 100) / 100);
}

const LETTER_COLORS = {
  A: 'var(--good)', B: '#7aa6d6', C: '#eea23f', D: '#e08a4f', F: 'var(--warn)'
};

export function letterColor(letter) {
  return LETTER_COLORS[String(letter).charAt(0).toUpperCase()] || 'var(--ink-muted)';
}

/**
 * The letter for a percentage, from the course's own cutoffs.
 * Rounds first, so an 89.6 under whole-number rounding earns the 90 cutoff.
 */
export function letterGrade(pct, grading) {
  const rounded = roundPct(pct, grading && grading.rounding);
  if (rounded === null) return { letter: '—', color: 'var(--ink-muted)' };

  const scale = grading && Array.isArray(grading.scale) && grading.scale.length
    ? grading.scale
    : DEFAULT_SCALE;
  const sorted = [...scale].sort((a, b) => b.min - a.min);
  const hit = sorted.find(row => rounded >= row.min) || sorted[sorted.length - 1];

  return { letter: hit.letter, color: letterColor(hit.letter) };
}

/* ---------- class statistics ---------- */

function median(sortedNumbers) {
  const n = sortedNumbers.length;
  if (!n) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? sortedNumbers[mid] : (sortedNumbers[mid - 1] + sortedNumbers[mid]) / 2;
}

function mean(numbers) {
  if (!numbers.length) return null;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

/**
 * How the whole class did on one assignment.
 *
 * Statistics cover graded work only. Counting missing work as zero here would
 * make a fair quiz look brutal just because half the class had not handed it in
 * yet, which is the opposite of what these numbers are for — the counts are
 * reported alongside so the gap stays visible.
 */
export function assignmentStats(section, assignment, grading) {
  const rows = section.students.map(student => ({
    student,
    outcome: scoreOutcome(section.scores[student.id + '_' + assignment.id], assignment, grading)
  }));

  const graded = rows.filter(r => r.outcome.state === 'graded');
  const points = graded.map(r => r.outcome.earned).sort((a, b) => a - b);
  const max = Math.max(0, Number(assignment.max) || 0);
  const toPct = value => (value === null || max <= 0 ? null : (value / max) * 100);

  const meanPoints = mean(points);
  const medianPoints = median(points);
  const highPoints = points.length ? points[points.length - 1] : null;
  const lowPoints = points.length ? points[0] : null;

  return {
    assignment,
    rows,
    total: rows.length,
    gradedCount: graded.length,
    missingCount: rows.filter(r => r.outcome.state === 'missing').length,
    excusedCount: rows.filter(r => r.outcome.state === 'excused').length,
    ungradedCount: rows.filter(r => r.outcome.state === 'ungraded').length,
    meanPoints,
    medianPoints,
    highPoints,
    lowPoints,
    meanPct: toPct(meanPoints),
    medianPct: toPct(medianPoints),
    highPct: toPct(highPoints),
    lowPct: toPct(lowPoints)
  };
}

/** The same summary for the section's final grades. */
export function classFinalStats(section, grading) {
  const finals = section.students
    .map(s => computeStudentGrade(section, s.id, grading).final)
    .filter(f => f !== null);
  const sorted = [...finals].sort((a, b) => a - b);

  return {
    gradedCount: finals.length,
    total: section.students.length,
    meanPct: mean(finals),
    medianPct: median(sorted),
    highPct: sorted.length ? sorted[sorted.length - 1] : null,
    lowPct: sorted.length ? sorted[0] : null
  };
}
