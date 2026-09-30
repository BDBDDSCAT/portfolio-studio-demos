# Runcheck

Check a CSV before it becomes a plot, a fit, or a published result.

Runcheck is a small, local data quality gate for numerical experiments. Describe the expected columns in JSON, then check types, bounds, composite keys, input order, and row sums. It produces a standalone HTML report and a JSON report with exact source hashes.

[![A deliberately broken synthetic optics CSV, with source-addressed violations](docs/preview.png)](https://bdbddscat.github.io/portfolio-studio-demos/runcheck/)

[Browser demo](https://bdbddscat.github.io/portfolio-studio-demos/runcheck/) · [中文](README.zh-CN.md) · [Schema reference](docs/schema.md) · [MIT](LICENSE)

**Node.js 22+ · zero runtime dependencies · browser + CLI · MIT**

## Try it

From this directory:

```sh
node cli.js audit --input examples/clean.csv --schema examples/schema.json --out reports/clean
```

```text
PASS · 6 records · 5 columns · 0 issues · 0 invalid records
```

Open `reports/clean/report.html` in a browser, or read `report.json` in another program. To see a failed audit:

```sh
node cli.js audit --input examples/broken.csv --schema examples/schema.json --out reports/broken
```

The synthetic optics fixture contains a duplicate sample/wavelength key, a decreasing wavelength, `NaN`, and a row where `R + T + A = 1.1`. It exits with code **1** and still writes both reports. These are illustrative data, not measurements or an optics simulation.

To run the browser workspace locally:

```sh
python3 -m http.server 8099 --bind 127.0.0.1
```

Open <http://127.0.0.1:8099>. CSV and schema files are checked in the browser; processing does not require an account, API key, or remote service.

## CLI

```text
runcheck audit --input FILE --schema FILE --out DIRECTORY
               [--delimiter comma|tab|semicolon]
               [--max-issues N] [--force]
```

Use `node cli.js` in place of `runcheck`. To enable the command from a local checkout, run `npm link`. Runcheck does not need `npm install` for its CLI, library, or tests.

| Option | Meaning |
| --- | --- |
| `--input FILE` | UTF-8 CSV file; the first record is the header. |
| `--schema FILE` | UTF-8 JSON schema, version 1. |
| `--out DIRECTORY` | Create this directory and save `report.json` and `report.html`. |
| `--delimiter` | `comma` by default; also accepts `tab` or `semicolon`. |
| `--max-issues N` | Save up to 0–10000 issue examples; default 100. Totals and profiles always cover the complete input. |
| `--force` | Replace existing report files. Without it, either existing report filename stops the command. |
| `--help` / `--version` | Show command help or software version. |

Unknown options, repeated options, missing values, unsupported separators, and malformed CSV or schemas exit with **2**. File read/write errors also exit with **2**. Parse and schema errors do not create audit reports. Exit **0** means all configured rules passed; exit **1** means one or more audit violations. Runcheck inspects values without changing the input files.

```sh
node cli.js audit --input scan.tsv --schema scan.schema.json --out reports/scan --delimiter tab --max-issues 25
```

## Write a schema

```json
{
  "version": 1,
  "columns": {
    "sample": { "type": "string", "enum": ["sample-a", "sample-b"] },
    "wavelength_nm": { "type": "number", "min": 380, "max": 750 },
    "R": { "type": "number", "min": 0, "max": 1 },
    "T": { "type": "number", "min": 0, "max": 1 },
    "A": { "type": "number", "min": 0, "max": 1 }
  },
  "extraColumns": "reject",
  "uniqueKeys": [["sample", "wavelength_nm"]],
  "monotonic": [{ "column": "wavelength_nm", "groupBy": ["sample"], "strict": true }],
  "sums": [{ "columns": ["R", "T", "A"], "target": 1, "tolerance": 0.000001 }]
}
```

- Every declared column is required unless `requiredColumns` explicitly lists the required subset. `requiredColumns: []` makes every declared column optional. Present optional columns still receive their configured checks.
- Supported types are `string`, `number`, and `integer`. Numbers use finite decimal or exponent notation, such as `-0.5`, `.25`, or `1e-6`. `NaN`, `Infinity`, hexadecimal values, thousands separators, and nonzero values that underflow to zero fail. Integer notation must be exactly integral and fit the safe JavaScript integer range.
- `nullable` defaults to `false`. An empty field, including `""`, is null. Outer whitespace is trimmed for numeric conversion; strings retain their exact whitespace. A whitespace-only numeric field is an invalid number.
- `min` and `max` are inclusive numeric bounds; `enum` is a nonempty list of values with the column's type. Enum comparisons happen after numeric conversion.
- `extraColumns` defaults to `reject`; `allow` permits undeclared headers without applying column rules or profiles to them.
- Each `uniqueKeys` entry is a tuple of columns. Numeric key values use their parsed value, so `1` and `1.0` are the same key. Incomplete, null, or malformed tuples are skipped. Tuple boundaries remain distinct even when string fields contain separators.
- `monotonic` checks the original row order within each `groupBy` tuple. Omit `groupBy` to check the entire file. `strict: true` requires increasing values; the default `false` permits equality. Invalid or empty values do not reset the previous valid value. The audit never sorts rows.
- `sums` checks `abs(sum - target) <= tolerance` using explicit finite `target` and nonnegative finite absolute `tolerance`. Rows with missing, null, or malformed members skip this cross-column rule; their individual violations still count.

Unknown schema properties are rejected so misspelled rules cannot silently disappear. See the [full schema and CSV reference](docs/schema.md) for parsing, defaults, issue codes, and report semantics.

## Read the report

`counts.records` is the number of data records, excluding the header. `counts.issues` counts every violation, while `counts.invalidRecords` counts affected data records once. A record can have several violations. Header issues use `record: 0`; data records start at **1**. `startLine` identifies the physical source line where that record began, including quoted multiline fields.

Each profile contains parsed value count, null count, invalid type count, and numeric minimum, maximum, mean, and **sample** standard deviation. Numeric bounds or enum failures still contribute their parsed value to the profile. Empty/malformed values do not. Standard deviation is null for fewer than two numeric values; string statistics are null. Computation uses JavaScript floating-point numbers; a statistic outside their representable range is null with `statisticsWarning` explaining overflow or underflow. Scaled moments preserve small, varying data when their squared differences underflow.

`hashes.inputSha256` and `hashes.schemaSha256` identify the exact bytes supplied by the CLI, including BOM, whitespace, and line endings. The report records Runcheck's version, delimiter, normalized schema, complete issue counts by code, and whether saved issue examples were truncated. Hashes identify inputs; they do not establish where the data came from.

## Use the library

```js
import { readFile } from 'node:fs/promises';
import { makeReport, renderReportHTML } from './src/audit.js';

const input = await readFile('examples/clean.csv');
const schema = await readFile('examples/schema.json');
const report = await makeReport(input, schema, { maxIssues: 100 });
console.log(report.passed, report.hashes);
const html = renderReportHTML(report);
```

`makeReport` accepts text or `Uint8Array` input, and a schema object, JSON text, or `Uint8Array`. An object schema is hashed as UTF-8 `JSON.stringify(schema)`; pass raw bytes to retain a source file's exact hash. Library separator values are literal `','`, `'\t'`, or `';'`. `parseCSV`, `validateSchema`, and synchronous `auditCSV` are also exported, along with `CSVParseError`, `SchemaError`, and `SOFTWARE_VERSION`. `auditCSV` creates the audit report without hashes; `makeReport` adds SHA-256 provenance. In browsers, hashing needs HTTPS or localhost Web Crypto.

## Add a CI check

After checkout and Node.js setup, run the audit as a normal build step:

```yaml
- name: Check numerical data
  working-directory: runcheck
  run: node cli.js audit --input examples/clean.csv --schema examples/schema.json --out reports/ci
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: runcheck-report
    path: runcheck/reports/ci/
```

An audit violation fails the step with exit 1, and the saved HTML explains the failure. Report files are ignored by the repository.

## Develop

```sh
npm test
```

Tests use Node's built-in runner. Contributions with a small failing CSV and schema are easy to reproduce. Include the expected exit code and issue when reporting a problem.
