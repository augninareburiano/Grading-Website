import { state, scheduleSave } from './state.js';
import { requestRender } from './bus.js';
import { escapeHtml } from './utils.js';
import { DEFAULT_SCALE, PLUS_MINUS_SCALE, ROUNDING_MODES } from './migrate.js';

/**
 * Course-wide grading policy: the letter cutoffs, how much precision survives
 * rounding, and the late-work rule. These live above sections on purpose —
 * they are the instructor's policy, not a property of one block, so changing
 * the scale once applies it everywhere.
 *
 * Scale rows commit on `change` rather than `input`: `change` fires on blur, so
 * the redraw that re-sorts the rows can never happen mid-keystroke.
 */
export function initSettings() {
  document.getElementById('addScaleRowBtn').addEventListener('click', addScaleRow);
  document.getElementById('scalePresetDefault').addEventListener('click', () => applyPreset(DEFAULT_SCALE));
  document.getElementById('scalePresetPlusMinus').addEventListener('click', () => applyPreset(PLUS_MINUS_SCALE));

  const scaleTable = document.getElementById('scaleList');
  scaleTable.addEventListener('change', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'scale-letter') updateScaleRow(Number(el.dataset.index), { letter: el.value });
    if (el.dataset.action === 'scale-min') updateScaleRow(Number(el.dataset.index), { min: el.value });
  });
  scaleTable.addEventListener('click', e => {
    const el = e.target.closest('[data-action="scale-remove"]');
    if (el) removeScaleRow(Number(el.dataset.index));
  });

  document.getElementById('roundingSelect').addEventListener('change', e => {
    state.grading.rounding = ROUNDING_MODES[e.target.value] ? e.target.value : 'whole';
    scheduleSave();
    requestRender();
  });

  document.getElementById('lateEnabled').addEventListener('change', e => {
    state.grading.latePenalty.enabled = e.target.checked;
    scheduleSave();
    requestRender();
  });

  bindLateNumber('latePerDay', 'percentPerDay', 0, Infinity);
  bindLateNumber('lateMax', 'maxPercent', 0, 100);
}

function bindLateNumber(elementId, key, min, max) {
  document.getElementById(elementId).addEventListener('change', e => {
    const value = Number(e.target.value);
    state.grading.latePenalty[key] = Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : min;
    scheduleSave();
    requestRender();
  });
}

/* ---------- scale editing ---------- */

function sortScale() {
  state.grading.scale.sort((a, b) => b.min - a.min);
}

function addScaleRow() {
  const lowest = state.grading.scale.reduce((min, r) => Math.min(min, r.min), 100);
  state.grading.scale.push({ letter: 'New', min: Math.max(0, lowest - 10) });
  sortScale();
  scheduleSave();
  requestRender();
}

function updateScaleRow(index, patch) {
  const row = state.grading.scale[index];
  if (!row) return;

  if (patch.letter !== undefined) {
    const letter = patch.letter.trim();
    if (!letter) return requestRender(); // refuse a blank letter, put the old one back
    row.letter = letter.slice(0, 4);
  }
  if (patch.min !== undefined) {
    const min = Number(patch.min);
    if (!Number.isFinite(min)) return requestRender();
    row.min = Math.max(0, min);
  }

  sortScale();
  scheduleSave();
  requestRender();
}

function removeScaleRow(index) {
  // One band has to remain, or every grade would be unlabelled.
  if (state.grading.scale.length <= 1) return;
  state.grading.scale.splice(index, 1);
  scheduleSave();
  requestRender();
}

function applyPreset(preset) {
  state.grading.scale = preset.map(r => ({ ...r }));
  scheduleSave();
  requestRender();
}

/* ---------- render ---------- */

export function renderSettings() {
  renderScale();
  renderRounding();
  renderLatePolicy();
}

function renderScale() {
  const scale = state.grading.scale;
  document.getElementById('scaleList').innerHTML = scale.map((row, i) => `<tr>
    <td style="width:90px;">
      <input type="text" value="${escapeHtml(row.letter)}" maxlength="4"
        data-action="scale-letter" data-index="${i}" style="width:70px;" aria-label="Letter">
    </td>
    <td style="color:var(--ink-muted);font-size:12px;">at least</td>
    <td style="width:110px;">
      <input type="number" value="${row.min}" min="0" step="0.1"
        data-action="scale-min" data-index="${i}" style="width:88px;" aria-label="Minimum percent">
    </td>
    <td style="color:var(--ink-muted);font-family:'JetBrains Mono',monospace;font-size:11px;">
      ${describeBand(scale, i)}
    </td>
    <td style="text-align:right;width:36px;">
      <button class="btn-icon" data-action="scale-remove" data-index="${i}"
        title="Remove this band" ${scale.length <= 1 ? 'disabled' : ''}>✕</button>
    </td>
  </tr>`).join('');

  renderScaleWarning(scale);
}

/** "90 – 100" style range text, taken from the next band up. */
function describeBand(scale, index) {
  const upper = index === 0 ? null : scale[index - 1].min;
  const lower = scale[index].min;
  return upper === null ? `${lower} and above` : `${lower} up to ${upper}`;
}

function renderScaleWarning(scale) {
  const warn = document.getElementById('scaleWarn');
  const problems = [];

  const letters = scale.map(r => r.letter.toLowerCase());
  if (new Set(letters).size !== letters.length) problems.push('two bands share a letter');

  const mins = scale.map(r => r.min);
  if (new Set(mins).size !== mins.length) problems.push('two bands start at the same percentage');

  // Without a band at 0 there is a hole under the lowest cutoff; grades that
  // land there fall back to the bottom band, which is rarely what was meant.
  if (Math.min(...mins) > 0) problems.push('nothing covers 0% — add a bottom band at 0');

  warn.style.display = problems.length ? 'block' : 'none';
  warn.textContent = problems.length ? `Check the scale: ${problems.join('; ')}.` : '';
}

function renderRounding() {
  const select = document.getElementById('roundingSelect');
  select.innerHTML = Object.entries(ROUNDING_MODES)
    .map(([key, mode]) => `<option value="${key}">${escapeHtml(mode.label)}</option>`)
    .join('');
  select.value = state.grading.rounding;
}

function renderLatePolicy() {
  const { enabled, percentPerDay, maxPercent } = state.grading.latePenalty;

  document.getElementById('lateEnabled').checked = enabled;
  document.getElementById('latePerDay').value = percentPerDay;
  document.getElementById('lateMax').value = maxPercent;

  // The day counters in the grade matrix are meaningless with the rule off, so
  // dim the whole group rather than leave dead inputs looking live.
  const fields = document.getElementById('lateFields');
  fields.style.opacity = enabled ? '1' : '.45';
  fields.querySelectorAll('input').forEach(input => { input.disabled = !enabled; });

  document.getElementById('lateSummary').textContent = enabled
    ? `Late work loses ${percentPerDay}% of its points per day, down to at most ${maxPercent}% off. Set the days late on each score in the Grades tab.`
    : 'Late work is not penalised. Turn this on to count days late in the Grades tab.';
}
