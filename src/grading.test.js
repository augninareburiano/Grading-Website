import { describe, it, expect } from 'vitest';
import {
  scoreOutcome,
  categoryResult,
  computeStudentGrade,
  letterGrade,
  roundPct,
  formatPct,
  assignmentStats,
  classFinalStats,
  latePenaltyPct
} from './grading.js';
import { migrate, defaultGrading, PLUS_MINUS_SCALE } from './migrate.js';

/* ---------- fixtures ---------- */

const grading = () => defaultGrading();

/**
 * Builds a section without going through the UI. Scores are given as
 * { "student_assignment": entry } using the same keys the app uses.
 */
function section({ students = ['s1'], categories = [], assignments = [], scores = {} } = {}) {
  return {
    id: 'sec',
    name: 'Test Section',
    students: students.map(id => ({ id, name: id, studentId: '', email: '' })),
    categories: categories.map(c => ({ dropLowest: 0, ...c })),
    assignments: assignments.map(a => ({ dueDate: '', type: 'other', ...a })),
    scores
  };
}

const graded = score => ({ score, status: 'graded', lateDays: 0 });
const late = (score, lateDays) => ({ score, status: 'graded', lateDays });
const missing = () => ({ score: null, status: 'missing', lateDays: 0 });
const excused = () => ({ score: null, status: 'excused', lateDays: 0 });

/* ---------- the four cell states ---------- */

describe('scoreOutcome', () => {
  const assignment = { id: 'a1', max: 10 };

  it('treats an absent entry as ungraded, not as a zero', () => {
    const out = scoreOutcome(undefined, assignment, grading());
    expect(out.state).toBe('ungraded');
    expect(out.counts).toBe(false);
    expect(out.possible).toBe(0);
  });

  it('counts missing work as zero out of max', () => {
    const out = scoreOutcome(missing(), assignment, grading());
    expect(out.counts).toBe(true);
    expect(out.earned).toBe(0);
    expect(out.possible).toBe(10);
  });

  it('removes excused work from the denominator entirely', () => {
    const out = scoreOutcome(excused(), assignment, grading());
    expect(out.counts).toBe(false);
    expect(out.possible).toBe(0);
  });

  it('flags a score above the max as extra credit without clamping it', () => {
    const out = scoreOutcome(graded(12), assignment, grading());
    expect(out.earned).toBe(12);
    expect(out.isExtraCredit).toBe(true);
  });

  it('ignores a score attached to a missing or excused cell', () => {
    expect(scoreOutcome({ ...missing(), score: 9 }, assignment, grading()).earned).toBe(0);
    expect(scoreOutcome({ ...excused(), score: 9 }, assignment, grading()).counts).toBe(false);
  });
});

/* ---------- late penalties ---------- */

describe('late penalties', () => {
  const assignment = { id: 'a1', max: 100 };
  const withPolicy = extra => ({
    ...grading(),
    latePenalty: { enabled: true, percentPerDay: 10, maxPercent: 100, ...extra }
  });

  it('does nothing while the policy is switched off', () => {
    expect(latePenaltyPct(3, { enabled: false, percentPerDay: 10, maxPercent: 100 })).toBe(0);
    expect(scoreOutcome(late(80, 3), assignment, grading()).earned).toBe(80);
  });

  it('deducts the per-day percentage from the points earned', () => {
    expect(scoreOutcome(late(80, 2), assignment, withPolicy()).earned).toBeCloseTo(64);
  });

  it('stops deducting at the cap', () => {
    const out = scoreOutcome(late(80, 10), assignment, withPolicy({ maxPercent: 50 }));
    expect(out.penaltyPct).toBe(50);
    expect(out.earned).toBeCloseTo(40);
  });

  it('never drives a score below zero', () => {
    const out = scoreOutcome(late(80, 30), assignment, withPolicy());
    expect(out.earned).toBe(0);
  });
});

/* ---------- category maths ---------- */

describe('categoryResult', () => {
  const cat = { id: 'c1', name: 'Quizzes', weight: 100 };

  it('is null, not zero, when nothing has been graded', () => {
    const s = section({
      categories: [cat],
      assignments: [{ id: 'a1', name: 'Q1', categoryId: 'c1', max: 10 }]
    });
    expect(categoryResult(s, 's1', cat, grading()).pct).toBeNull();
  });

  it('sums points across the category rather than averaging percentages', () => {
    const s = section({
      categories: [cat],
      assignments: [
        { id: 'a1', name: 'Q1', categoryId: 'c1', max: 10 },
        { id: 'a2', name: 'Q2', categoryId: 'c1', max: 90 }
      ],
      scores: { s1_a1: graded(10), s1_a2: graded(45) }
    });
    // 55 of 100 points, not the 75% a mean of 100% and 50% would give.
    expect(categoryResult(s, 's1', cat, grading()).pct).toBeCloseTo(55);
  });

  it('drops the lowest scoring assignment when asked', () => {
    const s = section({
      categories: [{ ...cat, dropLowest: 1 }],
      assignments: [
        { id: 'a1', name: 'Q1', categoryId: 'c1', max: 10 },
        { id: 'a2', name: 'Q2', categoryId: 'c1', max: 10 },
        { id: 'a3', name: 'Q3', categoryId: 'c1', max: 10 }
      ],
      scores: { s1_a1: graded(10), s1_a2: graded(2), s1_a3: graded(8) }
    });
    const result = categoryResult(s, 's1', { ...cat, dropLowest: 1 }, grading());
    expect(result.droppedCount).toBe(1);
    expect(result.pct).toBeCloseTo(90); // 18 of 20, the 2 is gone
  });

  it('drops a missing zero before a weak real score', () => {
    const s = section({
      categories: [{ ...cat, dropLowest: 1 }],
      assignments: [
        { id: 'a1', name: 'Q1', categoryId: 'c1', max: 10 },
        { id: 'a2', name: 'Q2', categoryId: 'c1', max: 10 }
      ],
      scores: { s1_a1: missing(), s1_a2: graded(5) }
    });
    expect(categoryResult(s, 's1', { ...cat, dropLowest: 1 }, grading()).pct).toBeCloseTo(50);
  });

  it('always keeps one assignment, however large dropLowest is', () => {
    const s = section({
      categories: [{ ...cat, dropLowest: 5 }],
      assignments: [{ id: 'a1', name: 'Q1', categoryId: 'c1', max: 10 }],
      scores: { s1_a1: graded(7) }
    });
    const result = categoryResult(s, 's1', { ...cat, dropLowest: 5 }, grading());
    expect(result.droppedCount).toBe(0);
    expect(result.pct).toBeCloseTo(70);
  });

  it('never drops a zero-max extra credit assignment', () => {
    const s = section({
      categories: [{ ...cat, dropLowest: 1 }],
      assignments: [
        { id: 'a1', name: 'Q1', categoryId: 'c1', max: 10 },
        { id: 'bonus', name: 'Bonus', categoryId: 'c1', max: 0 }
      ],
      scores: { s1_a1: graded(6), s1_bonus: graded(3) }
    });
    const result = categoryResult(s, 's1', { ...cat, dropLowest: 1 }, grading());
    // The 60% quiz is the one dropped; the bonus points survive on their own.
    expect(result.earned).toBe(3);
    expect(result.possible).toBe(0);
    expect(result.pct).toBeNull();
  });
});

/* ---------- final grades ---------- */

describe('computeStudentGrade', () => {
  const twoCategories = {
    categories: [
      { id: 'c1', name: 'Quizzes', weight: 40 },
      { id: 'c2', name: 'Exams', weight: 60 }
    ],
    assignments: [
      { id: 'a1', name: 'Q1', categoryId: 'c1', max: 100 },
      { id: 'a2', name: 'E1', categoryId: 'c2', max: 100 }
    ]
  };

  it('returns null when the student has nothing graded at all', () => {
    const result = computeStudentGrade(section(twoCategories), 's1', grading());
    expect(result.final).toBeNull();
    expect(formatPct(result.final, 'whole')).toBe('—');
  });

  it('weights the categories', () => {
    const s = section({ ...twoCategories, scores: { s1_a1: graded(90), s1_a2: graded(80) } });
    expect(computeStudentGrade(s, 's1', grading()).final).toBeCloseTo(84); // 90*.4 + 80*.6
  });

  it('re-normalises the weights when a category has no data yet', () => {
    const s = section({ ...twoCategories, scores: { s1_a1: graded(90) } });
    // Only Quizzes counts, so its 40% carries the whole grade.
    expect(computeStudentGrade(s, 's1', grading()).final).toBeCloseTo(90);
  });

  it('lets extra credit push the final above 100', () => {
    const s = section({ ...twoCategories, scores: { s1_a1: graded(110), s1_a2: graded(100) } });
    expect(computeStudentGrade(s, 's1', grading()).final).toBeCloseTo(104);
  });

  it('separates a mid-term joiner from a student who skipped the work', () => {
    const joined = section({
      ...twoCategories,
      students: ['newcomer', 'slacker'],
      scores: {
        // The newcomer was never set Q1; the slacker did not hand it in.
        newcomer_a2: graded(80),
        slacker_a1: missing(),
        slacker_a2: graded(80)
      }
    });
    expect(computeStudentGrade(joined, 'newcomer', grading()).final).toBeCloseTo(80);
    expect(computeStudentGrade(joined, 'slacker', grading()).final).toBeCloseTo(48); // 0*.4 + 80*.6
  });

  it('keeps students with identical names apart by id', () => {
    const s = section({
      ...twoCategories,
      students: ['s1', 's2'],
      scores: { s1_a1: graded(100), s2_a1: graded(20) }
    });
    s.students[0].name = 'Alex Kim';
    s.students[1].name = 'Alex Kim';
    expect(computeStudentGrade(s, 's1', grading()).final).toBeCloseTo(100);
    expect(computeStudentGrade(s, 's2', grading()).final).toBeCloseTo(20);
  });

  it('ignores a category weighted at zero', () => {
    const s = section({
      categories: [
        { id: 'c1', name: 'Practice', weight: 0 },
        { id: 'c2', name: 'Exams', weight: 100 }
      ],
      assignments: [
        { id: 'a1', name: 'P1', categoryId: 'c1', max: 100 },
        { id: 'a2', name: 'E1', categoryId: 'c2', max: 100 }
      ],
      scores: { s1_a1: graded(0), s1_a2: graded(90) }
    });
    expect(computeStudentGrade(s, 's1', grading()).final).toBeCloseTo(90);
  });
});

/* ---------- rounding and letters ---------- */

describe('rounding and letter grades', () => {
  it('rounds to the configured precision', () => {
    expect(roundPct(89.472, 'whole')).toBe(89);
    expect(roundPct(89.472, 'tenth')).toBe(89.5);
    expect(roundPct(89.472, 'hundredth')).toBe(89.47);
  });

  it('rounds a .5 upward instead of losing it to float error', () => {
    expect(roundPct(89.5, 'whole')).toBe(90);
    expect(roundPct(8.005, 'hundredth')).toBe(8.01);
  });

  it('lets rounding decide a borderline letter', () => {
    expect(letterGrade(89.5, grading()).letter).toBe('A');
    expect(letterGrade(89.5, { ...grading(), rounding: 'tenth' }).letter).toBe('B');
  });

  it('reads cutoffs off a custom scale', () => {
    const pm = { ...grading(), scale: PLUS_MINUS_SCALE, rounding: 'tenth' };
    expect(letterGrade(97.2, pm).letter).toBe('A+');
    expect(letterGrade(90.0, pm).letter).toBe('A-');
    expect(letterGrade(61.4, pm).letter).toBe('D-');
    expect(letterGrade(12, pm).letter).toBe('F');
  });

  it('shows an em dash rather than a letter when there is no grade', () => {
    expect(letterGrade(null, grading()).letter).toBe('—');
  });
});

/* ---------- statistics ---------- */

describe('statistics', () => {
  const s = section({
    students: ['s1', 's2', 's3', 's4', 's5'],
    categories: [{ id: 'c1', name: 'Quizzes', weight: 100 }],
    assignments: [{ id: 'a1', name: 'Q1', categoryId: 'c1', max: 10 }],
    scores: {
      s1_a1: graded(10),
      s2_a1: graded(6),
      s3_a1: graded(8),
      s4_a1: missing(),
      s5_a1: excused()
      // s5 excused, s4 missing, nobody ungraded except none
    }
  });

  it('summarises graded work and counts the rest separately', () => {
    const stats = assignmentStats(s, s.assignments[0], grading());
    expect(stats.gradedCount).toBe(3);
    expect(stats.missingCount).toBe(1);
    expect(stats.excusedCount).toBe(1);
    expect(stats.meanPoints).toBeCloseTo(8); // (10+6+8)/3 — the missing zero is excluded
    expect(stats.medianPoints).toBe(8);
    expect(stats.highPoints).toBe(10);
    expect(stats.lowPoints).toBe(6);
    expect(stats.meanPct).toBeCloseTo(80);
  });

  it('reports nulls for an assignment nobody has been graded on', () => {
    const untouched = section({
      categories: [{ id: 'c1', name: 'Quizzes', weight: 100 }],
      assignments: [{ id: 'a1', name: 'Q1', categoryId: 'c1', max: 10 }]
    });
    const stats = assignmentStats(untouched, untouched.assignments[0], grading());
    expect(stats.meanPoints).toBeNull();
    expect(stats.highPoints).toBeNull();
    expect(formatPct(stats.meanPct, 'whole')).toBe('—');
  });

  it('averages an even number of scores across the middle pair', () => {
    const even = section({
      students: ['s1', 's2'],
      categories: [{ id: 'c1', name: 'Quizzes', weight: 100 }],
      assignments: [{ id: 'a1', name: 'Q1', categoryId: 'c1', max: 10 }],
      scores: { s1_a1: graded(7), s2_a1: graded(10) }
    });
    expect(assignmentStats(even, even.assignments[0], grading()).medianPoints).toBe(8.5);
  });

  it('summarises the class final grades', () => {
    const stats = classFinalStats(s, grading());
    expect(stats.total).toBe(5);
    expect(stats.gradedCount).toBe(4); // the excused student has no counted work
    expect(stats.highPct).toBeCloseTo(100);
    expect(stats.lowPct).toBeCloseTo(0); // the missing student
  });
});

/* ---------- migration ---------- */

describe('migrate', () => {
  it('carries a v2 save over to the current shape', () => {
    const v2 = {
      activeSectionId: 'x',
      sections: [{
        id: 'x',
        name: 'Block A',
        students: [{ id: 's1', name: 'Ann' }],
        categories: [{ id: 'c1', name: 'Quizzes', weight: 50 }],
        assignments: [{ id: 'a1', name: 'Q1', categoryId: 'c1', max: 10 }],
        scores: { s1_a1: { score: 8, excused: false }, s1_a2: { score: 3, excused: true } }
      }]
    };
    const state = migrate(v2);
    expect(state.schemaVersion).toBe(3);
    expect(state.sections[0].students[0]).toMatchObject({ name: 'Ann', studentId: '', email: '' });
    expect(state.sections[0].categories[0].dropLowest).toBe(0);
    expect(state.sections[0].assignments[0]).toMatchObject({ dueDate: '', type: 'other' });
    expect(state.sections[0].scores.s1_a1).toEqual({ score: 8, status: 'graded', lateDays: 0 });
  });

  it('turns the old excused flag into a status', () => {
    const state = migrate({
      sections: [{
        id: 'x',
        students: [{ id: 's1', name: 'Ann' }],
        categories: [{ id: 'c1', name: 'Q', weight: 100 }],
        assignments: [{ id: 'a1', name: 'Q1', categoryId: 'c1', max: 10 }],
        scores: { s1_a1: { score: null, excused: true } }
      }]
    });
    expect(state.sections[0].scores.s1_a1.status).toBe('excused');
  });

  it('drops scores whose student or assignment is gone', () => {
    const state = migrate({
      sections: [{
        id: 'x',
        students: [{ id: 's1', name: 'Ann' }],
        categories: [{ id: 'c1', name: 'Q', weight: 100 }],
        assignments: [{ id: 'a1', name: 'Q1', categoryId: 'c1', max: 10 }],
        scores: { s1_a1: { score: 5 }, ghost_a1: { score: 5 }, s1_ghost: { score: 5 }, junk: {} }
      }]
    });
    expect(Object.keys(state.sections[0].scores)).toEqual(['s1_a1']);
  });

  it('drops an assignment whose category no longer exists', () => {
    const state = migrate({
      sections: [{
        id: 'x',
        students: [],
        categories: [],
        assignments: [{ id: 'a1', name: 'Orphan', categoryId: 'gone', max: 10 }]
      }]
    });
    expect(state.sections[0].assignments).toEqual([]);
  });

  it('survives garbage without throwing', () => {
    expect(migrate(null).sections).toEqual([]);
    expect(migrate({ sections: 'nope' }).sections).toEqual([]);
    expect(migrate({ sections: [null] }).sections[0].name).toBe('Section');
    expect(migrate({ grading: { rounding: 'bogus', scale: [] } }).grading.rounding).toBe('whole');
  });

  it('repoints activeSectionId when it names a section that is gone', () => {
    const state = migrate({ activeSectionId: 'deleted', sections: [{ id: 'real', name: 'A' }] });
    expect(state.activeSectionId).toBe('real');
  });

  it('rejects NaN and Infinity coming back out of JSON', () => {
    const state = migrate({
      sections: [{
        id: 'x',
        students: [{ id: 's1', name: 'Ann' }],
        categories: [{ id: 'c1', name: 'Q', weight: 'abc' }],
        assignments: [{ id: 'a1', name: 'Q1', categoryId: 'c1', max: 'oops' }],
        scores: { s1_a1: { score: 'nonsense', status: 'graded' } }
      }]
    });
    expect(state.sections[0].categories[0].weight).toBe(0);
    expect(state.sections[0].assignments[0].max).toBe(100);
    // A cell with no usable score and nothing else to say is not worth storing.
    expect(state.sections[0].scores.s1_a1).toBeUndefined();
  });
});
