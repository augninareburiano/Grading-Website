import { getActiveSection, scheduleSave } from './state.js';
import { requestRender } from './bus.js';
import { uid, escapeHtml } from './utils.js';

let search = '';

export function initStudents() {
  document.getElementById('addStudentBtn').addEventListener('click', addStudent);
  document.getElementById('studentNameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addStudent();
  });

  document.getElementById('studentSearchSetup').addEventListener('input', e => {
    search = e.target.value.toLowerCase();
    renderStudents();
  });

  document.getElementById('studentList').addEventListener('click', e => {
    const el = e.target.closest('[data-action="remove"]');
    if (el) removeStudent(el.dataset.id);
  });
}

function addStudent() {
  const active = getActiveSection();
  const input = document.getElementById('studentNameInput');
  const name = input.value.trim();
  if (!name || !active) return;
  active.students.push({ id: uid(), name });
  input.value = '';
  scheduleSave();
  requestRender();
}

function removeStudent(id) {
  const active = getActiveSection();
  if (!active) return;
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

  const filtered = active.students.filter(s => s.name.toLowerCase().includes(search));
  tbody.innerHTML = filtered.map(s => `<tr>
    <td>${escapeHtml(s.name)}</td>
    <td style="text-align:right;width:36px;">
      <button class="btn-icon" data-action="remove" data-id="${s.id}" title="Remove">✕</button>
    </td>
  </tr>`).join('');

  document.getElementById('studentCountTag').textContent = `(${active.students.length})`;
  empty.style.display = filtered.length ? 'none' : 'block';
  empty.textContent = active.students.length
    ? 'No students match your search.'
    : 'No students yet — add your first one above.';
}
