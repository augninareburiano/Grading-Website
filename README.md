# Grading-Website

A multi-section gradebook. One course with a name and term, any number of
sections, and for each section its own roster, weighted grade categories,
assignments, and scores. The Reports page turns those into weighted final
grades, class statistics, printable sheets, and CSV exports.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

| Script                 | What it does                                  |
| ---------------------- | --------------------------------------------- |
| `npm run dev`          | Dev server with hot reload                    |
| `npm run build`        | Production build into `dist/`                 |
| `npm run preview`      | Serve the built `dist/` to check it locally   |
| `npm test`             | Run the test suite once                       |
| `npm run test:watch`   | Re-run tests as files change                  |

## Layout

```
index.html            markup only — every id here is what the JS binds to
vercel.json           hosting config (static build + cache headers)
firestore.rules       security rules for the Firebase backend
src/
  main.js             boot: wire modules, load data, first render
  render.js           renderAll() — redraws every view
  bus.js              requestRender(), so modules don't import render.js
  state.js            the state object + load/save
  migrate.js          schema defaults + bringing old saves up to date
  utils.js            uid, escapeHtml, showToast
  grading.js          pure grade math (no DOM) — the heavily tested part
  nav.js              page switching
  sections.js         section switcher, add/rename/delete
  course.js           course name and term
  students.js         roster: name, ID number, email
  roster-parse.js     pure parsing of a pasted/uploaded roster — tested
  roster-import.js    the paste/upload/copy UI and its preview
  categories.js       categories, weights, drop-lowest, weight bar
  assignments.js      assignments: category, max, due date, type
  settings.js         grade scale, rounding, late-work policy
  grades.js           the score matrix
  reports.js          student reports + printable grade sheet
  stats.js            class statistics + per-assignment breakdown
  export.js           CSV export
  auth-ui.js          sign-in UI, only for backends that have accounts
  api/
    index.js          picks an adapter — the only door to storage
    local.js          localStorage (default)
    firebase.js       Firestore + Google sign-in
    remote.js         plain HTTP adapter for a backend of your own
  grading.test.js     the grade rules, as unit tests
  app.test.js         boots the real app in jsdom and drives it through the DOM
legacy/
  grading-system.html the original single-file version, kept for reference
```

### How a change flows

A module mutates `state`, calls `scheduleSave()` (debounced 400ms) and
`requestRender()`. `render.js` redraws the sidebar and **the page you are
looking at**, and flags the others in `bus.js` to be redrawn when they are next
opened. No module needs to know which other views its change affects.

That split is what makes a full class affordable. Redrawing everything was fine
at thirty students; at 150 the score matrix alone is tens of thousands of nodes,
and rebuilding it on every keystroke in Setup — where it is not on screen — was
most of the cost for none of the benefit. Adding a student while Setup is open
now touches the matrix zero times.

Two places deliberately opt out of a redraw entirely, because it would fight the
user: the score matrix patches the individual cell and the student's final grade
as you tab through it, and free-text fields skip themselves while focused.
Anything that skips the redraw must say what it invalidated — typing a score
patches its own cell, but it changes every report, so `grades.js` calls
`invalidate('reports')`.

The matrix also pages its rows (25/50/100/everyone, default 50). Search runs
across the whole roster, not just the visible page.

Event handlers are **delegated**: rows carry `data-action` / `data-field` /
`data-id` and each module puts one listener on the container. Inline `onclick=`
will not work here — handlers live in module scope, which the global HTML scope
can't reach. Editable table cells commit on `change` (which fires on blur), so
the redraw that follows can never land mid-keystroke.

## Data

`src/api/` is the only place that touches storage. Every adapter implements the
same two methods:

```js
load()      // -> Promise<state | null>   null = nothing saved yet
save(state) // -> Promise<void>           throws on failure
```

An adapter that knows who the user is also exposes `auth` (see `api/index.js`);
the sign-in UI renders only when it is present, so the localStorage build shows
no account controls at all. Adapters are imported dynamically, so an unused
backend is never loaded at runtime.

Pick one with `VITE_DATA_BACKEND` in `.env.local` — `local`, `firebase`, or
`remote`. Copy `.env.example` to get started.

### State shape

```js
{
  schemaVersion: 3,
  course:  { name, term },
  grading: {
    scale: [{ letter, min }],                      // sorted high to low
    rounding: 'whole' | 'tenth' | 'hundredth',
    latePenalty: { enabled, percentPerDay, maxPercent }
  },
  activeSectionId: "ab12cd34",
  sections: [{
    id, name,
    students:    [{ id, name, studentId, email }],
    categories:  [{ id, name, weight, dropLowest }],    // weight is a percentage
    assignments: [{ id, name, categoryId, max, dueDate, type }],
    scores:      { "<studentId>_<assignmentId>": { score, status, lateDays } }
  }]
}
```

`migrate.js` normalises anything loaded from storage into this shape, including
saves from before the schema existed. It is forgiving on purpose: unknown values
are replaced with defaults rather than throwing, orphaned scores are dropped,
and an `activeSectionId` pointing at a deleted section is repointed.

## Adding a class of students

Typing 150 students in one at a time is not a workflow, and the roster already
exists somewhere. **Paste a list** in the Students card accepts:

- a bare list of names, one per line
- a copy straight out of Excel or Google Sheets (tab-separated)
- a CSV or semicolon-separated export, with or without a header row
- a header in any column order (`Name` / `Student ID` / `Email`, and the common
  aliases including `LRN`, `Surname`, `Given name`)
- names split across `Last Name` / `First Name` / `Middle Name` columns
- `Lovelace, Ada` reversed-name format, detected and put back the right way

A `.csv`, `.tsv`, or `.txt` file can be chosen instead of pasting, and a whole
roster can be copied from another section (students get fresh ids, so the two
sections' scores stay independent).

Nothing is created until the preview is confirmed. The parser has to guess at
the delimiter, the header, and the name order; every guess is shown on screen
and can be overruled, because a wrong guess applied silently to 150 students is
far more work to undo than to prevent. Students already in the section are
detected — by ID where there is one, by name otherwise — and skipped rather than
duplicated, with the count of what was skipped shown before you commit.

`roster-parse.js` is pure and carries its own tests for each of those formats.

## Grading rules

Each cell in the matrix is in one of four states:

| State        | Means                        | Effect on the average          |
| ------------ | ---------------------------- | ------------------------------ |
| blank        | not marked yet               | left out of the denominator    |
| **missing**  | not handed in                | counts as zero out of the max  |
| **excused**  | does not apply to them       | left out of the denominator    |
| a score      | marked                       | earned / max                   |

The blank vs. missing distinction is what keeps a student who joined mid-term
from being punished for assignments they were never set.

Then, in order:

- **Late work** loses `percentPerDay` of its points per day late, capped at
  `maxPercent`, and never drops below zero. Off by default; the days-late box
  only appears in the matrix once it is on.
- **Drop lowest** removes the N lowest-scoring counted assignments in a
  category, ranked by their own percentage — so a missing zero goes before a
  weak real score. At least one always survives, so a student with a single
  graded quiz keeps it.
- A **category** is `sum(earned) / sum(possible)` over what remains.
- The **final grade** is the weighted mean of the categories that have data,
  with the remaining weights re-normalised — so a half-finished term reads as a
  real percentage instead of being dragged toward zero. Nothing graded at all
  shows an em dash, never 0%.
- The result is **rounded once**, and the **letter** comes from the rounded
  number against the editable scale. With whole-number rounding an 89.5 becomes
  90 and earns an A.

**Extra credit** works two ways: a score above the maximum is allowed and pushes
the percentage past 100, and an assignment with a max of 0 is pure bonus — its
points can only add, and it is never chosen by drop-lowest.

Weights that do not total 100% raise a warning. Grades stay readable in the
meantime, because they are scaled across whatever weight is present.

## Reports

Four views over the same numbers, and **Print** prints whichever one is open:

- **Student reports** — one card per student, with the category breakdown and
  counts of missing / excused / not-yet-graded work.
- **Grade sheet** — the whole class on one page, with a class summary row and
  the grade scale printed underneath.
- **Class statistics** — mean, median, high, and low per assignment, plus how
  many are graded, missing, and excused. Averages cover graded work only, so a
  newly created assignment does not look like a class-wide failure; an
  assignment the class genuinely struggled with is flagged.
- **By assignment** — every student's score on one assignment, best first.

**Export CSV** writes the whole section — one row per student, one column per
assignment, plus category percentages, final, and letter. The per-assignment
panel has its own export. Percentages are written as bare numbers so a
spreadsheet or LMS importer can read them.

## Backend: Firebase

Each teacher's whole gradebook is one Firestore document at `gradebooks/{uid}`,
which keeps the `load()` / `save()` contract the app already speaks. A
classroom-sized gradebook is far below the 1MB document limit; the split to
per-section documents, if a school ever needs it, sits behind the same adapter
interface.

1. Create a Firebase project, add a **Web app**, and copy its config.
2. Enable **Authentication > Sign-in method > Google**.
3. Create a **Firestore** database.
4. Deploy the rules in `firestore.rules` — they restrict every document to the
   signed-in user who owns it:
   ```bash
   firebase deploy --only firestore:rules
   ```
5. Copy `.env.example` to `.env.local`, set `VITE_DATA_BACKEND=firebase`, and
   fill in the `VITE_FIREBASE_*` values.

The Firebase web config is public by design — it identifies the project and
authorises nothing. Access is decided entirely by the security rules and by who
is signed in. Never put a service account key in `.env`.

Offline edits are queued in Firestore's local cache and flush when the
connection returns. Signed out, the app renders empty behind a sign-in prompt
and refuses to save rather than pretending to.

## Hosting: Vercel

`vercel.json` builds with Vite and serves `dist/` as a static site, with
immutable caching on hashed assets and no caching on `index.html`.

```bash
npm i -g vercel
vercel            # preview deployment
vercel --prod
```

Set the `VITE_*` variables in **Project Settings > Environment Variables**.
They are read at *build* time, not run time, so changing one needs a redeploy.

Then add your Vercel domain to **Firebase Console > Authentication > Settings >
Authorized domains**, or Google sign-in will be rejected in production.

## Tests

```bash
npm test
```

- `grading.test.js` covers the rules above directly: missing vs. excused vs.
  blank, drop-lowest ordering and its floor, late penalties and their cap, extra
  credit past 100%, weight re-normalisation, rounding at the boundary, custom
  and +/− scales, statistics, and the migration of old saves.
- `app.test.js` boots the real `index.html` in jsdom and drives the real app
  through the DOM, so a renamed element id or an unbound handler fails a test
  instead of shipping as a blank page.
