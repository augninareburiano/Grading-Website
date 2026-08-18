import { state, getActiveSection, scheduleSave } from './state.js';
import { requestRender } from './bus.js';
import { uid, escapeHtml, showToast } from './utils.js';
import { parseRoster, planImport } from './roster-parse.js';

/**
 * Bulk roster entry: paste a list, drop a file, or copy another section.
 *
 * Adding 150 students one at a time is not a workflow, and the roster already
 * exists somewhere — a spreadsheet, an SIS export, an email. So the job here is
 * reading what is already on the clipboard, not making people retype it.
 *
 * Nothing is created until the preview is confirmed. The parser guesses at the
 * delimiter, the header, and the name order; every guess is shown on screen and
 * can be overruled, because a wrong guess applied silently to 150 students is
 * far more work to undo than to prevent.
 */
const PREVIEW_LIMIT = 8;

const STATUS_LABELS = {
  new: 'add',
  'duplicate-id': 'already here — same ID',
  'duplicate-name': 'already here — same name',
  'duplicate-in-paste': 'repeated in this list',
  invalid: 'no name'
};

let isOpen = false;
let text = '';
let nameOrder = 'auto';

export function initRosterImport() {
  document.getElementById('importToggleBtn').addEventListener('click', () => {
    isOpen = !isOpen;
    renderRosterImport();
    if (isOpen) document.getElementById('importText').focus();
  });

  document.getElementById('importCancelBtn').addEventListener('click', () => {
    isOpen = false;
    text = '';
    nameOrder = 'auto';
    document.getElementById('importText').value = '';
    renderRosterImport();
  });

  const textarea = document.getElementById('importText');
  textarea.addEventListener('input', () => {
    text = textarea.value;
    renderPreview();
  });

  document.getElementById('importFile').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      text = await file.text();
      textarea.value = text;
      renderPreview();
    } catch (err) {
      console.error('Could not read the file', err);
      showToast('Could not read that file');
    }
    e.target.value = ''; // let the same file be picked again after a fix
  });

  document.getElementById('importNameOrder').addEventListener('change', e => {
    nameOrder = e.target.value;
    renderPreview();
  });

  document.getElementById('importConfirmBtn').addEventListener('click', runImport);
  document.getElementById('copySectionBtn').addEventListener('click', copyFromSection);
}

/* ---------- importing ---------- */

function currentPlan() {
  const active = getActiveSection();
  const parsed = parseRoster(text, { nameOrder });
  return { parsed, plan: planImport(parsed.rows, active ? active.students : []) };
}

function runImport() {
  const active = getActiveSection();
  if (!active) return;

  const { plan } = currentPlan();
  const incoming = plan.rows.filter(row => row.status === 'new');
  if (!incoming.length) return;

  incoming.forEach(row => {
    active.students.push({
      id: uid(),
      name: row.name,
      studentId: row.studentId,
      email: row.email
    });
  });

  const skipped = plan.counts.duplicate + plan.counts.invalid;
  isOpen = false;
  text = '';
  nameOrder = 'auto';
  document.getElementById('importText').value = '';

  scheduleSave();
  requestRender();
  showToast(
    `Added ${incoming.length} student${incoming.length === 1 ? '' : 's'}` +
    (skipped ? ` · skipped ${skipped}` : '')
  );
}

/**
 * Copies another section's roster. Students get fresh ids so the two sections'
 * scores stay entirely separate — the same child in two blocks is two records.
 */
function copyFromSection() {
  const active = getActiveSection();
  const sourceId = document.getElementById('copySectionSelect').value;
  const source = state.sections.find(s => s.id === sourceId);
  if (!active || !source || source.id === active.id) return;

  const { rows, counts } = planImport(
    source.students.map(s => ({ name: s.name, studentId: s.studentId, email: s.email })),
    active.students
  );

  const incoming = rows.filter(row => row.status === 'new');
  if (!incoming.length) {
    showToast('Every one of them is already in this section');
    return;
  }
  if (!confirm(`Copy ${incoming.length} student${incoming.length === 1 ? '' : 's'} from "${source.name}" into "${active.name}"?`)) return;

  incoming.forEach(row => {
    active.students.push({ id: uid(), name: row.name, studentId: row.studentId, email: row.email });
  });

  scheduleSave();
  requestRender();
  showToast(`Copied ${incoming.length} · skipped ${counts.duplicate + counts.invalid}`);
}

/* ---------- rendering ---------- */

export function renderRosterImport() {
  const panel = document.getElementById('importPanel');
  panel.style.display = isOpen ? '' : 'none';
  document.getElementById('importToggleBtn').textContent = isOpen
    ? 'Close import'
    : 'Paste a list';

  renderCopySources();
  if (isOpen) renderPreview();
}

/** Only sections that actually have someone to copy are worth offering. */
function renderCopySources() {
  const select = document.getElementById('copySectionSelect');
  const row = document.getElementById('copySectionRow');
  const active = getActiveSection();

  const sources = state.sections.filter(s => active && s.id !== active.id && s.students.length);
  row.style.display = sources.length ? '' : 'none';

  const previous = select.value;
  select.innerHTML = sources
    .map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${s.students.length})</option>`)
    .join('');
  if (previous && sources.some(s => s.id === previous)) select.value = previous;
}

function renderPreview() {
  const summary = document.getElementById('importSummary');
  const table = document.getElementById('importPreview');
  const button = document.getElementById('importConfirmBtn');
  const orderRow = document.getElementById('importNameOrderRow');

  if (!text.trim()) {
    summary.innerHTML = '<span class="muted">Paste your list above and a preview will appear here.</span>';
    table.innerHTML = '';
    button.disabled = true;
    button.textContent = 'Add students';
    orderRow.style.display = 'none';
    return;
  }

  const { parsed, plan } = currentPlan();
  document.getElementById('importNameOrder').value = nameOrder;

  // The name-order control only makes sense when the split is ambiguous, which
  // is exactly the two-comma-fields case the parser has to guess at.
  const ambiguous = parsed.delimiter === ',' && !parsed.hasHeader;
  orderRow.style.display = ambiguous ? '' : 'none';

  summary.innerHTML = describe(parsed, plan.counts);

  const shown = plan.rows.slice(0, PREVIEW_LIMIT);
  table.innerHTML = `<thead><tr>
      <th>Name</th><th>ID</th><th>Email</th><th></th>
    </tr></thead><tbody>${shown.map(row => `<tr class="${row.status === 'new' ? '' : 'row-skip'}">
      <td>${escapeHtml(row.name) || '<span class="muted">—</span>'}</td>
      <td class="mono muted">${escapeHtml(row.studentId) || '—'}</td>
      <td class="mono muted">${escapeHtml(row.email) || '—'}</td>
      <td class="num"><span class="flag ${row.status === 'new' ? 'flag-bonus' : 'flag-missing'}">${STATUS_LABELS[row.status]}</span></td>
    </tr>`).join('')}</tbody>`;

  if (plan.rows.length > PREVIEW_LIMIT) {
    table.innerHTML += `<tfoot><tr><td colspan="4" class="muted">
      …and ${plan.rows.length - PREVIEW_LIMIT} more
    </td></tr></tfoot>`;
  }

  button.disabled = plan.counts.new === 0;
  button.textContent = plan.counts.new
    ? `Add ${plan.counts.new} student${plan.counts.new === 1 ? '' : 's'}`
    : 'Nothing new to add';
}

function describe(parsed, counts) {
  const bits = [`Read <b>${counts.total}</b> ${counts.total === 1 ? 'line' : 'lines'}`];
  bits.push(escapeHtml(parsed.delimiterLabel));
  if (parsed.hasHeader) bits.push('header row detected');
  if (parsed.nameOrderGuessed) bits.push('read as <b>Last, First</b>');

  const warnings = [];
  if (counts.duplicate) warnings.push(`${counts.duplicate} already in this section`);
  if (counts.invalid) warnings.push(`${counts.invalid} with no name`);

  return `<span>${bits.join('  ·  ')}</span>` +
    (warnings.length ? `<span class="import-warn">Skipping ${warnings.join(' and ')}.</span>` : '');
}
