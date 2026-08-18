import { getActiveSection, scheduleSave } from './state.js';
import { requestRender } from './bus.js';
import { uid, escapeHtml } from './utils.js';

let search = '';

/**
 * The student roster: name, school ID number, and an optional email for the
 * notification features that may come later.
 *
 * Rows are editable in place. Fields commit on `change` (which fires on blur),
 * so the redraw that follows can never land mid-keystroke.
 */
export function initStudents() {
  document.getElementById('addStudentBtn').addEventListener('click', addStudent);
  ['studentNameInput', 'studentIdInput', 'studentEmailInput'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') addStudent();
    });
  });

  document.getElementById('studentSearchSetup').addEventListener('input', e => {
    search = e.target.value.toLowerCase();
    renderStudents();
  });

  const list = document.getElementById('studentList');
  list.addEventListener('click', e => {
    const el = e.target.closest('[data-action="remove"]');
    if (el) removeStudent(el.dataset.id);
  });
  list.addEventListener('change', e => {
    const el = e.target.closest('[data-field]');
    if (el) updateStudent(el.dataset.id, el.dataset.field, el.value);
  });
}

function addStudent() {
  const active = getActiveSection();
  const nameInput = document.getElementById('studentNameInput');
  const idInput = document.getElementById('studentIdInput');
  const emailInput = document.getElementById('studentEmailInput');

  const name = nameInput.value.trim();
  if (!name || !active) return;

  active.students.push({
    id: uid(),
    name,
    studentId: idInput.value.trim(),
    email: emailInput.value.trim()
  });

  nameInput.value = '';
  idInput.value = '';
  emailInput.value = '';
  nameInput.focus(); // keep a run of additions flowing without reaching for the mouse
  scheduleSave();
  requestRender();
}

function updateStudent(id, field, value) {
  const active = getActiveSection();
  const student = active && active.students.find(s => s.id === id);
  if (!student) return;

  const trimmed = value.trim();
  // A blank name would leave an unclickable row, so put the old one back.
  if (field === 'name' && !trimmed) return requestRender();

  student[field] = trimmed;
  scheduleSave();
  requestRender();
}

function removeStudent(id) {
  const active = getActiveSection();
  if (!active) return;
  const student = active.students.find(s => s.id === id);
  if (student && !confirm(`Remove ${student.name} and all of their scores from this section?`)) return;

  active.students = active.students.filter(s => s.id !== id);
  // Drop this student's scores so they don't linger as orphans.
  Object.keys(active.scores).forEach(k => {
    if (k.startsWith(id + '_')) delete active.scores[k];
  });
  scheduleSave();
  requestRender();
}

export function renderStudents() {
  const active = getActiveSection();
  const tbody = document.getElementById('studentList');
  const empty = document.getElementById('studentEmpty');
  tbody.innerHTML = '';

  if (!active) {
    empty.style.display = 'block';
    return;
  }

  const filtered = active.students.filter(s => matches(s, search));

  // Two students really can share a name; scores are keyed by internal id so
  // nothing breaks, but the roster flags it so the right row gets edited.
  const nameCounts = new Map();
  active.students.forEach(s => {
    const key = s.name.trim().toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  });

  tbody.innerHTML = filtered.map(s => {
    const duplicate = nameCounts.get(s.name.trim().toLowerCase()) > 1;
    return `<tr>
      <td>
        <input type="text" class="cell-input" value="${escapeHtml(s.name)}"
          data-field="name" data-id="${s.id}" aria-label="Student name">
        ${duplicate ? '<span class="dup-flag" title="Another student in this section has the same name. Their scores are still kept separately.">duplicate name</span>' : ''}
      </td>
      <td>
        <input type="text" class="cell-input mono" value="${escapeHtml(s.studentId)}"
          data-field="studentId" data-id="${s.id}" placeholder="ID" aria-label="Student ID number">
      </td>
      <td>
        <input type="email" class="cell-input" value="${escapeHtml(s.email)}"
          data-field="email" data-id="${s.id}" placeholder="email (optional)" aria-label="Student email">
      </td>
      <td style="text-align:right;width:36px;">
        <button class="btn-icon" data-action="remove" data-id="${s.id}" title="Remove">✕</button>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('studentCountTag').textContent = `(${active.students.length})`;
  empty.style.display = filtered.length ? 'none' : 'block';
  empty.textContent = active.students.length
    ? 'No students match your search.'
    : 'No students yet — add your first one above.';
}

/** Search covers ID and email too, so a roster paste can be checked either way. */
function matches(student, term) {
  if (!term) return true;
  return [student.name, student.studentId, student.email]
    .some(field => String(field || '').toLowerCase().includes(term));
}
