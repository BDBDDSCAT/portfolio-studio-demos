/** Comma-separated data with RFC-style quoting and physical source-line provenance. */
export function parseCsv(text) {
  if (typeof text !== 'string') throw new TypeError('CSV input must be text.');
  if (new TextEncoder().encode(text).length > 20 * 1024 * 1024) throw new Error('CSV exceeds the 20 MB limit.');
  text = text.replace(/^\uFEFF/, '');
  const records = [];
  let values = [], value = '', quoted = false, closed = false, structured = false, line = 1, sourceLine = 1;
  function field() { values.push(value); value = ''; closed = false; }
  function record() {
    field();
    if (structured || !values.every((part) => part.trim() === '')) records.push({ values, sourceLine });
    values = []; structured = false;
  }
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { value += '"'; i += 1; }
        else { quoted = false; closed = true; }
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && text[i + 1] === '\n') i += 1;
        value += '\n'; line += 1;
      } else value += ch;
      continue;
    }
    if (ch === ',') { structured = true; field(); continue; }
    if (ch === '\r' || ch === '\n') {
      record();
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      line += 1; sourceLine = line;
      continue;
    }
    if (closed) {
      if (ch === ' ' || ch === '\t') continue;
      throw new Error(`Unexpected character after a quoted field at line ${line}.`);
    }
    if (ch === '"') {
      if (value !== '') throw new Error(`Unexpected quote in an unquoted field at line ${line}.`);
      quoted = true; structured = true;
    } else value += ch;
  }
  if (quoted) throw new Error(`Unclosed quoted field starting at line ${sourceLine}.`);
  if (value !== '' || values.length || closed) record();
  if (records.length < 2) throw new Error('CSV requires a header and at least one data row.');
  const columns = records.shift().values.map((name) => name.trim());
  if (columns.length < 2 || columns.length > 256 || columns.some((name) => name === '')) throw new Error('CSV requires 2..256 named columns.');
  if (new Set(columns).size !== columns.length) throw new Error('CSV column names must be unique.');
  if (records.length > 100000) throw new Error('CSV exceeds the 100,000 row limit.');
  for (const row of records) {
    if (row.values.length !== columns.length) throw new Error(`Line ${row.sourceLine}: expected ${columns.length} columns, received ${row.values.length}.`);
  }
  return { columns, rows: records };
}

function number(text, name, line) {
  const value = text.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value))) {
    throw new Error(`Line ${line}, column ${JSON.stringify(name)}: expected a finite decimal number.`);
  }
  const parsed = Number(value);
  if (parsed === 0 && /[1-9]/.test(value.split(/[eE]/)[0])) {
    throw new Error(`Line ${line}, column ${JSON.stringify(name)}: nonzero value is too small to represent; rescale the input units.`);
  }
  return parsed;
}

/** Select and sort numerical columns; duplicate x values are rejected rather than pooled. */
export function selectTrace(table, { x, y, sigma = null }) {
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) throw new TypeError('A parsed CSV table is required.');
  if (!x || !y || x === y || (sigma && (sigma === x || sigma === y))) throw new Error('Choose distinct x, y, and optional sigma columns.');
  const names = [x, y, ...(sigma ? [sigma] : [])];
  for (const name of names) if (!table.columns.includes(name)) throw new Error(`Unknown CSV column: ${name}.`);
  const xi = table.columns.indexOf(x), yi = table.columns.indexOf(y), si = table.columns.indexOf(sigma);
  const data = table.rows.map((row) => {
    const sample = { x: number(row.values[xi], x, row.sourceLine), y: number(row.values[yi], y, row.sourceLine), sourceLine: row.sourceLine };
    if (sigma) {
      sample.sigma = number(row.values[si], sigma, row.sourceLine);
      if (sample.sigma <= 0) throw new Error(`Line ${row.sourceLine}: sigma must be positive.`);
    }
    return sample;
  }).sort((a, b) => a.x - b.x);
  for (let i = 1; i < data.length; i += 1) {
    if (data[i].x === data[i - 1].x) throw new Error(`Duplicate x=${data[i].x} at source lines ${data[i - 1].sourceLine} and ${data[i].sourceLine}; aggregate repeated measurements explicitly before fitting.`);
  }
  return data;
}

export function resultToCsv(result) {
  return `x,y,sigma,fitted,residual,source_line\n${result.samples.map((sample) => [
    sample.x, sample.y, sample.sigma ?? '', sample.fitted, sample.residual, sample.sourceLine ?? '',
  ].join(',')).join('\n')}\n`;
}

export function buildFitReport(result, metadata = {}) {
  return {
    schemaVersion: 1,
    application: 'Tracefit',
    source: metadata.source ?? 'supplied numeric samples',
    columns: metadata.columns ?? { x: 'x', y: 'y', sigma: null },
    units: metadata.units ?? { x: null, y: null, slope: 'y units / x units', width: 'x units', note: 'Physical units are not inferred; source column names are preserved separately.' },
    ...result,
  };
}
