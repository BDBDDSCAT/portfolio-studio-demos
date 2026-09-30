import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, selectTrace } from '../src/csv.js';

test('quoted commas, escaped quotes, BOM, CRLF, and embedded newlines preserve physical provenance', () => {
  const table = parseCsv('\uFEFF"x, nm",signal,note\r\n2,4,"two, units"\r\n1,3,"first\r\nline ""quoted"""\r\n3,5,plain\r\n');
  assert.deepEqual(table.columns, ['x, nm', 'signal', 'note']);
  assert.equal(table.rows[1].values[2], 'first\nline "quoted"');
  assert.deepEqual(table.rows.map((row) => row.sourceLine), [2, 3, 5]);
  const data = selectTrace(table, { x: 'x, nm', y: 'signal' });
  assert.deepEqual(data.map((sample) => [sample.x, sample.sourceLine]), [[1, 3], [2, 2], [3, 5]]);
});

test('malformed structure is rejected with source context', () => {
  for (const text of ['x,x\n1,2', ',y\n1,2', 'x,y\n1,2,3', 'x,y\n1,"unclosed', 'x,y\n1,"two"garbage', 'x,y\n1,t"wo']) {
    assert.throws(() => parseCsv(text));
  }
});

test('duplicates, nonfinite numbers, blank cells, and nonpositive sigma are explicit errors', () => {
  const select = (text, sigma = null) => selectTrace(parseCsv(text), { x: 'x', y: 'y', sigma });
  assert.throws(() => select('x,y\n1,2\n1,3'), /Duplicate x=1.*lines 2 and 3/);
  for (const value of ['NaN', 'Infinity', '1e999', '0x10', '']) assert.throws(() => select(`x,y\n1,${value}\n2,3`), /Line 2/);
  assert.throws(() => select('x,y,sigma\n1,2,0\n2,3,1', 'sigma'), /sigma must be positive/);
  assert.throws(() => selectTrace(parseCsv('x,y\n1,2'), { x: 'x', y: 'x' }), /distinct/);
  assert.throws(() => select('x,y\n1,1e-999\n2,3'), /too small to represent/);
  for (const record of [',', '"",""', ' , ']) {
    assert.throws(() => select(`x,y\n0,1\n${record}\n1,2`), /Line 3/);
  }
  assert.deepEqual(select('x,y\n0,1\n\n1,2').map(sample => sample.sourceLine), [2, 4]);
});
