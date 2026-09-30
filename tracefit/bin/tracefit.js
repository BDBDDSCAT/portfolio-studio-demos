#!/usr/bin/env node
import { readFile, mkdir, lstat, stat, realpath, writeFile, link, unlink, rename } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fitTrace } from '../src/fit.js';
import { parseCsv, selectTrace, resultToCsv, buildFitReport } from '../src/csv.js';

const HELP = `Tracefit — constrained Gaussian / Lorentzian peak fitting

Usage: node bin/tracefit.js fit --input data.csv --x wavelength_nm --y intensity [options]

  --input PATH       Comma-separated CSV with named header (required)
  --x NAME           x column (default first column)
  --y NAME           y column (default second column)
  --sigma NAME       Positive known standard deviation of y; enables weighted fitting
  --model MODEL      gaussian (default) or lorentzian
  --peaks N          1..3 positive peaks (default 1)
  --iterations N     Maximum LM iterations per start, 1..1000 (default 150)
  --starts N         Deterministic initializations, 1..20 (default 5)
  --out DIRECTORY    Output fit.json + fitted.csv (default ./out)
  --force            Replace existing output files
  --help, -h         Show this help

Gaussian width = sigma; Lorentzian width = HWHM. Both use an affine baseline.
No sigma: covariance is scaled by residual variance. With sigma: known-error covariance.
Duplicate x values and invalid numbers are rejected. Samples are sorted by x.
Exit codes: 0 success/help, 2 invalid input or I/O, 3 fit did not converge.
Unconverged fits retain diagnostic output; covariance must be treated as invalid.
Input files and their symlink/hardlink aliases are never overwritten, even with --force.
`;

function parse(args) {
  const options = {};
  if (args[0] && !args[0].startsWith('-')) {
    const command = args.shift();
    if (command === 'help') options.help = true;
    else if (command !== 'fit') throw new Error(`Unknown command: ${command}.`);
  }
  const allowed = new Set(['input', 'x', 'y', 'sigma', 'model', 'peaks', 'iterations', 'starts', 'out', 'force', 'help']);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-h') args[i] = '--help';
    const match = /^--([a-z][a-z-]*)(?:=(.*))?$/.exec(args[i]);
    if (!match || !allowed.has(match[1])) throw new Error(`Unknown argument: ${args[i]}.`);
    const [, name, attached] = match;
    if (Object.hasOwn(options, name)) throw new Error(`Duplicate option: --${name}.`);
    if (name === 'force' || name === 'help') {
      if (attached !== undefined) throw new Error(`--${name} does not take a value.`);
      options[name] = true; continue;
    }
    const value = attached ?? args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}.`);
    if (['peaks', 'iterations', 'starts'].includes(name)) {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`--${name} must be an integer.`);
      options[name] = Number(value);
    } else options[name] = value;
  }
  for (const [name, max] of [['peaks', 3], ['iterations', 1000], ['starts', 20]]) {
    if (Object.hasOwn(options, name) && (options[name] < 1 || options[name] > max)) throw new Error(`--${name} must be between 1 and ${max}.`);
  }
  return options;
}

async function protectInput(inputPath, outputPaths) {
  const [sourceRealPath, sourceState] = await Promise.all([realpath(inputPath), stat(inputPath, { bigint: true })]);
  for (const outputPath of Object.values(outputPaths)) {
    if (resolve(inputPath) === resolve(outputPath)) throw new Error(`Output would overwrite the input source: ${outputPath}. Choose a different --out directory.`);
    try {
      const [outputRealPath, outputState] = await Promise.all([realpath(outputPath), stat(outputPath, { bigint: true })]);
      if (sourceRealPath === outputRealPath || (sourceState.dev === outputState.dev && sourceState.ino === outputState.ino)) {
        throw new Error(`Output aliases the input source: ${outputPath}. Choose a different --out directory; --force cannot replace input data.`);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function outputs(directory, contents, force, inputPath) {
  await mkdir(directory, { recursive: true });
  const paths = Object.fromEntries(Object.keys(contents).map((name) => [name, join(directory, name)]));
  await protectInput(inputPath, paths);
  for (const path of Object.values(paths)) {
    try {
      const state = await lstat(path);
      if (!force) throw new Error(`Output already exists: ${path}; use --force.`);
      if (!state.isFile()) throw new Error(`Output is not a regular file: ${path}.`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const staged = [], published = [];
  try {
    for (const [name, content] of Object.entries(contents)) {
      const temporary = `${paths[name]}.${randomUUID()}.tmp`;
      staged.push(temporary);
      await writeFile(temporary, content, { flag: 'wx' });
    }
    for (let i = 0; i < staged.length; i += 1) {
      const path = paths[Object.keys(contents)[i]];
      if (force) await rename(staged[i], path);
      else { await link(staged[i], path); published.push(path); }
    }
  } catch (error) {
    if (!force) await Promise.all(published.map((path) => unlink(path).catch(() => {})));
    throw error;
  } finally { await Promise.all(staged.map((path) => unlink(path).catch(() => {}))); }
  return paths;
}

try {
  const options = parse(process.argv.slice(2));
  if (options.help) process.stdout.write(HELP);
  else {
    if (!options.input) throw new Error('--input is required. Use --help.');
    const inputPath = resolve(options.input);
    const outputDirectory = resolve(options.out ?? 'out');
    await protectInput(inputPath, { report: join(outputDirectory, 'fit.json'), fitted: join(outputDirectory, 'fitted.csv') });
    if ((await stat(inputPath)).size > 20 * 1024 * 1024) throw new Error('CSV exceeds the 20 MB limit.');
    const table = parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(inputPath)));
    const columns = { x: options.x ?? table.columns[0], y: options.y ?? table.columns[1], sigma: options.sigma ?? null };
    const data = selectTrace(table, columns);
    const result = fitTrace(data, {
      model: options.model ?? 'gaussian', peaks: options.peaks ?? 1,
      maxIterations: options.iterations ?? 150, multiStarts: options.starts ?? 5,
    });
    const report = buildFitReport(result, { source: basename(options.input), columns });
    const paths = await outputs(outputDirectory, {
      'fit.json': `${JSON.stringify(report, null, 2)}\n`, 'fitted.csv': resultToCsv(result),
    }, options.force, inputPath);
    process.stdout.write(`${JSON.stringify({ converged: result.converged, status: result.status, model: result.model, peaks: result.peaks, rmse: result.statistics.rmse, covarianceValid: result.covariance.valid, warnings: result.warnings.length, files: paths })}\n`);
    if (!result.converged) process.exitCode = 3;
  }
} catch (error) {
  process.stderr.write(`tracefit: ${error.message}\n`);
  process.exitCode = 2;
}
