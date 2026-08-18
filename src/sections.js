import { state, getActiveSection, createSection, scheduleSave } from './state.js';
import { requestRender } from './bus.js';
import { escapeHtml, showToast } from './utils.js';

export function initSections() {
  document.getElementById('sectionSelect').addEventListener('change', e => {
    state.activeSectionId = e.target.value;
    scheduleSave();
    requestRender();
  });

  document.getElementById('addSectionBtn').addEventListener('click', quickAddSection);
  document.getElementById('addSectionBtn2').addEventListener('click', addSectionFromForm);

  document.getElementById('newSectionInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addSectionFromForm();
  });

  // One delegated handler for every row in the sections table.
  document.getElementById('sectionList').addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id } = el.dataset;
    if (action === 'switch') switchToSection(id);
    if (action === 'rename') renameSection(id);
    if (action === 'remove') removeSection(id);
  });

  document.getElementById('saveCourseName').addEventListener('click', saveCourseName);
  document.getElementById('courseNameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveCourseName();
  });
}

function quickAddSection() {
  const name = prompt('Name for the new section/block:', 'New Section');
  if (!name || !name.trim()) return;
  addSection(name.trim());
}

function addSectionFromForm() {
  const input = document.getElementById('newSectionInput');
  const name = input.value.trim();
  if (!name) return;
  input.value = '';
  addSection(name);
}

function addSection(name) {
  const s = createSection(name);
  state.sections.push(s);
  state.activeSectionId = s.id;
  scheduleSave();
  requestRender();
}

function switchToSection(id) {
  state.activeSectionId = id;
  scheduleSave();
  requestRender();
}

function renameSection(id) {
  const sec = state.sections.find(s => s.id === id);
  if (!sec) return;
  const name = prompt('Rename section:', sec.name);
  if (!name || !name.trim()) return;
  sec.name = name.trim();
  scheduleSave();
  requestRender();
}

function removeSection(id) {
  if (state.sections.length <= 1) {
    alert('You need at least one section.');
    return;
  }
  const sec = state.sections.find(s => s.id === id);
  if (!sec) return;
  if (!confirm(`Delete "${sec.name}" and all its students, grades, and assignments? This can't be undone.`)) return;
  state.sections = state.sections.filter(s => s.id !== id);
  if (state.activeSectionId === id) state.activeSectionId = state.sections[0].id;
  scheduleSave();
  requestRender();
}

function saveCourseName() {
  const active = getActiveSection();
  const v = document.getElementById('courseNameInput').value.trim();
  if (!v || !active) return;
  active.name = v;
  scheduleSave();
  requestRender();
  showToast('Section name updated');
}

export function renderSectionSwitcher() {
  const sel = document.getElementById('sectionSelect');
  sel.innerHTML = state.sections
    .map(s => `<option value="${s.id}" ${s.id === state.activeSectionId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`)
    .join('');

  const active = getActiveSection();
  document.getElementById('sectionMeta').textContent =
    active ? `${active.students.length} student${active.students.length === 1 ? '' : 's'}` : '';

  const totalStudents = state.sections.reduce((sum, s) => sum + s.students.length, 0);
  document.getElementById('totalCountDisplay').textContent =
    `${state.sections.length} section${state.sections.length === 1 ? '' : 's'} · ${totalStudents} total`;
  document.getElementById('courseTitleDisplay').textContent = active ? active.name : '—';
  document.getElementById('courseInitial').textContent = active ? active.name.charAt(0).toUpperCase() : 'S';

  document.getElementById('setupHeroTitle').textContent =
    active ? `Build ${active.name}, once.` : 'Build this section, once.';
  document.getElementById('gradesHeroTitle').textContent =
    active ? `Enter scores for ${active.name}.` : "Enter today's scores.";
  document.getElementById('reportsHeroTitle').textContent =
    active ? `See how ${active.name} is doing.` : 'See how this section is doing.';
}

export function renderSectionList() {
  const tbody = document.getElementById('sectionList');
  tbody.innerHTML = state.sections.map(s => {
    const isActive = s.id === state.activeSectionId;
    return `<tr class="${isActive ? 'active-row' : ''}">
      <td style="width:20px;">${isActive ? '<span style="color:var(--good);">●</span>' : ''}</td>
      <td style="font-weight:600;cursor:pointer;" data-action="switch" data-id="${s.id}">${escapeHtml(s.name)}</td>
      <td style="color:var(--ink-muted);font-family:'JetBrains Mono',monospace;">${s.students.length} students</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn-icon edit" data-action="rename" data-id="${s.id}" title="Rename">✎</button>
        <button class="btn-icon" data-action="remove" data-id="${s.id}" title="Delete">✕</button>
      </td>
    </tr>`;
  }).join('');
}
