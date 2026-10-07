import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'cli.js');
const fixture = name => path.join(root, 'examples', name);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const invoke = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: root });

async function workspace(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'runcheck-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function auditArgs(out, input = fixture('clean.csv'), schema = fixture('schema.json')) {
  return ['audit', '--input', input, '--schema', schema, '--out', out];
}

async function reportAt(out) {
  return JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'));
}

test('help and version are available without input files', () => {
  const help = invoke('--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /runcheck audit/);
  assert.match(help.stdout, /0 = passed, 1 = audit violations, 2 = usage\/input\/output error/);
  assert.equal(invoke('audit', '--help').status, 0);
  assert.equal(invoke('--version').stdout, '1.0.0\n');
});

test('clean data creates JSON and standalone HTML reports with exact source hashes', async t => {
  const directory = await workspace(t);
  const out = path.join(directory, 'nested', 'reports');
  const result = invoke(...auditArgs(out));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS.*6 records.*5 columns.*0 issues/);
  const report = await reportAt(out);
  assert.equal(report.passed, true);
  assert.deepEqual(report.software, { name: 'Runcheck', version: '1.0.0' });
  assert.equal(report.schemaVersion, 1);
  assert.deepEqual(report.counts, { records: 6, columns: 5, issues: 0, invalidRecords: 0 });
  assert.equal(report.hashes.inputSha256, hash(await readFile(fixture('clean.csv'))));
  assert.equal(report.hashes.schemaSha256, hash(await readFile(fixture('schema.json'))));
  const html = await readFile(path.join(out, 'report.html'), 'utf8');
  assert.match(html, /Runcheck/);
  assert.match(html, /<!doctype html>/i);
  assert.deepEqual((await readdir(out)).sort(), ['report.html', 'report.json']);
});

test('broken data exits 1 and keeps exact totals when saved issue examples are capped', async t => {
  const directory = await workspace(t);
  const completeOut = path.join(directory, 'complete');
  const limitedOut = path.join(directory, 'limited');
  const noneOut = path.join(directory, 'none');
  const baseline = invoke(...auditArgs(completeOut, fixture('broken.csv')));
  assert.equal(baseline.status, 1, baseline.stderr);
  assert.match(baseline.stdout, /FAIL/);
  const complete = await reportAt(completeOut);
  assert.equal(complete.counts.records, 6);
  assert.ok(complete.counts.issues >= 4);
  assert.ok(complete.counts.invalidRecords >= 4);
  const limited = invoke(...auditArgs(limitedOut, fixture('broken.csv')), '--max-issues', '1');
  assert.equal(limited.status, 1, limited.stderr);
  const report = await reportAt(limitedOut);
  assert.deepEqual(report.counts, complete.counts);
  assert.equal(report.issues.length, 1);
  assert.equal(report.issuesTruncated, true);
  assert.match(limited.stdout, /totals include every issue/);
  const none = invoke(...auditArgs(noneOut, fixture('broken.csv')), '--max-issues', '0');
  assert.equal(none.status, 1, none.stderr);
  const noneReport = await reportAt(noneOut);
  assert.equal(noneReport.issues.length, 0);
  assert.deepEqual(noneReport.counts, complete.counts);
});

test('cancellation in a sum rule fails the CLI audit and retains its residual in both reports', async t => {
  const directory = await workspace(t);
  const input = path.join(directory, 'cancellation.csv');
  const schema = path.join(directory, 'schema.json');
  const out = path.join(directory, 'reports');
  await Promise.all([
    writeFile(input, 'a,b,c\n10000000000000000,1,-10000000000000000\n'),
    writeFile(schema, JSON.stringify({ version: 1, columns: { a: { type: 'number' }, b: { type: 'number' }, c: { type: 'number' } }, sums: [{ columns: ['a', 'b', 'c'], target: 0, tolerance: 0.5 }] })),
  ]);
  const result = invoke(...auditArgs(out, input, schema));
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /FAIL.*1 records.*1 issues.*1 invalid records/);
  const report = await reportAt(out);
  assert.equal(report.passed, false);
  assert.deepEqual(report.issueCounts, { sum: 1 });
  assert.equal(report.hashes.inputSha256, hash(await readFile(input)));
  assert.match(report.issues[0].message, /Sum 1 differs from target 0; residual is 1;/);
  assert.match(await readFile(path.join(out, 'report.html'), 'utf8'), /residual is 1;/);
});

test('tab and semicolon options parse quoted fields using the selected delimiter', async t => {
  const directory = await workspace(t);
  const schema = path.join(directory, 'schema.json');
  await writeFile(schema, JSON.stringify({ version: 1, columns: { name: { type: 'string' }, value: { type: 'number' } } }));
  for (const [name, delimiter] of [['tab', '\t'], ['semicolon', ';']]) {
    const input = path.join(directory, `${name}.csv`);
    const out = path.join(directory, name);
    await writeFile(input, `name${delimiter}value\n"beam${delimiter}red"${delimiter}1.2e-3\n`);
    const result = invoke(...auditArgs(out, input, schema), '--delimiter', name);
    assert.equal(result.status, 0, result.stderr);
    const report = await reportAt(out);
    assert.equal(report.delimiter, delimiter);
    assert.equal(report.counts.records, 1);
  }
});

test('UTF-8 BOM and CRLF parsing does not change the input byte hash', async t => {
  const directory = await workspace(t);
  const input = path.join(directory, 'input.csv');
  const schema = path.join(directory, 'schema.json');
  const out = path.join(directory, 'reports');
  const bytes = Buffer.from('\ufeffname,value\r\n光,2.5\r\n', 'utf8');
  const schemaBytes = Buffer.from('{\n  "version": 1, "columns": {"name": {"type": "string"}, "value": {"type": "number"}}\n}\n');
  await Promise.all([writeFile(input, bytes), writeFile(schema, schemaBytes)]);
  const result = invoke(...auditArgs(out, input, schema));
  assert.equal(result.status, 0, result.stderr);
  const report = await reportAt(out);
  assert.equal(report.hashes.inputSha256, hash(bytes));
  assert.equal(report.hashes.schemaSha256, hash(schemaBytes));
  assert.equal(report.counts.records, 1);
});

test('each existing report filename prevents overwrite without force', async t => {
  const directory = await workspace(t);
  for (const name of ['report.json', 'report.html']) {
    const out = path.join(directory, name.replace('.', '-'));
    await mkdir(out);
    await writeFile(path.join(out, name), 'keep this report\n');
    const result = invoke(...auditArgs(out));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /already exists.*--force/);
    assert.equal(await readFile(path.join(out, name), 'utf8'), 'keep this report\n');
    assert.deepEqual(await readdir(out), [name]);
  }
});

test('force replaces report files and never treats a directory as a report', async t => {
  const directory = await workspace(t);
  const out = path.join(directory, 'reports');
  await mkdir(out);
  await Promise.all(['report.json', 'report.html'].map(name => writeFile(path.join(out, name), 'old report')));
  const result = invoke(...auditArgs(out), '--force');
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await reportAt(out)).passed, true);
  assert.match(await readFile(path.join(out, 'report.html'), 'utf8'), /Runcheck/);
  const blocked = path.join(directory, 'blocked');
  await mkdir(path.join(blocked, 'report.html'), { recursive: true });
  const failed = invoke(...auditArgs(blocked), '--force');
  assert.equal(failed.status, 2);
  assert.match(failed.stderr, /is a directory/);
  assert.deepEqual(await readdir(blocked), ['report.html']);
});

test('malformed CSV, invalid schemas and invalid UTF-8 exit 2 without reports', async t => {
  const directory = await workspace(t);
  const input = path.join(directory, 'input.csv');
  const schema = path.join(directory, 'schema.json');
  const cases = [
    ['name,value\n"unfinished,1\n', '{"version":1,"columns":{"name":{"type":"string"},"value":{"type":"number"}}}'],
    ['name,value\nbeam,1\n', '{bad json'],
    ['name,value\nbeam,1\n', '{"version":99,"columns":{"name":{"type":"string"}}}'],
    [Buffer.from([0xff, 0xfe, 0x61]), '{"version":1,"columns":{"name":{"type":"string"}}}'],
    ['name,value\nbeam,1\n', Buffer.from([0xff, 0xfe])],
  ];
  for (let i = 0; i < cases.length; i += 1) {
    const out = path.join(directory, `case-${i}`);
    await Promise.all([writeFile(input, cases[i][0]), writeFile(schema, cases[i][1])]);
    const result = invoke(...auditArgs(out, input, schema));
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /^Runcheck:/);
    await assert.rejects(readFile(path.join(out, 'report.json')), { code: 'ENOENT' });
  }
});

test('unknown, repeated, missing and unsupported options are usage errors', async t => {
  const directory = await workspace(t);
  const base = auditArgs(path.join(directory, 'reports'));
  const cases = [
    [], ['check'], ['audit'], [...base, '--unknown'], [...base, 'extra.csv'],
    [...base, '--force', '--force'], [...base, '--input', fixture('clean.csv')],
    [...base, '--delimiter'], [...base, '--delimiter', 'pipe'], [...base, '--delimiter', ','],
    [...base, '--max-issues', '-1'], [...base, '--max-issues', '1.5'],
    [...base, '--max-issues', '10001'], [...base, '--max-issues', '1e2'],
    [...base, '--max-issues', '9007199254740992'],
  ];
  for (const args of cases) {
    const result = invoke(...args);
    assert.equal(result.status, 2, `${args.join(' ')}\n${result.stderr}`);
    assert.match(result.stderr, /^Runcheck:/);
  }
  const missing = invoke(...auditArgs(path.join(directory, 'missing'), path.join(directory, 'missing.csv')));
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /ENOENT/);
});
