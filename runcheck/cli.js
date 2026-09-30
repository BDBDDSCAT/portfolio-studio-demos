#!/usr/bin/env node
import { readFile, mkdir, lstat, realpath, mkdtemp, writeFile, link, rename, unlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { makeReport, renderReportHTML, SOFTWARE_VERSION } from './src/audit.js';

const HELP = `Runcheck ${SOFTWARE_VERSION} — local CSV quality checks

Usage:
  runcheck audit --input FILE --schema FILE --out DIRECTORY [options]
  runcheck --help
  runcheck --version

Options:
  --delimiter comma|tab|semicolon   Field separator (default: comma)
  --max-issues N                   Saved issue examples, 0–10000 (default: 100)
  --force                          Replace existing report.json/report.html
  --help                           Show this help

Outputs: report.json and report.html
Exit codes: 0 = passed, 1 = audit violations, 2 = usage/input/output error
`;

function parseArgs(args) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) return { help: true };
  if (args.length === 1 && args[0] === '--version') return { version: true };
  if (args[0] !== 'audit') throw new Error('Expected the audit command. Use --help for usage.');

  const options = { delimiter: 'comma', maxIssues: 100, force: false };
  const seen = new Set();
  const names = new Map([
    ['--input', 'input'], ['--schema', 'schema'], ['--out', 'out'],
    ['--delimiter', 'delimiter'], ['--max-issues', 'maxIssues'],
  ]);
  for (let i = 1; i < args.length; i += 1) {
    const flag = args[i];
    if (!names.has(flag) && flag !== '--force' && flag !== '--help') {
      throw new Error(`Unknown argument: ${flag}`);
    }
    if (seen.has(flag)) throw new Error(`Repeated option: ${flag}`);
    seen.add(flag);
    if (flag === '--force') { options.force = true; continue; }
    if (flag === '--help') { options.help = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    options[names.get(flag)] = value;
  }
  if (options.help) return options;
  for (const flag of ['input', 'schema', 'out']) {
    if (!options[flag]) throw new Error(`Missing required option: --${flag}`);
  }
  const delimiters = { comma: ',', tab: '\t', semicolon: ';' };
  if (!Object.hasOwn(delimiters, options.delimiter)) throw new Error('Delimiter must be comma, tab, or semicolon.');
  options.delimiter = delimiters[options.delimiter];
  if (typeof options.maxIssues === 'string') {
    if (!/^(0|[1-9]\d*)$/.test(options.maxIssues)) throw new Error('--max-issues must be an integer from 0 to 10000.');
    options.maxIssues = Number(options.maxIssues);
    if (!Number.isSafeInteger(options.maxIssues) || options.maxIssues > 10000) {
      throw new Error('--max-issues must be an integer from 0 to 10000.');
    }
  }
  return options;
}

async function inspectTarget(filename, force) {
  try {
    const stat = await lstat(filename);
    if (stat.isDirectory()) throw new Error(`Output path is a directory: ${filename}`);
    if (!force) throw new Error(`Report already exists: ${filename}. Use --force to replace it.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function saveReports(directory, report, force, sourceFiles) {
  const targets = ['report.json', 'report.html'].map(name => path.join(directory, name));
  await mkdir(directory, { recursive: true });
  const [realDirectory, ...sources] = await Promise.all([realpath(directory), ...sourceFiles.map(filename => realpath(filename))]);
  for (const filename of targets) {
    let resolved;
    try { resolved = await realpath(filename); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      resolved = path.join(realDirectory, path.basename(filename));
    }
    if (sources.includes(resolved)) throw new Error(`Report path overlaps an input file: ${filename}`);
  }
  await Promise.all(targets.map(filename => inspectTarget(filename, force)));
  const temporary = await mkdtemp(path.join(directory, '.runcheck-'));
  const staged = targets.map(filename => path.join(temporary, path.basename(filename)));
  const installed = [];
  try {
    await Promise.all([
      writeFile(staged[0], `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
      writeFile(staged[1], renderReportHTML(report), 'utf8'),
    ]);
    for (let i = 0; i < targets.length; i += 1) {
      if (force) await rename(staged[i], targets[i]);
      else {
        // link fails on an existing target, including one created after inspection.
        await link(staged[i], targets[i]);
        installed.push(targets[i]);
      }
    }
  } catch (error) {
    if (!force) await Promise.all(installed.map(filename => unlink(filename).catch(() => {})));
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { process.stdout.write(HELP); return; }
    if (options.version) { process.stdout.write(`${SOFTWARE_VERSION}\n`); return; }
    const [input, schema] = await Promise.all([readFile(options.input), readFile(options.schema)]);
    const report = await makeReport(input, schema, {
      delimiter: options.delimiter,
      maxIssues: options.maxIssues,
    });
    const outputDirectory = path.resolve(options.out);
    await saveReports(outputDirectory, report, options.force, [options.input, options.schema]);
    const status = report.passed ? 'PASS' : 'FAIL';
    const { records, columns, issues, invalidRecords } = report.counts;
    process.stdout.write(`${status} · ${records} records · ${columns} columns · ${issues} issues · ${invalidRecords} invalid records\n`);
    if (report.issuesTruncated) process.stdout.write(`Saved ${report.issues.length} issue examples; totals include every issue.\n`);
    process.stdout.write(`Reports: ${outputDirectory}\n`);
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Runcheck: ${error.message}\n`);
    process.exitCode = 2;
  }
}

await main();
