import { describe, it, expect } from 'vitest';
import { parseRoster, planImport, detectDelimiter, splitLine } from './roster-parse.js';

const names = result => result.rows.map(r => r.name);

describe('splitLine', () => {
  it('keeps a quoted comma inside one field', () => {
    expect(splitLine('"Lovelace, Ada",S-001', ',')).toEqual(['Lovelace, Ada', 'S-001']);
  });

  it('unescapes a doubled quote', () => {
    expect(splitLine('"She said ""hi""",x', ',')).toEqual(['She said "hi"', 'x']);
  });

  it('returns the whole line when there is no delimiter', () => {
    expect(splitLine('  Ada Lovelace  ', null)).toEqual(['Ada Lovelace']);
  });
});

describe('detectDelimiter', () => {
  it('finds tabs in a spreadsheet paste', () => {
    expect(detectDelimiter('Ada\tS-1\nGrace\tS-2').char).toBe('\t');
  });

  it('finds semicolons in a European CSV export', () => {
    expect(detectDelimiter('Ada;S-1;a@x.edu\nGrace;S-2;g@x.edu').char).toBe(';');
  });

  it('reports nothing for a bare list of names', () => {
    expect(detectDelimiter('Ada Lovelace\nGrace Hopper')).toBeNull();
  });
});

describe('parseRoster', () => {
  it('takes a bare list of names, one per line', () => {
    const result = parseRoster('Ada Lovelace\nGrace Hopper\n\n  Alan Turing  ');
    expect(names(result)).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing']);
    expect(result.delimiterLabel).toBe('one name per line');
    expect(result.hasHeader).toBe(false);
  });

  it('reads a spreadsheet paste with tabs', () => {
    const result = parseRoster('Ada Lovelace\tS-001\tada@example.edu');
    expect(result.rows[0]).toMatchObject({
      name: 'Ada Lovelace',
      studentId: 'S-001',
      email: 'ada@example.edu'
    });
  });

  it('uses a header row to map the columns, in any order', () => {
    const result = parseRoster([
      'Email,Student ID,Name',
      'ada@example.edu,S-001,Ada Lovelace'
    ].join('\n'));

    expect(result.hasHeader).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      name: 'Ada Lovelace',
      studentId: 'S-001',
      email: 'ada@example.edu'
    });
  });

  it('joins split first and last name columns', () => {
    const result = parseRoster([
      'Last Name,First Name,LRN',
      'Lovelace,Ada,123456789012'
    ].join('\n'));

    expect(result.rows[0]).toMatchObject({ name: 'Ada Lovelace', studentId: '123456789012' });
  });

  it('includes a middle name column when there is one', () => {
    const result = parseRoster([
      'First Name,Middle Name,Last Name',
      'Ada,Byron,Lovelace'
    ].join('\n'));

    expect(result.rows[0].name).toBe('Ada Byron Lovelace');
  });

  it('recognises "Last, First" and puts the name back the right way round', () => {
    const result = parseRoster('Lovelace, Ada\nHopper, Grace');
    expect(result.nameOrder).toBe('last-first');
    expect(result.nameOrderGuessed).toBe(true);
    expect(names(result)).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  it('does not mistake "Name, ID" for a reversed name', () => {
    const result = parseRoster('Ada Lovelace, S-001\nGrace Hopper, S-002');
    expect(result.nameOrder).toBe('first-last');
    expect(result.rows[0]).toMatchObject({ name: 'Ada Lovelace', studentId: 'S-001' });
  });

  it('lets the caller overrule the guess', () => {
    const result = parseRoster('Lovelace, Ada', { nameOrder: 'first-last' });
    expect(result.rows[0]).toMatchObject({ name: 'Lovelace', studentId: 'Ada' });
  });

  it('finds the email wherever it sits when there is no header', () => {
    const result = parseRoster('Ada Lovelace\tada@example.edu\tS-001');
    expect(result.rows[0]).toMatchObject({ studentId: 'S-001', email: 'ada@example.edu' });
  });

  it('does not treat a data row as a header', () => {
    const result = parseRoster('Ada Lovelace,S-001\nGrace Hopper,S-002');
    expect(result.hasHeader).toBe(false);
    expect(result.rows).toHaveLength(2);
  });

  it('flags a line it cannot get a name out of', () => {
    const result = parseRoster('Name,ID\n,S-001');
    expect(result.rows[0].error).toBeTruthy();
  });

  it('survives an empty paste', () => {
    expect(parseRoster('').rows).toEqual([]);
    expect(parseRoster('   \n  \n').rows).toEqual([]);
  });

  it('handles a 150-student paste', () => {
    const text = Array.from({ length: 150 }, (_, i) =>
      `Student ${i + 1}\tS-${String(i + 1).padStart(3, '0')}\ts${i + 1}@example.edu`
    ).join('\n');

    const result = parseRoster(text);
    expect(result.rows).toHaveLength(150);
    expect(result.rows[149]).toMatchObject({ name: 'Student 150', studentId: 'S-150' });
    expect(result.rows.every(r => !r.error)).toBe(true);
  });
});

describe('planImport', () => {
  const existing = [
    { id: 'a', name: 'Ada Lovelace', studentId: 'S-001', email: '' },
    { id: 'b', name: 'Grace Hopper', studentId: '', email: '' }
  ];

  const plan = text => planImport(parseRoster(text).rows, existing);

  it('marks genuinely new students as new', () => {
    const { counts } = plan('Alan Turing\tS-003');
    expect(counts).toMatchObject({ total: 1, new: 1, duplicate: 0, invalid: 0 });
  });

  it('catches a student already on the roster by ID', () => {
    const { rows } = plan('Ada L.\tS-001');
    expect(rows[0].status).toBe('duplicate-id');
  });

  it('falls back to matching on name when neither side has an ID', () => {
    expect(plan('Grace Hopper').rows[0].status).toBe('duplicate-name');
  });

  it('treats a shared name with different IDs as two real students', () => {
    const { counts } = plan('Ada Lovelace\tS-999');
    expect(counts.new).toBe(1); // different ID, so a different person
  });

  it('catches the same student pasted twice in one go', () => {
    const { rows, counts } = plan('Alan Turing\tS-003\nAlan Turing\tS-003');
    expect(rows[0].status).toBe('new');
    expect(rows[1].status).toBe('duplicate-in-paste');
    expect(counts.new).toBe(1);
  });

  it('counts a nameless line as invalid rather than importing it', () => {
    const { counts } = planImport(parseRoster('Name,ID\n,S-009').rows, existing);
    expect(counts).toMatchObject({ new: 0, invalid: 1 });
  });
});
