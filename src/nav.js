import { activatePage } from './render.js';

const TOPBAR_HINTS = {
  setup: 'Setup — course, students, categories & assignments',
  grades: 'Grades — enter scores',
  reports: 'Reports — final grades, statistics & printable sheets',
  settings: 'Settings — grade scale, rounding & late work'
};

export function initNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });
}

export function showPage(page) {
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.page === page);
  });

  document.querySelectorAll('.page').forEach(p => { p.style.display = 'none'; });
  document.getElementById('page-' + page).style.display = 'block';
  document.getElementById('topbarHint').textContent = TOPBAR_HINTS[page] || '';

  // Redraws the page only if it fell out of date while it was hidden.
  activatePage(page);
}
