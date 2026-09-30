import {
  DEFAULT_PARAMS,
  DEFAULT_VIEW,
  normalizeParams,
  encodeHash,
  decodeHash,
  serializeSession,
  deserializeSession,
} from './state.js';

const $ = (id) => document.getElementById(id);
const N = 512;
let params = { ...DEFAULT_PARAMS },
  view = { ...DEFAULT_VIEW },
  mask = null,
  result = null;
let language = 'en',
  requestId = 0,
  timer,
  lastPoint = null,
  drawing = false,
  erasing = false;
let cursor = { x: 256, y: 256 },
  keyboardDrawing = false;
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const exportButtons = ['exportPng', 'exportCsv', 'saveSession'];
const messages = {
  en: {
    eyebrow: 'A SMALL LAB FOR A CURIOUS MIND',
    headline: 'Let light show<br><em>its work.</em>',
    intro:
      'An aperture. A wave. A pattern.<br>Explore the quiet geometry of diffraction —<br>right here in your browser.',
    local: 'Runs locally · No install · Open source',
    bench: '01 / THE OPTICAL BENCH',
    experiment: 'Choose an experiment',
    double: 'Double slit',
    single: 'Single slit',
    grating: 'Grating',
    circle: 'Circular',
    annulus: 'Annular',
    vortex: 'Vortex',
    custom: 'Draw your own',
    geometry: 'Aperture geometry',
    width: 'Slit width',
    height: 'Slit height',
    separation: 'Centre spacing',
    count: 'Number of slits',
    diameter: 'Outer diameter',
    inner: 'Inner diameter',
    charge: 'Vortex charge',
    drawHint: 'Draw on the aperture. Shift erases. Keyboard: arrows to move, Space to draw.',
    brush: 'Brush diameter',
    erase: 'Eraser',
    clear: 'Clear',
    light: 'Light & lens',
    wavelength: 'Wavelength',
    focal: 'Lens focal length',
    reset: '↺ Reset this experiment',
    aperture: 'The aperture',
    inputPlane: 'INPUT PLANE',
    pattern: 'The diffraction',
    log: 'Log contrast',
    linear: 'Linear intensity',
    focalPlane: 'BACK FOCAL PLANE',
    normalized: 'Relative intensity · peak = 1',
    view: 'View',
    drawOn: 'Draw light here ↗',
    sample: 'Aperture sampling',
    transmission: 'Transmitting area',
    unitIllumination: 'Unit incident amplitude',
    cutTitle: 'A slice through the centre',
    cutType: 'LINEAR INTENSITY / y = 0',
    position: 'Position in focal plane (mm)',
    png: 'Export experiment PNG',
    csv: 'Intensity CSV',
    share: 'Copy experiment link',
    session: 'Session',
    save: 'Save JSON',
    load: 'Load JSON',
    notesLabel: '02 / A NOTE FROM THE BENCH',
    notesTitle: 'Small openings.<br>Unexpected worlds.',
    physicsNote:
      'This is scalar, monochromatic Fraunhofer diffraction in a lens’s focal plane. Each pattern is normalized separately. The grid is finite; very small details are approximate.',
    physicsLink: 'Read the model & its limits ↗',
    footer: 'Made for the pleasure of figuring things out.',
    linkTitle: 'Your experiment link',
    linkHint: 'Select and copy the link to share this setup.',
    close: 'Close',
    ready: 'Experiment ready',
    busy: 'Computing…',
    copied: 'Experiment link copied.',
    customShare: 'Custom drawings travel in a JSON session. Use Session → Save JSON.',
    loaded: 'Session loaded.',
    saved: 'Session saved.',
    downloaded: 'Export downloaded.',
    amplitude: 'AMPLITUDE',
    phase: 'AMPLITUDE + PHASE',
    amplitudeCaption: 'Light passes through the opening; the rest is blocked.',
    phaseCaption: 'Hue shows phase winding; brightness shows amplitude.',
    customCaption: 'A hand-drawn amplitude mask. Black blocks the light.',
    fringes: 'Fringe spacing (theory)',
    firstZero: 'First minimum (theory)',
    airy: 'First dark ring (theory)',
    annularMeasure: 'Inner / outer diameter',
    vortexMeasure: 'Phase winding',
    customMeasure: 'Open grid cells',
    blank: 'The aperture is empty. Draw an opening to let light through.',
    failed: 'Could not compute this experiment.',
    fileTooLarge: 'Session file must be smaller than 2 MB.',
    badLink: 'This link could not be restored. Loaded the default experiment.',
    cropped: 'View limited to sampled field',
    notes: {
      double:
        'Two openings, one conversation. Light from each slit overlaps: some paths agree, others cancel. Increase the spacing and the fringes draw closer; change the width and the envelope changes.',
      single:
        'A narrow opening makes a wide pattern. The first dark fringes sit at ±λf/a. The slit’s finite height creates a second, vertical envelope.',
      grating:
        'More slits sharpen the same idea. Their waves line up at particular angles, producing narrow principal orders. The distance between orders is λf/d.',
      circle:
        'The Airy pattern is the signature of a circular opening. Smaller apertures spread light further: the first dark ring is about 1.22λf/D from the centre.',
      annulus:
        'Remove the middle of a circular aperture and the rings rearrange. A narrower central peak comes with stronger side lobes — a trade-off, not free resolution.',
      vortex:
        'Here the opening changes phase as well as amplitude. One turn around the centre advances phase by 2πℓ; the winding cancels the on-axis field and leaves a dark core.',
      custom:
        'The opening is yours. Try two dots, a diagonal line, or a little constellation. Each point contributes a wave; their interference sketches the Fourier pattern.',
    },
  },
  zh: {
    eyebrow: '给好奇心的一间小实验室',
    headline: '让光，展现<br><em>它的规律。</em>',
    intro: '一个孔径，一束光，一幅图案。<br>在浏览器里，观察衍射的几何之美。',
    local: '本地计算 · 无需安装 · 开源',
    bench: '01 / 光学实验台',
    experiment: '选择实验',
    double: '双缝',
    single: '单缝',
    grating: '光栅',
    circle: '圆孔',
    annulus: '环孔',
    vortex: '涡旋',
    custom: '手绘孔径',
    geometry: '孔径几何',
    width: '缝宽',
    height: '缝高',
    separation: '中心间距',
    count: '狭缝数量',
    diameter: '外径',
    inner: '内径',
    charge: '涡旋拓扑荷',
    drawHint: '在孔径上绘制，按 Shift 擦除。键盘：方向键移动，空格绘制。',
    brush: '笔刷直径',
    erase: '橡皮擦',
    clear: '清空',
    light: '光源与透镜',
    wavelength: '波长',
    focal: '透镜焦距',
    reset: '↺ 重置当前实验',
    aperture: '孔径',
    inputPlane: '输入平面',
    pattern: '衍射图',
    log: '对数对比度',
    linear: '线性强度',
    focalPlane: '透镜后焦面',
    normalized: '相对强度 · 峰值 = 1',
    view: '视野',
    drawOn: '在这里画出光 ↗',
    sample: '孔径采样间距',
    transmission: '等效通光面积',
    unitIllumination: '入射振幅为 1',
    cutTitle: '经过中心的一条截线',
    cutType: '线性强度 / y = 0',
    position: '焦平面位置 (mm)',
    png: '导出实验 PNG',
    csv: '强度 CSV',
    share: '复制实验链接',
    session: '实验文件',
    save: '保存 JSON',
    load: '导入 JSON',
    notesLabel: '02 / 实验台手记',
    notesTitle: '小小的开口，<br>意外的世界。',
    physicsNote:
      '模型为透镜焦平面的标量、单色夫琅禾费衍射。每幅图单独归一化；采样网格有限，极小的细节只能近似表达。',
    physicsLink: '了解模型和适用范围 ↗',
    footer: '为弄明白事物的乐趣而做。',
    linkTitle: '实验分享链接',
    linkHint: '选中并复制链接，即可分享当前参数。',
    close: '关闭',
    ready: '实验已就绪',
    busy: '正在计算…',
    copied: '已复制实验链接。',
    customShare: '手绘孔径需要保存实验文件：实验文件 → 保存 JSON。',
    loaded: '已导入实验。',
    saved: '已保存实验。',
    downloaded: '已下载导出文件。',
    amplitude: '振幅',
    phase: '振幅 + 相位',
    amplitudeCaption: '开口让光通过，其余区域遮挡光。',
    phaseCaption: '色相表示相位，亮度表示振幅。',
    customCaption: '手绘振幅掩模，黑色区域遮挡光。',
    fringes: '条纹间距（理论）',
    firstZero: '首个暗纹（理论）',
    airy: '首个暗环（理论）',
    annularMeasure: '内外径之比',
    vortexMeasure: '相位绕转',
    customMeasure: '通光网格数量',
    blank: '孔径为空。在左边画一个开口，让光通过。',
    failed: '无法计算当前实验。',
    fileTooLarge: '实验文件必须小于 2 MB。',
    badLink: '无法恢复此链接，已载入默认实验。',
    cropped: '视野已限制在采样范围内',
    notes: {
      double:
        '两个开口，一次对话。来自两条狭缝的光相遇：有些路径相长，有些相消。增大间距，条纹变密；改变缝宽，包络随之变化。',
      single:
        '开口越窄，图案越宽。第一对暗纹位于 ±λf/a；狭缝有限的高度还会产生垂直方向的衍射包络。',
      grating:
        '更多狭缝让同一个规律变得尖锐。各束光在特定角度相长，形成窄小的主极大；级次间距为 λf/d。',
      circle: '艾里图案是圆孔的标志。孔径越小，光越分散；首个暗环距中心约 1.22λf/D。',
      annulus:
        '遮住圆孔中间，衍射环就会重新分配。中心峰变窄的同时，旁瓣更强——这是权衡，不是凭空提高分辨率。',
      vortex:
        '这个孔径同时改变振幅和相位。绕中心一周，相位推进 2πℓ；相位绕转让轴上光场相消，形成暗心。',
      custom:
        '开口由你决定。试试两个点、一条斜线，或一小片星群。每个点贡献一束波，它们共同画出傅里叶图案。',
    },
  },
};
const t = (key) => messages[language][key] ?? key;
const name = () => t(params.preset);

function notify(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
}
function setBusy(busy) {
  $('status').textContent = t(busy ? 'busy' : 'ready');
  $('status-dot').classList.toggle('busy', busy);
  for (const id of exportButtons) $(id).disabled = busy || !result;
}
function failExperiment(message) {
  result = null;
  setBusy(false);
  $('status').textContent = t('failed');
  for (const id of ['aperture', 'diffraction', 'profile']) {
    const canvas = $(id);
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }
  notify(message, true);
}
function requestCompute() {
  clearTimeout(timer);
  setBusy(true);
  requestId++;
  const id = requestId;
  timer = setTimeout(
    () =>
      worker.postMessage({
        id,
        params: { ...params },
        mask: params.preset === 'custom' ? mask : undefined,
      }),
    65,
  );
}
worker.onmessage = ({ data }) => {
  if (data.id !== requestId) return;
  if (data.error) {
    failExperiment(`${t('failed')} ${data.error}`);
    return;
  }
  result = data.result;
  setBusy(false);
  render();
  if (params.preset === 'custom' && result.totalPower === 0) notify(t('blank'));
};
worker.onerror = () => failExperiment(t('failed'));

function syncControls() {
  const slit = ['single', 'double', 'grating'].includes(params.preset);
  const visible = {
    widthMm: slit,
    heightMm: slit,
    separationMm: ['double', 'grating'].includes(params.preset),
    count: params.preset === 'grating',
    diameterMm: ['circle', 'annulus', 'vortex'].includes(params.preset),
    innerDiameterMm: params.preset === 'annulus',
    charge: params.preset === 'vortex',
  };
  for (const [key, value] of Object.entries(params)) {
    if (!$(key)) continue;
    $(key).value = value;
    const output = $(key + '-value');
    if (output)
      output.textContent = ['count', 'charge'].includes(key)
        ? value
        : key === 'wavelengthNm'
          ? `${value} nm`
          : `${Number(value)
              .toFixed(key === 'focalLengthMm' ? 0 : 3)
              .replace(/0+$/, '')
              .replace(/\.$/, '')} mm`;
  }
  // Focal lengths are integers: keep their trailing zeroes.
  $('focalLengthMm-value').textContent = `${params.focalLengthMm} mm`;
  for (const [key, show] of Object.entries(visible))
    document.querySelector(`[data-for="${key}"]`).hidden = !show;
  $('innerDiameterMm').max = Math.max(0.1, params.diameterMm - 0.05).toFixed(2);
  $('drawing-controls').hidden = params.preset !== 'custom';
  $('aperture').parentElement.classList.toggle('drawing', params.preset === 'custom');
  $('draw-overlay').hidden = params.preset !== 'custom' || (mask && mask.some((x) => x > 0));
  $('aperture-kind').textContent = t(params.preset === 'vortex' ? 'phase' : 'amplitude');
  $('aperture-caption').textContent = t(
    params.preset === 'vortex'
      ? 'phaseCaption'
      : params.preset === 'custom'
        ? 'customCaption'
        : 'amplitudeCaption',
  );
  $('experiment-note').textContent = messages[language].notes[params.preset];
  for (const button of document.querySelectorAll('[data-preset]')) {
    const active = button.dataset.preset === params.preset;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active);
  }
  $('displayMode').value = view.mode;
  $('viewSpanMm').value = view.spanMm;
  $('share').disabled = params.preset === 'custom';
  $('share').title = params.preset === 'custom' ? t('customShare') : '';
}
function setLanguage(next) {
  language = next;
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
  for (const element of document.querySelectorAll('[data-i18n]'))
    element.innerHTML = t(element.dataset.i18n);
  $('language').textContent = next === 'en' ? '中文' : 'EN';
  $('language').setAttribute('aria-label', next === 'en' ? 'Switch to Chinese' : '切换到英语');
  try {
    localStorage.setItem('wavebench-language', next);
  } catch {}
  syncControls();
  setBusy($('status-dot').classList.contains('busy'));
  if (result && !$('status-dot').classList.contains('busy')) render();
}

function spectralColor(wavelength) {
  let r = 0,
    g = 0,
    b = 0;
  if (wavelength < 440) {
    r = (440 - wavelength) / 60;
    b = 1;
  } else if (wavelength < 490) {
    g = (wavelength - 440) / 50;
    b = 1;
  } else if (wavelength < 510) {
    g = 1;
    b = (510 - wavelength) / 20;
  } else if (wavelength < 580) {
    r = (wavelength - 510) / 70;
    g = 1;
  } else if (wavelength < 645) {
    r = 1;
    g = (645 - wavelength) / 65;
  } else r = 1;
  return [r, g, b].map((c) => Math.round(55 + 200 * Math.pow(c, 0.8)));
}
function phaseColor(phase) {
  const h = ((phase / (2 * Math.PI) + 1) % 1) * 6;
  const x = 1 - Math.abs((h % 2) - 1);
  const rgb =
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
  return rgb.map((c) => 60 + 170 * c);
}
function renderAperture() {
  if (!result) return;
  const context = $('aperture').getContext('2d'),
    pixels = context.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const a = params.preset === 'custom' && mask ? mask[i] : result.amplitude[i],
      rgb = params.preset === 'vortex' ? phaseColor(result.phase[i]) : [204, 223, 169];
    for (let c = 0; c < 3; c++)
      pixels.data[4 * i + c] = [8, 22, 17][c] + a * (rgb[c] - [8, 22, 17][c]);
    pixels.data[4 * i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  drawApertureGuides(context);
}
function drawApertureGuides(context) {
  context.strokeStyle = '#708e6430';
  context.lineWidth = 1;
  for (let p = 64; p < N; p += 64) {
    context.beginPath();
    context.moveTo(p + 0.5, 0);
    context.lineTo(p + 0.5, N);
    context.moveTo(0, p + 0.5);
    context.lineTo(N, p + 0.5);
    context.stroke();
  }
  if (keyboardDrawing && params.preset === 'custom') {
    context.strokeStyle = '#e6c77a';
    context.beginPath();
    context.arc(cursor.x, cursor.y, ((Number($('brush').value) / 8) * N) / 2, 0, Math.PI * 2);
    context.stroke();
  }
}
function effectiveSpan() {
  return Math.min(view.spanMm, (result.n - 2) * result.observationPitchMm);
}
function sample2d(x, y) {
  const n = result.n;
  if (x < 0 || y < 0 || x >= n - 1 || y >= n - 1) return 0;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy,
    i = iy * n + ix,
    a = result.intensity;
  return (
    (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fy) + (a[i + n] * (1 - fx) + a[i + n + 1] * fx) * fy
  );
}
function sampleCut(x) {
  const f = x / result.observationPitchMm + N / 2,
    i = Math.floor(f);
  if (i < 0 || i >= N - 1) return 0;
  return result.cut[i] * (1 - (f - i)) + result.cut[i + 1] * (f - i);
}
function renderDiffraction() {
  const canvas = $('diffraction'),
    context = canvas.getContext('2d'),
    size = canvas.width,
    span = effectiveSpan(),
    pixels = context.createImageData(size, size),
    rgb = spectralColor(params.wavelengthNm),
    base = [7, 18, 15];
  const scale = span / size / result.observationPitchMm;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const intensity = sample2d((x - size / 2) * scale + N / 2, (y - size / 2) * scale + N / 2);
      const brightness =
        view.mode === 'log' ? Math.log1p(intensity * 9999) / Math.log(10000) : intensity;
      const white = Math.pow(brightness, 9) * 0.65,
        offset = (y * size + x) * 4;
      for (let c = 0; c < 3; c++)
        pixels.data[offset + c] =
          base[c] + brightness * (rgb[c] - base[c]) * (1 - white) + white * (250 - base[c]);
      pixels.data[offset + 3] = 255;
    }
  context.putImageData(pixels, 0, 0);
  context.strokeStyle = '#8b9a7730';
  context.lineWidth = 1;
  context.setLineDash([2, 6]);
  context.beginPath();
  context.moveTo(size / 2, 0);
  context.lineTo(size / 2, size);
  context.moveTo(0, size / 2);
  context.lineTo(size, size / 2);
  context.stroke();
  context.setLineDash([]);
  $('screen-scale').textContent = `${span.toFixed(2)} × ${span.toFixed(2)} mm`;
  $('screen-scale').title = span < view.spanMm ? t('cropped') : '';
}
function renderProfile() {
  const canvas = $('profile'),
    context = canvas.getContext('2d'),
    width = canvas.width,
    height = canvas.height,
    top = 15,
    bottom = height - 18,
    span = effectiveSpan();
  context.clearRect(0, 0, width, height);
  context.strokeStyle = '#dde2d4';
  context.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const y = top + ((bottom - top) * k) / 4;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.strokeStyle = '#bdcbb0';
  context.setLineDash([4, 5]);
  context.beginPath();
  context.moveTo(width / 2, top);
  context.lineTo(width / 2, bottom);
  context.stroke();
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(0, bottom);
  for (let x = 0; x <= width; x++)
    context.lineTo(x, bottom - sampleCut((x / width - 0.5) * span) * (bottom - top));
  context.lineTo(width, bottom);
  context.closePath();
  context.fillStyle = '#b9d38c38';
  context.fill();
  context.beginPath();
  for (let x = 0; x <= width; x++) {
    const y = bottom - sampleCut((x / width - 0.5) * span) * (bottom - top);
    x === 0 ? context.moveTo(x, y) : context.lineTo(x, y);
  }
  context.strokeStyle = '#497b4a';
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = '#879279';
  context.font = '11px monospace';
  context.fillText('1.0', 3, top - 4);
  context.fillText('0', 3, height - 3);
  $('chart-left').textContent = `−${(span / 2).toFixed(2)} mm`;
  $('chart-right').textContent = `+${(span / 2).toFixed(2)} mm`;
}
function renderReadout() {
  const factor = (params.wavelengthNm / 1e6) * params.focalLengthMm;
  let label, value, formula;
  switch (params.preset) {
    case 'double':
    case 'grating':
      label = t('fringes');
      value = `${(factor / params.separationMm).toFixed(3)} <i>mm</i>`;
      formula = 'λf / d';
      break;
    case 'single':
      label = t('firstZero');
      value = `±${(factor / params.widthMm).toFixed(3)} <i>mm</i>`;
      formula = '±λf / a';
      break;
    case 'circle':
      label = t('airy');
      value = `${((1.22 * factor) / params.diameterMm).toFixed(3)} <i>mm</i>`;
      formula = '1.22λf / D';
      break;
    case 'annulus':
      label = t('annularMeasure');
      value = (params.innerDiameterMm / params.diameterMm).toFixed(2);
      formula = 'Dᵢ / Dₒ';
      break;
    case 'vortex':
      label = t('vortexMeasure');
      value = `${params.charge} <i>× 2π</i>`;
      formula = 'φ = ℓ atan2(y, x)';
      break;
    default:
      label = t('customMeasure');
      value = mask ? mask.reduce((sum, x) => sum + (x > 0), 0).toLocaleString() : 0;
      formula = 'A(x, y) ∈ [0, 1]';
  }
  $('measure-label').textContent = label;
  $('measure-value').innerHTML = value;
  $('measure-formula').textContent = formula;
  $('area-value').innerHTML = `${result.totalPower.toFixed(3)} <i>mm²</i>`;
}
function render() {
  renderAperture();
  renderDiffraction();
  renderProfile();
  renderReadout();
}

function usePreset(preset) {
  if (preset === 'custom' && !mask) mask = new Float32Array(N * N);
  params = normalizeParams({ ...params, preset });
  keyboardDrawing = false;
  notify('');
  syncControls();
  requestCompute();
}
$('presets').addEventListener('click', (event) => {
  const button = event.target.closest('[data-preset]');
  if (button) usePreset(button.dataset.preset);
});
for (const key of Object.keys(DEFAULT_PARAMS))
  if ($(key))
    $(key).addEventListener('input', (event) => {
      params = normalizeParams({ ...params, [key]: Number(event.target.value) });
      notify('');
      syncControls();
      requestCompute();
    });
$('displayMode').addEventListener('change', (event) => {
  view.mode = event.target.value;
  if (result && !$('status-dot').classList.contains('busy')) {
    renderDiffraction();
    renderProfile();
  }
});
$('viewSpanMm').addEventListener('change', (event) => {
  view.spanMm = Number(event.target.value);
  if (result && !$('status-dot').classList.contains('busy')) {
    renderDiffraction();
    renderProfile();
  }
});
$('language').addEventListener('click', () => setLanguage(language === 'en' ? 'zh' : 'en'));
$('reset').addEventListener('click', () => {
  params = { ...DEFAULT_PARAMS, preset: params.preset };
  view = { ...DEFAULT_VIEW };
  if (params.preset === 'custom') mask = new Float32Array(N * N);
  notify('');
  syncControls();
  requestCompute();
});
$('brush').addEventListener('input', () => {
  $('brush-value').textContent = `${Number($('brush').value).toFixed(2)} mm`;
});
$('erase').addEventListener('click', () => {
  erasing = !erasing;
  $('erase').setAttribute('aria-pressed', erasing);
});
$('clear').addEventListener('click', () => {
  if (mask) mask.fill(0);
  syncControls();
  requestCompute();
});

function pointFromEvent(event) {
  const box = $('aperture').getBoundingClientRect();
  return {
    x: ((event.clientX - box.left) / box.width) * N,
    y: ((event.clientY - box.top) / box.height) * N,
  };
}
function paint(point, erase) {
  const radius = ((Number($('brush').value) / 8) * N) / 2,
    previous = lastPoint ?? point,
    distance = Math.hypot(point.x - previous.x, point.y - previous.y),
    steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.4)));
  for (let step = 1; step <= steps; step++) {
    const px = previous.x + ((point.x - previous.x) * step) / steps,
      py = previous.y + ((point.y - previous.y) * step) / steps;
    for (let y = Math.max(0, Math.floor(py - radius)); y < Math.min(N, Math.ceil(py + radius)); y++)
      for (
        let x = Math.max(0, Math.floor(px - radius));
        x < Math.min(N, Math.ceil(px + radius));
        x++
      )
        if ((x - px) ** 2 + (y - py) ** 2 <= radius ** 2) mask[y * N + x] = erase ? 0 : 1;
  }
  lastPoint = point;
  cursor = point;
  // Preview the edited mask immediately; the worker computes its pattern after a pause.
  const context = $('aperture').getContext('2d'),
    pixels = context.createImageData(N, N);
  for (let i = 0; i < mask.length; i++) {
    pixels.data[i * 4] = 8 + 196 * mask[i];
    pixels.data[i * 4 + 1] = 22 + 201 * mask[i];
    pixels.data[i * 4 + 2] = 17 + 152 * mask[i];
    pixels.data[i * 4 + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  drawApertureGuides(context);
  $('draw-overlay').hidden = mask.some((x) => x > 0);
  notify('');
  requestCompute();
}
$('aperture').addEventListener('pointerdown', (event) => {
  if (params.preset !== 'custom' || event.button !== 0) return;
  event.preventDefault();
  drawing = true;
  keyboardDrawing = false;
  lastPoint = null;
  $('aperture').setPointerCapture(event.pointerId);
  paint(pointFromEvent(event), erasing || event.shiftKey);
});
$('aperture').addEventListener('pointermove', (event) => {
  if (!drawing) return;
  paint(pointFromEvent(event), erasing || event.shiftKey);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
  $('aperture').addEventListener(type, () => {
    drawing = false;
    lastPoint = null;
  });
$('aperture').addEventListener('keydown', (event) => {
  if (params.preset !== 'custom') return;
  const dirs = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] };
  if (dirs[event.key]) {
    event.preventDefault();
    keyboardDrawing = true;
    cursor.x = Math.min(N - 1, Math.max(0, cursor.x + dirs[event.key][0]));
    cursor.y = Math.min(N - 1, Math.max(0, cursor.y + dirs[event.key][1]));
    renderAperture();
  } else if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    keyboardDrawing = true;
    lastPoint = null;
    paint(cursor, erasing || event.shiftKey);
    lastPoint = null;
  }
});

function download(blob, filename) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('exportCsv').addEventListener('click', () => {
  const half = effectiveSpan() / 2,
    rows = ['x_mm,normalized_intensity'];
  for (let i = 0; i < N; i++) {
    const x = (i - N / 2) * result.observationPitchMm;
    if (Math.abs(x) <= half) rows.push(`${x.toPrecision(12)},${result.cut[i].toPrecision(12)}`);
  }
  download(
    new Blob([rows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' }),
    `wavebench-${params.preset}-${params.wavelengthNm}nm.csv`,
  );
  notify(t('downloaded'));
});
function geometryText() {
  if (['single', 'double', 'grating'].includes(params.preset))
    return `a=${params.widthMm} mm · h=${params.heightMm} mm${params.preset !== 'single' ? ` · d=${params.separationMm} mm` : ''}${params.preset === 'grating' ? ` · M=${params.count}` : ''}`;
  if (['circle', 'annulus', 'vortex'].includes(params.preset))
    return `D=${params.diameterMm} mm${params.preset === 'annulus' ? ` · Di=${params.innerDiameterMm} mm` : ''}${params.preset === 'vortex' ? ` · charge=${params.charge}` : ''}`;
  return 'Custom amplitude mask · 512 × 512';
}
$('exportPng').addEventListener('click', () => {
  const filename = `wavebench-${params.preset}-${params.wavelengthNm}nm.png`;
  const canvas = document.createElement('canvas');
  canvas.width = 1500;
  canvas.height = 1160;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f3f1e9';
  context.fillRect(0, 0, 1500, 1160);
  context.fillStyle = '#243c34';
  context.font = '48px Georgia';
  context.fillText('wavebench / ' + messages.en[params.preset], 60, 78);
  context.font = '18px monospace';
  context.fillText(
    `λ = ${params.wavelengthNm} nm    f = ${params.focalLengthMm} mm    ${geometryText()}`,
    60,
    120,
  );
  context.font = '15px monospace';
  context.fillText('APERTURE / 8 × 8 mm', 60, 164);
  context.fillText(
    `FOCAL PLANE / ${effectiveSpan().toFixed(3)} × ${effectiveSpan().toFixed(3)} mm`,
    790,
    164,
  );
  context.drawImage($('aperture'), 60, 185, 650, 650);
  context.drawImage($('diffraction'), 790, 185, 650, 650);
  context.font = '15px monospace';
  context.fillText(
    params.preset === 'vortex' ? 'Hue: phase · Brightness: amplitude' : 'Amplitude transmission',
    60,
    864,
  );
  context.fillText(
    `${view.mode === 'log' ? 'Log contrast: log(1 + 9999 I) / log(10000)' : 'Linear intensity'} · peak normalized`,
    790,
    864,
  );
  context.font = '16px monospace';
  context.fillText('CENTRAL HORIZONTAL SECTION / LINEAR NORMALIZED INTENSITY', 60, 911);
  context.drawImage($('profile'), 60, 927, 1380, 130);
  context.font = '13px monospace';
  context.fillText(`−${(effectiveSpan() / 2).toFixed(3)} mm`, 60, 1078);
  context.textAlign = 'right';
  context.fillText(`+${(effectiveSpan() / 2).toFixed(3)} mm`, 1440, 1078);
  context.textAlign = 'left';
  context.fillText(
    'Scalar Fraunhofer model · finite grid · each experiment normalized separately',
    60,
    1118,
  );
  context.fillText('bdbddscat.github.io/portfolio-studio-demos/wavebench/', 60, 1140);
  canvas.toBlob((blob) => {
    if (blob) {
      download(blob, filename);
      notify(t('downloaded'));
    }
  }, 'image/png');
});
$('share').addEventListener('click', async () => {
  if (params.preset === 'custom') {
    notify(t('customShare'));
    return;
  }
  const url = new URL(location.href);
  url.hash = encodeHash(params, view);
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url.href);
    notify(t('copied'));
  } catch {
    $('linkFallback').value = url.href;
    $('linkDialog').showModal();
    $('linkFallback').select();
  }
});
$('saveSession').addEventListener('click', () => {
  download(
    new Blob([serializeSession(params, view, mask)], { type: 'application/json' }),
    `wavebench-${params.preset}.json`,
  );
  notify(t('saved'));
});
$('loadSession').addEventListener('click', () => $('sessionFile').click());
$('sessionFile').addEventListener('change', async () => {
  const file = $('sessionFile').files[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error(t('fileTooLarge'));
    const session = deserializeSession(await file.text());
    params = session.params;
    view = session.view;
    mask = session.mask;
    notify(t('loaded'));
    history.replaceState(null, '', location.pathname + location.search);
    syncControls();
    requestCompute();
  } catch (error) {
    notify(error.message, true);
  } finally {
    $('sessionFile').value = '';
  }
});
function restoreHash() {
  if (!location.hash) return;
  try {
    const state = decodeHash(location.hash);
    if (state) {
      params = state.params;
      view = state.view;
      syncControls();
      requestCompute();
    }
  } catch {
    params = { ...DEFAULT_PARAMS };
    view = { ...DEFAULT_VIEW };
    syncControls();
    requestCompute();
    notify(t('badLink'), true);
  }
}
addEventListener('hashchange', restoreHash);
try {
  language = localStorage.getItem('wavebench-language') === 'zh' ? 'zh' : 'en';
} catch {}
setLanguage(language);
syncControls();
restoreHash();
requestCompute();
