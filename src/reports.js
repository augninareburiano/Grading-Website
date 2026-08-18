import { getActiveSection } from './state.js';
import { computeStudentGrade, letterGrade } from './grading.js';
import { escapeHtml } from './utils.js';

let search = '';

export function initReports() {
  document.getElementById('studentSearchReports').addEventListener('input', e => {
    search = e.target.value.toLowerCase();
    renderReports();
  });

  document.getElementById('printBtn').addEventListener('click', () => window.print());
}

export function renderReports() {
  const active = getActiveSection();
  const list = document.getElementById('reportList');
  const empty = document.getElementById('reportEmpty');

  document.getElementById('reportSub').textContent =
    active ? `${active.name} — weighted final grades by category, ready to print or hand out.` : '';

  if (!active || !active.students.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = 'Nothing to report yet — add students, categories, and scores first.';
    return;
  }

  const filtered = active.students.filter(s => s.name.toLowerCase().includes(search));
  if (!filtered.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = 'No students match your search.';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = filtered.map(s => {
    const { final, catBreakdown } = computeStudentGrade(active, s.id);
    const lg = letterGrade(final);
    const breakdown = catBreakdown
      .map(c => `${escapeHtml(c.name)}: ${c.pct !== null ? c.pct.toFixed(1) + '%' : '—'}`)
      .join('  ·  ');

    return `<div class="grade-card">
      <div>
        <div class="name">${escapeHtml(s.name)}</div>
        <div class="breakdown">${breakdown || 'No categories set up'}</div>
      </div>
      <div style="text-align:right;">
        <div class="grade-badge" style="background:${lg.color}22;color:${lg.color};">${final !== null ? final.toFixed(1) + '%' : '—'}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:${lg.color};margin-top:4px;">${lg.letter}</div>
      </div>
    </div>`;
  }).join('');
}
