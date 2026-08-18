import { getActiveSection, scheduleSave } from './state.js';
import { requestRender } from './bus.js';
import { uid, escapeHtml } from './utils.js';

export const COLORS = ['#c3e85a', '#7aa6d6', '#eea23f', '#c19be0', '#7fd6b0', '#e08a9b'];

export function categoryColor(index) {
  return COLORS[index % COLORS.length];
}

/**
 * Grade categories, their weights, and their drop-lowest rule.
 *
 * "Drop lowest" belongs here rather than in the course-wide policy because it
 * is a property of the category — dropping a quiz is normal, dropping a final
 * exam is not.
 */
export function initCategories() {
  document.getElementById('addCatBtn').addEventListener('click', addCategory);
  ['catNameInput', 'catWeightInput'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') addCategory();
    });
  });

  const list = document.getElementById('catList');
  list.addEventListener('click', e => {
    const el = e.target.closest('[data-action="remove"]');
    if (el) removeCategory(el.dataset.id);
  });
  list.addEventListener('change', e => {
    const el = e.target.closest('[data-field]');
    if (el) updateCategory(el.dataset.id, el.dataset.field, el.value);
  });
}

function addCategory() {
  const active = getActiveSection();
  const nameInput = document.getElementById('catNameInput');
  const weightInput = document.getElementById('catWeightInput');
  const name = nameInput.value.trim();
  const weight = parseFloat(weightInput.value);
  if (!name || !Number.isFinite(weight) || weight < 0 || !active) return;

  active.categories.push({ id: uid(), name, weight, dropLowest: 0 });
  nameInput.value = '';
  weightInput.value = '';
  nameInput.focus();
  scheduleSave();
  requestRender();
}

function updateCategory(id, field, value) {
  const active = getActiveSection();
  const category = active && active.categories.find(c => c.id === id);
  if (!category) return;

  if (field === 'name') {
    const name = value.trim();
    if (!name) return requestRender();
    category.name = name;
  } else if (field === 'weight') {
    const weight = Number(value);
    if (!Number.isFinite(weight) || weight < 0) return requestRender();
    category.weight = weight;
  } else if (field === 'dropLowest') {
    const drop = Number(value);
    if (!Number.isFinite(drop) || drop < 0) return requestRender();
    category.dropLowest = Math.round(drop);
  }

  scheduleSave();
  requestRender();
}

function removeCategory(id) {
  const active = getActiveSection();
  if (!active) return;

  const category = active.categories.find(c => c.id === id);
  const doomed = active.assignments.filter(a => a.categoryId === id);
  if (category && doomed.length && !confirm(
    `Delete "${category.name}"? Its ${doomed.length} ${doomed.length === 1 ? 'assignment' : 'assignments'} and their scores go too.`
  )) return;

  // Removing a category takes its assignments — and their scores — with it.
  const removedAssignIds = new Set(doomed.map(a => a.id));
  active.categories = active.categories.filter(c => c.id !== id);
  active.assignments = active.assignments.filter(a => a.categoryId !== id);
  Object.keys(active.scores).forEach(k => {
    const assignmentId = k.slice(k.indexOf('_') + 1);
    if (removedAssignIds.has(assignmentId)) delete active.scores[k];
  });

  scheduleSave();
  requestRender();
}

export function renderCategories() {
  const active = getActiveSection();
  const tbody = document.getElementById('catList');
  tbody.innerHTML = '';
  if (!active) return;

  tbody.innerHTML = active.categories.map((c, i) => {
    const color = categoryColor(i);
    const count = active.assignments.filter(a => a.categoryId === c.id).length;
    return `<tr>
      <td>
        <span class="cat-swatch" style="background:${color};"></span>
        <input type="text" class="cell-input" value="${escapeHtml(c.name)}"
          data-field="name" data-id="${c.id}" aria-label="Category name" style="width:calc(100% - 20px);">
      </td>
      <td style="width:96px;">
        <input type="number" class="cell-input mono" value="${c.weight}" min="0" step="0.5"
          data-field="weight" data-id="${c.id}" aria-label="Weight percent" style="width:74px;">
      </td>
      <td style="width:92px;">
        <input type="number" class="cell-input mono" value="${c.dropLowest}" min="0" step="1"
          data-field="dropLowest" data-id="${c.id}" aria-label="Drop lowest count" style="width:64px;"
          title="Drop this many of the student's lowest scores in this category">
      </td>
      <td style="color:var(--ink-muted);font-size:11.5px;">
        ${count} ${count === 1 ? 'assignment' : 'assignments'}
      </td>
      <td style="text-align:right;width:36px;">
        <button class="btn-icon" data-action="remove" data-id="${c.id}" title="Remove">✕</button>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('catEmpty').style.display = active.categories.length ? 'none' : 'block';
  renderWeightBar(active);
  renderDropNote(active);
}

function renderWeightBar(active) {
  const bar = document.getElementById('weightBar');
  const legend = document.getElementById('weightLegend');
  const total = active.categories.reduce((sum, c) => sum + Number(c.weight || 0), 0);

  bar.innerHTML = active.categories.map((c, i) => {
    const width = total > 0 ? (c.weight / total * 100) : 0;
    return `<div class="weight-seg" style="width:${width}%;background:${categoryColor(i)};"></div>`;
  }).join('');

  legend.innerHTML = active.categories.map((c, i) =>
    `<span><span class="dot" style="background:${categoryColor(i)}"></span>${escapeHtml(c.name)} ${c.weight}%</span>`
  ).join('');

  const warn = document.getElementById('weightWarn');
  if (active.categories.length && Math.abs(total - 100) > 0.001) {
    warn.style.display = 'block';
    warn.textContent = `Weights total ${round(total)}% — adjust so categories add up to 100%. `
      + 'Until then grades are scaled across whatever weight is present, so they stay readable but will shift when you fix this.';
  } else {
    warn.style.display = 'none';
  }
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/** Spells out the drop rule in words, since a bare number in a column is cryptic. */
function renderDropNote(active) {
  const note = document.getElementById('dropNote');
  const dropping = active.categories.filter(c => c.dropLowest > 0);

  note.style.display = dropping.length ? 'block' : 'none';
  note.textContent = dropping.length
    ? 'Dropping: ' + dropping
        .map(c => `${c.dropLowest} lowest from ${c.name}`)
        .join(', ')
      + '. One assignment always survives, so a student with a single graded score keeps it.'
    : '';
}
