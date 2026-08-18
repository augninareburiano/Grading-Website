import { state, scheduleSave } from './state.js';

/**
 * Course name and term. These sit above sections — one course, many sections —
 * and their only real job is to head up printed reports so a grade sheet that
 * leaves the building says what class and term it belongs to.
 */
export function initCourse() {
  bindField('courseTitleInput', 'name');
  bindField('courseTermInput', 'term');
}

function bindField(elementId, key) {
  const input = document.getElementById(elementId);
  input.addEventListener('input', () => {
    state.course[key] = input.value;
    scheduleSave();
    // Deliberately no requestRender() — a full redraw would reset this input
    // and pull the caret to the end mid-word. Only the readouts need updating.
    renderCourseHeadings();
  });
}

export function renderCourse() {
  const nameInput = document.getElementById('courseTitleInput');
  const termInput = document.getElementById('courseTermInput');

  // Skip while the field has focus, so a redraw triggered elsewhere (adding a
  // student, say) cannot overwrite what is being typed here.
  if (document.activeElement !== nameInput) nameInput.value = state.course.name || '';
  if (document.activeElement !== termInput) termInput.value = state.course.term || '';

  renderCourseHeadings();
}

/** The course line that appears on screen and at the top of every printout. */
export function courseHeading() {
  const { name, term } = state.course;
  return [name, term].filter(Boolean).join(' · ');
}

function renderCourseHeadings() {
  const heading = courseHeading();
  document.querySelectorAll('[data-course-heading]').forEach(el => {
    el.textContent = heading;
    // An empty course line would otherwise leave a gap at the top of the page.
    el.style.display = heading ? '' : 'none';
  });

  const brandSub = document.getElementById('brandSub');
  if (brandSub) {
    // textContent, so no escaping — assigning escaped markup here would print
    // "&amp;" at the user rather than an ampersand.
    brandSub.textContent = state.course.name || 'Multi-section tracker';
  }
}
