import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  solveStack,
  wavelengthScan,
  angleScan,
  validateStack,
  scanToCsv,
} from "../src/thinfilm.js";

function close(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected} within ${tolerance}`,
  );
}
const interfaceStack = { incident: 1, substrate: 1.5, layers: [] };

test("single-interface complex coefficients and flux match independent Fresnel formulas", () => {
  for (const angleDeg of [0, 20, 55, 80]) {
    const theta = (angleDeg * Math.PI) / 180;
    const cosIncident = Math.cos(theta);
    const cosExit = Math.sqrt(1 - (Math.sin(theta) / 1.5) ** 2);
    const expectedS =
      (cosIncident - 1.5 * cosExit) / (cosIncident + 1.5 * cosExit);
    const expectedP =
      (1.5 * cosIncident - cosExit) / (1.5 * cosIncident + cosExit);
    const ts = (2 * cosIncident) / (cosIncident + 1.5 * cosExit);
    const tp = (2 * cosIncident) / (1.5 * cosIncident + cosExit);
    for (const [polarization, r, t] of [
      ["s", expectedS, ts],
      ["p", expectedP, tp],
    ]) {
      const result = solveStack(interfaceStack, { angleDeg, polarization });
      close(result.r.re, r);
      close(result.r.im, 0);
      close(result.t.re, t);
      close(result.R, r ** 2);
      close(result.T, ((1.5 * cosExit) / cosIncident) * t ** 2);
      close(result.R + result.T, 1);
      close(result.A, 0);
    }
  }
});

test("Brewster angle suppresses p reflection, while total internal reflection has unit modulus", () => {
  const brewster = (Math.atan(1.5) * 180) / Math.PI;
  const p = solveStack(interfaceStack, {
    angleDeg: brewster,
    polarization: "p",
  });
  assert.ok(p.R < 1e-28);
  const highToLow = { incident: 1.5, substrate: 1, layers: [] };
  for (const polarization of ["s", "p"]) {
    const result = solveStack(highToLow, { angleDeg: 60, polarization });
    close(result.R, 1);
    close(result.T, 0);
    close(result.A, 0);
    assert.ok(Math.abs(result.r.im) > 0.1);
    assert.ok(
      [result.r.re, result.r.im, result.t.re, result.t.im].every(
        Number.isFinite,
      ),
    );
  }
});

test("critical substrate limit is finite; a finite q=0 internal layer is explicitly rejected", () => {
  const angleDeg = (Math.asin(1 / 1.5) * 180) / Math.PI;
  for (const polarization of ["s", "p"]) {
    const result = solveStack(
      { incident: 1.5, substrate: 1, layers: [] },
      { angleDeg, polarization },
    );
    close(result.R, 1);
    close(result.T, 0);
    assert.ok(
      result.diagnostics.some(({ code }) => code === "critical-substrate"),
    );
    assert.throws(
      () =>
        solveStack(
          { incident: 1.5, substrate: 2, layers: [{ n: 1, k: 0, dNm: 100 }] },
          { angleDeg, polarization },
        ),
      /q≈0/,
    );
    const absent = solveStack(
      { incident: 1.5, substrate: 2, layers: [{ n: 1, k: 0, dNm: 0 }] },
      { angleDeg, polarization },
    );
    close(absent.R + absent.T, 1);
  }
});

test("lossless multilayers conserve flux across wavelength and incidence angle", () => {
  const stack = {
    incident: 1.3,
    substrate: 1.8,
    layers: [
      { n: 2.2, k: 0, dNm: 87 },
      { n: 1.4, k: 0, dNm: 141 },
      { n: 1.9, k: 0, dNm: 203 },
    ],
  };
  for (const polarization of ["s", "p", "unpolarized"]) {
    for (const angleDeg of [0, 35, 72, 85]) {
      for (const wavelengthNm of [350, 532, 901]) {
        const result = solveStack(stack, {
          angleDeg,
          wavelengthNm,
          polarization,
        });
        close(result.R + result.T, 1, 2e-12);
        close(result.A, 0, 2e-12);
      }
    }
  }
});

test("a matched quarter-wave AR film has zero design reflectance and analytic off-design reflectance", () => {
  const n0 = 1;
  const ns = 1.5;
  const n1 = Math.sqrt(n0 * ns);
  const d = 550 / (4 * n1);
  const stack = {
    incident: n0,
    substrate: ns,
    layers: [{ n: n1, k: 0, dNm: d }],
  };
  for (const polarization of ["s", "p"]) {
    const design = solveStack(stack, { wavelengthNm: 550, polarization });
    assert.ok(design.R < 1e-28);
    close(design.T, 1);
    const wavelengthNm = 430;
    const a = (n0 - n1) / (n0 + n1);
    const b = (n1 - ns) / (n1 + ns);
    const cosine = Math.cos((4 * Math.PI * n1 * d) / wavelengthNm);
    const expectedR =
      (a ** 2 + b ** 2 + 2 * a * b * cosine) /
      (1 + (a * b) ** 2 + 2 * a * b * cosine);
    close(solveStack(stack, { wavelengthNm, polarization }).R, expectedR);
  }
});

test("quarter-wave Bragg peak matches its closed-form effective admittance", () => {
  const incident = 1;
  const substrate = 1.5;
  const high = 2.1;
  const low = 1.45;
  for (const pairs of [1, 3, 8, 32]) {
    const layers = Array.from({ length: pairs }, () => [
      { n: high, k: 0, dNm: 550 / (4 * high) },
      { n: low, k: 0, dNm: 550 / (4 * low) },
    ]).flat();
    const effective = substrate * (high / low) ** (2 * pairs);
    const expectedR = ((incident - effective) / (incident + effective)) ** 2;
    for (const polarization of ["s", "p"])
      close(
        solveStack({ incident, substrate, layers }, { polarization }).R,
        expectedR,
        2e-12,
      );
  }
});

test("thick passive absorbing layers remain finite and approach a semi-infinite interface", () => {
  const stack = {
    incident: 1,
    substrate: 1.5,
    layers: [{ n: 2, k: 0.5, dNm: 1e9 }],
  };
  const expectedR = ((1 - 2) ** 2 + 0.5 ** 2) / ((1 + 2) ** 2 + 0.5 ** 2);
  for (const polarization of ["s", "p"]) {
    const result = solveStack(stack, { polarization });
    close(result.R, expectedR);
    close(result.T, 0);
    close(result.A, 1 - expectedR);
    assert.ok(
      [
        result.R,
        result.T,
        result.A,
        result.r.re,
        result.r.im,
        result.t.re,
        result.t.im,
      ].every(Number.isFinite),
    );
  }
  const many = {
    incident: 1,
    substrate: 1,
    layers: Array.from({ length: 128 }, (_, i) => ({
      n: 1.5 + (i % 3),
      k: 20,
      dNm: 1e8,
    })),
  };
  const result = solveStack(many, {
    angleDeg: 80,
    polarization: "unpolarized",
  });
  close(result.R + result.T + result.A, 1);
  assert.ok([result.R, result.T, result.A].every(Number.isFinite));
});

test("weak absorption is retained when the optical thickness makes it significant", () => {
  const k = 1e-9;
  const wavelengthNm = 550;
  const stack = {
    incident: 1.5,
    substrate: 1.5,
    layers: [{ n: 1.5, k, dNm: wavelengthNm / (4 * Math.PI * k) }],
  };
  close(solveStack(stack, { wavelengthNm }).T, Math.exp(-1), 1e-10);
});

test("unpolarized light averages powers and does not invent a coherent mean amplitude", () => {
  const s = solveStack(interfaceStack, { angleDeg: 45, polarization: "s" });
  const p = solveStack(interfaceStack, { angleDeg: 45, polarization: "p" });
  const result = solveStack(interfaceStack, {
    angleDeg: 45,
    polarization: "unpolarized",
  });
  close(result.R, (s.R + p.R) / 2);
  close(result.T, (s.T + p.T) / 2);
  assert.equal(result.r, null);
  assert.equal(result.t, null);
  assert.deepEqual(result.components, { s, p });
});

test("scan endpoints, single point, CSV and examples are reproducible", async () => {
  const scan = wavelengthScan(interfaceStack, {
    startNm: 401,
    stopNm: 799,
    points: 7,
  });
  assert.equal(scan.rows[0].wavelengthNm, 401);
  assert.equal(scan.rows.at(-1).wavelengthNm, 799);
  assert.equal(
    wavelengthScan(interfaceStack, { startNm: 440, stopNm: 800, points: 1 })
      .rows[0].wavelengthNm,
    440,
  );
  const angular = angleScan(interfaceStack, {
    startDeg: 5,
    stopDeg: 75,
    points: 9,
  });
  assert.equal(angular.rows.at(-1).angleDeg, 75);
  assert.ok(
    scanToCsv(scan).startsWith(
      "wavelength_nm,angle_deg,R,T,A,r_re,r_im,t_re,t_im\n",
    ),
  );
  for (const name of ["interface", "ar", "bragg", "absorber"]) {
    const stack = JSON.parse(
      await readFile(new URL(`../examples/${name}.json`, import.meta.url)),
    );
    const result = wavelengthScan(stack, {
      points: 31,
      polarization: "unpolarized",
    });
    for (const row of result.rows) close(row.R + row.T + row.A, 1, 2e-12);
  }
});

test("large finite wavelength intervals keep every scan coordinate finite and in range", () => {
  for (const points of [5, 2001]) {
    const scan = wavelengthScan(interfaceStack, { startNm: 8e307, stopNm: 1.6e308, points });
    assert.equal(scan.rows[0].wavelengthNm, 8e307);
    assert.equal(scan.rows.at(-1).wavelengthNm, 1.6e308);
    scan.rows.forEach((row, i) => {
      assert.ok(Number.isFinite(row.wavelengthNm));
      assert.ok(row.wavelengthNm >= 8e307 && row.wavelengthNm <= 1.6e308);
      close(row.wavelengthNm / 1e308, 0.8 + 0.8 * i / (points - 1), 1e-15);
      close(row.R, 0.04);
      close(row.T, 0.96);
      if (i) assert.ok(row.wavelengthNm > scan.rows[i - 1].wavelengthNm);
    });
  }
  assert.equal(wavelengthScan(interfaceStack, { startNm: 8e307, stopNm: 1.6e308, points: 1 }).rows[0].wavelengthNm, 8e307);
});

test("strict validation rejects unknown fields, invalid domains and unsupported sizes without mutating input", () => {
  const copy = structuredClone(interfaceStack);
  solveStack(interfaceStack);
  assert.deepEqual(interfaceStack, copy);
  for (const stack of [
    null,
    {},
    { ...interfaceStack, incidental: 1 },
    { ...interfaceStack, incident: -1 },
    { ...interfaceStack, substrate: Infinity },
    { ...interfaceStack, layers: new Array(1) },
    { ...interfaceStack, layers: Array(129).fill({ n: 2, k: 0, dNm: 10 }) },
    ...[
      { n: 0, k: 0, dNm: 10 },
      { n: 2, k: -0.1, dNm: 10 },
      { n: 2, k: 0, dNm: NaN },
      { n: 2, k: 0, dNm: -10 },
      { n: 2, k: 0, dNm: 10, thickness: 10 },
    ].map((layer) => ({ ...interfaceStack, layers: [layer] })),
  ])
    assert.throws(() => validateStack(stack));
  for (const options of [
    { angleDeg: -1 },
    { angleDeg: 85.1 },
    { wavelengthNm: 0 },
    { wavelengthNm: Infinity },
    { polarization: "q" },
    { lambda: 550 },
  ])
    assert.throws(() => solveStack(interfaceStack, options));
  for (const options of [
    { points: 0 },
    { points: 2002 },
    { points: 2.5 },
    { stopNm: 300 },
    { startNm: NaN },
    { start: 400 },
  ])
    assert.throws(() => wavelengthScan(interfaceStack, options));
  for (const options of [
    { startDeg: -1 },
    { stopDeg: 86 },
    { startDeg: 75, stopDeg: 50 },
    { wavelengthNm: 0 },
    { points: 2002 },
  ])
    assert.throws(() => angleScan(interfaceStack, options));
});
