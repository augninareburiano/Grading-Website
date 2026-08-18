/**
 * @vitest-environment jsdom
 *
 * Boots the real app against the real index.html and drives it through the DOM.
 *
 * grading.test.js proves the maths; this proves the wiring — that every handler
 * finds the element it binds to, that a redraw does not throw, and that a score
 * typed into a box comes back out as a letter grade. Between them, a broken id
 * or a renamed field fails a test instead of a silent blank page.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// jsdom rewrites import.meta.url to an http URL, so resolve from the project
// root instead — vitest always runs with the cwd there.
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const BODY = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));

const $ = id => document.getElementById(id);
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }));
const change = el => el.dispatchEvent(new window.Event('change', { bubbles: true }));
const input = el => el.dispatchEvent(new window.Event('input', { bubbles: true }));

function type(id, value) {
  const el = $(id);
  el.value = value;
  return el;
}

const STORAGE_KEY = 'grading-system-data-v2';

/** Fresh DOM + fresh module graph, so each test starts from a known state. */
async function reboot() {
  document.body.innerHTML = BODY;
  vi.resetModules();
  await import('./main.js');
  // boot() is async; let its awaited load settle before asserting.
  await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Boots the app over empty storage, or over `seed` when one is given.
 *
 * Writes are blocked for the duration. vi.resetModules() hands each test its
 * own module graph, but the previous test's debounced save is still sitting on
 * a timer the *old* graph owns, and dynamic import yields to the event loop —
 * so without this, a stale save can land between the wipe and the load, and the
 * new app boots holding the last test's gradebook.
 */
async function boot(seed) {
  const realSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = () => {};
  try {
    localStorage.clear();
    if (seed !== undefined) realSetItem.call(localStorage, STORAGE_KEY, seed);
    await reboot();
  } finally {
    Storage.prototype.setItem = realSetItem;
  }
}

/**
 * Runs an action that triggers a download and returns the file it produced.
 *
 * jsdom has Blob but no URL.createObjectURL, so the blob is intercepted there.
 * Both forms are returned because decoding to text strips the leading BOM —
 * only the raw bytes can show whether it was written.
 */
async function captureDownload(action) {
  let captured = null;
  URL.createObjectURL = blob => { captured = blob; return 'blob:stub'; };
  URL.revokeObjectURL = () => {};
  action();
  if (!captured) throw new Error('nothing was downloaded');
  return {
    text: await captured.text(),
    bytes: new Uint8Array(await captured.arrayBuffer())
  };
}

beforeEach(async () => {
  window.confirm = () => true;
  window.alert = () => {};
  window.print = () => {};
  await boot();
});

/* ---------- it starts ---------- */

describe('boot', () => {
  it('renders without throwing and creates a first section', () => {
    expect($('sectionSelect').options.length).toBe(1);
    expect($('courseNameInput').value).toBe('Section 1');
    expect($('studentEmpty').style.display).toBe('block');
  });

  it('shows no account UI on the localStorage backend', () => {
    expect($('authBox').style.display).toBe('none');
    expect($('authBanner').style.display).toBe('none');
  });

  it('opens every page without error', () => {
    ['grades', 'reports', 'settings', 'setup'].forEach(page => {
      click(document.querySelector(`.nav-item[data-page="${page}"]`));
      expect($('page-' + page).style.display).toBe('block');
    });
  });
});

/* ---------- setting a section up ---------- */

describe('setup', () => {
  function addStudent(name, id = '', email = '') {
    type('studentNameInput', name);
    type('studentIdInput', id);
    type('studentEmailInput', email);
    click($('addStudentBtn'));
  }

  function addCategory(name, weight) {
    type('catNameInput', name);
    type('catWeightInput', String(weight));
    click($('addCatBtn'));
  }

  function addAssignment(name, max) {
    type('assignNameInput', name);
    type('assignMaxInput', String(max));
    click($('addAssignBtn'));
  }

  it('adds a student with an ID and email', () => {
    addStudent('Ada Lovelace', 'S-001', 'ada@example.edu');
    const row = $('studentList').querySelector('tr');
    expect(row.querySelector('[data-field="name"]').value).toBe('Ada Lovelace');
    expect(row.querySelector('[data-field="studentId"]').value).toBe('S-001');
    expect(row.querySelector('[data-field="email"]').value).toBe('ada@example.edu');
    expect($('studentCountTag').textContent).toBe('(1)');
  });

  it('edits a student in place', () => {
    addStudent('Ada');
    const field = $('studentList').querySelector('[data-field="name"]');
    field.value = 'Ada L.';
    change(field);
    expect($('studentList').querySelector('[data-field="name"]').value).toBe('Ada L.');
  });

  it('flags two students sharing a name but keeps them separate', () => {
    addStudent('Sam Reyes');
    addStudent('Sam Reyes');
    expect($('studentList').querySelectorAll('tr').length).toBe(2);
    expect($('studentList').querySelectorAll('.dup-flag').length).toBe(2);
  });

  it('searches the roster by ID as well as by name', () => {
    addStudent('Ada', 'S-001');
    addStudent('Grace', 'S-002');
    const box = type('studentSearchSetup', 's-002');
    input(box);
    expect($('studentList').querySelectorAll('tr').length).toBe(1);
    expect($('studentList').querySelector('[data-field="name"]').value).toBe('Grace');
  });

  it('warns when the category weights miss 100%', () => {
    addCategory('Quizzes', 30);
    expect($('weightWarn').style.display).toBe('block');
    expect($('weightWarn').textContent).toContain('30%');

    addCategory('Exams', 70);
    expect($('weightWarn').style.display).toBe('none');
  });

  it('will not add an assignment before a category exists', () => {
    expect($('addAssignBtn').disabled).toBe(true);
    addAssignment('Quiz 1', 10);
    expect($('assignList').querySelectorAll('tr').length).toBe(0);

    addCategory('Quizzes', 100);
    expect($('addAssignBtn').disabled).toBe(false);
    addAssignment('Quiz 1', 10);
    expect($('assignList').querySelectorAll('tr').length).toBe(1);
  });

  it('marks a zero-point assignment as bonus', () => {
    addCategory('Quizzes', 100);
    addAssignment('Bonus round', 0);
    expect($('assignList').querySelector('.hint-flag').textContent.trim()).toBe('bonus');
  });

  it('spells out the drop-lowest rule once one is set', () => {
    addCategory('Quizzes', 100);
    const drop = $('catList').querySelector('[data-field="dropLowest"]');
    drop.value = '1';
    change(drop);
    expect($('dropNote').style.display).toBe('block');
    expect($('dropNote').textContent).toContain('1 lowest from Quizzes');
  });

  it('deletes an assignment and its scores together', () => {
    type('studentNameInput', 'Ada');
    click($('addStudentBtn'));
    addCategory('Quizzes', 100);
    addAssignment('Quiz 1', 10);

    click(document.querySelector('.nav-item[data-page="grades"]'));
    expect($('gradesMatrix').querySelectorAll('[data-action="score"]').length).toBe(1);

    click(document.querySelector('.nav-item[data-page="setup"]'));
    click($('assignList').querySelector('[data-action="remove"]'));
    expect($('assignList').querySelectorAll('tr').length).toBe(0);

    // The matrix was hidden during the delete, so this also checks that a page
    // invalidated while off screen is redrawn when it comes back.
    click(document.querySelector('.nav-item[data-page="grades"]'));
    expect($('gradesMatrix').innerHTML).toBe('');
  });
});

/* ---------- bulk roster entry ---------- */

describe('roster import', () => {
  const paste = value => {
    const box = $('importText');
    box.value = value;
    input(box);
    return box;
  };

  const openPanel = () => click($('importToggleBtn'));

  it('stays out of the way until it is opened', () => {
    expect($('importPanel').style.display).toBe('none');
    openPanel();
    expect($('importPanel').style.display).toBe('');
    expect($('importConfirmBtn').disabled).toBe(true);
  });

  it('adds 150 students from one spreadsheet paste', () => {
    openPanel();
    paste(Array.from({ length: 150 }, (_, i) =>
      `Student ${i + 1}\tS-${String(i + 1).padStart(3, '0')}\ts${i + 1}@example.edu`
    ).join('\n'));

    expect($('importSummary').textContent).toContain('150');
    expect($('importConfirmBtn').textContent).toContain('Add 150 students');

    click($('importConfirmBtn'));

    expect($('studentCountTag').textContent).toBe('(150)');
    expect($('importPanel').style.display).toBe('none');

    const rows = $('studentList').querySelectorAll('tr');
    expect(rows.length).toBe(150);
    expect(rows[149].querySelector('[data-field="name"]').value).toBe('Student 150');
    expect(rows[149].querySelector('[data-field="studentId"]').value).toBe('S-150');
    expect(rows[149].querySelector('[data-field="email"]').value).toBe('s150@example.edu');
  });

  it('takes a bare list of names with no other detail', () => {
    openPanel();
    paste('Ada Lovelace\nGrace Hopper\nAlan Turing');
    click($('importConfirmBtn'));
    expect($('studentCountTag').textContent).toBe('(3)');
  });

  it('previews before it commits anything', () => {
    openPanel();
    paste('Ada Lovelace\nGrace Hopper');
    // Nothing is created just by looking at it.
    expect($('studentCountTag').textContent).toBe('(0)');
    expect($('importPreview').querySelectorAll('tbody tr').length).toBe(2);
  });

  it('skips students already in the section instead of doubling them', () => {
    type('studentNameInput', 'Ada Lovelace');
    click($('addStudentBtn'));

    openPanel();
    paste('Ada Lovelace\nGrace Hopper');

    expect($('importSummary').textContent).toContain('already in this section');
    expect($('importConfirmBtn').textContent).toContain('Add 1 student');

    click($('importConfirmBtn'));
    expect($('studentCountTag').textContent).toBe('(2)');
  });

  it('refuses to import when everything is a duplicate', () => {
    type('studentNameInput', 'Ada Lovelace');
    click($('addStudentBtn'));

    openPanel();
    paste('Ada Lovelace');
    expect($('importConfirmBtn').disabled).toBe(true);
    expect($('importConfirmBtn').textContent).toContain('Nothing new');
  });

  it('offers a name-order control only when the split is ambiguous', () => {
    openPanel();
    paste('Ada Lovelace\tS-001');
    expect($('importNameOrderRow').style.display).toBe('none');

    paste('Lovelace, Ada\nHopper, Grace');
    expect($('importNameOrderRow').style.display).toBe('');
    expect($('importSummary').textContent).toContain('Last, First');
    expect($('importPreview').textContent).toContain('Ada Lovelace');
  });

  it('lets the user overrule the name-order guess', () => {
    openPanel();
    paste('Lovelace, Ada');
    $('importNameOrder').value = 'first-last';
    change($('importNameOrder'));
    expect($('importPreview').textContent).toContain('Lovelace');

    click($('importConfirmBtn'));
    expect($('studentList').querySelector('[data-field="studentId"]').value).toBe('Ada');
  });

  it('maps columns from a header row in any order', () => {
    openPanel();
    paste('Email,Last Name,First Name\nada@example.edu,Lovelace,Ada');
    click($('importConfirmBtn'));

    const row = $('studentList').querySelector('tr');
    expect(row.querySelector('[data-field="name"]').value).toBe('Ada Lovelace');
    expect(row.querySelector('[data-field="email"]').value).toBe('ada@example.edu');
  });

  it('throws the paste away on cancel', () => {
    openPanel();
    paste('Ada Lovelace');
    click($('importCancelBtn'));

    expect($('importPanel').style.display).toBe('none');
    expect($('importText').value).toBe('');
    expect($('studentCountTag').textContent).toBe('(0)');
  });

  it('copies a roster from another section, with independent records', () => {
    openPanel();
    paste('Ada Lovelace\nGrace Hopper');
    click($('importConfirmBtn'));

    type('newSectionInput', 'Block B');
    click($('addSectionBtn2'));
    expect($('studentCountTag').textContent).toBe('(0)'); // new section starts empty

    openPanel();
    expect($('copySectionRow').style.display).toBe('');
    click($('copySectionBtn'));

    expect($('studentCountTag').textContent).toBe('(2)');

    // Renaming the copy must not touch the original.
    const field = $('studentList').querySelector('[data-field="name"]');
    field.value = 'Ada L.';
    change(field);

    $('sectionSelect').value = $('sectionSelect').options[0].value;
    change($('sectionSelect'));
    expect($('studentList').querySelector('[data-field="name"]').value).toBe('Ada Lovelace');
  });

  it('hides the copy option when there is nowhere to copy from', () => {
    openPanel();
    expect($('copySectionRow').style.display).toBe('none');
  });
});

/* ---------- entering grades ---------- */

describe('grades', () => {
  beforeEach(() => {
    type('studentNameInput', 'Ada');
    click($('addStudentBtn'));
    type('catNameInput', 'Quizzes');
    type('catWeightInput', '100');
    click($('addCatBtn'));
    type('assignNameInput', 'Quiz 1');
    type('assignMaxInput', '10');
    click($('addAssignBtn'));
    click(document.querySelector('.nav-item[data-page="grades"]'));
  });

  const scoreBox = () => $('gradesMatrix').querySelector('[data-action="score"]');
  const statusBox = () => $('gradesMatrix').querySelector('[data-action="status"]');
  const finalCell = () => $('gradesMatrix').querySelector('.final-cell');

  it('shows an em dash, not 0%, before anything is graded', () => {
    expect(finalCell().textContent).toContain('—');
  });

  it('turns a typed score into a percentage and a letter', () => {
    const box = scoreBox();
    box.value = '9';
    change(box);
    expect(finalCell().textContent).toContain('90%');
    expect(finalCell().textContent).toContain('A');
  });

  it('counts missing work as zero and excused work as nothing at all', () => {
    const status = statusBox();
    status.value = 'missing';
    change(status);
    expect(finalCell().textContent).toContain('0%');
    expect(scoreBox().disabled).toBe(true);

    status.value = 'excused';
    change(status);
    expect(finalCell().textContent).toContain('—');
  });

  it('accepts a score above the maximum as extra credit', () => {
    const box = scoreBox();
    box.value = '12';
    change(box);
    expect(box.classList.contains('extra-credit')).toBe(true);
    expect(finalCell().textContent).toContain('120%');
  });

  it('keeps the score when the row is redrawn', () => {
    const box = scoreBox();
    box.value = '7';
    change(box);
    click(document.querySelector('.nav-item[data-page="setup"]'));
    click(document.querySelector('.nav-item[data-page="grades"]'));
    expect(scoreBox().value).toBe('7');
  });

  it('only shows the days-late box once the policy is on', () => {
    expect($('gradesMatrix').querySelector('[data-action="late"]')).toBeNull();

    click(document.querySelector('.nav-item[data-page="settings"]'));
    $('lateEnabled').checked = true;
    change($('lateEnabled'));
    click(document.querySelector('.nav-item[data-page="grades"]'));

    expect($('gradesMatrix').querySelector('[data-action="late"]')).not.toBeNull();
  });

  it('applies the late penalty to the final grade', () => {
    click(document.querySelector('.nav-item[data-page="settings"]'));
    $('lateEnabled').checked = true;
    change($('lateEnabled'));
    click(document.querySelector('.nav-item[data-page="grades"]'));

    const box = scoreBox();
    box.value = '10';
    change(box);
    const days = $('gradesMatrix').querySelector('[data-action="late"]');
    days.value = '2';
    change(days);

    expect(finalCell().textContent).toContain('80%'); // 10 points, 20% off
  });
});

/* ---------- rendering only what is on screen ---------- */

describe('render scope', () => {
  const nav = page => click(document.querySelector(`.nav-item[data-page="${page}"]`));

  function buildClass(students = 150, assignments = 1) {
    click($('importToggleBtn'));
    const box = $('importText');
    box.value = Array.from({ length: students }, (_, i) => `Student ${i + 1}`).join('\n');
    input(box);
    click($('importConfirmBtn'));

    type('catNameInput', 'Quizzes');
    type('catWeightInput', '100');
    click($('addCatBtn'));
    for (let i = 1; i <= assignments; i++) {
      type('assignNameInput', 'Quiz ' + i);
      type('assignMaxInput', '10');
      click($('addAssignBtn'));
    }
  }

  it('never builds the score matrix while Setup is the open page', () => {
    buildClass(150, 5);
    // 150 students and five assignments went in without the matrix being touched.
    expect($('gradesMatrix').innerHTML).toBe('');

    nav('grades');
    expect($('gradesMatrix').querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  });

  it('redraws a page that changed while it was hidden', () => {
    buildClass(3, 1);
    nav('grades');
    expect($('gradesMatrix').querySelectorAll('tbody tr').length).toBe(3);

    nav('setup');
    type('studentNameInput', 'Late Arrival');
    click($('addStudentBtn'));

    nav('grades');
    expect($('gradesMatrix').querySelectorAll('tbody tr').length).toBe(4);
  });

  it('refreshes reports after scores are typed, even though the matrix does not redraw', () => {
    buildClass(1, 1);
    nav('grades');

    const box = $('gradesMatrix').querySelector('[data-action="score"]');
    box.value = '9';
    change(box);

    nav('reports');
    expect($('reportList').querySelector('.grade-card').textContent).toContain('90%');
  });

  it('leaves an unchanged page alone when you flip back to it', () => {
    buildClass(3, 1);
    nav('grades');
    const first = $('gradesMatrix').querySelector('tbody tr');

    nav('reports');
    nav('grades');
    // Same node, so nothing was rebuilt for a page that did not change.
    expect($('gradesMatrix').querySelector('tbody tr')).toBe(first);
  });
});

/* ---------- paging a large class ---------- */

describe('matrix paging', () => {
  const nav = page => click(document.querySelector(`.nav-item[data-page="${page}"]`));
  const rows = () => $('gradesMatrix').querySelectorAll('tbody tr').length;

  beforeEach(() => {
    click($('importToggleBtn'));
    const box = $('importText');
    box.value = Array.from({ length: 150 }, (_, i) => `Student ${String(i + 1).padStart(3, '0')}`).join('\n');
    input(box);
    click($('importConfirmBtn'));

    type('catNameInput', 'Quizzes');
    type('catWeightInput', '100');
    click($('addCatBtn'));
    type('assignNameInput', 'Quiz 1');
    type('assignMaxInput', '10');
    click($('addAssignBtn'));

    nav('grades');
  });

  it('shows one page of students rather than all 150', () => {
    expect(rows()).toBe(50);
    expect($('matrixPager').style.display).toBe('');
    expect($('matrixPagerInfo').textContent).toBe('Showing 1–50 of 150 students');
    expect($('matrixPageLabel').textContent).toBe('Page 1 of 3');
  });

  it('walks forward and back through the pages', () => {
    expect($('matrixPager').querySelector('[data-page-nav="prev"]').disabled).toBe(true);

    click($('matrixPager').querySelector('[data-page-nav="next"]'));
    expect($('matrixPagerInfo').textContent).toBe('Showing 51–100 of 150 students');
    expect($('gradesMatrix').querySelector('.student-cell').textContent).toBe('Student 051');

    click($('matrixPager').querySelector('[data-page-nav="next"]'));
    expect($('matrixPageLabel').textContent).toBe('Page 3 of 3');
    expect($('matrixPager').querySelector('[data-page-nav="next"]').disabled).toBe(true);

    click($('matrixPager').querySelector('[data-page-nav="prev"]'));
    expect($('matrixPageLabel').textContent).toBe('Page 2 of 3');
  });

  it('can show everyone when asked', () => {
    $('matrixPageSize').value = '0';
    change($('matrixPageSize'));
    expect(rows()).toBe(150);
    expect($('matrixPagerInfo').textContent).toBe('Showing 1–150 of 150 students');
  });

  it('keeps a typed score when paging away and back', () => {
    const box = $('gradesMatrix').querySelector('[data-action="score"]');
    box.value = '7';
    change(box);

    click($('matrixPager').querySelector('[data-page-nav="next"]'));
    click($('matrixPager').querySelector('[data-page-nav="prev"]'));

    expect($('gradesMatrix').querySelector('[data-action="score"]').value).toBe('7');
  });

  it('searches the whole roster, not just the visible page', () => {
    const box = type('studentSearchGrades', 'student 137');
    input(box);
    expect(rows()).toBe(1);
    expect($('gradesMatrix').querySelector('.student-cell').textContent).toBe('Student 137');
  });

  it('returns to the first page when a new search narrows the list', () => {
    click($('matrixPager').querySelector('[data-page-nav="next"]'));
    expect($('matrixPageLabel').textContent).toBe('Page 2 of 3');

    const box = type('studentSearchGrades', 'student 1');
    input(box);
    expect($('matrixPageLabel').textContent).toContain('Page 1');
  });

  it('does not strand you past the end when the roster shrinks', () => {
    click($('matrixPager').querySelector('[data-page-nav="next"]'));
    click($('matrixPager').querySelector('[data-page-nav="next"]'));
    expect($('matrixPageLabel').textContent).toBe('Page 3 of 3');

    nav('setup');
    const box = type('studentSearchSetup', 'Student 1');
    input(box);
    // Remove enough students that page 3 no longer exists.
    for (let i = 0; i < 60; i++) {
      const remove = $('studentList').querySelector('[data-action="remove"]');
      if (!remove) break;
      click(remove);
    }

    nav('grades');
    expect($('matrixPageLabel').textContent).toBe('Page 2 of 2');
    expect(rows()).toBeGreaterThan(0);
  });

  it('hides the pager for an ordinary class that fits on one page', () => {
    nav('setup');
    const box = type('studentSearchGrades', '');
    input(box);
    nav('grades');
    const search = type('studentSearchGrades', 'student 00');
    input(search);
    expect($('matrixPager').style.display).toBe('none');
  });
});

/* ---------- policy ---------- */

describe('settings', () => {
  it('switches the whole scale to plus/minus', () => {
    click(document.querySelector('.nav-item[data-page="settings"]'));
    click($('scalePresetPlusMinus'));
    expect($('scaleList').querySelectorAll('tr').length).toBe(13);
    expect($('scaleList').querySelector('[data-action="scale-letter"]').value).toBe('A+');
  });

  it('warns when no band covers 0%', () => {
    click(document.querySelector('.nav-item[data-page="settings"]'));
    const rows = $('scaleList').querySelectorAll('[data-action="scale-remove"]');
    click(rows[rows.length - 1]); // drop the F band
    expect($('scaleWarn').style.display).toBe('block');
    expect($('scaleWarn').textContent).toContain('0%');
  });

  it('refuses to remove the last remaining band', () => {
    click(document.querySelector('.nav-item[data-page="settings"]'));
    for (let i = 0; i < 10; i++) {
      const buttons = $('scaleList').querySelectorAll('[data-action="scale-remove"]');
      if (buttons.length <= 1) break;
      click(buttons[buttons.length - 1]);
    }
    expect($('scaleList').querySelectorAll('tr').length).toBe(1);
  });

  it('changes how many decimals a grade shows', () => {
    type('studentNameInput', 'Ada');
    click($('addStudentBtn'));
    type('catNameInput', 'Quizzes');
    type('catWeightInput', '100');
    click($('addCatBtn'));
    type('assignNameInput', 'Quiz 1');
    type('assignMaxInput', '3');
    click($('addAssignBtn'));
    click(document.querySelector('.nav-item[data-page="grades"]'));

    const box = $('gradesMatrix').querySelector('[data-action="score"]');
    box.value = '2';
    change(box);
    expect($('gradesMatrix').querySelector('.final-cell').textContent).toContain('67%');

    click(document.querySelector('.nav-item[data-page="settings"]'));
    $('roundingSelect').value = 'hundredth';
    change($('roundingSelect'));
    click(document.querySelector('.nav-item[data-page="grades"]'));
    expect($('gradesMatrix').querySelector('.final-cell').textContent).toContain('66.67%');
  });
});

/* ---------- reports ---------- */

describe('reports', () => {
  beforeEach(() => {
    ['Ada', 'Grace'].forEach(name => {
      type('studentNameInput', name);
      click($('addStudentBtn'));
    });
    type('catNameInput', 'Quizzes');
    type('catWeightInput', '100');
    click($('addCatBtn'));
    type('assignNameInput', 'Quiz 1');
    type('assignMaxInput', '10');
    click($('addAssignBtn'));

    click(document.querySelector('.nav-item[data-page="grades"]'));
    const boxes = $('gradesMatrix').querySelectorAll('[data-action="score"]');
    boxes[0].value = '9';
    change(boxes[0]);
    boxes[1].value = '5';
    change(boxes[1]);

    click(document.querySelector('.nav-item[data-page="reports"]'));
  });

  const tab = name => click(document.querySelector(`#reportTabs [data-panel="${name}"]`));

  it('gives each student a card with a grade and a letter', () => {
    const cards = $('reportList').querySelectorAll('.grade-card');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('90%');
    expect(cards[0].textContent).toContain('A');
    expect(cards[1].textContent).toContain('50%');
  });

  it('builds a printable grade sheet with a class summary', () => {
    tab('sheet');
    const table = $('gradeSheet').querySelector('table');
    expect(table.querySelectorAll('tbody tr').length).toBe(3); // 2 students + summary
    expect($('gradeSheet').textContent).toContain('70%'); // class average
  });

  it('reports per-assignment statistics', () => {
    tab('stats');
    const row = $('statsTable').querySelector('tbody tr');
    expect(row.textContent).toContain('Quiz 1');
    expect($('statsSummary').textContent).toContain('70%');
    expect($('statsTable').textContent).toContain('9'); // high
  });

  it('breaks one assignment down across the class, best first', () => {
    tab('assignment');
    const rows = $('assignmentReport').querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Ada');
    expect(rows[0].textContent).toContain('9 / 10');
  });

  it('jumps from a statistics row to that assignment', () => {
    tab('stats');
    click($('statsTable').querySelector('tbody tr'));
    expect($('assignmentReport').textContent).toContain('Quiz 1');
  });

  it('hides the student search on the panels it does not apply to', () => {
    tab('students');
    expect($('reportSearchBox').style.display).toBe('');
    tab('stats');
    expect($('reportSearchBox').style.display).toBe('none');
  });

  it('exports the section as a CSV a spreadsheet can read', async () => {
    const { text: csv, bytes } = await captureDownload(() => click($('exportCsvBtn')));

    // A UTF-8 BOM, so Excel does not mangle accented names.
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xEF, 0xBB, 0xBF]);

    const lines = csv.trim().split('\r\n');
    const header = lines.find(l => l.startsWith('Student,'));
    expect(header).toContain('Quiz 1 (/10)');
    expect(header).toContain('Quizzes %');
    expect(header.endsWith('Final %,Letter')).toBe(true);

    expect(lines.find(l => l.startsWith('Ada,'))).toContain('90,A');
    expect(lines.find(l => l.startsWith('Grace,'))).toContain('50,F');
  });

  it('writes missing and excused work as words, not as blanks', async () => {
    click(document.querySelector('.nav-item[data-page="grades"]'));
    const status = $('gradesMatrix').querySelectorAll('[data-action="status"]')[1];
    status.value = 'missing';
    change(status);
    click(document.querySelector('.nav-item[data-page="reports"]'));

    const { text: csv } = await captureDownload(() => click($('exportCsvBtn')));
    expect(csv).toContain('Missing');
  });

  it('quotes a name containing a comma', async () => {
    click(document.querySelector('.nav-item[data-page="setup"]'));
    const field = $('studentList').querySelector('[data-field="name"]');
    field.value = 'Lovelace, Ada';
    change(field);
    click(document.querySelector('.nav-item[data-page="reports"]'));

    const { text: csv } = await captureDownload(() => click($('exportCsvBtn')));
    expect(csv).toContain('"Lovelace, Ada"');
  });

  it('counts missing and not-yet-graded work on the student card', () => {
    click(document.querySelector('.nav-item[data-page="setup"]'));
    type('assignNameInput', 'Quiz 2');
    type('assignMaxInput', '10');
    click($('addAssignBtn'));

    click(document.querySelector('.nav-item[data-page="grades"]'));
    const status = $('gradesMatrix').querySelectorAll('[data-action="status"]')[1];
    status.value = 'missing';
    change(status);

    click(document.querySelector('.nav-item[data-page="reports"]'));
    expect($('reportList').querySelector('.grade-card').textContent).toContain('1 missing');
  });
});

/* ---------- persistence ---------- */

describe('persistence', () => {
  it('reloads what was entered', async () => {
    type('studentNameInput', 'Ada');
    click($('addStudentBtn'));
    type('courseTitleInput', 'English 9');
    input($('courseTitleInput'));

    // Let the 400ms debounce fire before tearing the app down.
    await new Promise(resolve => setTimeout(resolve, 500));
    await reboot();

    expect($('studentList').querySelector('[data-field="name"]').value).toBe('Ada');
    expect($('courseTitleInput').value).toBe('English 9');
  });

  it('starts clean when storage holds nonsense', async () => {
    await boot('{"sections":"not an array"}');
    expect($('sectionSelect').options.length).toBe(1);
    expect($('studentEmpty').style.display).toBe('block');
  });

  it('carries a pre-v3 save over instead of discarding it', async () => {
    await boot(JSON.stringify({
      activeSectionId: 'sec1',
      sections: [{
        id: 'sec1',
        name: 'Block A',
        students: [{ id: 'stu1', name: 'Ada' }],
        categories: [{ id: 'cat1', name: 'Quizzes', weight: 100 }],
        assignments: [{ id: 'asg1', name: 'Quiz 1', categoryId: 'cat1', max: 10 }],
        scores: { stu1_asg1: { score: 8, excused: false } }
      }]
    }));

    expect($('courseNameInput').value).toBe('Block A');
    click(document.querySelector('.nav-item[data-page="grades"]'));
    expect($('gradesMatrix').querySelector('[data-action="score"]').value).toBe('8');
    expect($('gradesMatrix').querySelector('.final-cell').textContent).toContain('80%');
  });
});
