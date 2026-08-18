# Grading-Website

A multi-section gradebook. Each section keeps its own students, weighted grade
categories, assignments, and scores; the Reports page turns those into weighted
final grades you can print.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

| Script            | What it does                                  |
| ----------------- | --------------------------------------------- |
| `npm run dev`     | Dev server with hot reload                    |
| `npm run build`   | Production build into `dist/`                 |
| `npm run preview` | Serve the built `dist/` to check it locally   |

## Layout

```
index.html            markup only — every id here is what the JS binds to
src/
  main.js             boot: wire modules, load data, first render
  render.js           renderAll() — redraws every view
  bus.js              requestRender(), so modules don't import render.js
  state.js            the state object + load/save
  utils.js            uid, escapeHtml, showToast
  grading.js          pure grade math (no DOM) — the part worth unit testing
  sections.js         section switcher, add/rename/delete
  students.js         student list + search
  categories.js       categories, weights, weight bar
  assignments.js      assignments + the category dropdown
  grades.js           the score matrix
  reports.js          final grades, letter grades, print
  api/
    index.js          picks an adapter — the only door to storage
    local.js          localStorage (default)
    remote.js         HTTP adapter for a future backend (not active yet)
legacy/
  grading-system.html the original single-file version, kept for reference
```

### How a change flows

A module mutates `state`, calls `scheduleSave()` (debounced 400ms) and
`requestRender()`. `render.js` redraws everything — cheap at classroom scale,
and it means no module needs to know which other views its change affects.

Event handlers are **delegated**: rows carry `data-action` / `data-id` and each
module puts one listener on the container. Inline `onclick=` will not work here
— handlers live in module scope, which the global HTML scope can't reach.

## Data

`src/api/` is the only place that touches storage. Every adapter implements the
same two methods:

```js
load()      // -> Promise<state | null>   null = nothing saved yet
save(state) // -> Promise<void>           throws on failure
```

Today it's `local.js` (localStorage — this browser only). To move to a real
backend, implement the two endpoints `remote.js` already expects
(`GET`/`PUT {VITE_API_URL}/gradebook`), copy `.env.example` to `.env.local` and
set `VITE_DATA_BACKEND=remote`. No UI code changes.

### State shape

```js
{
  activeSectionId: "ab12cd34",
  sections: [{
    id, name,
    students:    [{ id, name }],
    categories:  [{ id, name, weight }],           // weight is a percentage
    assignments: [{ id, name, categoryId, max }],
    scores:      { "<studentId>_<assignmentId>": { score, excused } }
  }]
}
```

## Grading rules

- A category's percentage is `sum(earned) / sum(max)` over its graded,
  non-excused assignments.
- Categories with nothing graded are skipped, and the remaining weights are
  re-normalised — so a half-finished term reads as a real percentage instead of
  being dragged toward zero.
- Blank score = not graded yet. "exc." excludes that assignment from the
  student's average entirely.
- Letters: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, else F.
