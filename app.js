const ZOOM_LEVELS = [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9];
const DEFAULT_HOLD_FORMULA_DIVISOR = 1400;
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 90;
const STORAGE_KEY = "reforger-wind-calc";

// Experimentally measured ART II reticle geometry (see README):
// center -> dot = 7.5 / zoom mrad, center -> inner edge of thick bar = 40.5 / zoom mrad
const ART_DOT_MRAD_FACTOR = 7.5;
const ART_INNER_BAR_MRAD_FACTOR = 40.5;

// PSO-1 scale: 10 mil each side of center
const PSO_PIXELS_PER_MIL = 17;
// ART II is second focal plane: reticle stays at fixed screen positions regardless of zoom.
// Dot pixel offset chosen so the thick bar (5.4 dot spacings out) still fits on the canvas.
const ART_DOT_PIXEL_OFFSET = 28;
const ART_BAR_PIXEL_OFFSET =
  ART_DOT_PIXEL_OFFSET * (ART_INNER_BAR_MRAD_FACTOR / ART_DOT_MRAD_FACTOR);

const SOLDIER_HEIGHT_M = 1.8;
// Fraction of the soldier image height from the top of the head down to the chest,
// used to align the chest with the scope's horizontal line
const SOLDIER_CHEST_FROM_TOP = 0.25;
// Allow the scope window to grow when the soldier is too tall to fit
const MAX_CANVAS_HEIGHT = 420;

const DEFAULTS = {
  distance: 600,
  windSpeed: 10,
  targetAzimuth: 270,
  windAzimuth: 180,
  artZoom: 3,
  holdFormulaDivisor: DEFAULT_HOLD_FORMULA_DIVISOR,
  targetMarker: "stick",
};

const soldierImage = new Image();
soldierImage.src = "res/soldier.png";

const elements = {
  windSpeed: document.getElementById("windSpeed"),
  windAzimuth: document.getElementById("windAzimuth"),
  targetAzimuth: document.getElementById("targetAzimuth"),
  distance: document.getElementById("distance"),
  artZoom: document.getElementById("artZoom"),
  targetMarker: document.getElementById("targetMarker"),
  holdFormulaDivisor: document.getElementById("holdFormulaDivisor"),
  zoomSuggest: document.getElementById("zoomSuggest"),
  results: document.getElementById("results"),
  resultHold: document.getElementById("resultHold"),
  resultCrosswind: document.getElementById("resultCrosswind"),
  resultPso: document.getElementById("resultPso"),
  resultArt: document.getElementById("resultArt"),
  psoCanvas: document.getElementById("psoCanvas"),
  artCanvas: document.getElementById("artCanvas"),
};

let pendingSuggestedZoom = null;

function normalizeAngle(degrees) {
  return ((degrees + 540) % 360) - 180;
}

function crosswindMps(windSpeed, targetAzimuth, windAzimuth) {
  const angleRad = normalizeAngle(targetAzimuth - windAzimuth) * (Math.PI / 180);
  return windSpeed * Math.sin(angleRad);
}

function holdMil(distance, crosswind, divisor) {
  return (distance * crosswind) / divisor;
}

// ART II dot spacing in mrad, measured experimentally (see README)
function pointMilAtZoom(zoom) {
  return ART_DOT_MRAD_FACTOR / zoom;
}

// README rule: choose the highest magnification where DotHold <= 1, keeping the
// hold inside the single reference dot. If the hold exceeds the largest dot
// value (2.5 mrad at 3x), no zoom can fit it, so use the lowest magnification:
// its dot is the closest reference to the hold.
function suggestZoom(holdMilValue, currentZoom) {
  const absHold = Math.abs(holdMilValue);
  if (absHold < 0.05) {
    return currentZoom;
  }

  let highestFitting = null;
  for (const zoom of ZOOM_LEVELS) {
    if (absHold <= pointMilAtZoom(zoom) + 1e-9) {
      highestFitting = zoom;
    }
  }

  return highestFitting ?? ZOOM_LEVELS[0];
}

function holdDirection(holdMilValue) {
  return holdMilValue >= 0 ? "RIGHT" : "LEFT";
}

function formatDirectionLabel(holdMilValue) {
  const direction = holdDirection(holdMilValue);
  const magnitude = Math.abs(holdMilValue).toFixed(2);
  return `${magnitude} mil ${direction}`;
}

function setupCanvas(canvas, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_WIDTH * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// Soldier angular height in mrad at the given distance
function soldierMilAt(distance) {
  return distance > 0 ? (SOLDIER_HEIGHT_M / distance) * 1000 : null;
}

// Grow the scope window when the soldier would not fit at the default height
function canvasHeightFor(soldierPixelHeight) {
  if (soldierPixelHeight === null) {
    return CANVAS_HEIGHT;
  }
  const needed = Math.ceil(soldierPixelHeight * 1.5) + 16;
  return Math.min(MAX_CANVAS_HEIGHT, Math.max(CANVAS_HEIGHT, needed));
}

// Draws the soldier so his chest sits on the scope's horizontal line.
// Returns false when the image is not available yet.
function drawSoldier(ctx, x, cy, pixelHeight) {
  if (!soldierImage.complete || !soldierImage.naturalWidth) {
    return false;
  }

  const width = pixelHeight * (soldierImage.naturalWidth / soldierImage.naturalHeight);
  const top = cy - pixelHeight * SOLDIER_CHEST_FROM_TOP;
  // The artwork is dark line art; invert it so it stays visible on the dark canvas
  ctx.filter = "invert(1)";
  ctx.drawImage(soldierImage, x - width / 2, top, width, pixelHeight);
  ctx.filter = "none";
  return true;
}

function clampToCanvas(x) {
  return Math.max(14, Math.min(CANVAS_WIDTH - 14, x));
}

function drawHoldStick(ctx, x, y, halfHeight) {
  ctx.strokeStyle = "#3dff3d";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x, y - halfHeight);
  ctx.lineTo(x, y + halfHeight);
  ctx.stroke();
}

// PSO-1: graduated windage scale of standalone vertical 1-mrad ticks (no line
// crossing them, like the real reticle), horizontal lines only outside the scale
function drawPsoReticle(ctx, height, holdMilValue, soldierPixelHeight) {
  const cx = CANVAS_WIDTH / 2;
  const cy = height / 2;
  const scale = PSO_PIXELS_PER_MIL;
  const color = "#e6e6e6";

  ctx.fillStyle = "#15181b";
  ctx.fillRect(0, 0, CANVAS_WIDTH, height);

  const holdX = clampToCanvas(cx + holdMilValue * scale);
  const soldierDrawn =
    soldierPixelHeight !== null && drawSoldier(ctx, holdX, cy, soldierPixelHeight);

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;

  // Horizontal stadia lines outside the graduated section only
  const scaleEdge = 10 * scale + 10;
  ctx.beginPath();
  ctx.moveTo(8, cy);
  ctx.lineTo(cx - scaleEdge, cy);
  ctx.moveTo(cx + scaleEdge, cy);
  ctx.lineTo(CANVAS_WIDTH - 8, cy);
  ctx.stroke();

  // Center chevron
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy + 5);
  ctx.lineTo(cx, cy - 5);
  ctx.lineTo(cx + 6, cy + 5);
  ctx.stroke();

  // Standalone vertical ticks, 1 mrad each, taller every 5 mrad
  ctx.font = "11px Arial, sans-serif";
  ctx.textAlign = "center";
  for (let mil = -10; mil <= 10; mil++) {
    if (mil === 0) continue;
    const x = cx + mil * scale;
    const halfHeight = mil % 5 === 0 ? 11 : 7;

    ctx.beginPath();
    ctx.moveTo(x, cy - halfHeight);
    ctx.lineTo(x, cy + halfHeight);
    ctx.stroke();

    if (Math.abs(mil) === 10) {
      ctx.fillText("10", x, cy + 26);
    }
  }

  if (!soldierDrawn) {
    drawHoldStick(ctx, holdX, cy, 14);
  }
}

// ART II: thin crosshair with center vertical line, thick outer bars, and two
// fixed ranging dots. SFP scope: the reticle never moves with zoom; only the
// mrad value of each element changes. Bar position uses the measured geometry:
// bars sit 40.5/7.5 = 5.4 dot spacings from center.
function drawArtReticle(ctx, height, holdMilValue, zoom, soldierPixelHeight) {
  const cx = CANVAS_WIDTH / 2;
  const cy = height / 2;
  const color = "#e6e6e6";

  ctx.fillStyle = "#15181b";
  ctx.fillRect(0, 0, CANVAS_WIDTH, height);

  const pixelsPerMil = ART_DOT_PIXEL_OFFSET / pointMilAtZoom(zoom);
  const holdX = clampToCanvas(cx + holdMilValue * pixelsPerMil);
  const soldierDrawn =
    soldierPixelHeight !== null && drawSoldier(ctx, holdX, cy, soldierPixelHeight);

  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  // Thin horizontal crosshair
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(8, cy);
  ctx.lineTo(CANVAS_WIDTH - 8, cy);
  ctx.stroke();

  // Thin vertical line marking the scope center
  ctx.beginPath();
  ctx.moveTo(cx, 8);
  ctx.lineTo(cx, height - 8);
  ctx.stroke();

  // Thick bars, flat ends facing center at the measured 40.5/zoom position
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(8, cy);
  ctx.lineTo(cx - ART_BAR_PIXEL_OFFSET, cy);
  ctx.moveTo(cx + ART_BAR_PIXEL_OFFSET, cy);
  ctx.lineTo(CANVAS_WIDTH - 8, cy);
  ctx.stroke();

  // Ranging dots: fixed screen position (second focal plane)
  for (const x of [cx - ART_DOT_PIXEL_OFFSET, cx + ART_DOT_PIXEL_OFFSET]) {
    ctx.beginPath();
    ctx.arc(x, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  if (!soldierDrawn) {
    drawHoldStick(ctx, holdX, cy, 14);
  }
}

function readInputs() {
  return {
    distance: Number(elements.distance.value),
    windSpeed: Number(elements.windSpeed.value),
    holdFormulaDivisor: Number(elements.holdFormulaDivisor.value) || DEFAULT_HOLD_FORMULA_DIVISOR,
    targetAzimuth: Number(elements.targetAzimuth.value),
    windAzimuth: Number(elements.windAzimuth.value),
    artZoom: Number(elements.artZoom.value),
    targetMarker: elements.targetMarker.value,
  };
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readInputs()));
  } catch {
    // Ignore quota or privacy mode errors
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const saved = JSON.parse(raw);
    elements.distance.value = saved.distance ?? DEFAULTS.distance;
    elements.windSpeed.value = saved.windSpeed ?? DEFAULTS.windSpeed;
    elements.holdFormulaDivisor.value =
      saved.holdFormulaDivisor ?? DEFAULTS.holdFormulaDivisor;
    elements.targetAzimuth.value = saved.targetAzimuth ?? DEFAULTS.targetAzimuth;
    elements.windAzimuth.value = saved.windAzimuth ?? DEFAULTS.windAzimuth;
    elements.artZoom.value = String(saved.artZoom ?? DEFAULTS.artZoom);
    elements.targetMarker.value = saved.targetMarker ?? DEFAULTS.targetMarker;
  } catch {
    // Ignore corrupt storage
  }
}

function applySuggestedZoom() {
  if (pendingSuggestedZoom === null) return;
  elements.artZoom.value = String(pendingSuggestedZoom);
  calculate();
}

function updateSuggestedZoomButton(suggestedZoom, currentZoom) {
  pendingSuggestedZoom = suggestedZoom;

  for (const option of elements.artZoom.options) {
    option.classList.toggle("suggested", Number(option.value) === suggestedZoom);
  }

  if (Math.abs(suggestedZoom - currentZoom) > 1e-6) {
    elements.zoomSuggest.hidden = false;
    elements.zoomSuggest.textContent = `Use ${suggestedZoom.toFixed(1)}×`;
  } else {
    elements.zoomSuggest.hidden = true;
  }
}

function renderResults(holdMilValue, crosswind, artZoom, suggestedZoom) {
  const direction = holdDirection(holdMilValue);
  const directionClass = direction === "RIGHT" ? "direction-right" : "direction-left";

  elements.results.classList.remove("direction-right", "direction-left");
  elements.results.classList.add(directionClass);

  elements.resultHold.querySelector(".results-value").textContent = formatDirectionLabel(holdMilValue);
  elements.resultCrosswind.textContent = `${crosswind.toFixed(2)} m/s`;

  const psoMarks = Math.abs(holdMilValue).toFixed(2);
  elements.resultPso.textContent = `${psoMarks} marks ${direction}`;

  const pointMil = pointMilAtZoom(artZoom);
  const spacing = Math.abs(holdMilValue) / pointMil;
  elements.resultArt.textContent =
    `${spacing.toFixed(2)} dot spacings ${direction} (dot = ${pointMil.toFixed(2)} mil @ ${artZoom.toFixed(1)}×)`;

  updateSuggestedZoomButton(suggestedZoom, artZoom);
}

function calculate() {
  const inputs = readInputs();
  const crosswind = crosswindMps(inputs.windSpeed, inputs.targetAzimuth, inputs.windAzimuth);
  const hold = holdMil(inputs.distance, crosswind, inputs.holdFormulaDivisor);
  const suggested = suggestZoom(hold, inputs.artZoom);

  renderResults(hold, crosswind, inputs.artZoom, suggested);

  const soldierMil = inputs.targetMarker === "soldier" ? soldierMilAt(inputs.distance) : null;

  const psoSoldierPx = soldierMil !== null ? soldierMil * PSO_PIXELS_PER_MIL : null;
  const psoHeight = canvasHeightFor(psoSoldierPx);
  const psoCtx = setupCanvas(elements.psoCanvas, psoHeight);
  drawPsoReticle(psoCtx, psoHeight, hold, psoSoldierPx);

  const artPixelsPerMil = ART_DOT_PIXEL_OFFSET / pointMilAtZoom(inputs.artZoom);
  const artSoldierPx = soldierMil !== null ? soldierMil * artPixelsPerMil : null;
  const artHeight = canvasHeightFor(artSoldierPx);
  const artCtx = setupCanvas(elements.artCanvas, artHeight);
  drawArtReticle(artCtx, artHeight, hold, inputs.artZoom, artSoldierPx);

  saveSettings();
}

function init() {
  loadSettings();

  const inputElements = [
    elements.windSpeed,
    elements.windAzimuth,
    elements.targetAzimuth,
    elements.distance,
    elements.artZoom,
    elements.targetMarker,
    elements.holdFormulaDivisor,
  ];

  for (const el of inputElements) {
    el.addEventListener("input", calculate);
    el.addEventListener("change", calculate);
  }

  // Select content on focus so Tab + type replaces the value immediately
  for (const el of inputElements) {
    if (el.tagName === "INPUT") {
      el.addEventListener("focus", () => el.select());
    }
  }

  elements.zoomSuggest.addEventListener("click", applySuggestedZoom);
  soldierImage.addEventListener("load", calculate);

  calculate();
}

init();
