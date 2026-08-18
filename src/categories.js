import { getActiveSection, scheduleSave } from './state.js';
import { requestRender } from './bus.js';
import { uid, escapeHtml } from './utils.js';

export const COLORS = ['#c3e85a', '#7aa6d6', '#eea23f', '#c19be0', '#7fd6b0', '#e08a9b'];

export function categoryColor(index) {
  return COLORS[index % COLORS.length];
}

export function initCategories() {
  document.getElementById('addCatBtn').addEventListener('click', addCategory);
  document.getElementById('catNameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addCategory();
  });
  document.getElementById('catWeightInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addCategory();
  });

  document.getElementById('catList').addEventListener('click', e => {
    const el = e.target.closest('[data-action="remove"]');
    if (el) removeCategory(el.dataset.id);
  });
}

function addCategory() {
  const active = getActiveSection();
  const nameInput = document.getElementById('catNameInput');
  const weightInput = document.getElementById('catWeightInput');
  const name = nameInput.value.trim();
  const weight = parseFloat(weightInput.value);
  if (!name || isNaN(weight) || weight < 0 || !active) return;

  active.categories.push({ id: uid(), name, weight });
  nameInput.value = '';
  weightInput.value = '';
  scheduleSave();
  requestRender();
}

function removeCategory(id) {
  const active = getActiveSection();
  if (!active) return;

  // Removing a category takes its assignments — and their scores — with it.
  const removedAssignIds = active.assignments.filter(a => a.categoryId === id).map(a => a.id);
  active.categories = active.categories.filter(c => c.id !== id);
  active.assignments = active.assignments.filter(a => a.categoryId !== id);
  Object.keys(active.scores).forEach(k => {
    const assignmentId = k.split('_')[1];
    if (removedAssignIds.includes(assignmentId)) delete active.scores[k];
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
    return `<tr>
      <td><span class="pill" style="color:${color};border:1px solid ${color}55;">${escapeHtml(c.name)}</span></td>
      <td style="font-family:'JetBrains Mono',monospace;">${c.weight}%</td>
      <td style="text-align:right;width:36px;">
        <button class="btn-icon" data-action="remove" data-id="${c.id}" title="Remove">✕</button>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('catEmpty').style.display = active.categories.length ? 'none' : 'block';

  renderWeightBar(active);
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
  if (active.categories.length && total !== 100) {
    warn.style.display = 'block';
    warn.textContent = `Weights total ${total}% — adjust so categories add up to 100%.`;
  } else {
    warn.style.display = 'none';
  }
}
