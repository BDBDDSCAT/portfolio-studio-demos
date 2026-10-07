/**
 * Passive, isotropic, constant-index thin-film optics, exp(-i omega t).
 * Layer index is n + i k, so exp(i 2 pi q d / lambda) attenuates for k >= 0.
 * A scattering recursion uses only decaying propagation factors, avoiding the
 * exponentially growing entries of an absorbing-layer characteristic matrix.
 * All distances (wavelength and layer thickness) are in nanometres.
 */

const POLARIZATIONS = new Set(["s", "p", "unpolarized"]);
const ROUND_OFF = 1e-10;
const C = (re, im = 0) => ({ re, im });
const add = (a, b) => C(a.re + b.re, a.im + b.im);
const sub = (a, b) => C(a.re - b.re, a.im - b.im);
const mul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const scale = (a, x) => C(a.re * x, a.im * x);
const norm = (a) => a.re * a.re + a.im * a.im;

function divide(a, b) {
  const magnitude = Math.max(Math.abs(b.re), Math.abs(b.im));
  if (!(magnitude > 0) || !Number.isFinite(magnitude)) {
    throw new RangeError(
      "Degenerate interface or nonrepresentable scattering denominator.",
    );
  }
  const br = b.re / magnitude;
  const bi = b.im / magnitude;
  const denominator = br * br + bi * bi;
  const ar = a.re / magnitude;
  const ai = a.im / magnitude;
  const result = C(
    (ar * br + ai * bi) / denominator,
    (ai * br - ar * bi) / denominator,
  );
  if (!Number.isFinite(result.re) || !Number.isFinite(result.im)) {
    throw new RangeError(
      "Scattering coefficients exceed the representable numerical range.",
    );
  }
  return result;
}

function object(value, name, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${name} must be an object.`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key))
      throw new RangeError(`Unknown ${name} field: ${key}`);
  }
}

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`${name} must be finite and positive.`);
}

function angle(value, name = "Angle") {
  if (!Number.isFinite(value) || value < 0 || value > 85)
    throw new RangeError(`${name} must be between 0 and 85 degrees.`);
}

function polarization(value) {
  if (!POLARIZATIONS.has(value))
    throw new RangeError("Polarization must be s, p, or unpolarized.");
}

/** Validate and copy a stack, rejecting unknown keys rather than ignoring typos. */
export function validateStack(stack) {
  object(stack, "stack", ["incident", "substrate", "layers"]);
  positive(stack.incident, "Incident refractive index");
  positive(stack.substrate, "Substrate refractive index");
  if (!Array.isArray(stack.layers) || stack.layers.length > 128)
    throw new RangeError("Layers must be an array with at most 128 entries.");
  const layers = Array.from(stack.layers, (layer, i) => {
    object(layer, `layer ${i + 1}`, ["n", "k", "dNm"]);
    positive(layer.n, `Layer ${i + 1} n`);
    if (!Number.isFinite(layer.k) || layer.k < 0)
      throw new RangeError(`Layer ${i + 1} k must be finite and nonnegative.`);
    if (!Number.isFinite(layer.dNm) || layer.dNm < 0)
      throw new RangeError(
        `Layer ${i + 1} thickness must be finite and nonnegative.`,
      );
    return { n: layer.n, k: layer.k, dNm: layer.dNm };
  });
  return { incident: stack.incident, substrate: stack.substrate, layers };
}

function longitudinal(n, k, tangential) {
  const re = n * n - k * k - tangential * tangential;
  const im = 2 * n * k;
  if (!Number.isFinite(re) || !Number.isFinite(im))
    throw new RangeError(
      "Refractive indices exceed the representable numerical range.",
    );
  if (im === 0) {
    if (
      Math.abs(re) <=
      32 * Number.EPSILON * Math.max(n * n, tangential * tangential)
    )
      return C(0);
    return re >= 0 ? C(Math.sqrt(re)) : C(0, Math.sqrt(-re));
  }
  const length = Math.hypot(re, im);
  // Passive branch: Re(q) >= 0 and Im(q) >= 0.
  // Compute the smaller component by division to retain very weak absorption.
  if (re >= 0) {
    const qr = Math.sqrt(length / 2 + re / 2);
    return C(qr, im / (2 * qr));
  }
  const qi = Math.sqrt(length / 2 - re / 2);
  return C(im / (2 * qi), qi);
}

function interfaceCoefficients(a, b, pol) {
  if (pol === "s") {
    const denominator = add(a.q, b.q);
    return {
      r: divide(sub(a.q, b.q), denominator),
      t: divide(scale(a.q, 2), denominator),
    };
  }
  // Conventional p amplitudes use the local electric polarization vectors;
  // at normal incidence r_p = -r_s. Cross products avoid dividing by q=0.
  const first = mul(b.nSquared, a.q);
  const second = mul(a.nSquared, b.q);
  const denominator = add(first, second);
  return {
    r: divide(sub(first, second), denominator),
    t: divide(scale(mul(mul(a.index, b.index), a.q), 2), denominator),
  };
}

function prepare(stack, angleDeg) {
  const tangential = stack.incident * Math.sin((angleDeg * Math.PI) / 180);
  // A zero-thickness layer is physically absent, including at a critical angle.
  const layers = stack.layers.filter(({ dNm }) => dNm > 0);
  const descriptions = [
    { n: stack.incident, k: 0 },
    ...layers,
    { n: stack.substrate, k: 0 },
  ];
  const media = descriptions.map(({ n, k }, i) => {
    const index = C(n, k);
    const q = longitudinal(n, k, tangential);
    const threshold = 1e-12 * Math.max(n, k, Math.abs(tangential));
    if (
      i > 0 &&
      i < descriptions.length - 1 &&
      Math.hypot(q.re, q.im) <= threshold
    ) {
      throw new RangeError(
        `Layer ${i} has q≈0 at the exact critical angle. The traveling-wave decomposition is degenerate; move the angle slightly away from this value.`,
      );
    }
    if (i === descriptions.length - 1 && Math.hypot(q.re, q.im) <= threshold) {
      q.re = 0;
      q.im = 0;
    }
    return { index, nSquared: mul(index, index), q };
  });
  const interfaces = { s: [], p: [] };
  for (const pol of ["s", "p"]) {
    for (let i = 0; i < media.length - 1; i += 1)
      interfaces[pol].push(interfaceCoefficients(media[i], media[i + 1], pol));
  }
  return { media, layers, interfaces };
}

function propagation(q, thickness, wavelengthNm) {
  const attenuationExponent = 2 * Math.PI * q.im * (thickness / wavelengthNm);
  if (attenuationExponent === Infinity || attenuationExponent > 745)
    return C(0);
  const phase = 2 * Math.PI * q.re * (thickness / wavelengthNm);
  if (!Number.isFinite(phase) || !Number.isFinite(attenuationExponent))
    throw new RangeError(
      "Layer phase exceeds the representable numerical range.",
    );
  const amplitude = Math.exp(-attenuationExponent);
  return C(amplitude * Math.cos(phase), amplitude * Math.sin(phase));
}

function solvePolarized(prepared, wavelengthNm, angleDeg, pol) {
  const { media, layers, interfaces } = prepared;
  const boundaries = interfaces[pol];
  let { r, t } = boundaries[boundaries.length - 1];
  for (let j = layers.length - 1; j >= 0; j -= 1) {
    const factor = propagation(media[j + 1].q, layers[j].dNm, wavelengthNm);
    const roundTrip = mul(factor, factor);
    const reflected = mul(r, roundTrip);
    const denominator = add(C(1), mul(boundaries[j].r, reflected));
    r = divide(add(boundaries[j].r, reflected), denominator);
    t = divide(mul(mul(boundaries[j].t, t), factor), denominator);
  }
  const incidentQ = media[0].q.re;
  const exitQ = media[media.length - 1].q;
  let R = norm(r);
  let T = exitQ.re === 0 ? 0 : (exitQ.re / incidentQ) * norm(t);
  let A = 1 - R - T;
  if (![R, T, A].every(Number.isFinite))
    throw new RangeError("Power coefficients are not representable.");
  if (
    R < -ROUND_OFF ||
    T < -ROUND_OFF ||
    A < -ROUND_OFF ||
    R > 1 + ROUND_OFF ||
    T > 1 + ROUND_OFF
  ) {
    throw new RangeError(
      "Passive-stack power balance failed beyond numerical roundoff.",
    );
  }
  R = Math.max(0, Math.min(1, R));
  T = Math.max(0, Math.min(1, T));
  A = Math.max(0, Math.min(1, 1 - R - T));
  const diagnostics = [];
  if (exitQ.re === 0 && exitQ.im === 0)
    diagnostics.push({
      code: "critical-substrate",
      level: "info",
      message:
        "The substrate longitudinal wavevector is zero. Coefficients use the critical-angle limit and transmitted normal flux is zero.",
    });
  return {
    wavelengthNm,
    angleDeg,
    polarization: pol,
    r: C(r.re, r.im),
    t: C(t.re, t.im),
    R,
    T,
    A,
    diagnostics,
  };
}

function solvePrepared(prepared, wavelengthNm, angleDeg, pol) {
  if (pol !== "unpolarized")
    return solvePolarized(prepared, wavelengthNm, angleDeg, pol);
  const s = solvePolarized(prepared, wavelengthNm, angleDeg, "s");
  const p = solvePolarized(prepared, wavelengthNm, angleDeg, "p");
  return {
    wavelengthNm,
    angleDeg,
    polarization: pol,
    r: null,
    t: null,
    R: (s.R + p.R) / 2,
    T: (s.T + p.T) / 2,
    A: (s.A + p.A) / 2,
    components: { s, p },
    diagnostics: s.diagnostics,
  };
}

/** Complex electric-field r/t and normal-flux R/T/A for one wavelength/angle. */
export function solveStack(stack, options = {}) {
  object(options, "solve option", ["wavelengthNm", "angleDeg", "polarization"]);
  const { wavelengthNm = 550, angleDeg = 0, polarization: pol = "s" } = options;
  positive(wavelengthNm, "Wavelength");
  angle(angleDeg);
  polarization(pol);
  const valid = validateStack(stack);
  return solvePrepared(prepare(valid, angleDeg), wavelengthNm, angleDeg, pol);
}

function scanPoints(points) {
  if (!Number.isInteger(points) || points < 1 || points > 2001)
    throw new RangeError("Scan points must be an integer between 1 and 2001.");
}

function coordinate(start, stop, i, points) {
  if (points === 1) return start;
  // Exact endpoints, even when the range does not divide evenly.
  if (i === points - 1) return stop;
  const range = stop - start;
  const offset = range * i;
  return start + (Number.isFinite(offset) ? offset / (points - 1) : range * (i / (points - 1)));
}

/** Inclusive wavelength scan. One point samples startNm. */
export function wavelengthScan(stack, options = {}) {
  object(options, "wavelength scan option", [
    "startNm",
    "stopNm",
    "points",
    "angleDeg",
    "polarization",
  ]);
  const {
    startNm = 400,
    stopNm = 800,
    points = 201,
    angleDeg = 0,
    polarization: pol = "s",
  } = options;
  positive(startNm, "Start wavelength");
  positive(stopNm, "Stop wavelength");
  if (stopNm < startNm)
    throw new RangeError("Stop wavelength must not be below start wavelength.");
  scanPoints(points);
  angle(angleDeg);
  polarization(pol);
  const prepared = prepare(validateStack(stack), angleDeg);
  const rows = Array.from({ length: points }, (_, i) =>
    solvePrepared(
      prepared,
      coordinate(startNm, stopNm, i, points),
      angleDeg,
      pol,
    ),
  );
  return {
    kind: "wavelength",
    polarization: pol,
    rows,
    diagnostics: rows[0].diagnostics,
  };
}

/** Inclusive incidence-angle scan, in degrees. One point samples startDeg. */
export function angleScan(stack, options = {}) {
  object(options, "angle scan option", [
    "wavelengthNm",
    "startDeg",
    "stopDeg",
    "points",
    "polarization",
  ]);
  const {
    wavelengthNm = 550,
    startDeg = 0,
    stopDeg = 85,
    points = 201,
    polarization: pol = "s",
  } = options;
  positive(wavelengthNm, "Wavelength");
  angle(startDeg, "Start angle");
  angle(stopDeg, "Stop angle");
  if (stopDeg < startDeg)
    throw new RangeError("Stop angle must not be below start angle.");
  scanPoints(points);
  polarization(pol);
  const valid = validateStack(stack);
  const rows = Array.from({ length: points }, (_, i) => {
    const angleDeg = coordinate(startDeg, stopDeg, i, points);
    return solvePrepared(prepare(valid, angleDeg), wavelengthNm, angleDeg, pol);
  });
  const diagnostics = rows
    .flatMap(({ diagnostics: items }) => items)
    .filter(
      (item, i, items) =>
        items.findIndex(({ code }) => code === item.code) === i,
    );
  return { kind: "angle", polarization: pol, rows, diagnostics };
}

/** Raw CSV; unpolarized scans have no coherent mean r/t, so those cells are empty. */
export function scanToCsv(scan) {
  if (!scan || !Array.isArray(scan.rows))
    throw new TypeError("A scan with rows is required.");
  const header = "wavelength_nm,angle_deg,R,T,A,r_re,r_im,t_re,t_im";
  const lines = scan.rows.map((row) =>
    [
      row.wavelengthNm,
      row.angleDeg,
      row.R,
      row.T,
      row.A,
      row.r?.re ?? "",
      row.r?.im ?? "",
      row.t?.re ?? "",
      row.t?.im ?? "",
    ].join(","),
  );
  return `${header}\n${lines.join("\n")}\n`;
}
