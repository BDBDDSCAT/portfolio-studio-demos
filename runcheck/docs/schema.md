# Runcheck schema v1

The schema is a UTF-8 JSON object. `version` and a nonempty `columns` object are required. Unknown properties are rejected at every rule level. See [the runnable optics example](../examples/schema.json).

## Top-level fields

| Field | Shape | Default |
| --- | --- | --- |
| `version` | Exactly `1` | Required |
| `columns` | Object mapping column names to column rules | Required |
| `requiredColumns` | Array of distinct declared names | All declared columns |
| `extraColumns` | `"reject"` or `"allow"` | `"reject"` |
| `uniqueKeys` | Array of arrays of distinct declared names | `[]` |
| `monotonic` | Array of order rules | `[]` |
| `sums` | Array of sum rules | `[]` |

Declared column names must be nonempty and have no outer whitespace. CSV header matching is exact and case-sensitive. CSV column order does not need to match schema property order.

`requiredColumns` may be empty. Declared columns outside this array can be absent. When present, those optional columns still receive their column rules. Every name referenced by a cross-column rule must be declared; references within one tuple or list cannot repeat. A cross-column rule is skipped when it lacks a member needed for comparison.

An undeclared header is a reported `extra_column` violation by default. With `extraColumns: "allow"`, undeclared columns remain part of the input column count but have no rules or profiles. Extra *fields* beyond the header width still produce `row_width` regardless of this setting.

## Column rules

```json
{
  "type": "number",
  "nullable": false,
  "min": 0,
  "max": 1,
  "enum": [0, 0.5, 1]
}
```

| Field | Semantics |
| --- | --- |
| `type` | Required: `"string"`, `"number"`, or `"integer"`. |
| `nullable` | Boolean; defaults to `false`. Empty fields may be null when true. |
| `min` / `max` | Optional finite numeric bounds, inclusive. Unsupported for string columns. `min` cannot exceed `max`. |
| `enum` | Optional nonempty array of values matching the type. Comparison uses parsed values. |

Numeric notation follows this grammar after trimming outer whitespace:

```text
^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$
```

Examples accepted by `number`: `1`, `+2`, `-0.5`, `.25`, `1.`, `1e-6`, ` 2.5 `.

Examples rejected: `NaN`, `Infinity`, `0x10`, `1_000`, `1,000`, `1 000`, whitespace alone, and notation that overflows to infinity (`1e999`) or rounds a nonzero value down to zero (`1e-9999`). Other numeric conversion uses JavaScript's binary floating-point representation.

`integer` applies the same numeric grammar, requires exactly integral decimal notation, and requires `Number.isSafeInteger(value)`. Values such as `2.0` and `2e0` pass; `2.1`, `2.00000000000000001`, and values beyond ±9,007,199,254,740,991 fail. The exact notation check prevents a fractional source from being accepted after binary rounding. A numeric enum compares parsed numbers: `1.0` matches enum value `1`.

An empty CSV field, quoted or unquoted, is null. Numeric whitespace is trimmed only for conversion; string values preserve all whitespace. A string containing one space is a nonempty string. Neither type nor numeric-bound checks run on null; null produces `null` unless permitted. Enum constraints do not replace nullability.

## Composite uniqueness

```json
"uniqueKeys": [["sample", "wavelength_nm"], ["record_id"]]
```

Each tuple must be unique across the entire file. Duplicates are reported on the later record, with the first matching record and its source line in the message. Tuples use typed values; numeric `1`, `1.0`, and `1e0` collide. String whitespace remains significant. Tuple boundaries are preserved, including values containing commas or other separators.

Missing, null, or type-invalid key members skip that uniqueness rule. A parsed value that fails a range or enum rule still participates, so an audit may report both a range violation and a duplicate.

## Input order

```json
"monotonic": [
  { "column": "wavelength_nm", "groupBy": ["sample"], "strict": true }
]
```

`column` must name a numeric (`number` or `integer`) column. `groupBy` defaults to `[]`, which treats the file as one group. `strict` defaults to `false`: each value must be greater than or equal to the previous valid value in its group. When true, equality also violates the rule.

Groups are compared in the input's original record order, even when their records are interleaved. An invalid or null comparison value is skipped without clearing the group's previous valid value. A valid value becomes the previous value even when it produces a monotonic violation. Runcheck does not sort input. A missing, null, or type-invalid grouping member skips the comparison.

## Row sums

```json
"sums": [
  { "columns": ["R", "T", "A"], "target": 1, "tolerance": 0.000001 }
]
```

`columns` is a nonempty tuple of numeric columns. `target` must be explicitly provided and finite. `tolerance` must be explicitly provided, finite, and nonnegative. The test is an absolute tolerance:

```text
abs(R + T + A - target) <= tolerance
```

This is not a relative or percentage tolerance. Summation uses JavaScript floating-point arithmetic. A nonfinite computed sum fails. Missing, empty, or type-invalid members skip the sum rule; their individual column issues still count. Values outside their bounds or enum still participate.

## CSV format

The CLI selects `comma`, `tab`, or `semicolon`; the library accepts the literal characters `','`, `'\t'`, or `';'`. Separator autodetection is not performed.

- The first record is the header. Empty input, empty header names, and duplicate header names throw `CSVParseError`.
- UTF-8 is required for byte input; invalid encoding is an input error. An initial UTF-8 BOM is accepted.
- LF, CRLF, and CR are record separators. Inside quoted fields their original content is retained and physical source lines are counted.
- Quoted fields can contain separators and newlines. `""` inside a quoted field represents one double quote.
- A quote may only begin an empty field. Following a closing quote, only a separator, newline, or end of file is permitted; even trailing spaces are rejected.
- Blank physical lines are data records. A final record separator does not itself add an extra record.
- Header and string whitespace is preserved. No field is repaired or rewritten.
- A record with a field count different from the header produces a `row_width` audit issue. Missing cells also receive the applicable null checks.

## Report fields

`makeReport` returns the same audit data as `auditCSV` and adds hashes. The report is a JSON-serializable object:

| Field | Meaning |
| --- | --- |
| `software` | `{ "name": "Runcheck", "version": "1.0.0" }` |
| `schemaVersion` | Rule format version, currently 1 |
| `passed` | True exactly when the full issue count is zero |
| `counts.records` | Data records, excluding header |
| `counts.columns` | CSV header width, including allowed extra columns |
| `counts.issues` | Total violations, independent of saved issue limit |
| `counts.invalidRecords` | Number of distinct affected data records; header issues excluded |
| `issueCounts` | Complete totals by issue code |
| `issues` | Saved examples: `record`, `startLine`, `column`, `code`, `message` |
| `issuesTruncated` | True when the full count exceeds the saved examples |
| `maxIssues` | Saved example limit, integer from 0 to 10000 |
| `profiles` | One profile for each present declared column |
| `columns` / `delimiter` | Exact headers and selected separator |
| `schema` | Validated schema with defaults applied |
| `hashes` | `inputSha256` and `schemaSha256`, added by `makeReport` |
| `hashEncoding` | How each source was encoded for hashing, added by `makeReport` |

Data `record` numbers start at 1. Header-level issues use 0. `startLine` is the physical line where a record began, so it can differ from `record + 1` when fields contain quoted newlines. For `row_width`, `column` is null; cross-column issues identify their participating columns.

Profiles include `column`, `type`, `count`, `nullCount`, `invalidCount`, `min`, `max`, `mean`, and `stddev`. `count` means successfully parsed, nonnull values, including values that fail bounds or enum checks. `invalidCount` counts type failures; `nullCount` includes empty and missing cells. Numeric `stddev` is the sample standard deviation using denominator `count - 1` and is null for fewer than two values. If a statistic exceeds the finite floating-point range or a positive standard deviation rounds below the smallest representable value, it is null and `statisticsWarning` explains the range limit. Scaled moments avoid intermediate squared-difference overflow and underflow. Empty numeric columns have null minimum, maximum, and mean. String columns have null numeric statistics.

The CLI hashes the exact UTF-8 bytes read from both files. BOM, JSON indentation, and line endings affect the hashes even if the parsed data is equivalent. A schema object passed directly to the library is hashed as the UTF-8 encoding of `JSON.stringify(schema)`; pass original bytes for an exact file hash. Text inputs are hashed as their UTF-8 encoding. Report hashes are source identifiers, not digital signatures.

## Issue codes

| Code | Violation |
| --- | --- |
| `missing_column` | A required header is absent. |
| `extra_column` | An undeclared header is present while extras are rejected. |
| `row_width` | A data record has a different field count from the header. |
| `null` | An empty or missing cell is not nullable. |
| `type` | Numeric syntax, finite-number, or safe-integer check failed. |
| `min` / `max` | A parsed number is outside an inclusive bound. |
| `enum` | A parsed value is outside its enum. |
| `unique` | A complete typed key tuple repeats an earlier tuple. |
| `monotonic` | A parsed value violates the configured input order. |
| `sum` | A complete numeric row sum exceeds absolute tolerance. |

Malformed CSV and invalid schemas throw errors rather than appearing as data violations. The CLI uses exit 2 for these cases, exit 1 for reportable violations, and exit 0 for a passed report.
