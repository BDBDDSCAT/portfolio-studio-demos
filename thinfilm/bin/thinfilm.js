#!/usr/bin/env node
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  wavelengthScan,
  angleScan,
  validateStack,
  scanToCsv,
} from "../src/thinfilm.js";

const HELP = `Thinfilm 1.0.0 — passive multilayer optical scattering

Usage:
  thinfilm spectrum --stack FILE [--start 400 --stop 800 --points 201]
                   [--angle 0 --polarization s] [--out DIR] [--force]
  thinfilm angle --stack FILE [--wavelength 550 --start 0 --stop 85 --points 201]
                [--polarization s] [--out DIR] [--force]
  thinfilm --help
  thinfilm --version

Lengths: nm. Angles: degrees (0..85). Polarization: s, p, unpolarized.
Points: 1..2001. Stack: real incident/substrate indices and <=128 layers
{n>0,k>=0,dNm>=0}; indices are constant, passive, and nondispersive.
Without --out, raw CSV is written to stdout. --out DIR writes curve.csv,
result.json, and stack.json. Existing files are never replaced without --force.
Spectrum start/stop: wavelength in nm. Angle start/stop: angle in degrees.
The exact critical angle of a finite internal layer is rejected explicitly.
`;

function parse(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help"))
    return { help: true };
  if (args.length === 1 && args[0] === "--version") return { version: true };
  const command = args[0];
  if (!["spectrum", "angle"].includes(command))
    throw new Error(`Unknown command: ${command}. Use --help.`);
  const allowed = new Set([
    "stack",
    "start",
    "stop",
    "points",
    "polarization",
    "out",
    "force",
    "help",
    ...(command === "spectrum" ? ["angle"] : ["wavelength"]),
  ]);
  const flags = {};
  for (let i = 1; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--") || token.length === 2 || token.includes("="))
      throw new Error(`Invalid argument: ${token}. Use --flag value.`);
    const key = token.slice(2);
    if (!allowed.has(key)) throw new Error(`Unknown flag: ${token}`);
    if (key in flags) throw new Error(`Duplicate flag: ${token}`);
    if (key === "force" || key === "help") flags[key] = true;
    else {
      const value = args[++i];
      if (value == null || value.startsWith("--") || value === "")
        throw new Error(`Missing value for ${token}`);
      flags[key] = value;
    }
  }
  if (flags.help) return { help: true };
  if (!flags.stack) throw new Error("--stack FILE is required.");
  const number = (key, fallback) => {
    if (!(key in flags)) return fallback;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(flags[key]))
      throw new Error(`--${key} must be a finite number.`);
    const value = Number(flags[key]);
    if (!Number.isFinite(value))
      throw new Error(`--${key} must be a finite number.`);
    return value;
  };
  const options =
    command === "spectrum"
      ? {
          startNm: number("start", 400),
          stopNm: number("stop", 800),
          points: number("points", 201),
          angleDeg: number("angle", 0),
          polarization: flags.polarization ?? "s",
        }
      : {
          wavelengthNm: number("wavelength", 550),
          startDeg: number("start", 0),
          stopDeg: number("stop", 85),
          points: number("points", 201),
          polarization: flags.polarization ?? "s",
        };
  return {
    command,
    stackPath: flags.stack,
    out: flags.out,
    force: flags.force === true,
    options,
  };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function main() {
  const config = parse(process.argv.slice(2));
  if (config.help) {
    process.stdout.write(HELP);
    return;
  }
  if (config.version) {
    process.stdout.write("1.0.0\n");
    return;
  }
  const sourcePath = resolve(config.stackPath);
  const sourceInfo = await stat(sourcePath);
  if (!sourceInfo.isFile() || sourceInfo.size > 2 * 1024 * 1024)
    throw new Error("Stack JSON must be a file no larger than 2 MiB.");
  let parsed;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot parse stack JSON: ${error.message}`);
  }
  const stack = validateStack(parsed);
  const scan =
    config.command === "spectrum"
      ? wavelengthScan(stack, config.options)
      : angleScan(stack, config.options);
  const csv = scanToCsv(scan);
  if (!config.out) {
    process.stdout.write(csv);
    return;
  }
  const directory = resolve(config.out);
  // API option names and a separate reference match the browser result schema.
  const files = {
    "curve.csv": csv,
    "stack.json": `${JSON.stringify(stack, null, 2)}\n`,
    "result.json": `${JSON.stringify({ schema: "thinfilm.result.v1", stack, config: config.options, reference: scan.rows[0], scan }, null, 2)}\n`,
  };
  const sourceCanonical = await realpath(sourcePath);
  for (const name of Object.keys(files)) {
    const destination = join(directory, name);
    const present = await exists(destination);
    const destinationInfo = present ? await stat(destination) : null;
    if (
      destination === sourcePath ||
      (present && (await realpath(destination)) === sourceCanonical) ||
      (destinationInfo && destinationInfo.dev === sourceInfo.dev && destinationInfo.ino === sourceInfo.ino)
    ) {
      throw new Error(
        `Output would overwrite the input stack: ${destination}. Choose a different --out directory.`,
      );
    }
    if (destinationInfo && !destinationInfo.isFile()) {
      throw new Error(
        `Output destination is not a regular file: ${destination}`,
      );
    }
  }
  // Check every destination before creating or replacing any result file.
  if (!config.force) {
    for (const name of Object.keys(files)) {
      if (await exists(join(directory, name)))
        throw new Error(
          `Refusing to overwrite ${join(directory, name)}. Use --force.`,
        );
    }
  }
  await mkdir(directory, { recursive: true });
  for (const [name, content] of Object.entries(files))
    await writeFile(join(directory, name), content, {
      flag: config.force ? "w" : "wx",
    });
  process.stdout.write(
    `Wrote ${scan.rows.length} raw samples to ${directory}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`thinfilm: ${error.message}\n`);
  process.exitCode = 1;
});
