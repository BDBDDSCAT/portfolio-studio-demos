import {
  DEFAULT_EXPERIMENT,
  DEFAULT_DISPLAY,
  normalizeExperiment,
  encodeExperimentHash,
  decodeExperimentHash,
  serializeExperiment,
  deserializeExperiment,
  buildSectionCsv,
  buildManifest,
} from './experiment.js';
import {
  effectiveSpan,
  renderFields,
  renderProfile,
  renderMetrics,
  renderDiagnostics,
  renderMask,
  renderScan,
} from './view.js';
const $ = (id) => document.getElementById(id);
const INITIAL = {
  ...DEFAULT_EXPERIMENT,
  preset: 'gaussian',
  method: 'angular-spectrum',
  beamWaistMm: 0.2,
  distanceMm: 250,
};
let params = { ...INITIAL },
  view = { ...DEFAULT_DISPLAY, spanMm: 2 },
  mask = null,
  result = null,
  resultParams = null,
  language = 'en',
  busy = false,
  requestId = 0,
  requestTimer,
  scanWorker = null,
  scanResult = null,
  exporting = false,
  lastPoint = null,
  drawing = false,
  erasing = false,
  keyboard = false,
  cursor = { x: 256, y: 256 };
const worker = new Worker(new URL('./worker.js?v=2.0.0', import.meta.url), { type: 'module' });
const EN = {
  heading: 'Wave propagation workbench',
  description:
    'Compute complex optical fields. Inspect sampling limits. Export reproducible experiments.',
  examples: 'Load example:',
  gaussianExample: 'Gaussian beam propagation',
  slitExample: 'Near-field double slit',
  gratingExample: 'Grating focal field',
  reset: 'Reset',
  model: 'Propagation model',
  method: 'Method',
  distance: 'Propagation distance z',
  focal: 'Lens focal length f',
  source: 'Input field',
  aperture: 'Source / aperture',
  wavelength: 'Wavelength λ',
  waist: 'Gaussian waist w₀',
  waistHelp: 'w₀ is the 1/e² intensity radius. Zero selects uniform aperture illumination.',
  width: 'Slit width a',
  height: 'Slit height',
  spacing: 'Centre spacing d',
  count: 'Slit count',
  diameter: 'Outer diameter D',
  inner: 'Inner diameter',
  charge: 'Topological charge ℓ',
  drawHelp: 'Draw on the input plane. Shift erases. Arrows + Space work with a keyboard.',
  brush: 'Brush diameter / mm',
  erase: 'Eraser',
  clear: 'Clear',
  maskImage: 'Image mask',
  maskHelp: 'Image luminance × alpha is amplitude transmission, fitted into the 8 mm window.',
  sampling: 'Sampling',
  grid: 'Grid size N × N',
  window: 'Input window L',
  pitch: 'Input pitch Δx',
  samplingHelp:
    'FFT boundaries are periodic. Increasing N improves input resolution; it does not enlarge the near-field window.',
  fieldLabel: 'COMPLEX FIELD / XY PLANE',
  view: 'View',
  inputAmplitude: 'Input amplitude',
  outputIntensity: 'Output intensity',
  outputPhase: 'Output phase',
  powerIn: 'Input ∫|U|² dA',
  powerOut: 'Output ∫|U|² dA',
  outputPitch: 'Output pitch',
  radius: 'Second-moment radius',
  radiusHelp: 'w = √(2〈r²〉), centroid removed',
  profile: 'Central section / y = 0',
  profileUnit: 'RAW RELATIVE INTENSITY',
  diagnostics: 'Numerical diagnostics',
  compare: 'Compare Fresnel / ASM',
  diagnosticHelp:
    'Diagnostics flag sampling risks. Energy conservation alone does not establish physical accuracy.',
  scanTitle: 'Propagation sweep / x–z section',
  start: 'Start z / mm',
  stop: 'Stop z / mm',
  steps: 'Steps',
  runScan: 'Run sweep',
  cancel: 'Cancel',
  scanCsv: 'Sweep CSV',
  scanAxis: 'x / mm · z increases from top to bottom',
  scanHint:
    'Near-field models only. A global color scale preserves relative peak intensity across distances.',
  exports: 'Reproduce & export',
  share: 'Copy experiment link',
  save: 'Experiment JSON',
  load: 'Load JSON',
  gridCsv: 'Full field CSV',
  sectionCsv: 'Section CSV',
  png: 'Snapshot PNG',
  manifest: 'Result manifest',
  reference: 'Model definitions',
  limits:
    'Scalar, coherent, monochromatic fields. Carrier phase is omitted. No polarization, vector fields, dispersion or lens aberrations. The FFT window can wrap diffracted energy.',
  physicsLink: 'Equations, conventions & validation →',
  ready: 'Computation ready',
  computing: 'Computing field…',
  comparing: 'Comparing models…',
  failed: 'Computation failed',
  allClear:
    'No sampling flags for the current field. Inspect convergence before relying on a result.',
  saved: 'Experiment file downloaded.',
  loaded: 'Experiment restored.',
  copied: 'Experiment link copied.',
  downloaded: 'File downloaded.',
  badLink: 'Invalid experiment link; loaded the default configuration.',
  empty: 'Empty input: draw an opening or import an amplitude mask.',
  scanDone: 'Sweep complete',
  scanCancelled: 'Sweep cancelled',
  scanStale: 'Parameters changed; rerun the sweep.',
  customShare: 'Custom masks require an experiment JSON file.',
  exporting: 'Exporting full native grid…',
  imageLoaded: 'Image imported as amplitude transmission.',
  imageLarge: 'Image file must be smaller than 20 MB.',
  scanError: 'Use 3–61 steps with 0.1 ≤ start < stop ≤ 2000 mm.',
  asmNote:
    'Free-space propagation on a fixed grid. Angular spectrum retains the exact longitudinal wave number for scalar modes.',
  fresnelNote:
    'Free-space propagation using a paraxial transfer function. Input and output sampling are identical.',
  farNote:
    'Ideal lens back focal plane. Coordinates scale with λf; this is a Fourier field, not a finite-distance propagation.',
};
const ZH = {
  heading: '标量光场传播工作台',
  description: '计算复光场、检查采样条件，并导出可复现的数值实验。',
  examples: '载入示例：',
  gaussianExample: '高斯束传播',
  slitExample: '双缝近场',
  gratingExample: '光栅焦平面',
  reset: '重置',
  model: '传播模型',
  method: '计算方法',
  distance: '传播距离 z',
  focal: '透镜焦距 f',
  source: '输入光场',
  aperture: '光源 / 孔径',
  wavelength: '波长 λ',
  waist: '高斯束腰 w₀',
  waistHelp: 'w₀ 为强度降至 1/e² 的半径。孔径照明设为零时使用均匀光场。',
  width: '缝宽 a',
  height: '缝高',
  spacing: '中心间距 d',
  count: '狭缝数量',
  diameter: '外径 D',
  inner: '内径',
  charge: '拓扑荷 ℓ',
  drawHelp: '在输入平面绘制，Shift 擦除；方向键移动，空格绘制。',
  brush: '笔刷直径 / mm',
  erase: '橡皮擦',
  clear: '清空',
  maskImage: '导入图像',
  maskHelp: '图像亮度 × 透明度作为振幅透过率，按比例置于 8 mm 窗口。',
  sampling: '采样设置',
  grid: '网格 N × N',
  window: '输入窗口 L',
  pitch: '输入间距 Δx',
  samplingHelp: 'FFT 使用周期边界。提高 N 可提高输入分辨率，不会扩大近场窗口。',
  fieldLabel: '复光场 / XY 平面',
  view: '视野',
  inputAmplitude: '输入振幅',
  outputIntensity: '输出强度',
  outputPhase: '输出相位',
  powerIn: '输入 ∫|U|² dA',
  powerOut: '输出 ∫|U|² dA',
  outputPitch: '输出采样间距',
  radius: '二阶矩半径',
  radiusHelp: 'w = √(2〈r²〉)，已扣除质心',
  profile: '中心截面 / y = 0',
  profileUnit: '未归一化相对强度',
  diagnostics: '数值诊断',
  compare: '比较 Fresnel / ASM',
  diagnosticHelp: '诊断提示已知采样风险。能量守恒不能单独证明物理结果准确。',
  scanTitle: '传播距离扫描 / x–z 截面',
  start: '起点 z / mm',
  stop: '终点 z / mm',
  steps: '采样步数',
  runScan: '运行扫描',
  cancel: '取消',
  scanCsv: '扫描 CSV',
  scanAxis: 'x / mm · z 从上到下增大',
  scanHint: '适用于近场模型。所有距离共用同一颜色尺度，保留峰值强度的相对变化。',
  exports: '复现与导出',
  share: '复制实验链接',
  save: '实验 JSON',
  load: '载入 JSON',
  gridCsv: '完整光场 CSV',
  sectionCsv: '截面 CSV',
  png: '数值快照 PNG',
  manifest: '结果清单',
  reference: '模型定义',
  limits:
    '标量、相干、单色光场，省略载波相位。未模拟偏振、矢量场、色散或透镜像差。有限 FFT 窗口可能使能量回绕。',
  physicsLink: '方程、约定与验证 →',
  ready: '计算已就绪',
  computing: '正在计算光场…',
  comparing: '正在比较模型…',
  failed: '计算失败',
  allClear: '当前光场未触发采样提示。使用结果前仍需检查网格收敛性。',
  saved: '已下载实验文件。',
  loaded: '已还原实验。',
  copied: '已复制实验链接。',
  downloaded: '已下载文件。',
  badLink: '实验链接无效，已载入默认配置。',
  empty: '输入为空：请绘制开口或导入振幅掩模。',
  scanDone: '扫描完成',
  scanCancelled: '扫描已取消',
  scanStale: '参数已改变，请重新扫描。',
  customShare: '自定义掩模需要用实验 JSON 分享。',
  exporting: '正在导出完整原生网格…',
  imageLoaded: '图像已作为振幅透过率导入。',
  imageLarge: '图像文件必须小于 20 MB。',
  scanError: '请使用 3–61 步，以及 0.1 ≤ 起点 < 终点 ≤ 2000 mm。',
  asmNote: '固定网格上的自由空间传播。角谱法保留标量平面波的精确纵向波数。',
  fresnelNote: '使用近轴传递函数计算自由空间传播，输入和输出采样间距相同。',
  farNote: '理想透镜后焦面，坐标按 λf 缩放。这是傅里叶光场，不是有限距离的传播结果。',
};
const t = (key) => (language === 'zh' ? ZH : EN)[key] ?? key;
function notify(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
}
function updateButtons() {
  const valid = !!result && !busy;
  for (const id of ['exportPng', 'exportCsv', 'saveSession', 'exportManifest'])
    $(id).disabled = !valid;
  $('exportGrid').disabled = !valid || exporting;
  $('share').disabled = params.preset === 'custom';
  $('share').title = params.preset === 'custom' ? t('customShare') : '';
  $('compare').disabled = !valid || params.method === 'fraunhofer' || result.inputPower === 0;
  $('runScan').disabled = !valid || params.method === 'fraunhofer' || !!scanWorker;
  $('exportScan').disabled = !scanResult || !!scanWorker;
}
function setBusy(value, label = 'computing') {
  busy = value;
  $('status-dot').classList.toggle('busy', value);
  $('status').textContent = t(value ? label : 'ready');
  updateButtons();
}
function invalidateSweep() {
  const hadSweep = !!scanWorker || !!scanResult;
  if (scanWorker) stopScan();
  scanResult = null;
  $('scan').getContext('2d').clearRect(0, 0, $('scan').width, $('scan').height);
  $('scan-note').textContent = t('scanHint');
  if (hadSweep) $('scan-status').textContent = t('scanStale');
  updateButtons();
}
function requestCompute() {
  clearTimeout(requestTimer);
  requestId++;
  const id = requestId;
  setBusy(true);
  requestTimer = setTimeout(
    () =>
      worker.postMessage({
        id,
        params: { ...params },
        mask: params.preset === 'custom' ? mask : undefined,
      }),
    65,
  );
}
function fail(message) {
  result = null;
  resultParams = null;
  setBusy(false);
  $('status').textContent = t('failed');
  for (const id of ['aperture', 'diffraction', 'phase', 'profile']) {
    $(id).getContext('2d').clearRect(0, 0, $(id).width, $(id).height);
  }
  notify(message, true);
}
worker.onmessage = ({ data }) => {
  if (data.id !== requestId) return;
  if (data.error) {
    fail(data.error);
    return;
  }
  if (data.comparison) {
    setBusy(false);
    $('comparison').hidden = false;
    $('comparison').textContent =
      `||U_Fresnel − U_ASM||₂ / ||U_ASM||₂ = ${data.comparison.fieldRelativeL2.toExponential(6)}\n||I_Fresnel − I_ASM||₂ / ||I_ASM||₂ = ${data.comparison.intensityRelativeL2.toExponential(6)}\nz = ${params.distanceMm} mm · ${params.gridSize}² · ${data.comparison.elapsed.toFixed(1)} ms`;
    render();
    return;
  }
  result = data.result;
  resultParams = { ...params };
  $('elapsed').textContent = `${data.elapsed.toFixed(1)} ms`;
  setBusy(false);
  render();
  if (!result.inputPower) notify(t('empty'));
};
worker.onerror = () => fail(t('failed'));
function render() {
  if (!result || busy) return;
  renderFields(result, resultParams, view);
  renderProfile(result, view);
  renderMetrics(result, resultParams, t('radiusHelp'));
  renderDiagnostics(result, t('allClear'));
  if (scanResult) renderScan(scanResult, view);
}
function sync() {
  const p = params.preset,
    slit = ['single', 'double', 'grating'].includes(p),
    visible = {
      distanceMm: params.method !== 'fraunhofer',
      focalLengthMm: params.method === 'fraunhofer',
      widthMm: slit,
      heightMm: slit,
      separationMm: ['double', 'grating'].includes(p),
      count: p === 'grating',
      diameterMm: ['circle', 'annulus', 'vortex'].includes(p),
      innerDiameterMm: p === 'annulus',
      charge: p === 'vortex',
    };
  for (const [key, value] of Object.entries(params))
    if ($(key)) {
      $(key).value = value;
      if ($(key + '-value'))
        $(key + '-value').textContent = ['charge', 'count'].includes(key)
          ? value
          : `${Number(value.toFixed(4))}${key === 'wavelengthNm' ? ' nm' : ' mm'}`;
    }
  for (const [key, show] of Object.entries(visible))
    document.querySelector(`[data-param="${key}"]`).hidden = !show;
  $('beamWaistMm').min = p === 'gaussian' ? 0.1 : 0;
  $('innerDiameterMm').max = params.diameterMm - 0.05;
  $('drawing-tools').hidden = p !== 'custom';
  $('aperture').parentElement.classList.toggle('drawing', p === 'custom');
  $('input-pitch').textContent = `${(8000 / params.gridSize).toFixed(3)} µm`;
  $('model-note').textContent = t(
    params.method === 'fraunhofer'
      ? 'farNote'
      : params.method === 'fresnel'
        ? 'fresnelNote'
        : 'asmNote',
  );
  $('displayMode').value = view.mode;
  $('viewSpanMm').value = view.spanMm;
  $('cli-command').textContent = cliCommand();
  updateButtons();
}
function cliCommand() {
  if (params.preset === 'custom')
    return `node bin/wavebench.js simulate --session wavebench-custom.json --out out`;
  let command = `node bin/wavebench.js simulate --preset ${params.preset} --method ${params.method}\n  --wavelength ${params.wavelengthNm} --grid ${params.gridSize} ${params.method === 'fraunhofer' ? `--focal ${params.focalLengthMm}` : `--distance ${params.distanceMm}`} --waist ${params.beamWaistMm}`;
  if (['single', 'double', 'grating'].includes(params.preset)) {
    command += `\n  --width ${params.widthMm} --height ${params.heightMm}`;
    if (params.preset !== 'single') command += ` --separation ${params.separationMm}`;
    if (params.preset === 'grating') command += ` --count ${params.count}`;
  }
  if (['circle', 'annulus', 'vortex'].includes(params.preset)) {
    command += ` --diameter ${params.diameterMm}`;
    if (params.preset === 'annulus') command += ` --inner ${params.innerDiameterMm}`;
    if (params.preset === 'vortex') command += ` --charge ${params.charge}`;
  }
  return command.replaceAll('\n', ' ') + ' --out out';
}
function setLanguage(next) {
  language = next;
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
  for (const node of document.querySelectorAll('[data-i18n]'))
    node.textContent = t(node.dataset.i18n);
  $('language').textContent = next === 'en' ? '中文' : 'EN';
  try {
    localStorage.setItem('wavebench-language', next);
  } catch {}
  sync();
  $('status').textContent = t(busy ? 'computing' : result ? 'ready' : 'failed');
  render();
}
function change(next) {
  const previousGrid = params.gridSize,
    previousPreset = params.preset;
  invalidateSweep();
  params = normalizeExperiment(next);
  if (params.preset === 'custom' && (!mask || mask.length !== params.gridSize ** 2))
    mask = new Float32Array(params.gridSize ** 2);
  if (
    params.preset === 'custom' &&
    (previousPreset !== 'custom' || previousGrid !== params.gridSize)
  )
    cursor = { x: params.gridSize / 2, y: params.gridSize / 2 };
  $('comparison').hidden = true;
  notify('');
  sync();
  requestCompute();
}
for (const key of Object.keys(DEFAULT_EXPERIMENT))
  if ($(key))
    $(key).addEventListener($(key).tagName === 'SELECT' ? 'change' : 'input', (event) => {
      const value = ['preset', 'method'].includes(key)
        ? event.target.value
        : Number(event.target.value);
      if (key === 'gridSize' && mask) {
        const old = Math.sqrt(mask.length),
          n = value,
          resized = new Float32Array(n * n);
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++)
            resized[y * n + x] =
              mask[
                Math.min(old - 1, Math.floor((y / n) * old)) * old +
                  Math.min(old - 1, Math.floor((x / n) * old))
              ];
        mask = resized;
      }
      const next = { ...params, [key]: value };
      if (key === 'preset' && params.preset === 'gaussian' && value !== 'gaussian')
        next.beamWaistMm = 0;
      change(next);
    });
document.querySelector('.examples').addEventListener('click', (event) => {
  const example = event.target.dataset.example;
  if (!example) return;
  view = { ...DEFAULT_DISPLAY, spanMm: example === 'gaussian' ? 2 : 4 };
  const p =
    example === 'gaussian'
      ? INITIAL
      : example === 'slit'
        ? {
            ...DEFAULT_EXPERIMENT,
            preset: 'double',
            method: 'fresnel',
            distanceMm: 120,
            widthMm: 0.2,
            heightMm: 1,
            separationMm: 0.65,
          }
        : {
            ...DEFAULT_EXPERIMENT,
            preset: 'grating',
            method: 'fraunhofer',
            count: 5,
            widthMm: 0.15,
            separationMm: 0.7,
          };
  change(p);
});
$('reset').addEventListener('click', () => {
  view = { ...DEFAULT_DISPLAY, spanMm: 2 };
  change(INITIAL);
});
$('language').addEventListener('click', () => setLanguage(language === 'en' ? 'zh' : 'en'));
for (const [id, key] of [
  ['displayMode', 'mode'],
  ['viewSpanMm', 'spanMm'],
])
  $(id).addEventListener('change', (event) => {
    view[key] = key === 'spanMm' ? Number(event.target.value) : event.target.value;
    render();
  });
$('compare').addEventListener('click', () => {
  requestId++;
  setBusy(true, 'comparing');
  worker.postMessage({
    id: requestId,
    kind: 'compare',
    params: { ...params },
    mask: params.preset === 'custom' ? mask : undefined,
  });
});
function download(blob, filename) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileStem = (p) => `wavebench-${p.preset}-${p.method}-${p.wavelengthNm}nm`;
$('exportCsv').addEventListener('click', () => {
  download(
    new Blob([buildSectionCsv(result, effectiveSpan(result, view))], { type: 'text/csv' }),
    fileStem(resultParams) + '-section.csv',
  );
  notify(t('downloaded'));
});
$('exportManifest').addEventListener('click', () => {
  download(
    new Blob([JSON.stringify(buildManifest(resultParams, result), null, 2)], {
      type: 'application/json',
    }),
    fileStem(resultParams) + '-manifest.json',
  );
  notify(t('downloaded'));
});
$('saveSession').addEventListener('click', () => {
  try {
    download(
      new Blob([serializeExperiment(params, view, mask)], { type: 'application/json' }),
      `wavebench-${params.preset}.json`,
    );
    notify(t('saved'));
  } catch (error) {
    notify(error.message, true);
  }
});
$('loadSession').addEventListener('click', () => $('sessionFile').click());
$('sessionFile').addEventListener('change', async () => {
  const file = $('sessionFile').files[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('Experiment file exceeds 2 MB.');
    const data = deserializeExperiment(await file.text());
    mask = data.mask;
    view = data.view;
    change(data.params);
    notify(t('loaded'));
    history.replaceState(null, '', location.pathname + location.search);
  } catch (error) {
    notify(error.message, true);
  } finally {
    $('sessionFile').value = '';
  }
});
$('share').addEventListener('click', async () => {
  try {
    const url = new URL(location.href);
    url.hash = encodeExperimentHash(params, view);
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url.href);
      notify(t('copied'));
    } catch {
      $('linkFallback').value = url.href;
      $('linkDialog').showModal();
      $('linkFallback').select();
    }
  } catch (error) {
    notify(error.message, true);
  }
});
$('exportGrid').addEventListener('click', () => {
  const p = { ...resultParams },
    filename = fileStem(p) + '-field.csv',
    exportWorker = new Worker(new URL('./export-worker.js', import.meta.url), { type: 'module' });
  exporting = true;
  updateButtons();
  notify(t('exporting'));
  const done = () => {
    exporting = false;
    exportWorker.terminate();
    updateButtons();
  };
  exportWorker.onmessage = ({ data }) => {
    if (data.error) notify(data.error, true);
    else {
      download(data.blob, filename);
      notify(t('downloaded') + ' ' + filename);
    }
    done();
  };
  exportWorker.onerror = () => {
    notify(t('failed'), true);
    done();
  };
  exportWorker.postMessage({ params: p, mask: p.preset === 'custom' ? mask : undefined });
});
$('exportPng').addEventListener('click', () => {
  const p = { ...resultParams },
    filename = fileStem(p) + '.png',
    canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1100;
  const context = canvas.getContext('2d');
  context.fillStyle = '#101419';
  context.fillRect(0, 0, 1600, 1100);
  context.fillStyle = '#dbe5f0';
  context.font = '28px monospace';
  context.fillText(`WAVEBENCH / ${p.method} / ${p.preset}`, 50, 55);
  context.font = '16px monospace';
  context.fillText(
    `λ=${p.wavelengthNm} nm · ${p.method === 'fraunhofer' ? `f=${p.focalLengthMm}` : `z=${p.distanceMm}`} mm · w0=${p.beamWaistMm} mm · N=${p.gridSize} · L=8 mm`,
    50,
    92,
  );
  const ids = ['aperture', 'diffraction', 'phase'],
    labels = ['INPUT AMPLITUDE', 'OUTPUT INTENSITY', 'OUTPUT PHASE'];
  for (let i = 0; i < 3; i++) {
    const x = 50 + i * 515;
    context.fillStyle = '#91a0b3';
    context.font = '14px monospace';
    context.fillText(labels[i], x, 130);
    context.drawImage($(ids[i]), x, 150, 470, 470);
    context.fillText(
      i === 0
        ? $('input-scale').textContent
        : i === 1
          ? $('output-scale').textContent
          : 'Phase hidden below 1e-8 peak',
      x,
      645,
    );
  }
  context.fillStyle = '#dbe5f0';
  context.fillText(
    `Pin=${result.inputPower.toExponential(7)} mm²   Pout=${result.outputPower.toExponential(7)} mm²   output Δx=${(result.outputPitchMm * 1000).toFixed(4)} µm`,
    50,
    689,
  );
  context.fillText(
    `Display: ${view.mode === 'log' ? 'log10, eight decades' : 'linear'}, peak normalized. Section: raw relative irradiance.`,
    50,
    719,
  );
  context.drawImage($('profile'), 50, 750, 1490, 170);
  context.fillText(
    `x ∈ [−${(effectiveSpan(result, view) / 2).toFixed(3)}, +${(effectiveSpan(result, view) / 2).toFixed(3)}] mm`,
    50,
    944,
  );
  context.font = '13px monospace';
  let y = 977;
  for (const d of result.diagnostics.slice(0, 2)) {
    context.fillText(`${d.code}: ${d.message.slice(0, 160)}`, 50, y);
    y += 22;
  }
  context.fillText(
    'Scalar coherent model / carrier phase omitted / periodic FFT boundary / relative irradiance',
    50,
    1048,
  );
  context.fillText('bdbddscat.github.io/portfolio-studio-demos/wavebench/', 50, 1074);
  canvas.toBlob((blob) => {
    if (blob) {
      download(blob, filename);
      notify(t('downloaded'));
    }
  }, 'image/png');
});
function stopScan() {
  if (scanWorker) {
    scanWorker.terminate();
    scanWorker = null;
  }
  $('cancelScan').hidden = true;
  scanResult = null;
  $('scan').getContext('2d').clearRect(0, 0, $('scan').width, $('scan').height);
  $('scan-note').textContent = t('scanHint');
  $('scan-status').textContent = t('scanCancelled');
  updateButtons();
}
$('cancelScan').addEventListener('click', stopScan);
$('runScan').addEventListener('click', () => {
  const start = Number($('scan-start').value),
    stop = Number($('scan-stop').value),
    steps = Number($('scan-steps').value);
  if (
    ![start, stop, steps].every(Number.isFinite) ||
    start < 0.1 ||
    stop > 2000 ||
    stop <= start ||
    !Number.isInteger(steps) ||
    steps < 3 ||
    steps > 61
  ) {
    notify(t('scanError'), true);
    return;
  }
  scanResult = null;
  $('scan').getContext('2d').clearRect(0, 0, $('scan').width, $('scan').height);
  $('scan-note').textContent = t('scanHint');
  scanWorker = new Worker(new URL('./scan-worker.js', import.meta.url), { type: 'module' });
  $('cancelScan').hidden = false;
  updateButtons();
  const active = scanWorker,
    p = { ...params };
  scanWorker.onmessage = ({ data }) => {
    if (scanWorker !== active) return;
    if (data.error) {
      stopScan();
      notify(data.error, true);
      return;
    }
    if (data.progress) {
      $('scan-status').textContent = `${data.progress} / ${data.steps}`;
      return;
    }
    scanResult = data.result;
    active.terminate();
    scanWorker = null;
    $('cancelScan').hidden = true;
    $('scan-status').textContent = `${t('scanDone')} / ${scanResult.steps} planes`;
    if (scanResult.warnings.length)
      $('scan-note').textContent = t('scanHint') + ' Flags: ' + scanResult.warnings.join(', ');
    renderScan(scanResult, view);
    updateButtons();
  };
  scanWorker.onerror = () => {
    stopScan();
    notify(t('failed'), true);
  };
  scanWorker.postMessage({
    params: p,
    mask: p.preset === 'custom' ? mask : undefined,
    start,
    stop,
    steps,
  });
});
$('exportScan').addEventListener('click', () => {
  const s = scanResult,
    rows = ['z_mm,x_mm,intensity,global_normalized_intensity,phase_rad'];
  for (let row = 0; row < s.steps; row++)
    for (let x = 0; x < s.n; x++) {
      const i = row * s.n + x;
      rows.push(
        [
          s.distances[row],
          (x - s.n / 2) * s.pitchMm,
          s.raw[i],
          s.peak ? s.raw[i] / s.peak : 0,
          s.phase[i],
        ]
          .map((v) => v.toPrecision(12))
          .join(','),
      );
    }
  download(
    new Blob([rows.join('\n') + '\n'], { type: 'text/csv' }),
    fileStem(s.params) + '-sweep.csv',
  );
  notify(t('downloaded'));
});
function point(event) {
  const box = $('aperture').getBoundingClientRect();
  return {
    x: ((event.clientX - box.left) / box.width) * params.gridSize,
    y: ((event.clientY - box.top) / box.height) * params.gridSize,
  };
}
function paint(p, erase) {
  const n = params.gridSize,
    r = ((Number($('brush').value) / 8) * n) / 2,
    last = lastPoint ?? p,
    steps = Math.max(1, Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / Math.max(1, r * 0.4)));
  for (let step = 1; step <= steps; step++) {
    const px = last.x + ((p.x - last.x) * step) / steps,
      py = last.y + ((p.y - last.y) * step) / steps;
    for (let y = Math.max(0, Math.floor(py - r)); y < Math.min(n, Math.ceil(py + r)); y++)
      for (let x = Math.max(0, Math.floor(px - r)); x < Math.min(n, Math.ceil(px + r)); x++)
        if ((x - px) ** 2 + (y - py) ** 2 <= r * r) mask[y * n + x] = erase ? 0 : 1;
  }
  lastPoint = p;
  cursor = p;
  invalidateSweep();
  renderMask(mask, n, keyboard ? cursor : null, r);
  notify('');
  requestCompute();
}
$('aperture').addEventListener('pointerdown', (event) => {
  if (params.preset !== 'custom' || event.button !== 0) return;
  event.preventDefault();
  drawing = true;
  keyboard = false;
  lastPoint = null;
  $('aperture').setPointerCapture(event.pointerId);
  paint(point(event), erasing || event.shiftKey);
});
$('aperture').addEventListener('pointermove', (event) => {
  if (drawing) paint(point(event), erasing || event.shiftKey);
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
    keyboard = true;
    const n = params.gridSize;
    cursor.x = Math.min(n - 1, Math.max(0, cursor.x + dirs[event.key][0]));
    cursor.y = Math.min(n - 1, Math.max(0, cursor.y + dirs[event.key][1]));
    renderMask(mask, n, cursor, ((Number($('brush').value) / 8) * n) / 2);
  } else if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    keyboard = true;
    lastPoint = null;
    paint(cursor, erasing || event.shiftKey);
    lastPoint = null;
  }
});
$('erase').addEventListener('click', () => {
  erasing = !erasing;
  $('erase').setAttribute('aria-pressed', erasing);
});
$('clear').addEventListener('click', () => {
  mask.fill(0);
  invalidateSweep();
  renderMask(mask, params.gridSize);
  requestCompute();
});
$('loadMask').addEventListener('click', () => $('maskFile').click());
$('maskFile').addEventListener('change', async () => {
  const file = $('maskFile').files[0];
  if (!file) return;
  let image;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error(t('imageLarge'));
    image = await createImageBitmap(file);
    if (image.width > 16384 || image.height > 16384)
      throw new Error('Image dimensions exceed 16384 pixels.');
    const n = params.gridSize,
      canvas = document.createElement('canvas');
    canvas.width = canvas.height = n;
    const context = canvas.getContext('2d'),
      scale = n / Math.max(image.width, image.height),
      w = image.width * scale,
      h = image.height * scale;
    context.drawImage(image, (n - w) / 2, (n - h) / 2, w, h);
    const pixels = context.getImageData(0, 0, n, n).data;
    mask = new Float32Array(n * n);
    for (let i = 0; i < mask.length; i++)
      mask[i] =
        Math.round(
          ((0.2126 * pixels[4 * i] + 0.7152 * pixels[4 * i + 1] + 0.0722 * pixels[4 * i + 2]) *
            pixels[4 * i + 3]) /
            255,
        ) / 255;
    change({ ...params, preset: 'custom' });
    notify(t('imageLoaded'));
  } catch (error) {
    notify(error.message, true);
  } finally {
    image?.close();
    $('maskFile').value = '';
  }
});
function restoreHash() {
  if (!location.hash) return;
  try {
    const data = decodeExperimentHash(location.hash);
    if (data) {
      view = data.view;
      change(data.params);
    }
  } catch {
    view = { ...DEFAULT_DISPLAY, spanMm: 2 };
    change(INITIAL);
    notify(t('badLink'), true);
  }
}
addEventListener('hashchange', restoreHash);
try {
  language = localStorage.getItem('wavebench-language') === 'zh' ? 'zh' : 'en';
} catch {}
setLanguage(language);
restoreHash();
requestCompute();
