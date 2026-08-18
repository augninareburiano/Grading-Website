import { getActiveSection, scheduleSave } from './state.js';
import { requestRender } from './bus.js';
import { uid, escapeHtml } from './utils.js';

export function initAssignments() {
  document.getElementById('addAssignBtn').addEventListener('click', addAssignment);
  document.getElementById('assignNameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addAssignment();
  });

  document.getElementById('assignList').addEventListener('click', e => {
    const el = e.target.closest('[data-action="remove"]');
    if (el) removeAssignment(el.dataset.id);
  });
}

function addAssignment() {
  const active = getActiveSection();
  const nameInput = document.getElementById('assignNameInput');
  const maxInput = document.getElementById('assignMaxInput');
  const catSelect = document.getElementById('assignCatSelect');

  const name = nameInput.value.trim();
  const categoryId = catSelect.value;
  const max = parseFloat(maxInput.value) || 100;
  if (!name || !categoryId || !active) return;

  active.assignments.push({ id: uid(), name, categoryId, max });
  nameInput.value = '';
  scheduleSave();
  requestRender();
}

function removeAssignment(id) {
  const active = getActiveSection();
  if (!active) return;
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

  tbody.innerHTML = active.assignments.map(a => {
    const cat = active.categories.find(c => c.id === a.categoryId);
    return `<tr>
      <td>${escapeHtml(a.name)}</td>
      <td><span class="pill">${cat ? escapeHtml(cat.name) : '—'}</span></td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--ink-muted);">/ ${a.max}</td>
      <td style="text-align:right;width:36px;">
        <button class="btn-icon" data-action="remove" data-id="${a.id}" title="Remove">✕</button>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('assignEmpty').style.display = active.assignments.length ? 'none' : 'block';

  renderCategoryOptions(active);
}

/** Keeps the "add assignment" category dropdown in sync with the categories list. */
function renderCategoryOptions(active) {
  const sel = document.getElementById('assignCatSelect');
  const previous = sel.value;
  sel.innerHTML = active.categories
    .map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join('') || '<option value="">No categories yet</option>';
  // Keep the user's pick selected across re-renders when it still exists.
  if (previous && active.categories.some(c => c.id === previous)) sel.value = previous;
}
