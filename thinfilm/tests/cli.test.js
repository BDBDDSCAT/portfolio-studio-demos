import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { link, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { wavelengthScan, angleScan } from "../src/thinfilm.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = fileURLToPath(new URL("../bin/thinfilm.js", import.meta.url));
const run = (args) =>
  spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });

test("CLI protects hardlinked input stacks even when report replacement is forced", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thinfilm-hardlink-"));
  try {
    const source = join(directory, "input.json");
    const content = JSON.stringify({ incident: 1, substrate: 1.5, layers: [] });
    await writeFile(source, content);
    await link(source, join(directory, "curve.csv"));
    const result = run(["spectrum", "--stack", source, "--out", directory, "--force"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /overwrite the input/);
    assert.equal(await readFile(source, "utf8"), content);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("CLI exports raw CSV matching API, reproducible JSON, and refuses accidental overwrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thinfilm-cli-"));
  try {
    const args = [
      "spectrum",
      "--stack",
      "examples/ar.json",
      "--start",
      "430",
      "--stop",
      "700",
      "--points",
      "17",
      "--angle",
      "25",
      "--polarization",
      "p",
      "--out",
      directory,
    ];
    assert.equal(run(args).status, 0);
    const stack = JSON.parse(
      await readFile(join(directory, "stack.json"), "utf8"),
    );
    const api = wavelengthScan(stack, {
      startNm: 430,
      stopNm: 700,
      points: 17,
      angleDeg: 25,
      polarization: "p",
    });
    const csv = await readFile(join(directory, "curve.csv"), "utf8");
    const rows = csv
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => line.split(",").map(Number));
    for (let i = 0; i < rows.length; i += 1) {
      assert.equal(rows[i][0], api.rows[i].wavelengthNm);
      assert.equal(rows[i][2], api.rows[i].R);
      assert.equal(rows[i][3], api.rows[i].T);
      assert.equal(rows[i][4], api.rows[i].A);
      assert.ok(Math.abs(rows[i][2] + rows[i][3] + rows[i][4] - 1) < 1e-12);
    }
    const json = JSON.parse(
      await readFile(join(directory, "result.json"), "utf8"),
    );
    assert.equal(json.schema, "thinfilm.result.v1");
    assert.deepEqual(json.config, {
      startNm: 430,
      stopNm: 700,
      points: 17,
      angleDeg: 25,
      polarization: "p",
    });
    assert.deepEqual(json.reference, api.rows[0]);
    assert.deepEqual(json.scan, api);
    const rejected = run(args);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /Refusing to overwrite/);
    assert.equal(await readFile(join(directory, "curve.csv"), "utf8"), csv);
    assert.equal(run([...args, "--force"]).status, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("angle CLI and stdout CSV agree with API including unpolarized powers", async () => {
  const stack = JSON.parse(
    await readFile(join(root, "examples/interface.json"), "utf8"),
  );
  const args = [
    "angle",
    "--stack",
    "examples/interface.json",
    "--wavelength",
    "532",
    "--start",
    "0",
    "--stop",
    "80",
    "--points",
    "9",
    "--polarization",
    "unpolarized",
  ];
  const result = run(args);
  assert.equal(result.status, 0, result.stderr);
  const api = angleScan(stack, {
    wavelengthNm: 532,
    startDeg: 0,
    stopDeg: 80,
    points: 9,
    polarization: "unpolarized",
  });
  const rows = result.stdout
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(","));
  for (let i = 0; i < rows.length; i += 1) {
    assert.equal(Number(rows[i][1]), api.rows[i].angleDeg);
    assert.equal(Number(rows[i][2]), api.rows[i].R);
    assert.equal(rows[i][5], "");
  }
});

test("even force never overwrites the input stack or writes partial output for a known overlap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thinfilm-overlap-"));
  try {
    const source = JSON.stringify({ incident: 1, substrate: 1.5, layers: [] });
    const stackPath = join(directory, "curve.csv");
    await writeFile(stackPath, source);
    const result = run([
      "spectrum",
      "--stack",
      stackPath,
      "--out",
      directory,
      "--force",
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /overwrite the input stack/);
    assert.equal(await readFile(stackPath, "utf8"), source);
    await assert.rejects(readFile(join(directory, "result.json")), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI help/version work; unknown, duplicate, malformed and illegal flags fail", () => {
  assert.match(
    execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" }),
    /Thinfilm 1.0.0/,
  );
  assert.equal(
    execFileSync(process.execPath, [cli, "--version"], {
      encoding: "utf8",
    }).trim(),
    "1.0.0",
  );
  for (const args of [
    ["unknown"],
    ["spectrum"],
    ["spectrum", "--stack", "examples/ar.json", "--typo", "1"],
    ["spectrum", "--stack", "examples/ar.json", "--points", "2.5"],
    ["spectrum", "--stack", "examples/ar.json", "--start", "-1"],
    ["spectrum", "--stack", "examples/ar.json", "--points", "4junk"],
    ["spectrum", "--stack", "examples/ar.json", "--polarization", "x"],
    ["spectrum", "--stack", "examples/ar.json", "--angle", "86"],
    ["angle", "--stack", "examples/ar.json", "--wavelength", "0"],
    ["angle", "--stack", "examples/ar.json", "--angle", "10"],
    [
      "spectrum",
      "--stack",
      "examples/ar.json",
      "--points",
      "4",
      "--points",
      "5",
    ],
    ["spectrum", "--stack", "examples/ar.json", "--points=5"],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, /^thinfilm:/);
  }
});
