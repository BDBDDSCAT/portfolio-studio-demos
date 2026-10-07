/** Strict CSV auditing: source values are inspected, never repaired. */
export const SOFTWARE_VERSION = '1.0.0';

export class CSVParseError extends Error {
  constructor(message, startLine = 1) {
    super(`${message} (line ${startLine})`);
    this.name = 'CSVParseError';
    this.startLine = startLine;
  }
}

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaError';
  }
}

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const DELIMITERS = [',', '\t', ';'];

function integerNotation(text) {
  const [mantissa, exponentText = '0'] = text.toLowerCase().split('e');
  const digits = mantissa.replace(/[+.-]/g, '');
  if (!/[1-9]/.test(digits)) return true;
  const fractionalDigits = mantissa.includes('.') ? mantissa.length - mantissa.indexOf('.') - 1 : 0;
  const fractionalPlaces = fractionalDigits - Number(exponentText);
  return fractionalPlaces <= 0 || (digits.match(/0*$/)?.[0].length ?? 0) >= fractionalPlaces;
}

function delimiterOption(value = ',') {
  if (!DELIMITERS.includes(value)) throw new TypeError('Delimiter must be comma, tab, or semicolon.');
  return value;
}

function compensatedSum(values) {
  let total = 0, correction = 0;
  for (const value of values) {
    const next = total + value;
    // Keep overflow an explicit violation instead of contaminating the correction.
    if (!Number.isFinite(next)) return next;
    correction += Math.abs(total) >= Math.abs(value)
      ? (total - next) + value
      : (value - next) + total;
    total = next;
  }
  return total + correction;
}

/** RFC-style quoting, with literal embedded CR/LF preserved inside fields. */
export function parseCSV(text, { delimiter = ',' } = {}) {
  if (typeof text !== 'string') throw new TypeError('CSV input must be text.');
  delimiterOption(delimiter);
  const input = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows = [];
  let values = [], field = '', quoted = false, afterQuote = false;
  let line = 1, startLine = 1, touched = false;
  const finishField = () => { values.push(field); field = ''; afterQuote = false; };
  const finishRow = () => {
    finishField();
    rows.push({ values, startLine });
    values = [];
    touched = false;
  };
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 1; }
        else { quoted = false; afterQuote = true; }
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && input[i + 1] === '\n') { field += '\r\n'; i += 1; }
        else field += char;
        line += 1;
      } else field += char;
      continue;
    }
    if (afterQuote && char !== delimiter && char !== '\r' && char !== '\n') {
      throw new CSVParseError('Unexpected character after a closing quote', line);
    }
    if (char === delimiter) { touched = true; finishField(); }
    else if (char === '\r' || char === '\n') {
      finishRow();
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      line += 1;
      startLine = line;
    } else if (char === '"') {
      if (field !== '' || afterQuote) throw new CSVParseError('Quote inside an unquoted field', line);
      quoted = true;
      touched = true;
    } else { field += char; touched = true; }
  }
  if (quoted) throw new CSVParseError('Unclosed quoted field', startLine);
  if (touched || values.length || field !== '' || afterQuote) finishRow();
  if (rows.length === 0) throw new CSVParseError('CSV requires a header row');
  const headers = rows.shift().values;
  const seen = new Set();
  for (const header of headers) {
    if (header === '') throw new CSVParseError('Header names must not be empty');
    if (seen.has(header)) throw new CSVParseError(`Duplicate header: ${header}`);
    seen.add(header);
  }
  return {
    headers,
    delimiter,
    records: rows.map((row, index) => ({ ...row, record: index + 1 })),
  };
}

function fail(message) { throw new SchemaError(message); }
function fields(input, supported, location) {
  if (!object(input)) fail(`${location} must be an object.`);
  for (const key of Object.keys(input)) if (!supported.includes(key)) fail(`Unknown ${location} property: ${key}.`);
}
function names(values, columns, location, minimum = 1) {
  if (!Array.isArray(values) || values.length < minimum || values.some((v) => typeof v !== 'string' || !own(columns, v))) {
    fail(`${location} must name ${minimum ? 'one or more ' : ''}declared columns.`);
  }
  if (new Set(values).size !== values.length) fail(`${location} contains duplicate columns.`);
  return values.slice();
}

/** Validate schema once; reject misspelled or unsupported rules. */
export function validateSchema(schema) {
  fields(schema, ['version', 'columns', 'requiredColumns', 'extraColumns', 'uniqueKeys', 'monotonic', 'sums'], 'schema');
  if (schema.version !== 1) fail('Schema version must be 1.');
  if (!object(schema.columns) || Object.keys(schema.columns).length === 0) fail('Schema columns must be a nonempty object.');
  const entries = [];
  for (const [name, rule] of Object.entries(schema.columns)) {
    if (!name.trim() || name !== name.trim()) fail('Declared column names must be nonempty and have no outer whitespace.');
    fields(rule, ['type', 'nullable', 'min', 'max', 'enum'], `column ${name}`);
    if (!['number', 'integer', 'string'].includes(rule.type)) fail(`Column ${name} requires type number, integer, or string.`);
    if (own(rule, 'nullable') && typeof rule.nullable !== 'boolean') fail(`Column ${name}: nullable must be boolean.`);
    for (const bound of ['min', 'max']) {
      if (own(rule, bound) && (rule.type === 'string' || !Number.isFinite(rule[bound]))) fail(`Column ${name}: ${bound} requires a finite numeric bound.`);
    }
    if (own(rule, 'min') && own(rule, 'max') && rule.min > rule.max) fail(`Column ${name}: min exceeds max.`);
    if (own(rule, 'enum')) {
      if (!Array.isArray(rule.enum) || rule.enum.length === 0) fail(`Column ${name}: enum must be a nonempty array.`);
      for (const value of rule.enum) {
        if (rule.type === 'string' ? typeof value !== 'string' : !Number.isFinite(value) || (rule.type === 'integer' && !Number.isSafeInteger(value))) {
          fail(`Column ${name}: enum values must match the column type.`);
        }
      }
    }
    entries.push([name, { ...rule, nullable: rule.nullable ?? false, ...(rule.enum ? { enum: rule.enum.slice() } : {}) }]);
  }
  const columns = Object.fromEntries(entries);
  const requiredColumns = own(schema, 'requiredColumns') ? names(schema.requiredColumns, columns, 'requiredColumns', 0) : Object.keys(columns);
  const extraColumns = own(schema, 'extraColumns') ? schema.extraColumns : 'reject';
  if (!['reject', 'allow'].includes(extraColumns)) fail('extraColumns must be reject or allow.');
  const array = (key) => {
    if (own(schema, key) && !Array.isArray(schema[key])) fail(`${key} must be an array.`);
    return schema[key] ?? [];
  };
  const uniqueKeys = array('uniqueKeys').map((key) => names(key, columns, 'uniqueKeys entry'));
  const monotonic = array('monotonic').map((rule) => {
    fields(rule, ['column', 'groupBy', 'strict'], 'monotonic rule');
    if (typeof rule.column !== 'string' || !own(columns, rule.column) || columns[rule.column].type === 'string') fail('Monotonic column must name a numeric column.');
    if (own(rule, 'strict') && typeof rule.strict !== 'boolean') fail('Monotonic strict must be boolean.');
    return { column: rule.column, groupBy: names(own(rule, 'groupBy') ? rule.groupBy : [], columns, 'monotonic groupBy', 0), strict: rule.strict ?? false };
  });
  const sums = array('sums').map((rule) => {
    fields(rule, ['columns', 'target', 'tolerance'], 'sum rule');
    const members = names(rule.columns, columns, 'sum columns');
    if (members.some((name) => columns[name].type === 'string')) fail('Sum columns must all be numeric.');
    if (!Number.isFinite(rule.target) || !Number.isFinite(rule.tolerance) || rule.tolerance < 0) fail('Sum rules require a finite target and nonnegative finite tolerance.');
    return { columns: members, target: rule.target, tolerance: rule.tolerance };
  });
  return { version: 1, columns, requiredColumns, extraColumns, uniqueKeys, monotonic, sums };
}

/** Full counts and profiles are computed even when only a few issues are retained. */
export function auditCSV(text, schema, { delimiter = ',', maxIssues = 100 } = {}) {
  if (!Number.isInteger(maxIssues) || maxIssues < 0 || maxIssues > 10000) throw new TypeError('maxIssues must be an integer from 0 to 10000.');
  const specification = validateSchema(schema);
  const parsed = parseCSV(text, { delimiter });
  const positions = new Map(parsed.headers.map((name, i) => [name, i]));
  const issues = [], invalidRecords = new Set(), issueCounts = new Map();
  let issueTotal = 0;
  const add = (row, column, code, message) => {
    issueTotal += 1;
    issueCounts.set(code, (issueCounts.get(code) ?? 0) + 1);
    if (row.record > 0) invalidRecords.add(row.record);
    if (issues.length < maxIssues) issues.push({ record: row.record, startLine: row.startLine, column, code, message });
  };
  const header = { record: 0, startLine: 1 };
  for (const name of specification.requiredColumns) if (!positions.has(name)) add(header, name, 'missing_column', `Required column is absent: ${name}.`);
  if (specification.extraColumns === 'reject') {
    for (const name of parsed.headers) if (!own(specification.columns, name)) add(header, name, 'extra_column', `Undeclared column is present: ${name}.`);
  }
  const accumulators = new Map(Object.entries(specification.columns).filter(([name]) => positions.has(name)).map(([name, rule]) => [name, {
    column: name, type: rule.type, count: 0, nullCount: 0, invalidCount: 0, min: null, max: null,
    mean: 0, m2: 0, scale: 0, scaledMean: 0, scaledM2: 0,
  }]));
  const unique = specification.uniqueKeys.map(() => new Map());
  const groups = specification.monotonic.map(() => new Map());
  for (const row of parsed.records) {
    if (row.values.length !== parsed.headers.length) add(row, null, 'row_width', `Record has ${row.values.length} fields; header has ${parsed.headers.length}.`);
    const typed = new Map();
    for (const [name, profile] of accumulators) {
      const rule = specification.columns[name];
      const raw = row.values[positions.get(name)];
      if (raw === undefined || raw === '') {
        profile.nullCount += 1;
        typed.set(name, null);
        if (!rule.nullable) add(row, name, 'null', 'Empty value is not permitted.');
        continue;
      }
      let value = raw;
      if (rule.type !== 'string') {
        const numeric = raw.trim();
        value = NUMBER.test(numeric) ? Number(numeric) : NaN;
        const underflow = value === 0 && /[1-9]/.test(numeric.split(/[eE]/)[0]);
        if (!Number.isFinite(value) || underflow || (rule.type === 'integer' && (!Number.isSafeInteger(value) || !integerNotation(numeric)))) {
          profile.invalidCount += 1;
          add(row, name, 'type', rule.type === 'integer' ? 'Expected exactly integral decimal notation within the safe integer range.' : 'Expected a finite, representable number in decimal notation.');
          continue;
        }
      }
      typed.set(name, value);
      profile.count += 1;
      if (rule.type !== 'string') {
        profile.min = profile.min === null ? value : Math.min(profile.min, value);
        profile.max = profile.max === null ? value : Math.max(profile.max, value);
        const delta = value - profile.mean;
        profile.mean += delta / profile.count;
        profile.m2 += delta * (value - profile.mean);
        // A scaled Welford accumulator backs up the usual calculation when
        // intermediate squared differences exceed or underflow the normal range.
        const magnitude = Math.abs(value);
        if (magnitude > profile.scale) {
          const factor = profile.scale / magnitude;
          profile.scaledMean *= factor;
          profile.scaledM2 *= factor * factor;
          profile.scale = magnitude;
        }
        const scaledValue = profile.scale ? value / profile.scale : 0;
        const scaledDelta = scaledValue - profile.scaledMean;
        profile.scaledMean += scaledDelta / profile.count;
        profile.scaledM2 += scaledDelta * (scaledValue - profile.scaledMean);
        if (own(rule, 'min') && value < rule.min) add(row, name, 'min', `Value ${value} is below minimum ${rule.min}.`);
        if (own(rule, 'max') && value > rule.max) add(row, name, 'max', `Value ${value} exceeds maximum ${rule.max}.`);
      }
      if (rule.enum && !rule.enum.includes(value)) add(row, name, 'enum', 'Value is outside the permitted enum.');
    }
    specification.uniqueKeys.forEach((key, index) => {
      if (key.some((name) => !typed.has(name) || typed.get(name) === null)) return;
      const identity = JSON.stringify(key.map((name) => typed.get(name)));
      const previous = unique[index].get(identity);
      if (previous) add(row, key.join(', '), 'unique', `Composite key duplicates record ${previous.record} (line ${previous.startLine}).`);
      else unique[index].set(identity, row);
    });
    specification.monotonic.forEach((rule, index) => {
      const value = typed.get(rule.column);
      if (value === undefined || value === null || rule.groupBy.some((name) => !typed.has(name) || typed.get(name) === null)) return;
      const identity = JSON.stringify(rule.groupBy.map((name) => typed.get(name)));
      const previous = groups[index].get(identity);
      if (previous && (rule.strict ? value <= previous.value : value < previous.value)) {
        add(row, rule.column, 'monotonic', `Expected ${rule.strict ? 'strictly increasing' : 'nondecreasing'} input order; previous value ${previous.value} is at line ${previous.startLine}.`);
      }
      groups[index].set(identity, { value, startLine: row.startLine });
    });
    for (const rule of specification.sums) {
      const values = rule.columns.map((name) => typed.get(name));
      if (values.some((value) => typeof value !== 'number')) continue;
      // Include the target before rounding the final total, so a small residual
      // survives both cancellation between columns and subtraction of a large target.
      const residual = compensatedSum([...values, -rule.target]);
      if (!Number.isFinite(residual) || Math.abs(residual) > rule.tolerance) {
        const sum = compensatedSum(values);
        add(row, rule.columns.join(' + '), 'sum', `Sum ${sum} differs from target ${rule.target}; residual is ${residual}; absolute tolerance is ${rule.tolerance}.`);
      }
    }
  }
  const profiles = [...accumulators.values()].map(({ m2, mean, scale, scaledMean, scaledM2, ...profile }) => {
    const numeric = profile.type !== 'string';
    const average = Number.isFinite(mean) ? mean : scaledMean * scale;
    const useUnscaled = Number.isFinite(m2) && (m2 >= 2 ** -1022 || (m2 === 0 && scaledM2 === 0));
    const deviation = useUnscaled
      ? Math.sqrt(Math.max(0, m2 / (profile.count - 1)))
      : Math.sqrt(Math.max(0, scaledM2 / (profile.count - 1))) * scale;
    const outOfRange = numeric && profile.count > 1 && (!Number.isFinite(deviation) || (deviation === 0 && scaledM2 > 0));
    return {
      ...profile,
      mean: numeric && profile.count ? average : null,
      stddev: numeric && profile.count > 1 && !outOfRange ? deviation : null,
      ...(outOfRange ? { statisticsWarning: Number.isFinite(deviation) ? 'Sample standard deviation is below the representable positive numeric range.' : 'Sample standard deviation exceeds the finite numeric range.' } : {}),
    };
  });
  return {
    software: { name: 'Runcheck', version: SOFTWARE_VERSION },
    schemaVersion: 1,
    passed: issueTotal === 0,
    counts: { records: parsed.records.length, columns: parsed.headers.length, issues: issueTotal, invalidRecords: invalidRecords.size },
    issueCounts: Object.fromEntries(issueCounts),
    issues,
    issuesTruncated: issues.length < issueTotal,
    maxIssues,
    profiles,
    columns: parsed.headers,
    delimiter,
    schema: specification,
  };
}

function bytes(value, label) {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  throw new TypeError(`${label} must be text or Uint8Array bytes.`);
}
function utf8(value, label) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(value); }
  catch { throw new TypeError(`${label} must use valid UTF-8 encoding.`); }
}
async function sha256(value) {
  let subtle = globalThis.crypto?.subtle;
  if (!subtle && typeof process !== 'undefined' && process.versions?.node) subtle = (await import('node:crypto')).webcrypto.subtle;
  if (!subtle) throw new Error('SHA-256 requires Web Crypto. Open the app through localhost or HTTPS.');
  const digest = new Uint8Array(await subtle.digest('SHA-256', value));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Hash exact supplied bytes; object schemas use their JSON.stringify representation. */
export async function makeReport(input, schema, options = {}) {
  const rawInput = bytes(input, 'CSV input');
  const schemaObject = object(schema) && !(schema instanceof Uint8Array);
  const rawSchema = schemaObject ? new TextEncoder().encode(JSON.stringify(schema)) : bytes(schema, 'Schema input');
  let specification;
  try { specification = JSON.parse(utf8(rawSchema, 'Schema').replace(/^\uFEFF/, '')); }
  catch (error) { if (error instanceof TypeError) throw error; throw new SchemaError('Schema input must be valid JSON.'); }
  const report = auditCSV(utf8(rawInput, 'CSV input'), specification, options);
  const [inputSha256, schemaSha256] = await Promise.all([sha256(rawInput), sha256(rawSchema)]);
  return {
    ...report,
    hashes: { inputSha256, schemaSha256 },
    hashEncoding: { input: 'exact supplied UTF-8 bytes', schema: schemaObject ? 'JSON.stringify object encoded as UTF-8' : 'exact supplied UTF-8 bytes' },
  };
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

/** Static, self-contained HTML with no scripts or interpretation of user HTML. */
export function renderReportHTML(report) {
  const e = escapeHTML;
  const rows = report.profiles.map((p) => `<tr>${[p.column, p.type, p.count, p.nullCount, p.invalidCount, p.min, p.max, p.mean, p.stddev].map((v) => `<td>${e(v === null ? '—' : v)}</td>`).join('')}</tr>`).join('');
  const issues = report.issues.map((i) => `<tr>${[i.record, i.startLine, i.column ?? 'record', i.code, i.message].map((v) => `<td>${e(v)}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Runcheck ${report.passed ? 'PASS' : 'FAIL'} report</title><style>body{background:#101318;color:#e1e7ef;font:14px system-ui;margin:0;padding:32px;line-height:1.55}main{max-width:1200px;margin:auto}h1{font-size:26px}h2{font-size:18px;margin-top:30px}.status{color:${report.passed ? '#7de0b5' : '#ff9a94'}}table{border-collapse:collapse;width:100%;font:12px ui-monospace,monospace}td,th{border:1px solid #303742;padding:9px;text-align:left;overflow-wrap:anywhere}.scroll{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#171c24;padding:18px}footer{color:#a1adbe;margin-top:24px}</style><main><h1>Runcheck <span class="status">${report.passed ? 'PASS' : 'FAIL'}</span></h1><p>${e(report.counts.records)} records · ${e(report.counts.issues)} issues · ${e(report.counts.invalidRecords)} affected records. Retained ${e(report.issues.length)} issue examples${report.issuesTruncated ? ' (truncated)' : ''}.</p><h2>Column profiles</h2><div class="scroll"><table><thead><tr><th>Column</th><th>Type</th><th>Valid</th><th>Null</th><th>Invalid</th><th>Min</th><th>Max</th><th>Mean</th><th>Sample std.</th></tr></thead><tbody>${rows}</tbody></table></div><h2>Issues</h2><div class="scroll"><table><thead><tr><th>Record</th><th>Source line</th><th>Column</th><th>Code</th><th>Message</th></tr></thead><tbody>${issues}</tbody></table></div><h2>Self-contained JSON report</h2><pre>${e(JSON.stringify(report, null, 2))}</pre><footer>Runcheck ${e(report.software.version)} · Read-only audit. No data values were repaired. SHA-256 hashes identify exact source/configuration bytes.</footer></main></html>`;
}
