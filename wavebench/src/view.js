const $ = (id) => document.getElementById(id);
const PALETTE = [
  [8, 11, 16],
  [23, 46, 96],
  [44, 128, 148],
  [89, 196, 176],
  [238, 242, 175],
];
function color(value) {
  const v = Math.max(0, Math.min(1, value)) * 4,
    i = Math.min(3, Math.floor(v)),
    t = v - i;
  return PALETTE[i].map((c, k) => c * (1 - t) + PALETTE[i + 1][k] * t);
}
function phaseColor(phase) {
  const h = ((phase / (2 * Math.PI) + 1.5) % 1) * 6,
    x = 1 - Math.abs((h % 2) - 1),
    rgb =
      h < 1
        ? [1, x, 0]
        : h < 2
          ? [x, 1, 0]
          : h < 3
            ? [0, 1, x]
            : h < 4
              ? [0, x, 1]
              : h < 5
                ? [x, 0, 1]
                : [1, 0, x];
  return rgb.map((v) => 70 + 150 * v);
}
function tone(value, mode) {
  return mode === 'log' ? Math.max(0, 1 + Math.log10(Math.max(value, 1e-8)) / 8) : value;
}
export function effectiveSpan(result, view) {
  return Math.min(view.spanMm, (result.n - 2) * result.outputPitchMm);
}
function sample(array, n, x, y) {
  if (x < 0 || y < 0 || x >= n - 1 || y >= n - 1) return 0;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    dx = x - ix,
    dy = y - iy,
    i = iy * n + ix;
  return (
    (array[i] * (1 - dx) + array[i + 1] * dx) * (1 - dy) +
    (array[i + n] * (1 - dx) + array[i + n + 1] * dx) * dy
  );
}
function renderImage(canvas, n, span, pitch, pixel) {
  const context = canvas.getContext('2d'),
    size = canvas.width,
    image = context.createImageData(size, size),
    scale = span / size / pitch;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const rgb = pixel((x - size / 2) * scale + n / 2, (y - size / 2) * scale + n / 2),
        i = (y * size + x) * 4;
      image.data[i] = rgb[0];
      image.data[i + 1] = rgb[1];
      image.data[i + 2] = rgb[2];
      image.data[i + 3] = 255;
    }
  context.putImageData(image, 0, 0);
}
export function renderFields(result, params, view) {
  const n = result.n,
    span = effectiveSpan(result, view),
    inputSpan =
      params.preset === 'custom' ? 8 : Math.min(view.spanMm, (n - 2) * result.inputPitchMm);
  renderImage($('aperture'), n, inputSpan, result.inputPitchMm, (x, y) => {
    const value = sample(result.inputAmplitude, n, x, y);
    return [8 + 194 * value, 11 + 213 * value, 16 + 223 * value];
  });
  renderImage($('diffraction'), n, span, result.outputPitchMm, (x, y) =>
    color(tone(sample(result.normalizedIntensity, n, x, y), view.mode)),
  );
  renderImage($('phase'), n, span, result.outputPitchMm, (x, y) => {
    if (sample(result.normalizedIntensity, n, x, y) < 1e-8) return [8, 11, 16];
    return phaseColor(Math.atan2(sample(result.imag, n, x, y), sample(result.real, n, x, y)));
  });
  $('input-scale').textContent = `${inputSpan.toFixed(2)} × ${inputSpan.toFixed(2)} mm`;
  $('output-scale').textContent = `${span.toFixed(2)} × ${span.toFixed(2)} mm`;
  $('phase-scale').textContent = '|U|² / peak ≥ 10⁻⁸';
  $('legend-left').textContent = view.mode === 'log' ? '10⁻⁸' : '0';
}
export function renderMask(mask, n, cursor = null, radius = 0) {
  const canvas = $('aperture'),
    context = canvas.getContext('2d'),
    size = canvas.width,
    image = context.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const a =
          mask[
            Math.min(n - 1, Math.floor((y / size) * n)) * n +
              Math.min(n - 1, Math.floor((x / size) * n))
          ],
        i = (y * size + x) * 4;
      image.data[i] = 8 + 194 * a;
      image.data[i + 1] = 11 + 213 * a;
      image.data[i + 2] = 16 + 223 * a;
      image.data[i + 3] = 255;
    }
  context.putImageData(image, 0, 0);
  $('input-scale').textContent = '8.00 × 8.00 mm';
  if (cursor) {
    context.strokeStyle = '#efbc65';
    context.beginPath();
    context.arc((cursor.x / n) * size, (cursor.y / n) * size, (radius / n) * size, 0, 2 * Math.PI);
    context.stroke();
  }
}
export function renderProfile(result, view) {
  const canvas = $('profile'),
    context = canvas.getContext('2d'),
    w = canvas.width,
    h = canvas.height,
    span = effectiveSpan(result, view);
  let peak = 0;
  for (let i = 0; i < result.n; i++)
    peak = Math.max(peak, result.intensity[(result.n / 2) * result.n + i]);
  const top = 17,
    bottom = h - 20;
  context.clearRect(0, 0, w, h);
  context.strokeStyle = '#2b3745';
  context.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const y = top + ((bottom - top) * k) / 4;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(w, y);
    context.stroke();
  }
  context.strokeStyle = '#77b6fb';
  context.lineWidth = 2;
  context.beginPath();
  for (let x = 0; x <= w; x++) {
    const value = sample(
        result.intensity,
        result.n,
        ((x / w - 0.5) * span) / result.outputPitchMm + result.n / 2,
        result.n / 2,
      ),
      y = bottom - (peak > 0 ? value / peak : 0) * (bottom - top);
    x === 0 ? context.moveTo(x, y) : context.lineTo(x, y);
  }
  context.stroke();
  context.fillStyle = '#91a0b3';
  context.font = '12px monospace';
  context.fillText(peak.toExponential(3), 3, top - 3);
  context.fillText('0', 3, h - 3);
  $('chart-left').textContent = `−${(span / 2).toFixed(3)}`;
  $('chart-right').textContent = `+${(span / 2).toFixed(3)}`;
}
export function renderMetrics(result, params, radiusHelp = 'w = √(2〈r²〉), centroid removed') {
  $('power-in').textContent = result.inputPower.toExponential(5);
  $('power-out').textContent = result.outputPower.toExponential(5);
  const delta = result.inputPower > 0 ? result.outputPower / result.inputPower - 1 : 0;
  $('power-delta').textContent = `ΔP/P = ${delta.toExponential(2)}`;
  $('output-pitch').textContent = `${(result.outputPitchMm * 1000).toFixed(3)} µm`;
  $('output-span').textContent = `${result.outputSpanMm.toFixed(3)} mm / ${result.n} samples`;
  let sum = 0,
    cx = 0,
    cy = 0;
  for (let y = 0; y < result.n; y++)
    for (let x = 0; x < result.n; x++) {
      const v = result.intensity[y * result.n + x];
      sum += v;
      cx += x * v;
      cy += y * v;
    }
  cx = sum ? cx / sum : 0;
  cy = sum ? cy / sum : 0;
  let moment = 0;
  for (let y = 0; y < result.n; y++)
    for (let x = 0; x < result.n; x++)
      moment += ((x - cx) ** 2 + (y - cy) ** 2) * result.intensity[y * result.n + x];
  $('beam-radius').textContent =
    `${(sum ? Math.sqrt((2 * moment) / sum) * result.outputPitchMm : 0).toFixed(4)} mm`;
  $('beam-radius').nextElementSibling.textContent = radiusHelp;
  if (params.preset === 'gaussian') {
    const w = params.beamWaistMm,
      lambda = params.wavelengthNm / 1e6,
      theory =
        params.method === 'fraunhofer'
          ? (lambda * params.focalLengthMm) / (Math.PI * w)
          : w * Math.hypot(1, (lambda * params.distanceMm) / (Math.PI * w * w));
    $('beam-radius').nextElementSibling.textContent = `paraxial w(th) = ${theory.toFixed(4)} mm`;
  }
}
export function renderDiagnostics(result, allClear) {
  const container = $('diagnostics');
  container.replaceChildren();
  if (!result.diagnostics.length) {
    const row = document.createElement('div');
    row.className = 'diagnostic ok';
    row.textContent = allClear;
    container.append(row);
  }
  for (const d of result.diagnostics) {
    const row = document.createElement('div');
    row.className = `diagnostic ${d.level === 'info' ? 'info' : ''}`;
    const code = document.createElement('code');
    code.textContent = d.code;
    row.append(code, document.createTextNode(d.message));
    container.append(row);
  }
}
export function renderScan(scan, view) {
  const canvas = $('scan'),
    context = canvas.getContext('2d'),
    w = canvas.width,
    h = canvas.height,
    image = context.createImageData(w, h),
    span = Math.min(view.spanMm, (scan.n - 2) * scan.pitchMm);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const row = Math.min(scan.steps - 1, Math.floor((y / h) * scan.steps)),
        f = ((x / w - 0.5) * span) / scan.pitchMm + scan.n / 2,
        i = Math.floor(f),
        frac = f - i,
        value =
          i >= 0 && i < scan.n - 1
            ? scan.raw[row * scan.n + i] * (1 - frac) + scan.raw[row * scan.n + i + 1] * frac
            : 0,
        rgb = color(tone(scan.peak ? value / scan.peak : 0, view.mode)),
        offset = (y * w + x) * 4;
      image.data[offset] = rgb[0];
      image.data[offset + 1] = rgb[1];
      image.data[offset + 2] = rgb[2];
      image.data[offset + 3] = 255;
    }
  context.putImageData(image, 0, 0);
  context.font = '12px monospace';
  context.fillStyle = '#dbe5f0';
  context.fillText(`z = ${scan.distances[0].toFixed(1)} mm`, 10, 19);
  context.fillText(`z = ${scan.distances[scan.steps - 1].toFixed(1)} mm`, 10, h - 9);
  $('scan-left').textContent = `−${(span / 2).toFixed(3)}`;
  $('scan-right').textContent = `+${(span / 2).toFixed(3)}`;
}
