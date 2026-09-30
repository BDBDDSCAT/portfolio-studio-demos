import {
  solveStack,
  wavelengthScan,
  angleScan,
  validateStack,
  scanToCsv,
} from "./thinfilm.js";

const $ = (id) => document.getElementById(id);
const translations = {
  zh: {
    skip: "跳到工作台",
    portfolio: "作品集",
    heading: "薄膜光学工作台",
    description:
      "从一个界面到多层干涉。编辑膜系，检查能量，导出可复现的数值结果。",
    initializing: "正在初始化…",
    stackTitle: "膜系 / 从上到下",
    coherent: "相干模型",
    example: "载入示例",
    presetAr: "λ/4 单层增透膜 · 550 nm",
    presetInterface: "空气 / 玻璃单界面",
    presetBragg: "Bragg 反射镜 · 8 对膜层",
    presetAbsorber: "吸收薄膜 · k > 0",
    presetCustom: "自定义膜系",
    incident: "入射介质 n₀",
    substrate: "基底 nₛ",
    tableCaption: "按入射光方向排列的薄膜层",
    remove: "移除",
    addLayer: "+ 添加膜层",
    layerHelp:
      "n 为折射率，k ≥ 0 为消光系数；d 为物理厚度。入射介质与基底为半无限、无吸收介质。",
    filesTitle: "可复现的膜系",
    exportStack: "导出膜系",
    importStack: "导入膜系",
    filesHelp:
      "所有计算都在本地浏览器中完成。JSON 保留介质参数和每一层的 n、k、d。",
    scanTitle: "参数扫描",
    scanMode: "扫描变量",
    modeWavelength: "波长 λ",
    modeAngle: "入射角 θ",
    samples: "采样点数",
    wavelength: "参考波长 / nm",
    angle: "参考入射角 / °",
    polarization: "偏振",
    unpolarized: "非偏振 · (s + p) / 2",
    sPolarization: "s · 电场垂直入射面",
    pPolarization: "p · 电场平行入射面",
    compute: "计算扫描",
    response: "功率响应",
    reflectance: "反射率",
    transmittance: "透射率",
    absorption: "吸收率",
    emptyChart: "输入有效参数后计算扫描。",
    chartHelp:
      "移动指针查看采样点；聚焦图表后按 ← / →。显示功率比例 R / T / A。",
    referenceTitle: "参考点",
    exportHelp: "保留原始精度 · 每个采样点都有 λ、θ、R、T、A",
    downloadCsv: "↓ 扫描 CSV",
    exportResult: "↓ 完整结果 JSON",
    modelTitle: "明确模型边界",
    modelNote:
      "平面波、均匀各向同性膜层、完全相干的多层干涉。每层 n 与 k 在整个扫描区间内固定；不包含材料色散、粗糙度或非相干厚基底。非偏振结果为 s、p 功率响应的算术平均。",
    energyNote:
      "R、T 为入射功率的比例，T 包含介质与传播角的通量因子。A = 1 − R − T。扫描网格离散，极值只对应已采样点。",
    footer: "薄膜干涉 · 数值可查",
    source: "源代码 / API / CLI ↗",
    arNote: "n = √(n₀nₛ)，d = λ₀ / 4n。在 550 nm、正入射时消除单层反射。",
    interfaceNote:
      "无膜层的 Fresnel 界面。切换角度扫描与 p 偏振，查看 Brewster 角附近的反射零点。",
    braggNote:
      "n = 2.1 / 1.45 的高、低折射率膜层交替。每层在 550 nm 的光学厚度为 λ/4。",
    absorberNote:
      "n = 2，k = 0.5，厚度 300 nm。观察吸收如何改变反射与透射的能量分配。",
    customNote: "按照入射光的传播方向编辑膜层。膜层顺序会改变干涉响应。",
    noLayers: "无膜层 · 直接计算两个介质的界面",
    layers: "层",
    layer: "膜层",
    startNm: "起点 / nm",
    stopNm: "终点 / nm",
    startDeg: "起点 / °",
    stopDeg: "终点 / °",
    wavelengthHelp:
      "固定参考入射角，均匀采样波长。参考波长用于下方的独立单点计算。",
    angleHelp:
      "固定参考波长，均匀采样 0–85° 内的入射角。参考入射角用于下方的独立单点计算。",
    pending: "参数已变更…",
    running: "计算中…",
    ready: "扫描完成",
    error: "参数错误",
    invalidNumber: "请输入有效数值",
    positive: "必须大于 0",
    nonnegative: "必须大于或等于 0",
    angleRange: "角度必须在 0–85° 之间",
    pointsRange: "采样点数必须为 1–2001 的整数",
    scanRange: "终点必须大于或等于起点",
    invalidImport: "无法导入膜系",
    fileTooLarge: "JSON 文件不得超过 10 MB",
    rMin: "最小 R",
    rMax: "最大 R",
    aMax: "最大 A",
    at: "位于",
    totalD: "膜层总厚度",
    validNote: "恒定折射率模型 · 原始功率响应 · 极值仅对应采样网格",
    chartAria: "反射率、透射率、吸收率扫描。使用左右方向键查看采样点。",
    axisWavelength: "波长 λ / nm",
    axisAngle: "入射角 θ / °",
    axisPower: "功率比例",
    scanDescription:
      "扫描包含 {points} 个采样点。反射率范围为 {min} 至 {max}。",
    stackAria: "入射介质，{layers} 层薄膜，基底；从左到右表示传播方向。",
    errorTitle: "计算失败，请检查参数。",
  },
  en: {
    skip: "Skip to instrument",
    portfolio: "Portfolio",
    heading: "Thin-film optics workbench",
    description:
      "From a single interface to multilayer interference. Edit stacks, inspect energy, export reproducible results.",
    initializing: "Initializing…",
    stackTitle: "Stack / top to bottom",
    coherent: "COHERENT",
    example: "Load example",
    presetAr: "λ/4 antireflection · 550 nm",
    presetInterface: "Air / glass interface",
    presetBragg: "Bragg mirror · 8 layer pairs",
    presetAbsorber: "Absorbing film · k > 0",
    presetCustom: "Custom stack",
    incident: "Incident medium n₀",
    substrate: "Substrate nₛ",
    tableCaption: "Thin-film layers in the direction of propagation",
    remove: "Remove",
    addLayer: "+ Add layer",
    layerHelp:
      "n is the refractive index, k ≥ 0 the extinction coefficient, and d the physical thickness. Incident and substrate media are semi-infinite and lossless.",
    filesTitle: "Reproducible stack",
    exportStack: "Export stack",
    importStack: "Import stack",
    filesHelp:
      "All calculations run locally in your browser. JSON preserves the media and each layer’s n, k, and d.",
    scanTitle: "Parameter scan",
    scanMode: "Scan variable",
    modeWavelength: "Wavelength λ",
    modeAngle: "Incidence angle θ",
    samples: "Sample points",
    wavelength: "Reference λ / nm",
    angle: "Reference θ / °",
    polarization: "Polarization",
    unpolarized: "Unpolarized · (s + p) / 2",
    sPolarization: "s · perpendicular E",
    pPolarization: "p · parallel E",
    compute: "Run scan",
    response: "Power response",
    reflectance: "Reflectance",
    transmittance: "Transmittance",
    absorption: "Absorption",
    emptyChart: "Enter valid parameters to compute a scan.",
    chartHelp:
      "Point to inspect a sample; focus the chart and use ← / →. Power fractions R / T / A.",
    referenceTitle: "Reference point",
    exportHelp: "Original precision · λ, θ, R, T, A at every sample",
    downloadCsv: "↓ Scan CSV",
    exportResult: "↓ Full result JSON",
    modelTitle: "Know the model limits",
    modelNote:
      "Plane waves, homogeneous isotropic layers, fully coherent multilayer interference. Each layer’s n and k are constant across the scan. Material dispersion, roughness, and incoherent thick substrates are excluded. Unpolarized results average the s and p power responses.",
    energyNote:
      "R and T are fractions of incident power; T includes the medium and propagation-angle flux factor. A = 1 − R − T. Extrema refer to the discrete sample grid.",
    footer: "Thin-film interference · inspectable numerics",
    source: "Source / API / CLI ↗",
    arNote:
      "n = √(n₀nₛ), d = λ₀ / 4n. Cancels the single-layer reflection at 550 nm and normal incidence.",
    interfaceNote:
      "A bare Fresnel interface. Switch to an angle scan and p polarization to inspect the reflectance minimum near the Brewster angle.",
    braggNote:
      "Alternating high / low index layers, n = 2.1 / 1.45. Each layer has a λ/4 optical thickness at 550 nm.",
    absorberNote:
      "n = 2, k = 0.5, thickness 300 nm. Inspect how absorption changes the balance of reflected and transmitted power.",
    customNote:
      "Edit layers in the direction of propagation. Layer order changes the interference response.",
    noLayers: "No films · a direct interface between two media",
    layers: "layers",
    layer: "Layer",
    startNm: "Start / nm",
    stopNm: "Stop / nm",
    startDeg: "Start / °",
    stopDeg: "Stop / °",
    wavelengthHelp:
      "Scan wavelength at a fixed reference angle. The reference wavelength is used for the independent single-point calculation below.",
    angleHelp:
      "Scan incidence angle between 0–85° at a fixed reference wavelength. The reference angle is used for the independent single-point calculation below.",
    pending: "Parameters changed…",
    running: "Computing…",
    ready: "Scan complete",
    error: "Invalid parameters",
    invalidNumber: "Enter a valid number",
    positive: "Must be greater than zero",
    nonnegative: "Must be zero or positive",
    angleRange: "Angles must be between 0–85°",
    pointsRange: "Sample points must be an integer from 1–2001",
    scanRange: "Stop must be greater than or equal to start",
    invalidImport: "Unable to import stack",
    fileTooLarge: "JSON file must be no larger than 10 MB",
    rMin: "Min R",
    rMax: "Max R",
    aMax: "Max A",
    at: "at",
    totalD: "Total thickness",
    validNote:
      "Constant-index model · raw power response · extrema on the sample grid",
    chartAria:
      "Reflectance, transmittance, and absorption scan. Use left and right arrow keys to inspect samples.",
    axisWavelength: "Wavelength λ / nm",
    axisAngle: "Incidence angle θ / °",
    axisPower: "Power fraction",
    scanDescription:
      "The scan contains {points} samples. Reflectance ranges from {min} to {max}.",
    stackAria:
      "Incident medium, {layers} thin-film layers, and substrate; propagation is from left to right.",
    errorTitle: "Calculation failed. Check the parameters.",
  },
};

let language = "zh";
try {
  language = localStorage.getItem("thinfilm-language") === "en" ? "en" : "zh";
} catch {
  /* Storage is optional. */
}
const t = (key) => translations[language][key] ?? key;
const state = {
  layers: [],
  preset: "bragg",
  result: null,
  probeIndex: 0,
  hover: false,
  error: "",
  generation: 0,
  pending: false,
};
const arIndex = Math.sqrt(1.5);
const presets = {
  ar: {
    incident: 1,
    substrate: 1.5,
    layers: [{ n: arIndex, k: 0, dNm: 550 / (4 * arIndex) }],
  },
  interface: { incident: 1, substrate: 1.5, layers: [] },
  bragg: {
    incident: 1,
    substrate: 1.5,
    layers: Array.from({ length: 16 }, (_, i) => ({
      n: i % 2 === 0 ? 2.1 : 1.45,
      k: 0,
      dNm: 550 / (4 * (i % 2 === 0 ? 2.1 : 1.45)),
    })),
  },
  absorber: {
    incident: 1,
    substrate: 1.5,
    layers: [{ n: 2, k: 0.5, dNm: 300 }],
  },
};
const colors = { R: "#79b8ff", T: "#7ed4c0", A: "#e7b969" };
let debounceTimer;
let plot = null;

function format(value, digits = 6) {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  if (Math.abs(value) < 0.0001 || Math.abs(value) >= 100000)
    return value.toExponential(3);
  return Number(value.toPrecision(digits)).toString();
}

function status(key, type = "") {
  $("status").textContent = t(key);
  $("status-dot").className = type;
}

function updateLanguage() {
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.title =
    language === "zh"
      ? "Thinfilm — 薄膜光学工作台"
      : "Thinfilm — Thin-film optics workbench";
  for (const element of document.querySelectorAll("[data-i18n]"))
    element.textContent = t(element.dataset.i18n);
  $("language").textContent = language === "zh" ? "EN" : "中文";
  $("language").setAttribute(
    "aria-label",
    language === "zh" ? "Switch to English" : "切换中文",
  );
  $("chart").setAttribute("aria-label", t("chartAria"));
  renderLayers();
  updateScanLabels();
  updatePresetNote();
  if (state.result) {
    renderResult();
    status(state.pending ? "pending" : "ready", state.pending ? "busy" : "");
  } else if (state.error) {
    status("error", "error");
    $("diagnostic").textContent = `${t("errorTitle")} ${state.error}`;
  } else status(state.pending ? "pending" : "initializing", state.pending ? "busy" : "");
}

function updatePresetNote() {
  $("preset-note").textContent = t(`${state.preset}Note`);
  $("preset").value = state.preset;
}

function renderLayers() {
  const body = $("layer-table").tBodies[0];
  body.replaceChildren();
  if (!state.layers.length) {
    const row = document.createElement("tr");
    row.className = "no-layers";
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = t("noLayers");
    row.append(cell);
    body.append(row);
  }
  state.layers.forEach((layer, index) => {
    const row = document.createElement("tr");
    const number = document.createElement("td");
    number.textContent = String(index + 1);
    row.append(number);
    for (const field of ["n", "k", "dNm"]) {
      const cell = document.createElement("td");
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.min = field === "n" ? "0.000001" : "0";
      input.value = String(layer[field]);
      input.title = String(layer[field]);
      input.dataset.index = String(index);
      input.dataset.field = field;
      input.setAttribute(
        "aria-label",
        `${t("layer")} ${index + 1} ${field === "dNm" ? "d / nm" : field}`,
      );
      cell.append(input);
      row.append(cell);
    }
    const cell = document.createElement("td");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-layer";
    remove.textContent = "×";
    remove.dataset.remove = String(index);
    remove.setAttribute(
      "aria-label",
      `${t("remove")} ${t("layer")} ${index + 1}`,
    );
    remove.title = remove.getAttribute("aria-label");
    cell.append(remove);
    row.append(cell);
    body.append(row);
  });
  $("layer-count").textContent = `${state.layers.length} ${t("layers")}`;
  $("add-layer").disabled = state.layers.length >= 128;
  renderStackVisual();
}

function renderStackVisual() {
  const visual = $("stack-visual");
  visual.replaceChildren();
  const incident = document.createElement("span");
  incident.className = "visual-medium";
  incident.textContent = "n₀";
  visual.append(incident);
  if (!state.layers.length) {
    const gap = document.createElement("span");
    gap.className = "visual-gap";
    gap.textContent = "INTERFACE";
    visual.append(gap);
  }
  state.layers.forEach((layer, i) => {
    const segment = document.createElement("span");
    segment.className = "visual-layer";
    segment.textContent = state.layers.length <= 16 ? String(i + 1) : "";
    segment.title = `${t("layer")} ${i + 1}: n=${layer.n}, k=${layer.k}, d=${layer.dNm} nm`;
    visual.append(segment);
  });
  const substrate = document.createElement("span");
  substrate.className = "visual-medium";
  substrate.textContent = "nₛ";
  visual.append(substrate);
  visual.setAttribute(
    "aria-label",
    t("stackAria").replace("{layers}", String(state.layers.length)),
  );
}

function setStack(stack, preset = "custom") {
  const valid = validateStack(stack);
  $("incident").value = String(valid.incident);
  $("substrate").value = String(valid.substrate);
  state.layers = valid.layers.map((layer) => ({ ...layer }));
  state.preset = preset;
  renderLayers();
  updatePresetNote();
}

function readNumber(input, condition, message) {
  const value = input.value.trim() === "" ? NaN : Number(input.value);
  if (!Number.isFinite(value) || !condition(value)) {
    input.setAttribute("aria-invalid", "true");
    const name =
      input.getAttribute("aria-label") ||
      document.querySelector(`label[for="${input.id}"]`)?.textContent ||
      input.id;
    throw new RangeError(
      `${name}: ${Number.isFinite(value) ? message : t("invalidNumber")}`,
    );
  }
  return value;
}

function readStack() {
  const incident = readNumber(
    $("incident"),
    (value) => value > 0,
    t("positive"),
  );
  const substrate = readNumber(
    $("substrate"),
    (value) => value > 0,
    t("positive"),
  );
  const layers = state.layers.map((_, index) => {
    const layer = {};
    for (const field of ["n", "k", "dNm"]) {
      const input = $("layer-table").querySelector(
        `input[data-index="${index}"][data-field="${field}"]`,
      );
      layer[field] = readNumber(
        input,
        (value) => (field === "n" ? value > 0 : value >= 0),
        t(field === "n" ? "positive" : "nonnegative"),
      );
    }
    return layer;
  });
  return validateStack({ incident, substrate, layers });
}

function readConfig() {
  const kind = $("scan-mode").value,
    angleValue = (value) => value >= 0 && value <= 85;
  const start = readNumber(
    $("start"),
    kind === "wavelength" ? (value) => value > 0 : angleValue,
    t(kind === "wavelength" ? "positive" : "angleRange"),
  );
  const stop = readNumber(
    $("stop"),
    kind === "wavelength" ? (value) => value > 0 : angleValue,
    t(kind === "wavelength" ? "positive" : "angleRange"),
  );
  if (stop < start) {
    $("stop").setAttribute("aria-invalid", "true");
    throw new RangeError(t("scanRange"));
  }
  return {
    kind,
    start,
    stop,
    points: readNumber(
      $("points"),
      (value) => Number.isInteger(value) && value >= 1 && value <= 2001,
      t("pointsRange"),
    ),
    wavelengthNm: readNumber(
      $("wavelength"),
      (value) => value > 0,
      t("positive"),
    ),
    angleDeg: readNumber($("angle"), angleValue, t("angleRange")),
    polarization: $("polarization").value,
  };
}

function updateScanLabels() {
  const wavelength = $("scan-mode").value === "wavelength";
  $("start-label").textContent = t(wavelength ? "startNm" : "startDeg");
  $("stop-label").textContent = t(wavelength ? "stopNm" : "stopDeg");
  for (const id of ["start", "stop"]) {
    $(id).min = wavelength ? "0.000001" : "0";
    if (wavelength) $(id).removeAttribute("max");
    else $(id).max = "85";
  }
  $("scan-tag").textContent = wavelength ? "WAVELENGTH" : "ANGLE";
  $("scan-help").textContent = t(wavelength ? "wavelengthHelp" : "angleHelp");
}

function customStack() {
  state.preset = "custom";
  updatePresetNote();
}

function scheduleCompute(immediate = false) {
  clearTimeout(debounceTimer);
  state.pending = true;
  $("download-csv").disabled = true;
  $("export-result").disabled = true;
  status("pending", "busy");
  if (immediate) compute();
  else debounceTimer = setTimeout(compute, 180);
}

function compute() {
  clearTimeout(debounceTimer);
  const generation = ++state.generation;
  status("running", "busy");
  requestAnimationFrame(() => {
    if (generation !== state.generation) return;
    for (const input of document.querySelectorAll("[aria-invalid]"))
      input.removeAttribute("aria-invalid");
    const startTime = performance.now();
    try {
      const stack = readStack(),
        config = readConfig();
      const reference = solveStack(stack, {
        wavelengthNm: config.wavelengthNm,
        angleDeg: config.angleDeg,
        polarization: config.polarization,
      });
      const scanOptions =
        config.kind === "wavelength"
          ? {
              startNm: config.start,
              stopNm: config.stop,
              points: config.points,
              angleDeg: config.angleDeg,
              polarization: config.polarization,
            }
          : {
              wavelengthNm: config.wavelengthNm,
              startDeg: config.start,
              stopDeg: config.stop,
              points: config.points,
              polarization: config.polarization,
            };
      const scan =
        config.kind === "wavelength"
          ? wavelengthScan(stack, scanOptions)
          : angleScan(stack, scanOptions);
      state.result = {
        schema: "thinfilm.result.v1",
        stack,
        config: scanOptions,
        reference,
        scan,
      };
      state.error = "";
      state.pending = false;
      state.hover = false;
      state.probeIndex = nearestIndex(
        scan.rows,
        config.kind === "wavelength" ? config.wavelengthNm : config.angleDeg,
        config.kind,
      );
      $("elapsed").textContent =
        `${format(performance.now() - startTime, 3)} ms`;
      $("download-csv").disabled = false;
      $("export-result").disabled = false;
      renderStackVisual();
      renderResult();
      status("ready");
    } catch (error) {
      showError(error);
    }
  });
}

function showError(error, prefix = "") {
  state.generation++;
  state.pending = false;
  state.result = null;
  state.error = `${prefix}${error.message || String(error)}`;
  status("error", "error");
  $("elapsed").textContent = "—";
  $("download-csv").disabled = true;
  $("export-result").disabled = true;
  for (const id of [
    "stat-r",
    "stat-t",
    "stat-a",
    "probe-r",
    "probe-t",
    "probe-a",
    "probe-x",
  ])
    $(id).textContent = "—";
  $("reference-label").textContent = "";
  $("scan-stats").replaceChildren();
  $("chart-subtitle").textContent = "";
  $("chart-description").textContent = `${t("errorTitle")} ${state.error}`;
  $("diagnostic").className = "diagnostic warning";
  $("diagnostic").textContent = `${t("errorTitle")} ${state.error}`;
  $("chart-empty").hidden = false;
  drawChart();
}

function nearestIndex(rows, coordinate, kind) {
  const key = kind === "wavelength" ? "wavelengthNm" : "angleDeg";
  let index = 0;
  for (let i = 1; i < rows.length; i++)
    if (
      Math.abs(rows[i][key] - coordinate) <
      Math.abs(rows[index][key] - coordinate)
    )
      index = i;
  return index;
}

function renderResult() {
  if (!state.result) return;
  const { scan, reference, config, stack } = state.result;
  $("chart-empty").hidden = true;
  $("chart-subtitle").textContent =
    scan.kind === "wavelength"
      ? `θ = ${format(config.angleDeg)}°  /  ${config.polarization}  /  ${scan.rows.length} ${t("samples")}`
      : `λ = ${format(config.wavelengthNm)} nm  /  ${config.polarization}  /  ${scan.rows.length} ${t("samples")}`;
  $("reference-label").textContent =
    `λ = ${format(reference.wavelengthNm)} nm · θ = ${format(reference.angleDeg)}°`;
  for (const key of ["R", "T", "A"])
    $(`stat-${key.toLowerCase()}`).textContent = format(reference[key]);
  let minR = scan.rows[0],
    maxR = minR,
    maxA = minR;
  for (const row of scan.rows) {
    if (row.R < minR.R) minR = row;
    if (row.R > maxR.R) maxR = row;
    if (row.A > maxA.A) maxA = row;
  }
  const coordinate = (row) =>
    scan.kind === "wavelength"
      ? `${format(row.wavelengthNm)} nm`
      : `${format(row.angleDeg)}°`;
  $("scan-stats").replaceChildren();
  for (const [label, value, point] of [
    [t("rMin"), minR.R, minR],
    [t("rMax"), maxR.R, maxR],
    [t("aMax"), maxA.A, maxA],
  ]) {
    const element = document.createElement("span");
    element.append(`${label} `);
    const strong = document.createElement("b");
    strong.textContent = format(value);
    element.append(strong, ` ${t("at")} ${coordinate(point)}`);
    $("scan-stats").append(element);
  }
  const thickness = document.createElement("span");
  thickness.textContent = `${t("totalD")} ${format(stack.layers.reduce((sum, layer) => sum + layer.dNm, 0))} nm`;
  $("scan-stats").append(thickness);
  const diagnostics = [
    ...(reference.diagnostics || []),
    ...(scan.diagnostics || []),
  ].filter(
    (item, index, items) =>
      items.findIndex(
        (other) =>
          (other.code || other.message || other) ===
          (item.code || item.message || item),
      ) === index,
  );
  $("diagnostic").className =
    `diagnostic${diagnostics.some((item) => item.level === "warning") ? " warning" : ""}`;
  $("diagnostic").textContent = diagnostics.length
    ? diagnostics
        .map((item) => item.message || item.code || String(item))
        .join(" ")
    : t("validNote");
  $("chart-description").textContent = t("scanDescription")
    .replace("{points}", String(scan.rows.length))
    .replace("{min}", format(minR.R))
    .replace("{max}", format(maxR.R));
  drawChart();
  updateProbe();
}

function niceTicks(min, max, count = 5) {
  const rough = (max - min) / count,
    power = 10 ** Math.floor(Math.log10(rough)),
    normalized = rough / power;
  const step =
    (normalized <= 1
      ? 1
      : normalized <= 2
        ? 2
        : normalized <= 2.5
          ? 2.5
          : normalized <= 5
            ? 5
            : 10) * power;
  if (!(step > 0) || !Number.isFinite(step)) return [min, max];
  const first = Math.ceil(min / step) * step;
  if (!Number.isFinite(first)) return [min, max];
  const ticks = [];
  for (let i = 0; i < 32; i++) {
    const value = first + i * step;
    if (value > max) break;
    if (value >= min && value !== ticks.at(-1)) ticks.push(value);
  }
  return ticks;
}

function drawChart() {
  const canvas = $("chart"),
    box = canvas.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(box.width * ratio);
  canvas.height = Math.round(box.height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, box.width, box.height);
  if (!state.result) {
    plot = null;
    return;
  }
  const { scan } = state.result,
    rows = scan.rows,
    key = scan.kind === "wavelength" ? "wavelengthNm" : "angleDeg";
  const margin = {
    left: box.width < 450 ? 45 : 52,
    right: 15,
    top: 23,
    bottom: 47,
  };
  const width = box.width - margin.left - margin.right,
    height = box.height - margin.top - margin.bottom;
  let xMin = rows[0][key],
    xMax = rows[rows.length - 1][key];
  let yMin = 0,
    yMax = 1;
  if (xMin === xMax) {
    const padding = scan.kind === "wavelength" ? Math.max(1, xMin * 0.05) : 1;
    xMin = Math.max(
      scan.kind === "wavelength" ? Number.MIN_VALUE : 0,
      xMin - padding,
    );
    xMax =
      scan.kind === "angle" ? Math.min(85, xMax + padding) : Math.min(Number.MAX_VALUE, xMax + padding);
  }
  for (const row of rows)
    for (const curve of ["R", "T", "A"]) {
      yMin = Math.min(yMin, row[curve]);
      yMax = Math.max(yMax, row[curve]);
    }
  const range = yMax - yMin;
  yMin -= range * 0.045;
  yMax += range * 0.045;
  const x = (value) => margin.left + ((value - xMin) / (xMax - xMin)) * width;
  const y = (value) => margin.top + ((yMax - value) / (yMax - yMin)) * height;
  plot = { xMin, xMax, x, y, key, margin, width, height };
  context.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.lineWidth = 1;
  for (const value of niceTicks(0, 1, 5)) {
    const yy = y(value);
    context.strokeStyle = "#2a3541";
    context.beginPath();
    context.moveTo(margin.left, yy);
    context.lineTo(margin.left + width, yy);
    context.stroke();
    context.fillStyle = "#9aa9ba";
    context.textAlign = "right";
    context.textBaseline = "middle";
    context.fillText(format(value, 3), margin.left - 10, yy);
  }
  if (yMin < -0.1 || yMax > 1.1)
    for (const value of niceTicks(yMin, yMax, 5).filter(
      (tick) => tick < 0 || tick > 1,
    )) {
      const yy = y(value);
      context.strokeStyle = "#2a3541";
      context.beginPath();
      context.moveTo(margin.left, yy);
      context.lineTo(margin.left + width, yy);
      context.stroke();
      context.fillStyle = "#9aa9ba";
      context.textAlign = "right";
      context.fillText(format(value, 3), margin.left - 10, yy);
    }
  for (const value of niceTicks(xMin, xMax, box.width < 450 ? 4 : 6)) {
    const xx = x(value);
    context.strokeStyle = "#26313d";
    context.beginPath();
    context.moveTo(xx, margin.top);
    context.lineTo(xx, margin.top + height);
    context.stroke();
    context.fillStyle = "#9aa9ba";
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(format(value, 4), xx, margin.top + height + 10);
  }
  context.strokeStyle = "#536171";
  context.beginPath();
  context.moveTo(margin.left, margin.top);
  context.lineTo(margin.left, margin.top + height);
  context.lineTo(margin.left + width, margin.top + height);
  context.stroke();
  context.fillStyle = "#9aa9ba";
  context.textAlign = "left";
  context.textBaseline = "top";
  context.font = "10px system-ui, sans-serif";
  context.fillText(t("axisPower"), margin.left, 3);
  context.textAlign = "center";
  context.fillText(
    t(scan.kind === "wavelength" ? "axisWavelength" : "axisAngle"),
    margin.left + width / 2,
    box.height - 14,
  );
  context.save();
  context.beginPath();
  context.rect(margin.left, margin.top, width, height);
  context.clip();
  for (const curve of ["R", "T", "A"]) {
    context.strokeStyle = colors[curve];
    context.lineWidth = curve === "A" ? 1.5 : 1.8;
    context.beginPath();
    rows.forEach((row, index) => {
      if (index === 0) context.moveTo(x(row[key]), y(row[curve]));
      else context.lineTo(x(row[key]), y(row[curve]));
    });
    context.stroke();
    if (rows.length === 1 || rows[0][key] === rows[rows.length - 1][key]) {
      context.fillStyle = colors[curve];
      context.beginPath();
      context.arc(x(rows[0][key]), y(rows[0][curve]), 3.5, 0, Math.PI * 2);
      context.fill();
    }
  }
  if (state.hover) {
    const row = rows[state.probeIndex],
      xx = x(row[key]);
    context.setLineDash([3, 4]);
    context.strokeStyle = "#768493";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(xx, margin.top);
    context.lineTo(xx, margin.top + height);
    context.stroke();
    context.setLineDash([]);
    for (const curve of ["R", "T", "A"]) {
      context.fillStyle = colors[curve];
      context.beginPath();
      context.arc(xx, y(row[curve]), 3, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
}

function updateProbe() {
  if (!state.result) return;
  const { scan } = state.result,
    row = scan.rows[state.probeIndex];
  $("probe-x").textContent =
    scan.kind === "wavelength"
      ? `λ = ${format(row.wavelengthNm)} nm`
      : `θ = ${format(row.angleDeg)}°`;
  for (const curve of ["R", "T", "A"])
    $(`probe-${curve.toLowerCase()}`).textContent = format(row[curve], 7);
}

function download(content, filename, type) {
  const blob = new Blob([content], { type }),
    url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("language").addEventListener("click", () => {
  language = language === "zh" ? "en" : "zh";
  try {
    localStorage.setItem("thinfilm-language", language);
  } catch {
    /* Storage is optional. */
  }
  updateLanguage();
});
$("preset").addEventListener("change", () => {
  const preset = $("preset").value;
  if (!presets[preset]) return;
  setStack(presets[preset], preset);
  $("scan-mode").value = "wavelength";
  $("start").value = "380";
  $("stop").value = "780";
  $("points").value = "401";
  $("wavelength").value = "550";
  $("angle").value = "0";
  $("polarization").value = "unpolarized";
  updateScanLabels();
  scheduleCompute(true);
});
$("layer-table").addEventListener("input", (event) => {
  const input = event.target.closest("input[data-field]");
  if (!input) return;
  state.layers[Number(input.dataset.index)][input.dataset.field] =
    input.value === "" ? "" : Number(input.value);
  input.title = input.value;
  customStack();
  renderStackVisual();
  scheduleCompute();
});
$("layer-table").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-remove]");
  if (!button) return;
  state.layers.splice(Number(button.dataset.remove), 1);
  customStack();
  renderLayers();
  scheduleCompute(true);
});
$("add-layer").addEventListener("click", () => {
  if (state.layers.length >= 128) return;
  state.layers.push({ n: 1.5, k: 0, dNm: 100 });
  customStack();
  renderLayers();
  scheduleCompute(true);
  $("layer-table")
    .querySelector(`input[data-index="${state.layers.length - 1}"]`)
    ?.focus();
});
for (const id of ["incident", "substrate"])
  $(id).addEventListener("input", () => {
    customStack();
    scheduleCompute();
  });
for (const id of ["start", "stop", "points", "wavelength", "angle"])
  $(id).addEventListener("input", () => scheduleCompute());
$("polarization").addEventListener("change", () => scheduleCompute(true));
$("scan-mode").addEventListener("change", () => {
  const wavelength = $("scan-mode").value === "wavelength";
  $("start").value = wavelength ? "380" : "0";
  $("stop").value = wavelength ? "780" : "85";
  $("points").value = wavelength ? "401" : "341";
  updateScanLabels();
  scheduleCompute(true);
});
$("compute").addEventListener("click", () => scheduleCompute(true));
$("chart").addEventListener("pointermove", (event) => {
  if (!plot || !state.result) return;
  const box = $("chart").getBoundingClientRect(),
    px = Math.max(
      0,
      Math.min(plot.width, event.clientX - box.left - plot.margin.left),
    );
  state.probeIndex = nearestIndex(
    state.result.scan.rows,
    plot.xMin + (px / plot.width) * (plot.xMax - plot.xMin),
    state.result.scan.kind,
  );
  state.hover = true;
  drawChart();
  updateProbe();
});
$("chart").addEventListener("pointerleave", () => {
  state.hover = false;
  drawChart();
});
$("chart").addEventListener("keydown", (event) => {
  if (
    !state.result ||
    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
  )
    return;
  event.preventDefault();
  state.probeIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? state.result.scan.rows.length - 1
        : Math.max(
            0,
            Math.min(
              state.result.scan.rows.length - 1,
              state.probeIndex + (event.key === "ArrowRight" ? 1 : -1),
            ),
          );
  state.hover = true;
  drawChart();
  updateProbe();
});
$("download-csv").addEventListener("click", () => {
  if (state.result)
    download(
      scanToCsv(state.result.scan),
      `thinfilm-${state.result.scan.kind}-${state.result.scan.polarization}.csv`,
      "text/csv;charset=utf-8",
    );
});
$("export-result").addEventListener("click", () => {
  if (state.result)
    download(
      `${JSON.stringify(state.result, null, 2)}\n`,
      "thinfilm-result.json",
      "application/json",
    );
});
$("export-stack").addEventListener("click", () => {
  try {
    download(
      `${JSON.stringify(readStack(), null, 2)}\n`,
      "thinfilm-stack.json",
      "application/json",
    );
  } catch (error) {
    showError(error);
  }
});
$("import-stack").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async () => {
  const file = $("import-file").files?.[0];
  if (!file) return;
  clearTimeout(debounceTimer);
  try {
    if (file.size > 10 * 1048576) throw new RangeError(t("fileTooLarge"));
    const parsed = JSON.parse(await file.text()),
      resultFile = parsed?.schema === "thinfilm.result.v1";
    if (resultFile) {
      const config = parsed.config;
      if (!config || typeof config !== "object" || Array.isArray(config)) throw new RangeError("Result JSON requires a scan configuration.");
      const kind = parsed.scan?.kind ?? config.kind;
      if (!["wavelength", "angle"].includes(kind)) throw new RangeError("Result scan kind must be wavelength or angle.");
      if (config.kind !== undefined && config.kind !== kind) throw new RangeError("Result scan kind conflicts with its configuration.");
      if (!["s", "p", "unpolarized"].includes(config.polarization)) throw new RangeError("Result polarization must be s, p, or unpolarized.");
      const fields = kind === "wavelength" ? ["startNm", "stopNm", "points", "angleDeg", "polarization"] : ["wavelengthNm", "startDeg", "stopDeg", "points", "polarization"];
      if (fields.some((key) => !Object.hasOwn(config, key))) throw new RangeError("Result scan configuration is incomplete.");
      const options = { ...config }; delete options.kind;
      if (kind === "wavelength") wavelengthScan(parsed.stack, options); else angleScan(parsed.stack, options);
      if (!parsed.reference || !Number.isFinite(parsed.reference.wavelengthNm) || parsed.reference.wavelengthNm <= 0 || !Number.isFinite(parsed.reference.angleDeg) || parsed.reference.angleDeg < 0 || parsed.reference.angleDeg > 85) throw new RangeError("Result reference coordinates are invalid.");
      if ((kind === "wavelength" && parsed.reference.angleDeg !== config.angleDeg) || (kind === "angle" && parsed.reference.wavelengthNm !== config.wavelengthNm)) throw new RangeError("Result reference coordinates conflict with the scan configuration.");
    }
    setStack(resultFile ? parsed.stack : parsed);
    if (resultFile && parsed.config) {
      const config = parsed.config;
      const kind = parsed.scan?.kind ?? config.kind;
      if (["wavelength", "angle"].includes(kind)) $("scan-mode").value = kind;
      const start = config.startNm ?? config.startDeg ?? config.start;
      const stop = config.stopNm ?? config.stopDeg ?? config.stop;
      if (start !== undefined) $("start").value = String(start);
      if (stop !== undefined) $("stop").value = String(stop);
      if (config.points !== undefined)
        $("points").value = String(config.points);
      if (config.wavelengthNm !== undefined)
        $("wavelength").value = String(config.wavelengthNm);
      if (config.angleDeg !== undefined)
        $("angle").value = String(config.angleDeg);
      if (parsed.reference?.wavelengthNm !== undefined)
        $("wavelength").value = String(parsed.reference.wavelengthNm);
      if (parsed.reference?.angleDeg !== undefined)
        $("angle").value = String(parsed.reference.angleDeg);
      if (["s", "p", "unpolarized"].includes(config.polarization))
        $("polarization").value = config.polarization;
      updateScanLabels();
    }
    scheduleCompute(true);
  } catch (error) {
    showError(error, `${t("invalidImport")}: `);
  } finally {
    $("import-file").value = "";
  }
});

new ResizeObserver(() => drawChart()).observe($("chart"));
setStack(presets.bragg, "bragg");
updateLanguage();
scheduleCompute(true);
