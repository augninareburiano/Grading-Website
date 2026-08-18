import { getActiveSection, scheduleSave } from './state.js';
import { requestRender } from './bus.js';
import { uid, escapeHtml } from './utils.js';
import { ASSIGNMENT_TYPES } from './migrate.js';

/**
 * Assignments: what the work was, which category it counts toward, what it was
 * out of, when it was due, and what kind of thing it is.
 *
 * A max of 0 is allowed and means pure extra credit — points that can only add.
 */
export function initAssignments() {
  document.getElementById('addAssignBtn').addEventListener('click', addAssignment);
  document.getElementById('assignNameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addAssignment();
  });

  const list = document.getElementById('assignList');
  list.addEventListener('click', e => {
    const el = e.target.closest('[data-action="remove"]');
    if (el) removeAssignment(el.dataset.id);
  });
  list.addEventListener('change', e => {
    const el = e.target.closest('[data-field]');
    if (el) updateAssignment(el.dataset.id, el.dataset.field, el.value);
  });
}

function addAssignment() {
  const active = getActiveSection();
  const nameInput = document.getElementById('assignNameInput');
  const maxInput = document.getElementById('assignMaxInput');
  const dueInput = document.getElementById('assignDueInput');
  const catSelect = document.getElementById('assignCatSelect');
  const typeSelect = document.getElementById('assignTypeSelect');

  const name = nameInput.value.trim();
  const categoryId = catSelect.value;
  const max = maxInput.value === '' ? 100 : Math.max(0, Number(maxInput.value));
  if (!name || !categoryId || !active || !Number.isFinite(max)) return;

  active.assignments.push({
    id: uid(),
    name,
    categoryId,
    max,
    dueDate: dueInput.value,
    type: ASSIGNMENT_TYPES.includes(typeSelect.value) ? typeSelect.value : 'other'
  });

  nameInput.value = '';
  dueInput.value = '';
  nameInput.focus();
  scheduleSave();
  requestRender();
}

function updateAssignment(id, field, value) {
  const active = getActiveSection();
  const assignment = active && active.assignments.find(a => a.id === id);
  if (!assignment) return;

  if (field === 'name') {
    const name = value.trim();
    if (!name) return requestRender();
    assignment.name = name;
  } else if (field === 'max') {
    const max = Number(value);
    if (!Number.isFinite(max) || max < 0) return requestRender();
    // Scores are kept as entered; changing the max re-scales every percentage
    // that uses it, which is what "I marked it out of 20, not 25" should do.
    assignment.max = max;
  } else if (field === 'categoryId') {
    if (!active.categories.some(c => c.id === value)) return requestRender();
    assignment.categoryId = value;
  } else if (field === 'type') {
    assignment.type = ASSIGNMENT_TYPES.includes(value) ? value : 'other';
  } else if (field === 'dueDate') {
    assignment.dueDate = value;
  }

  scheduleSave();
  requestRender();
}

function removeAssignment(id) {
  const active = getActiveSection();
  if (!active) return;

  const assignment = active.assignments.find(a => a.id === id);
  const scored = Object.keys(active.scores).filter(k => k.endsWith('_' + id)).length;
  if (assignment && scored && !confirm(
    `Delete "${assignment.name}"? ${scored} entered ${scored === 1 ? 'score' : 'scores'} will be deleted with it.`
  )) return;

  active.assignments = active.assignments.filter(a => a.id !== id);
  Object.keys(active.scores).forEach(k => {
    if (k.endsWith('_' + id)) delete active.scores[k];
  });
  scheduleSave();
  requestRender();
}

export function renderAssignments() {
  const active = getActiveSection();
  const tbody = document.getElementById('assignList');
  tbody.innerHTML = '';
  if (!active) return;

  tbody.innerHTML = active.assignments.map(a => `<tr>
    <td>
      <input type="text" class="cell-input" value="${escapeHtml(a.name)}"
        data-field="name" data-id="${a.id}" aria-label="Assignment name">
    </td>
    <td>
      <select class="cell-input" data-field="categoryId" data-id="${a.id}" aria-label="Category">
        ${categoryOptions(active, a.categoryId)}
      </select>
    </td>
    <td>
      <select class="cell-input" data-field="type" data-id="${a.id}" aria-label="Type">
        ${ASSIGNMENT_TYPES.map(t =>
          `<option value="${t}" ${t === a.type ? 'selected' : ''}>${label(t)}</option>`
        ).join('')}
      </select>
    </td>
    <td style="width:96px;">
      <input type="number" class="cell-input mono" value="${a.max}" min="0" step="0.5"
        data-field="max" data-id="${a.id}" aria-label="Max score" style="width:78px;">
      ${a.max === 0 ? '<span class="hint-flag" title="Worth 0 points, so every point scored is bonus.">bonus</span>' : ''}
    </td>
    <td style="width:150px;">
      <input type="date" class="cell-input mono" value="${escapeHtml(a.dueDate)}"
        data-field="dueDate" data-id="${a.id}" aria-label="Due date" style="width:138px;">
    </td>
    <td style="text-align:right;width:36px;">
      <button class="btn-icon" data-action="remove" data-id="${a.id}" title="Remove">✕</button>
    </td>
  </tr>`).join('');

  document.getElementById('assignEmpty').style.display = active.assignments.length ? 'none' : 'block';
  renderAddFormOptions(active);
}

function label(type) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function categoryOptions(active, selectedId) {
  if (!active.categories.length) return '<option value="">No categories yet</option>';
  return active.categories
    .map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');
}

/** Keeps the "add assignment" controls in sync with the categories list. */
function renderAddFormOptions(active) {
  const catSelect = document.getElementById('assignCatSelect');
  const previous = catSelect.value;
  catSelect.innerHTML = categoryOptions(active, previous);
  // Keep the user's pick selected across re-renders when it still exists.
  if (previous && active.categories.some(c => c.id === previous)) catSelect.value = previous;

  const typeSelect = document.getElementById('assignTypeSelect');
  if (!typeSelect.options.length) {
    typeSelect.innerHTML = ASSIGNMENT_TYPES
      .map(t => `<option value="${t}">${label(t)}</option>`)
      .join('');
    typeSelect.value = 'quiz';
  }

  const addBtn = document.getElementById('addAssignBtn');
  addBtn.disabled = !active.categories.length;
  addBtn.title = active.categories.length ? '' : 'Add a grade category first';
}
