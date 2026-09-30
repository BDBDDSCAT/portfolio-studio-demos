import { evaluateTrace } from './fit.js';
import { parseCsv, selectTrace, buildFitReport, resultToCsv } from './csv.js';

const $ = (id) => document.getElementById(id);
let language = 'en', table, source, result = null, samples = [], requestId = 0, uploadVersion = 0, busy = false;
try { language = localStorage.getItem('tracefit.language') === 'zh' ? 'zh' : 'en'; } catch {}
let worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let workerFailed = false;
function restartWorker() {
  worker.terminate(); worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  workerFailed = false;
  worker.onmessage = onWorkerMessage; worker.onerror = onWorkerError;
}
const strings = {
  en: {
    documentation: 'Documentation', eyebrow: 'SIGNAL ANALYSIS / CONSTRAINED NONLINEAR FITTING', title: 'Fit the signal.<br>Inspect what remains.', lede: 'Gaussian and Lorentzian peaks with an affine baseline. Inspect residuals, convergence, and local parameter uncertainty in one place.', local: 'Local processing', positive: '1–3 positive peaks', weighted: 'Optional σ weighting', input: 'Input trace', upload: 'Open CSV', uploadDetail: 'Named columns · comma separated', examples: 'SYNTHETIC EXAMPLES', doublet: 'Doublet', xColumn: 'x column', yColumn: 'y column', sigmaColumn: 'Known y uncertainty σ', modelHeading: 'Fit model', model: 'Peak shape', peaks: 'Peak count', run: 'Run fit ↗', privacy: 'Your CSV stays in this browser. Data is never sent to a server.', samples: 'SAMPLES', dof: 'DEGREES OF FREEDOM', uncertainty: 'LOCAL COVARIANCE', signal: 'Observed & fitted', observed: 'Observed', fitted: 'Fit', residuals: 'Residuals', residualDefinition: 'observed − fitted', parameters: 'Parameters & uncertainty', parameter: 'Parameter', estimate: 'Estimate', standardError: 'Local standard error', footer: 'Convergence is a numerical status. Residuals and model assumptions still need inspection.', limitations: 'Model & statistical limits ↗', none: 'None — estimate residual variance', synthetic: 'Synthetic', uploaded: 'Uploaded', pending: 'Ready to fit. Parameters have changed.', fitting: 'Fitting…', converged: 'Converged', failed: 'NOT CONVERGED — inspect diagnostics', valid: 'VALID', invalid: 'INVALID', empty: 'Choose a trace and run a fit.', gaussianNote: 'Gaussian width = standard deviation σ. Baseline = offset + slope × (x − reference).', lorentzianNote: 'Lorentzian width = half width at half maximum. Baseline = offset + slope × (x − reference).', scaled: 'Local covariance is scaled by RSS / degrees of freedom. Assumes independent residuals with equal variance.', known: 'Known-error covariance uses the supplied σ values as absolute standard deviations. Assumes independent measurement errors.', invalidCov: 'Uncertainty is unavailable for this fit. Standard errors are intentionally blank; inspect diagnostics.', rows: 'samples', zero: 'Run a fit to inspect residuals.', syntheticDetail: 'deterministic generated data, not an experimental measurement',
  },
  zh: {
    documentation: '文档', eyebrow: '信号分析 / 有约束非线性拟合', title: '拟合信号。<br>检视剩余误差。', lede: '高斯峰与洛伦兹峰，搭配仿射基线。在同一界面检查残差、收敛状态与局部参数不确定度。', local: '本地计算', positive: '1–3 个正峰', weighted: '可选 σ 加权', input: '输入曲线', upload: '打开 CSV', uploadDetail: '具名列 · 逗号分隔', examples: '合成数据示例', doublet: '双峰', xColumn: 'x 数据列', yColumn: 'y 数据列', sigmaColumn: '已知 y 标准差 σ', modelHeading: '拟合模型', model: '峰形', peaks: '峰数量', run: '开始拟合 ↗', privacy: 'CSV 只在当前浏览器处理，不会发送到服务器。', samples: '样本数量', dof: '自由度', uncertainty: '局部协方差', signal: '观测与拟合', observed: '观测', fitted: '拟合', residuals: '残差', residualDefinition: '观测值 − 拟合值', parameters: '参数与不确定度', parameter: '参数', estimate: '估计值', standardError: '局部标准误', footer: '收敛是数值状态。仍需检查残差与模型假设。', limitations: '模型与统计限制 ↗', none: '不使用 — 根据残差估计方差', synthetic: '合成数据', uploaded: '已上传', pending: '参数已更新，可以开始拟合。', fitting: '拟合中…', converged: '已收敛', failed: '未收敛 — 请检查诊断信息', valid: '有效', invalid: '无效', empty: '选择曲线并运行拟合。', gaussianNote: '高斯宽度 = 标准差 σ。基线 = 偏移 + 斜率 × (x − 参考位置)。', lorentzianNote: '洛伦兹宽度 = 半高半宽。基线 = 偏移 + 斜率 × (x − 参考位置)。', scaled: '局部协方差按 RSS / 自由度缩放；假设残差独立且方差相同。', known: '已知误差协方差把输入 σ 视为绝对标准差；假设测量误差相互独立。', invalidCov: '该拟合的不确定度不可用。标准误保留为空，请检查诊断信息。', rows: '个样本', zero: '运行拟合后检查残差。', syntheticDetail: '确定性生成数据，非真实实验测量',
  },
};
const t = (key) => strings[language][key];
const format = (value) => Number.isFinite(value) ? (value === 0 ? '0' : value.toPrecision(5)) : '—';
const columns = () => ({ x: $('x-column').value, y: $('y-column').value, sigma: $('sigma-column').value || null });

function status(text, kind = '') { $('fit-status').textContent = text; $('fit-status').className = `status ${kind}`; }
function invalidate() {
  if (busy) {
    restartWorker();
  }
  requestId += 1; result = null; busy = false; $('fit-button').disabled = false;
  $('export-csv').disabled = $('export-json').disabled = true;
  $('metric-rmse').textContent = $('metric-dof').textContent = $('metric-covariance').textContent = '—';
  $('parameter-table').querySelector('tbody').replaceChildren(); $('warning-list').replaceChildren();
  $('covariance-note').textContent = '';
  $('model-note').textContent = t($('model').value === 'gaussian' ? 'gaussianNote' : 'lorentzianNote');
  try { samples = selectTrace(table, columns()); $('metric-samples').textContent = samples.length; status(t('pending')); }
  catch (error) { samples = []; $('metric-samples').textContent = '—'; status(error.message, 'error'); }
  $('fit-button').disabled = samples.length === 0;
  draw();
}

function setTable(next, label, synthetic = false) {
  uploadVersion += 1;
  table = next; source = { label, synthetic };
  for (const id of ['x-column', 'y-column', 'sigma-column']) {
    const select = $(id); select.replaceChildren();
    if (id === 'sigma-column') select.append(new Option(t('none'), ''));
    for (const column of table.columns) select.append(new Option(column, column));
  }
  $('x-column').value = table.columns[0]; $('y-column').value = table.columns[1]; $('sigma-column').value = '';
  updateSource(); invalidate();
}
function updateSource() {
  $('source-label').textContent = `${source.synthetic ? t('synthetic') : t('uploaded')}: ${source.label}${source.synthetic ? ` — ${t('syntheticDetail')}` : ''}`;
}
function randomGenerator(seed) {
  return () => { seed = (1664525 * seed + 1013904223) >>> 0; return (seed + 1) / 4294967297; };
}
function synthetic(kind) {
  const rand = randomGenerator(75203), lines = ['wavelength_nm,intensity,sigma_y'];
  for (let i = 0; i <= 160; i += 1) {
    const x = 420 + 300 * i / 160, noise = 0.012 * Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand());
    let y;
    if (kind === 'doublet') y = 0.10 + 0.0002 * (x - 570) + 0.95 * Math.exp(-0.5 * ((x - 525) / 17) ** 2) + 0.72 * Math.exp(-0.5 * ((x - 574) / 22) ** 2);
    else if (kind === 'lorentzian') y = 0.1 - 0.00012 * (x - 570) + 1.1 / (1 + ((x - 563) / 14) ** 2);
    else y = 0.16 + 0.0005 * (x - 570) + 1.25 * Math.exp(-0.5 * ((x - 545) / 18) ** 2);
    lines.push(`${x},${y + noise},0.012`);
  }
  $('model').value = kind === 'lorentzian' ? 'lorentzian' : 'gaussian';
  $('peak-count').value = kind === 'doublet' ? '2' : '1';
  setTable(parseCsv(lines.join('\n')), kind, true);
}

function run() {
  if (!samples.length || busy) return;
  invalidate();
  if (workerFailed) restartWorker();
  const id = ++requestId; busy = true; result = null;
  $('fit-button').disabled = true; $('export-csv').disabled = $('export-json').disabled = true;
  status(t('fitting'));
  worker.postMessage({ id, samples, options: { model: $('model').value, peaks: Number($('peak-count').value), maxIterations: 150, multiStarts: 5 } });
}
function onWorkerMessage({ data }) {
  if (data.id !== requestId) return;
  busy = false; $('fit-button').disabled = false;
  if (data.error) { status(data.error, 'error'); return; }
  result = data.result; displayResult(); draw();
}
function onWorkerError(error) {
  worker.terminate(); workerFailed = true; busy = false;
  invalidate(); status(error.message || 'The numerical worker failed. Run the fit again to retry.', 'error');
}
worker.onmessage = onWorkerMessage;
worker.onerror = onWorkerError;

function displayResult() {
  status(`${result.converged ? t('converged') : t('failed')} · ${result.iterations} iterations`, result.converged ? 'success' : 'error');
  $('metric-rmse').textContent = format(result.statistics.rmse); $('metric-dof').textContent = result.statistics.dof;
  $('metric-covariance').textContent = t(result.covariance.valid ? 'valid' : 'invalid');
  const tbody = $('parameter-table').querySelector('tbody'); tbody.replaceChildren();
  for (const parameter of result.parameterTable) {
    const row = document.createElement('tr');
    for (const value of [parameter.name, format(parameter.value), result.covariance.valid ? format(parameter.standardError) : '—']) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    tbody.append(row);
  }
  $('warning-list').replaceChildren();
  for (const warning of result.warnings) {
    const p = document.createElement('p'); p.textContent = `[${warning.code}] ${warning.message}`; $('warning-list').append(p);
  }
  $('covariance-note').textContent = result.covariance.valid ? t(result.covariance.mode === 'known-sigma' ? 'known' : 'scaled') : t('invalidCov');
  $('export-csv').disabled = $('export-json').disabled = false;
}

function chart(canvas, residual = false) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const margin = { left: 51, right: 16, top: 15, bottom: 31 }, pw = width - margin.left - margin.right, ph = height - margin.top - margin.bottom;
  if (!samples.length || (residual && !result)) {
    ctx.fillStyle = '#91a2b5'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(t(residual ? 'zero' : 'empty'), width / 2, height / 2); return;
  }
  const data = result?.samples ?? samples, xmin = data[0].x, xmax = data.at(-1).x;
  let ymin = Infinity, ymax = -Infinity;
  for (const sample of data) { const y = residual ? sample.residual : sample.y; ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); if (result && !residual) { ymin = Math.min(ymin, sample.fitted); ymax = Math.max(ymax, sample.fitted); } }
  if (residual) { const extent = Math.max(Math.abs(ymin), Math.abs(ymax), 1e-8); ymin = -extent; ymax = extent; }
  const padding = Math.max((ymax - ymin) * 0.12, Math.abs(ymax) * 0.01, 1e-10); ymin -= padding; ymax += padding;
  const px = (x) => margin.left + (x - xmin) / (xmax - xmin || 1) * pw, py = (y) => margin.top + (ymax - y) / (ymax - ymin) * ph;
  ctx.font = '9px ui-monospace, monospace'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const x = xmin + (xmax - xmin) * i / 4, y = ymin + (ymax - ymin) * i / 4;
    ctx.strokeStyle = '#263547'; ctx.beginPath(); ctx.moveTo(px(x), margin.top); ctx.lineTo(px(x), margin.top + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(margin.left, py(y)); ctx.lineTo(margin.left + pw, py(y)); ctx.stroke();
    ctx.fillStyle = '#91a2b5'; ctx.textAlign = 'center'; ctx.fillText(Number(x.toPrecision(4)).toString(), px(x), height - 9);
    ctx.textAlign = 'right'; ctx.fillText(Number(y.toPrecision(3)).toString(), margin.left - 8, py(y) + 3);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(margin.left, margin.top, pw, ph); ctx.clip();
  if (residual) { ctx.strokeStyle = '#71879b'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(margin.left, py(0)); ctx.lineTo(margin.left + pw, py(0)); ctx.stroke(); ctx.setLineDash([]); }
  ctx.fillStyle = residual ? '#bca3e9' : '#8db6ee';
  const stride = Math.max(1, Math.floor(data.length / 3000));
  for (let i = 0; i < data.length; i += stride) { const sample = data[i]; ctx.beginPath(); ctx.arc(px(sample.x), py(residual ? sample.residual : sample.y), residual ? 1.7 : 2.1, 0, Math.PI * 2); ctx.fill(); }
  if (result && !residual) {
    ctx.strokeStyle = result.converged ? '#71d5c0' : '#ffbc77'; ctx.lineWidth = 1.8; ctx.beginPath();
    for (let i = 0; i <= 700; i += 1) { const x = xmin + (xmax - xmin) * i / 700, y = evaluateTrace(x, result.parameters, result.model); if (i === 0) ctx.moveTo(px(x), py(y)); else ctx.lineTo(px(x), py(y)); }
    ctx.stroke();
  }
  ctx.restore();
}
function draw() { chart($('fit-chart')); chart($('residual-chart'), true); $('axis-description').textContent = `${columns().x} → ${columns().y}`; }
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('fit-button').addEventListener('click', run);
for (const id of ['x-column', 'y-column', 'sigma-column', 'model', 'peak-count']) $(id).addEventListener('change', invalidate);
for (const kind of ['gaussian', 'doublet', 'lorentzian']) $(`sample-${kind}`).addEventListener('click', () => synthetic(kind));
$('csv-upload').addEventListener('change', async ({ target }) => {
  const file = target.files[0]; if (!file) return;
  const token = ++uploadVersion;
  table = null; source = { label: file.name, synthetic: false }; updateSource(); invalidate();
  status(language === 'zh' ? '正在读取 CSV…' : 'Reading CSV…');
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('CSV exceeds the 20 MB limit.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    if (token !== uploadVersion) return;
    setTable(parseCsv(text), file.name);
  } catch (error) { if (token === uploadVersion) status(error.message, 'error'); }
  target.value = '';
});
$('export-csv').addEventListener('click', () => { if (result) download('tracefit-fitted.csv', resultToCsv(result), 'text/csv'); });
$('export-json').addEventListener('click', () => { if (result) download('tracefit-report.json', JSON.stringify(buildFitReport(result, { columns: columns(), source: source.synthetic ? `synthetic:${source.label}` : source.label }), null, 2), 'application/json'); });
function applyLanguage() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  $('language-toggle').textContent = language === 'en' ? '中文' : 'EN';
  for (const element of document.querySelectorAll('[data-i18n]')) element.innerHTML = t(element.dataset.i18n);
  $('sigma-column').options[0].textContent = t('none'); updateSource();
  $('model-note').textContent = t($('model').value === 'gaussian' ? 'gaussianNote' : 'lorentzianNote');
  if (result) displayResult(); else if (busy) status(t('fitting')); else invalidate();
  draw();
}
$('language-toggle').addEventListener('click', () => {
  language = language === 'en' ? 'zh' : 'en';
  try { localStorage.setItem('tracefit.language', language); } catch {}
  applyLanguage();
});
new ResizeObserver(draw).observe($('fit-chart'));
synthetic('gaussian'); applyLanguage(); run();
