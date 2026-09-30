import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  parseCSV, validateSchema, auditCSV, makeReport, renderReportHTML, CSVParseError, SchemaError,
} from '../src/audit.js';

const numeric = { version: 1, columns: { x: { type: 'number' } } };
const codes = (report) => report.issues.map((issue) => issue.code);

test('quoted CSV preserves comma, escaped quotes, embedded CRLF, BOM and source start lines', () => {
  const parsed = parseCSV('\uFEFFid,note,x\r\n1,"comma, and ""quotes""",3\r\n2,"first\r\nsecond",bad\r\n3,last,4\r\n');
  assert.deepEqual(parsed.headers, ['id', 'note', 'x']);
  assert.equal(parsed.records[0].values[1], 'comma, and "quotes"');
  assert.equal(parsed.records[1].values[1], 'first\r\nsecond');
  assert.deepEqual(parsed.records.map((row) => row.startLine), [2, 3, 5]);
  const report = auditCSV('\uFEFFnote,x\r\n"a\r\nb",NaN\r\n', { version: 1, columns: { note: { type: 'string' }, x: { type: 'number' } } });
  assert.equal(report.issues[0].startLine, 2);
  assert.equal(report.issues[0].record, 1);
});

test('explicit comma, tab and semicolon delimiters work without auto-detection', () => {
  for (const delimiter of [',', '\t', ';']) {
    const parsed = parseCSV(`x${delimiter}y\n1${delimiter}"a${delimiter}b"`, { delimiter });
    assert.deepEqual(parsed.records[0].values, ['1', `a${delimiter}b`]);
  }
  assert.throws(() => parseCSV('a|b\n1|2', { delimiter: '|' }), /Delimiter/);
  assert.deepEqual(parseCSV('a,b\n1,2\n').records.length, 1);
  assert.deepEqual(parseCSV('a\n1\n\n').records.length, 2, 'blank input records are audited, not silently removed');
});

test('strict CSV rejects broken quoting, empty or duplicate headers', () => {
  for (const value of ['', 'a,a\n1,2', 'a,\n1,2', 'a\n"unterminated', 'a\n"ok" tail', 'a\npre"quote']) {
    assert.throws(() => parseCSV(value), CSVParseError, value);
  }
  assert.throws(() => parseCSV('a\n"one\ntwo'), (error) => error.name === 'CSVParseError' && error.startLine === 2);
});

test('schema compilation rejects unsupported properties and malformed constraints', () => {
  for (const value of [
    null, [], { version: 2, columns: numeric.columns }, { version: 1, columns: {} },
    { ...numeric, extraColumns: 'ignore' }, { ...numeric, extraColumns: null }, { ...numeric, uniqueKeys: [['unknown']] },
    { ...numeric, requiredColumns: ['x', 'x'] }, { ...numeric, typo: true },
    { version: 1, columns: { x: { type: 'float' } } },
    { version: 1, columns: { x: { type: 'number', minimum: 0 } } },
    { version: 1, columns: { x: { type: 'string', min: 1 } } },
    { version: 1, columns: { x: { type: 'integer', enum: [1.5] } } },
    { version: 1, columns: { x: { type: 'number', min: 2, max: 1 } } },
    { ...numeric, monotonic: [{ column: 'x', strict: 'yes' }] },
    { ...numeric, monotonic: [{ column: 'x', groupBy: null }] },
    { ...numeric, sums: [{ columns: ['x'], target: 1 }] },
    { ...numeric, sums: [{ columns: ['x'], target: 1, tolerance: -1 }] },
  ]) assert.throws(() => validateSchema(value), SchemaError);
  const compiled = validateSchema(numeric);
  assert.equal(compiled.columns.x.nullable, false);
  assert.equal(compiled.extraColumns, 'reject');
  assert.deepEqual(compiled.requiredColumns, ['x']);
});

test('required and extra column policy is independent from optional declared columns', () => {
  const schema = { version: 1, columns: { x: { type: 'number' }, optional: { type: 'string' } }, requiredColumns: ['x'], extraColumns: 'allow' };
  assert.equal(auditCSV('x,other\n1,anything', schema).passed, true);
  const missing = auditCSV('other\nhello', { ...schema, extraColumns: 'reject' });
  assert.deepEqual(codes(missing), ['missing_column', 'extra_column']);
  assert.equal(missing.issues[0].startLine, 1);
  assert.equal(missing.issues[0].record, 0);
  assert.equal(missing.counts.invalidRecords, 0, 'header errors do not invent invalid data records');
});

test('number and integer conversion is finite decimal-only with explicit null semantics', () => {
  const source = 'x\n1\n+2.5\n .25 \n1e2\nNaN\nInfinity\n0x10\n"1,000"\n \n\n1e999\n';
  const report = auditCSV(source, numeric);
  assert.equal(report.counts.records, 11);
  assert.equal(report.issueCounts.type, 6);
  assert.equal(report.issueCounts.null, 1);
  assert.equal(report.profiles[0].count, 4);
  assert.equal(report.profiles[0].nullCount, 1);
  const integers = auditCSV('x\n2.0\n2e1\n2.5\n9007199254740992', { version: 1, columns: { x: { type: 'integer' } } });
  assert.equal(integers.issueCounts.type, 2);
  assert.equal(integers.profiles[0].count, 2);
  assert.equal(auditCSV('x\n\n', { version: 1, columns: { x: { type: 'number', nullable: true } } }).passed, true);
  const roundedIntegers = auditCSV('x\n9007199254740991.1\n2.00000000000000001\n.20e1', { version: 1, columns: { x: { type: 'integer' } } });
  assert.equal(roundedIntegers.issueCounts.type, 2, 'fractional decimal input is not accepted after binary rounding');
  assert.equal(roundedIntegers.profiles[0].count, 1);
  assert.equal(auditCSV('x\n1e-9999', numeric).issueCounts.type, 1, 'nonzero underflow is rejected instead of becoming zero');
});

test('bounds, enum, null and row width produce separate source-addressed violations', () => {
  const schema = { version: 1, columns: { x: { type: 'number', min: 0, max: 2, enum: [0, 2] }, label: { type: 'string', enum: ['a'] } } };
  const report = auditCSV('x,label\n-1,a\n3,b\n1,a\n,a\n2', schema);
  assert.equal(report.issueCounts.min, 1);
  assert.equal(report.issueCounts.max, 1);
  assert.equal(report.issueCounts.enum, 4);
  assert.equal(report.issueCounts.null, 2);
  assert.equal(report.issueCounts.row_width, 1);
  assert.equal(report.counts.invalidRecords, 5);
  assert.equal(report.profiles[0].min, -1, 'profiles retain finite values even when they fail bounds');
  assert.equal(report.profiles[0].max, 3);
});

test('composite unique keys avoid separator collisions and distinguish typed tuples', () => {
  const schema = { version: 1, columns: { a: { type: 'string' }, b: { type: 'string' }, x: { type: 'number', nullable: true } }, uniqueKeys: [['a', 'b'], ['a', 'x']] };
  const report = auditCSV('a,b,x\n"a|b",c,1\na,"b|c",1\n"a|b",c,2\na,z,1.0\na,q,\na,q,', schema);
  assert.equal(report.issueCounts.unique, 3);
  assert.equal(report.issues[0].record, 3);
  assert.match(report.issues[0].message, /record 1 \(line 2\)/);
});

test('grouped monotonic rules follow original interleaved order and configurable equality', () => {
  const schema = { version: 1, columns: { group: { type: 'string' }, x: { type: 'number', nullable: true } }, monotonic: [{ column: 'x', groupBy: ['group'], strict: true }] };
  const report = auditCSV('group,x\na,1\nb,50\na,2\nb,49\na,2\na,\na,bad\na,1', schema);
  assert.equal(report.issueCounts.monotonic, 3);
  assert.deepEqual(report.issues.filter((i) => i.code === 'monotonic').map((i) => i.startLine), [5, 6, 9]);
  assert.equal(auditCSV('group,x\na,1\na,1', { ...schema, monotonic: [{ column: 'x', groupBy: ['group'], strict: false }] }).passed, true);
});

test('sum rules use explicit absolute tolerance and skip incomplete invalid member values', () => {
  const schema = { version: 1, columns: { R: { type: 'number' }, T: { type: 'number' }, A: { type: 'number', nullable: true } }, sums: [{ columns: ['R', 'T', 'A'], target: 1, tolerance: 1e-6 }] };
  const report = auditCSV('R,T,A\n.2,.7,.1\n.2,.7,.1000001\n.2,.7,.11\nNaN,.7,.1\n.2,.7,', schema);
  assert.equal(report.issueCounts.sum, 1);
  assert.equal(report.issueCounts.type, 1);
  assert.equal(report.counts.issues, 2);
  assert.equal(report.issues.find((i) => i.code === 'sum').startLine, 4);
});

test('Welford profiles report known sample standard deviation and explicit undefined statistics', () => {
  const report = auditCSV('x,note\n2,a\n4,b\n4,c\n4,d\n5,e\n5,f\n7,g\n9,h\n,empty\nbad,text', { version: 1, columns: { x: { type: 'number', nullable: true }, note: { type: 'string' } } });
  const profile = report.profiles[0];
  assert.equal(profile.count, 8);
  assert.equal(profile.nullCount, 1);
  assert.equal(profile.invalidCount, 1);
  assert.equal(profile.min, 2);
  assert.equal(profile.max, 9);
  assert.equal(profile.mean, 5);
  assert.ok(Math.abs(profile.stddev - Math.sqrt(32 / 7)) < 1e-12);
  assert.equal(report.profiles[1].mean, null);
  assert.equal(auditCSV('x\n1', numeric).profiles[0].stddev, null);
  assert.equal(auditCSV('x\n\n', numeric).profiles[0].mean, null);
});

test('capping examples preserves exact issue totals, rule counts, invalid records and profiles', () => {
  const text = `x\n${Array(30).fill('bad').join('\n')}`;
  const capped = auditCSV(text, numeric, { maxIssues: 2 });
  assert.equal(capped.issues.length, 2);
  assert.equal(capped.counts.issues, 30);
  assert.equal(capped.issueCounts.type, 30);
  assert.equal(capped.counts.invalidRecords, 30);
  assert.equal(capped.profiles[0].invalidCount, 30);
  assert.equal(capped.issuesTruncated, true);
  const none = auditCSV(text, numeric, { maxIssues: 0 });
  assert.equal(none.issues.length, 0);
  assert.equal(none.passed, false);
  assert.throws(() => auditCSV(text, numeric, { maxIssues: -1 }), /maxIssues/);
});

test('finite extreme magnitudes use scaled Welford without silently serializing infinity', () => {
  const scaled = auditCSV('x\n-1e200\n0\n1e200', numeric).profiles[0];
  assert.equal(scaled.mean, 0);
  assert.equal(scaled.stddev, 1e200);
  const overflow = auditCSV('x\n-1.7e308\n1.7e308', numeric).profiles[0];
  assert.equal(overflow.mean, 0);
  assert.equal(overflow.stddev, null);
  assert.match(overflow.statisticsWarning, /finite numeric range/);
  assert.equal(JSON.stringify(overflow).includes('Infinity'), false);
});

test('small varying data use scaled moments without underflowing a representable standard deviation', () => {
  for (const scale of [1e-160, 1e-200]) {
    const profile = auditCSV(`x\n${scale}\n${2 * scale}\n`, numeric).profiles[0];
    const expected = scale / Math.sqrt(2);
    assert.ok(Math.abs(profile.stddev / expected - 1) < 1e-14);
    assert.ok(profile.stddev > 0);
  }
  const smallest = auditCSV('x\n5e-324\n' + '0\n'.repeat(99), numeric).profiles[0];
  assert.equal(smallest.stddev, null);
  assert.match(smallest.statisticsWarning, /representable/);
});

test('raw input and schema SHA-256 hashes distinguish BOM, line endings and schema formatting', async () => {
  const raw = new TextEncoder().encode('\uFEFFx\r\n1\r\n');
  const sourceSchema = JSON.stringify(numeric, null, 2);
  const report = await makeReport(raw, new TextEncoder().encode(sourceSchema));
  assert.equal(report.hashes.inputSha256, createHash('sha256').update(raw).digest('hex'));
  assert.equal(report.hashes.schemaSha256, createHash('sha256').update(sourceSchema).digest('hex'));
  assert.equal(report.software.version, '1.0.0');
  const changedCSV = await makeReport('x\n1\n', sourceSchema);
  const changedSchema = await makeReport(raw, JSON.stringify(numeric));
  assert.notEqual(changedCSV.hashes.inputSha256, report.hashes.inputSha256);
  assert.notEqual(changedSchema.hashes.schemaSha256, report.hashes.schemaSha256);
  assert.deepEqual(changedCSV.counts, report.counts, 'byte identity is distinct from equivalent parsed data');
  await assert.rejects(() => makeReport(new Uint8Array([255]), numeric), /UTF-8/);
});

test('self-contained HTML escapes malicious headers, values, schema and issue contents', async () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const schema = { version: 1, columns: { [hostile]: { type: 'string', enum: ['safe', '<script>alert(1)</script>'] } } };
  const report = await makeReport(`"${hostile.replaceAll('"', '""')}"\n<script>alert(1)</script>`, schema);
  const html = renderReportHTML(report);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img '), false);
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes(report.hashes.inputSha256));
  assert.ok(html.includes('Self-contained JSON report'));
});

test('prototype-shaped CSV names and schema keys cannot pollute ordinary objects', () => {
  const schema = JSON.parse('{"version":1,"columns":{"__proto__":{"type":"number"},"constructor":{"type":"string"}}}');
  const report = auditCSV('__proto__,constructor\n1,value', schema);
  assert.equal(report.passed, true);
  assert.equal(report.profiles[0].column, '__proto__');
  assert.equal({}.polluted, undefined);
});
