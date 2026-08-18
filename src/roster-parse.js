/**
 * Turns a pasted or uploaded roster into student records.
 *
 * Pure — no DOM, no state. Rosters arrive from wherever the school keeps them,
 * so this is built to accept the real shapes rather than one blessed format:
 * a bare list of names, a copy straight out of Excel or Google Sheets (tabs),
 * a CSV export (commas, sometimes semicolons), with or without a header row,
 * with the name in one column or split across "Last name" and "First name".
 *
 * Nothing is guessed silently. Every decision it makes is reported back —
 * delimiter, header, name order — so the UI can show its work and let the user
 * overrule it before a single student is created.
 */

const HEADER_ALIASES = {
  name: ['name', 'names', 'student', 'students', 'student name', 'fullname', 'full name', 'learner', 'learner name', 'pupil'],
  lastName: ['last', 'last name', 'lastname', 'surname', 'family name', 'apellido'],
  firstName: ['first', 'first name', 'firstname', 'given name', 'givenname'],
  middleName: ['middle', 'middle name', 'middlename', 'middle initial', 'mi'],
  studentId: ['id', 'ids', 'id number', 'id no', 'student id', 'studentid', 'student number', 'student no', 'number', 'no', 'sid', 'lrn'],
  email: ['email', 'emails', 'e-mail', 'mail', 'email address', 'e-mail address']
};

const DELIMITERS = [
  { char: '\t', label: 'tab-separated' },
  { char: ',', label: 'comma-separated' },
  { char: ';', label: 'semicolon-separated' }
];

/* ---------- low-level splitting ---------- */

/** Splits one line, honouring RFC 4180 quoting so "Lovelace, Ada" stays whole. */
export function splitLine(line, delimiter) {
  if (!delimiter) return [line.trim()];

  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);

  return fields.map(f => f.trim());
}

function lines(text) {
  return String(text || '')
    .split(/\r\n|\r|\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

/**
 * Picks the delimiter that splits the most lines consistently.
 *
 * Consistency is what matters, not raw frequency: a list of "Last, First" names
 * has commas everywhere, but so does a real CSV — the tiebreak is that a true
 * delimiter yields the same field count on every line.
 */
export function detectDelimiter(text) {
  const rows = lines(text);
  if (!rows.length) return null;

  let best = null;
  DELIMITERS.forEach(({ char, label }) => {
    const counts = rows.map(row => splitLine(row, char).length);
    const fields = counts[0];
    if (fields < 2) return;

    const consistent = counts.filter(c => c === fields).length / counts.length;
    const score = consistent * fields;
    if (!best || score > best.score) best = { char, label, fields, consistent, score };
  });

  return best;
}

/* ---------- header handling ---------- */

function normaliseHeader(cell) {
  return String(cell || '')
    .toLowerCase()
    .replace(/[._#*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function headerRole(cell) {
  const value = normaliseHeader(cell);
  if (!value) return null;
  return Object.keys(HEADER_ALIASES).find(role => HEADER_ALIASES[role].includes(value)) || null;
}

/**
 * A first row is a header only if it names columns and carries no data of its
 * own — an email or a digit in there means it is a student, not a heading.
 */
function looksLikeHeader(fields) {
  const roles = fields.map(headerRole).filter(Boolean);
  if (!roles.length) return false;
  return !fields.some(f => f.includes('@') || /\d/.test(f));
}

function mapColumns(fields) {
  const columns = {};
  fields.forEach((cell, index) => {
    const role = headerRole(cell);
    if (role && columns[role] === undefined) columns[role] = index;
  });
  return columns;
}

/* ---------- name order ---------- */

/**
 * "Lovelace, Ada" and "Ada, S-104" split identically, so the only honest
 * separator is what the second field looks like: a bare word with no digits and
 * no @ is a given name, anything else is an id or an address.
 */
function guessNameOrder(rows, delimiter) {
  if (delimiter !== ',') return { order: 'first-last', guessed: false };

  const pairs = rows.filter(fields => fields.length === 2);
  if (!pairs.length || pairs.length !== rows.length) {
    return { order: 'first-last', guessed: false };
  }

  const allNameLike = pairs.every(([, second]) =>
    second && !second.includes('@') && !/\d/.test(second) && second.split(/\s+/).length <= 3
  );

  return allNameLike
    ? { order: 'last-first', guessed: true }
    : { order: 'first-last', guessed: false };
}

/* ---------- the main parse ---------- */

/** Everything after the name: an @ is an email, anything else is an id. */
function assignLoose(fields, record) {
  fields.forEach(value => {
    if (!value) return;
    if (value.includes('@')) {
      if (!record.email) record.email = value;
    } else if (!record.studentId) {
      record.studentId = value;
    }
  });
}

function joinName(...parts) {
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} text  pasted or uploaded roster
 * @param {object} [options]
 * @param {'auto'|'first-last'|'last-first'} [options.nameOrder]
 * @returns {{ rows, delimiter, delimiterLabel, hasHeader, columns, nameOrder, nameOrderGuessed, skippedLines }}
 */
export function parseRoster(text, options = {}) {
  const raw = lines(text);
  const detected = detectDelimiter(text);
  const delimiter = detected ? detected.char : null;

  const split = raw.map(line => splitLine(line, delimiter));
  const hasHeader = split.length > 1 && looksLikeHeader(split[0]);
  const columns = hasHeader ? mapColumns(split[0]) : {};
  const body = hasHeader ? split.slice(1) : split;

  const guess = guessNameOrder(hasHeader ? [] : body, delimiter);
  const requested = options.nameOrder || 'auto';
  const nameOrder = requested === 'auto' ? guess.order : requested;

  const rows = body.map((fields, index) => {
    const record = {
      lineNumber: index + 1 + (hasHeader ? 1 : 0),
      name: '',
      studentId: '',
      email: '',
      raw: fields.join(delimiter === '\t' ? ' | ' : (delimiter || ' '))
    };

    if (hasHeader && Object.keys(columns).length) {
      const at = role => (columns[role] === undefined ? '' : (fields[columns[role]] || '').trim());

      record.name = columns.name !== undefined
        ? at('name')
        : joinName(at('firstName'), at('middleName'), at('lastName'));
      record.studentId = at('studentId');
      record.email = at('email');
    } else if (fields.length === 2 && nameOrder === 'last-first') {
      record.name = joinName(fields[1], fields[0]);
    } else {
      record.name = (fields[0] || '').trim();
      assignLoose(fields.slice(1), record);
    }

    // A stray quote or a trailing comma can leave the name empty; say so rather
    // than creating a student called "".
    if (!record.name) record.error = 'no name found on this line';
    return record;
  });

  return {
    rows,
    delimiter,
    delimiterLabel: detected ? detected.label : 'one name per line',
    hasHeader,
    columns,
    nameOrder,
    nameOrderGuessed: requested === 'auto' && guess.guessed,
    skippedLines: 0
  };
}

/* ---------- reconciling against the existing roster ---------- */

const key = value => String(value || '').trim().toLowerCase();

/**
 * Labels every parsed row against the students already in the section, so the
 * preview can show exactly what an import would do before it does it.
 *
 * Matching is by ID first — that is what an ID is for — and falls back to name
 * only when neither side has one, since two real students genuinely can share
 * a name.
 */
export function planImport(rows, existingStudents = []) {
  const existingIds = new Set(existingStudents.map(s => key(s.studentId)).filter(Boolean));
  const existingNames = new Set(existingStudents.map(s => key(s.name)));

  const seenIds = new Set();
  const seenNames = new Set();

  const planned = rows.map(row => {
    if (row.error) return { ...row, status: 'invalid' };

    const id = key(row.studentId);
    const name = key(row.name);

    if (id && existingIds.has(id)) return { ...row, status: 'duplicate-id' };
    if (id && seenIds.has(id)) return { ...row, status: 'duplicate-in-paste' };
    if (!id && existingNames.has(name)) return { ...row, status: 'duplicate-name' };
    if (!id && seenNames.has(name)) return { ...row, status: 'duplicate-in-paste' };

    if (id) seenIds.add(id);
    seenNames.add(name);
    return { ...row, status: 'new' };
  });

  return {
    rows: planned,
    counts: {
      total: planned.length,
      new: planned.filter(r => r.status === 'new').length,
      duplicate: planned.filter(r => r.status.startsWith('duplicate')).length,
      invalid: planned.filter(r => r.status === 'invalid').length
    }
  };
}
