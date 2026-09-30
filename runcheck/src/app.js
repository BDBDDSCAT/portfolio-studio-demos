import { makeReport, renderReportHTML } from './audit.js';

const $ = (id) => document.getElementById(id);
const words = {
  en: {
    subtitle: 'CSV quality checks for numerical experiments.', schemaReference: 'Schema reference', local: 'Local processing',
    intro: 'Audit types, ranges, keys, input order and conservation sums. Keep exact source hashes with the result.',
    csvTitle: '01 / CSV data', importCSV: 'Import CSV', csvLabel: 'CSV text', schemaTitle: '02 / Schema JSON', importSchema: 'Import schema', schemaLabel: 'Schema JSON text',
    delimiter: 'Delimiter', comma: 'Comma (,)', tab: 'Tab (⇥)', semicolon: 'Semicolon (;)', noGuess: 'Explicit selection; no guessing.',
    schemaHint: 'Schema v1: number / integer / string, nullable, bounds, enum, composite keys, grouped order and sums with absolute tolerance.',
    audit: 'Audit data', synthetic: 'Synthetic fixtures:', clean: 'Clean', broken: 'Broken', cap: 'Issue example cap',
    reportTitle: '03 / Audit report', downloadJSON: 'Download JSON', downloadHTML: 'Download HTML', inputHash: 'Input SHA-256', schemaHash: 'Schema SHA-256',
    hashNote: 'Uploaded files are hashed from their original bytes. Pasted text is hashed as UTF-8. Line endings and BOM change the hash.',
    profiles: 'Column profiles', profileNote: 'Finite values, including range failures. Sample standard deviation uses n−1.',
    column: 'Column', type: 'Type', valid: 'Valid', null: 'Null', invalid: 'Invalid', mean: 'Mean', std: 'Sample std.', issues: 'Issues', record: 'Record', sourceLine: 'Source line', code: 'Code', message: 'Message',
    recordNote: 'Data records start at 1; record 0 identifies header issues. Source line is the physical start line, including quoted multiline records. Counts remain exact when examples are capped.',
    footer: 'Read-only audit. Files stay in your browser; no account, upload service or runtime dependency.',
    records: 'Records', totalIssues: 'Total issues', affected: 'Affected records', outcome: 'Outcome', emptyIssues: 'No violations found.',
    ready: 'Ready to audit.', changed: 'Inputs changed. Run the audit again.', running: 'Auditing data and hashing original bytes…',
    sourcePaste: 'Pasted text · UTF-8 hash', sourceFile: 'Original file bytes', sourceFixture: 'Synthetic fixture · no measured data',
    result: (report) => `${report.passed ? 'PASS' : 'FAIL'} · ${report.counts.records} records · ${report.counts.issues} issues · ${report.counts.invalidRecords} affected records.`,
    retained: (report) => `${report.issues.length} / ${report.counts.issues} examples retained${report.issuesTruncated ? ' · capped' : ''}`,
    failure: (error) => `${error.name}: ${error.message}`, fallback: 'Bundled fixtures could not load. Serve this directory over localhost, or paste CSV and schema JSON.',
  },
  zh: {
    subtitle: '数值实验的 CSV 数据质检。', schemaReference: 'Schema 参考', local: '本地处理',
    intro: '检查类型、范围、键、原始记录顺序与守恒和，并随报告保留源文件的准确哈希。',
    csvTitle: '01 / CSV 数据', importCSV: '导入 CSV', csvLabel: 'CSV 文本', schemaTitle: '02 / Schema JSON', importSchema: '导入 Schema', schemaLabel: 'Schema JSON 文本',
    delimiter: '分隔符', comma: '逗号 (,)', tab: '制表符 (⇥)', semicolon: '分号 (;)', noGuess: '明确选择，不自动猜测。',
    schemaHint: 'Schema v1：数字 / 安全整数 / 字符串、空值、范围、枚举、组合键、分组顺序，以及使用绝对容差的求和规则。',
    audit: '检查数据', synthetic: '合成样例：', clean: '合格', broken: '含错误', cap: '问题示例上限',
    reportTitle: '03 / 质检报告', downloadJSON: '下载 JSON', downloadHTML: '下载 HTML', inputHash: '输入 SHA-256', schemaHash: 'Schema SHA-256',
    hashNote: '上传文件按原始字节计算哈希；粘贴文本按 UTF-8 计算。换行符与 BOM 均会改变哈希。',
    profiles: '列统计', profileNote: '统计所有有限数值，包括超出范围的数据。样本标准差的分母为 n−1。',
    column: '列', type: '类型', valid: '有效值', null: '空值', invalid: '类型错误', mean: '均值', std: '样本标准差', issues: '问题', record: '记录', sourceLine: '源行号', code: '错误码', message: '说明',
    recordNote: '数据记录从 1 开始，记录 0 表示表头问题。源行号为记录的实际起始行，包括带引号的多行记录。示例数量受限时，问题总数仍完整统计。',
    footer: '只读检查。文件留在浏览器中，无需账户、上传服务或运行时依赖。',
    records: '记录数', totalIssues: '问题总数', affected: '受影响记录', outcome: '结果', emptyIssues: '未发现违规。',
    ready: '可以开始检查。', changed: '输入已变化，请重新检查。', running: '正在检查数据并计算原始字节哈希…',
    sourcePaste: '粘贴文本 · UTF-8 哈希', sourceFile: '文件原始字节', sourceFixture: '合成样例 · 非实测数据',
    result: (report) => `${report.passed ? 'PASS' : 'FAIL'} · ${report.counts.records} 条记录 · ${report.counts.issues} 个问题 · ${report.counts.invalidRecords} 条受影响记录。`,
    retained: (report) => `展示 ${report.issues.length} / ${report.counts.issues} 个问题示例${report.issuesTruncated ? ' · 已达到上限' : ''}`,
    failure: (error) => `检查失败 / ${error.name}: ${error.message}`, fallback: '无法加载内置样例。请通过 localhost 提供此目录，或粘贴 CSV 和 Schema JSON。',
  },
};

let storedLanguage;
try { storedLanguage = localStorage.getItem('runcheck-language'); } catch { /* Storage is optional. */ }
const requestedLanguage = new URLSearchParams(location.search).get('lang');
let language = ['en', 'zh'].includes(requestedLanguage) ? requestedLanguage : storedLanguage === 'zh' ? 'zh' : 'en';
let inputBytes = null, schemaBytes = null, inputName = '', schemaName = '', synthetic = false;
let report = null, revision = 0, busy = false, lastError = null;
const t = () => words[language];
const decoder = new TextDecoder('utf-8', { fatal: true });

function status(text, kind = '') {
  $('status-message').textContent = text;
  $('status-message').className = kind;
}
function sourceMeta() {
  const meta = (bytes, name) => bytes
    ? `${synthetic ? t().sourceFixture : t().sourceFile} · ${name} · ${bytes.byteLength.toLocaleString()} bytes`
    : t().sourcePaste;
  $('input-meta').textContent = meta(inputBytes, inputName);
  $('schema-meta').textContent = meta(schemaBytes, schemaName);
}
function localize() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  $('language').value = language;
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t()[element.dataset.i18n];
  sourceMeta();
  if (report) render(report);
  else if (lastError) status(t().failure(lastError), 'error');
  else status(busy ? t().running : t().ready);
}
function invalidate() {
  revision += 1;
  report = null;
  lastError = null;
  $('report-area').hidden = true;
  $('download-json').disabled = true;
  $('download-html').disabled = true;
  sourceMeta();
  status(t().changed);
}
function cell(row, value) {
  const td = document.createElement('td');
  td.textContent = value === null || value === undefined ? '—' : String(value);
  row.append(td);
}
function number(value) {
  if (value === null) return '—';
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(7)));
}
function render(value) {
  $('report-area').hidden = false;
  $('download-json').disabled = false;
  $('download-html').disabled = false;
  $('report-summary').replaceChildren();
  const metrics = [[t().outcome, value.passed ? 'PASS' : 'FAIL', value.passed ? 'pass' : 'fail'], [t().records, value.counts.records], [t().totalIssues, value.counts.issues], [t().affected, value.counts.invalidRecords]];
  for (const [label, content, kind = ''] of metrics) {
    const box = document.createElement('div'); box.className = `metric ${kind}`;
    const name = document.createElement('span'); name.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = String(content);
    box.append(name, strong); $('report-summary').append(box);
  }
  $('input-hash').textContent = value.hashes.inputSha256;
  $('schema-hash').textContent = value.hashes.schemaSha256;
  const profiles = $('profiles-table').querySelector('tbody'); profiles.replaceChildren();
  for (const p of value.profiles) {
    const row = document.createElement('tr');
    for (const content of [p.column, p.type, p.count, p.nullCount, p.invalidCount, number(p.min), number(p.max), number(p.mean), number(p.stddev)]) cell(row, content);
    if (p.statisticsWarning) { row.title = p.statisticsWarning; row.lastChild.textContent = `${row.lastChild.textContent} ⚠`; }
    profiles.append(row);
  }
  const issues = $('issues-table').querySelector('tbody'); issues.replaceChildren();
  for (const issue of value.issues) {
    const row = document.createElement('tr');
    for (const content of [issue.record, issue.startLine, issue.column ?? 'record', issue.code, issue.message]) cell(row, content);
    issues.append(row);
  }
  if (value.issues.length === 0) {
    const row = document.createElement('tr'); cell(row, value.passed ? t().emptyIssues : t().retained(value)); row.firstChild.colSpan = 5; issues.append(row);
  }
  $('issue-cap-note').textContent = t().retained(value);
  status(t().result(value), value.passed ? 'success' : 'error');
}
async function audit() {
  if (busy) return;
  const token = revision;
  busy = true;
  $('audit-button').disabled = true;
  lastError = null;
  status(t().running);
  try {
    const result = await makeReport(inputBytes ?? $('csv-input').value, schemaBytes ?? $('schema-input').value, {
      delimiter: { comma: ',', tab: '\t', semicolon: ';' }[$('delimiter').value],
      maxIssues: Number($('max-issues').value),
    });
    if (token === revision) { report = result; render(report); }
  } catch (error) {
    if (token === revision) {
      report = null; lastError = error;
      $('report-area').hidden = true;
      $('download-json').disabled = true; $('download-html').disabled = true;
      status(t().failure(error), 'error');
    }
  } finally { busy = false; $('audit-button').disabled = false; }
}
async function loadSample(kind) {
  invalidate();
  const token = revision;
  try {
    const responses = await Promise.all([fetch(`./examples/${kind}.csv`), fetch('./examples/schema.json')]);
    if (responses.some((response) => !response.ok)) throw new Error(t().fallback);
    const data = await Promise.all(responses.map((response) => response.arrayBuffer()));
    if (token !== revision) return;
    inputBytes = new Uint8Array(data[0]); schemaBytes = new Uint8Array(data[1]);
    inputName = `${kind}.csv`; schemaName = 'schema.json'; synthetic = true;
    $('csv-input').value = decoder.decode(inputBytes); $('schema-input').value = decoder.decode(schemaBytes);
    $('csv-file').value = ''; $('schema-file').value = ''; $('delimiter').value = 'comma';
    sourceMeta();
    await audit();
  } catch (error) { if (token === revision) { lastError = error; status(t().failure(error), 'error'); } }
}
async function importFile(kind) {
  const file = $(`${kind}-file`).files[0];
  if (!file) return;
  invalidate();
  const token = revision;
  // A failed import must not leave an earlier dataset available for auditing.
  if (kind === 'csv') { inputBytes = null; inputName = ''; $('csv-input').value = ''; }
  else { schemaBytes = null; schemaName = ''; $('schema-input').value = ''; }
  sourceMeta();
  try {
    const raw = new Uint8Array(await file.arrayBuffer());
    const text = decoder.decode(raw);
    if (token !== revision) return;
    synthetic = false;
    if (kind === 'csv') { inputBytes = raw; inputName = file.name; $('csv-input').value = text; }
    else { schemaBytes = raw; schemaName = file.name; $('schema-input').value = text; }
    lastError = null; sourceMeta(); status(t().ready);
  } catch (error) { if (token === revision) { lastError = error; status(t().failure(error), 'error'); } }
}
function download(content, type, name) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('language').addEventListener('change', () => {
  language = $('language').value;
  try { localStorage.setItem('runcheck-language', language); } catch { /* Storage is optional. */ }
  localize();
});
$('csv-input').addEventListener('input', () => { inputBytes = null; synthetic = false; invalidate(); });
$('schema-input').addEventListener('input', () => { schemaBytes = null; synthetic = false; invalidate(); });
$('delimiter').addEventListener('change', invalidate);
$('max-issues').addEventListener('input', invalidate);
$('csv-file').addEventListener('change', () => importFile('csv'));
$('schema-file').addEventListener('change', () => importFile('schema'));
$('sample-clean').addEventListener('click', () => loadSample('clean'));
$('sample-broken').addEventListener('click', () => loadSample('broken'));
$('audit-button').addEventListener('click', audit);
$('download-json').addEventListener('click', () => { if (report) download(JSON.stringify(report, null, 2), 'application/json', 'runcheck-report.json'); });
$('download-html').addEventListener('click', () => { if (report) download(renderReportHTML(report), 'text/html', 'runcheck-report.html'); });
localize();
loadSample('clean');
