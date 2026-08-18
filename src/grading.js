/**
 * Pure grade math — no DOM, no state import. Everything it needs is passed in,
 * which keeps it the easy part of the app to reason about and to unit test.
 */

/**
 * Weighted final grade for one student in one section.
 *
 * A category counts only if the student has at least one graded, non-excused
 * assignment in it. The remaining weights are re-normalised so a half-finished
 * term still reads as a sensible percentage rather than being dragged toward 0.
 *
 * Returns { final, catBreakdown } where `final` is null when nothing is graded
 * yet, and each breakdown entry is { name, weight, pct } with pct possibly null.
 */
export function computeStudentGrade(section, studentId) {
  const catBreakdown = [];
  let weightedSum = 0;
  let weightUsed = 0;

  section.categories.forEach(cat => {
    const catAssignments = section.assignments.filter(a => a.categoryId === cat.id);
    let earned = 0;
    let possible = 0;

    catAssignments.forEach(a => {
      const entry = section.scores[studentId + '_' + a.id];
      if (entry && !entry.excused && entry.score !== null && entry.score !== undefined) {
        earned += Number(entry.score);
        possible += Number(a.max);
      }
    });

    const pct = possible > 0 ? (earned / possible * 100) : null;
    catBreakdown.push({ name: cat.name, weight: cat.weight, pct });

    if (pct !== null) {
      weightedSum += pct * (cat.weight / 100);
      weightUsed += cat.weight;
    }
  });

  const final = weightUsed > 0 ? (weightedSum / (weightUsed / 100)) : null;
  return { final, catBreakdown };
}

export function letterGrade(pct) {
  if (pct === null) return { letter: '—', color: 'var(--ink-muted)' };
  if (pct >= 90) return { letter: 'A', color: 'var(--good)' };
  if (pct >= 80) return { letter: 'B', color: '#7aa6d6' };
  if (pct >= 70) return { letter: 'C', color: '#eea23f' };
  if (pct >= 60) return { letter: 'D', color: '#e08a4f' };
  return { letter: 'F', color: 'var(--warn)' };
}
