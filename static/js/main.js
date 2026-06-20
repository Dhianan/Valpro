/* ── Globals ─────────────────────────────────────────── */
const PAIR_COLORS = {
  "CHF/INR": { price: "#bc8cff", sma20: "#58a6ff", sma50: "#f85149", rsi: "#d29922" },
  "USD/INR": { price: "#39d353", sma20: "#58a6ff", sma50: "#f85149", rsi: "#d29922" },
  "EUR/USD": { price: "#58a6ff", sma20: "#bc8cff", sma50: "#f85149", rsi: "#d29922" },
  "GBP/USD": { price: "#3fb950", sma20: "#58a6ff", sma50: "#f85149", rsi: "#d29922" },
};
const CHART_DEFAULTS = {
  animation: false,
  plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false } },
  scales: {
    x: {
      ticks: { color: "#8b949e", font: { size: 10 }, maxRotation: 0, maxTicksLimit: 8 },
      grid:  { color: "rgba(48,54,61,.5)" },
    },
    y: {
      ticks: { color: "#8b949e", font: { size: 10 } },
      grid:  { color: "rgba(48,54,61,.5)" },
    },
  },
};

const charts = {};
let macroData   = null;
let forecastData= null;
let seriesCache = {};

/* ── Fetch helpers ─────────────────────────────────────── */
async function get(url) {
  const r = await fetch(url);
  return r.json();
}

/* ── Nav ─────────────────────────────────────────────── */
document.querySelectorAll("nav button[data-section]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach(b => b.classList.remove("active"));
    document.querySelectorAll("section").forEach(s => s.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.section).classList.add("active");
  });
});

/* ── Pair tabs ──────────────────────────────────────────── */
function setupPairTabs(containerSelector, pairs, onSelect) {
  const wrap = document.querySelector(containerSelector);
  if (!wrap) return;
  wrap.innerHTML = "";
  pairs.forEach((pair, i) => {
    const btn = document.createElement("button");
    btn.className = "pair-tab" + (i === 0 ? " active" : "");
    btn.textContent = pair;
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".pair-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      onSelect(pair);
    });
    wrap.appendChild(btn);
  });
}

/* ── Chart factory ─────────────────────────────────────── */
function makeChart(id, type, data, opts = {}) {
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(canvas, {
    type,
    data,
    options: { ...CHART_DEFAULTS, ...opts },
  });
  return charts[id];
}

/* ── Price + SMA chart ─────────────────────────────────── */
function renderPriceChart(pair, series, canvasId) {
  const col = PAIR_COLORS[pair] || PAIR_COLORS["EUR/USD"];
  const histLen = series.history.dates.length;
  const allDates = [...series.history.dates, ...series.forecast.dates];
  const allClose = [
    ...series.history.close,
    ...series.forecast.close,
  ];
  const sma20 = [
    ...series.history.sma20,
    ...series.forecast.sma20,
  ];
  const sma50 = [
    ...series.history.sma50,
    ...series.forecast.sma50,
  ];

  // Forecast boundary line (vertical) – use background color change via segment
  makeChart(canvasId, "line", {
    labels: allDates,
    datasets: [
      {
        label: "Close",
        data: allClose,
        borderColor: (ctx) => {
          const i = ctx.dataIndex;
          return i < histLen ? col.price : col.price + "88";
        },
        segment: {
          borderDash: (ctx) => ctx.p0DataIndex >= histLen - 1 ? [4, 4] : [],
        },
        borderWidth: 2,
        pointRadius: 0,
        fill: {
          target: "origin",
          above: col.price + "10",
        },
        tension: 0.3,
      },
      {
        label: "SMA-20",
        data: sma20,
        borderColor: col.sma20,
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: "SMA-50",
        data: sma50,
        borderColor: col.sma50,
        borderWidth: 1.5,
        borderDash: [6, 3],
        pointRadius: 0,
        tension: 0.3,
      },
    ],
  }, {
    plugins: {
      legend:  { display: false },
      tooltip: {
        mode: "index", intersect: false,
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(4)}`,
        },
      },
      annotation: {
        annotations: {
          boundary: {
            type: "line",
            xMin: allDates[histLen],
            xMax: allDates[histLen],
            borderColor: "#8b949e",
            borderWidth: 1,
            borderDash: [4, 4],
            label: {
              display: true,
              content: "Forecast →",
              color: "#8b949e",
              font: { size: 10 },
              position: "start",
            },
          },
        },
      },
    },
    scales: {
      ...CHART_DEFAULTS.scales,
      y: {
        ...CHART_DEFAULTS.scales.y,
        title: { display: true, text: pair, color: "#8b949e", font: { size: 11 } },
      },
    },
  });
}

/* ── RSI chart ─────────────────────────────────────────── */
function renderRSIChart(pair, series, canvasId) {
  const col = PAIR_COLORS[pair] || PAIR_COLORS["EUR/USD"];
  const allDates = [...series.history.dates, ...series.forecast.dates];
  const rsi = [...series.history.rsi, ...series.forecast.rsi];

  makeChart(canvasId, "line", {
    labels: allDates,
    datasets: [{
      label: "RSI-14",
      data: rsi,
      borderColor: col.rsi,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
      fill: false,
    }],
  }, {
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: "index", intersect: false,
        callbacks: { label: (ctx) => `RSI-14: ${ctx.parsed.y?.toFixed(1)}` },
      },
      annotation: {
        annotations: {
          ob: { type: "line", yMin: 70, yMax: 70, borderColor: "#f85149", borderWidth: 1, borderDash: [4,4] },
          os: { type: "line", yMin: 30, yMax: 30, borderColor: "#3fb950", borderWidth: 1, borderDash: [4,4] },
          mid: { type: "line", yMin: 50, yMax: 50, borderColor: "#30363d", borderWidth: 1 },
        },
      },
    },
    scales: {
      ...CHART_DEFAULTS.scales,
      y: {
        ...CHART_DEFAULTS.scales.y,
        min: 0, max: 100,
        title: { display: true, text: "RSI-14", color: "#8b949e", font: { size: 11 } },
      },
    },
  });
}

/* ── Probability gauge chart ─────────────────────────────── */
function renderGaugeChart(pair, canvasId, probData) {
  const up   = probData.prob_up_pct;
  const down = probData.prob_dn_pct;
  makeChart(canvasId, "doughnut", {
    labels: ["Bullish", "Bearish"],
    datasets: [{
      data: [up, down],
      backgroundColor: ["#3fb950cc", "#f85149cc"],
      borderWidth: 0,
      hoverOffset: 4,
    }],
  }, {
    cutout: "72%",
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: { label: (ctx) => `${ctx.label}: ${ctx.parsed.toFixed(1)}%` },
      },
    },
    scales: { x: { display: false }, y: { display: false } },
  });
}

/* ── Probability bar ──────────────────────────────────────── */
function renderProbBars(pair, probData, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const up   = probData.prob_up_pct;
  const down = probData.prob_dn_pct;
  const bias = up >= 50 ? "BULLISH" : "BEARISH";
  const biasClass = up >= 50 ? "badge-green" : "badge-red";

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <span class="badge ${biasClass}">${bias}</span>
      <span style="font-size:.75rem;color:var(--muted)">
        Spot: <strong style="color:var(--text)">${probData.current_spot}</strong>
      </span>
    </div>
    <div class="prob-container">
      <div class="prob-row">
        <span class="prob-label">Bullish ↑</span>
        <div class="prob-bar-wrap">
          <div class="prob-bar" style="width:${up}%;background:var(--green)"></div>
        </div>
        <span class="prob-val" style="color:var(--green)">${up}%</span>
      </div>
      <div class="prob-row">
        <span class="prob-label">Bearish ↓</span>
        <div class="prob-bar-wrap">
          <div class="prob-bar" style="width:${down}%;background:var(--red)"></div>
        </div>
        <span class="prob-val" style="color:var(--red)">${down}%</span>
      </div>
    </div>
    <div style="font-size:.72rem;color:var(--muted);margin-top:12px;line-height:1.8">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px">
        <span>P5  (bear tail)</span><span style="color:var(--red);text-align:right">${probData.p5}</span>
        <span>P25 (lower quartile)</span><span style="color:var(--muted);text-align:right">${probData.p25}</span>
        <span>P50 (base case)</span><span style="color:var(--accent);text-align:right;font-weight:700">${probData.p50}</span>
        <span>P75 (upper quartile)</span><span style="color:var(--muted);text-align:right">${probData.p75}</span>
        <span>P95 (bull tail)</span><span style="color:var(--green);text-align:right">${probData.p95}</span>
      </div>
    </div>
  `;
}

/* ── Crossover table ─────────────────────────────────────── */
function renderCrossTable(crossovers, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!crossovers.length) {
    el.innerHTML = `<p style="color:var(--muted);font-size:.8rem">No crossover events in window.</p>`;
    return;
  }
  const rows = crossovers.map(c => `
    <tr>
      <td>${c.date}</td>
      <td class="num">${c.close}</td>
      <td class="num">${c.sma20}</td>
      <td class="num">${c.sma50}</td>
      <td class="num">${c.rsi}</td>
      <td>${c.zone}</td>
      <td><span class="badge ${c.signal === "BULLISH" ? "badge-green" : "badge-red"}">${c.signal}</span></td>
      <td><span class="badge ${c.period === "History" ? "badge-blue" : "badge-purple"}">${c.period}</span></td>
    </tr>
  `).join("");
  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Date</th><th>Close</th><th>SMA-20</th><th>SMA-50</th>
        <th>RSI</th><th>RSI Zone</th><th>Signal</th><th>Period</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/* ── SECTION: Overview ──────────────────────────────────── */
async function loadOverview() {
  const data = macroData || await get("/api/macro");
  macroData = data;

  const fcast = forecastData || await get("/api/forecast");
  forecastData = fcast;

  // KPI cards
  const pairs = [
    { pair: "CHF/INR", horizon: "30d" },
    { pair: "USD/INR", horizon: "30d" },
    { pair: "EUR/USD", horizon: "7d" },
    { pair: "GBP/USD", horizon: "7d" },
  ];
  const kpiWrap = document.getElementById("kpi-cards");
  kpiWrap.innerHTML = pairs.map(({ pair, horizon }) => {
    const p = fcast[pair];
    const bias   = p.prob_up_pct >= 50 ? "BULLISH" : "BEARISH";
    const bclass = p.prob_up_pct >= 50 ? "badge-green" : "badge-red";
    const sign   = p.prob_up_pct >= 50 ? "▲" : "▼";
    const pct    = p.prob_up_pct >= 50 ? p.prob_up_pct : p.prob_dn_pct;
    const delta  = (((p.p50 - p.current_spot) / p.current_spot) * 100).toFixed(2);
    const dcolor = delta >= 0 ? "var(--green)" : "var(--red)";
    return `
      <div class="card">
        <div class="card-title">${pair} · ${horizon} forecast</div>
        <div class="stat">
          <div class="value">${p.current_spot}</div>
          <div class="sub" style="color:${dcolor}">
            P50 ${p.p50} (${delta >= 0 ? "+" : ""}${delta}%)
          </div>
          <div style="margin-top:10px">
            <span class="badge ${bclass}">${sign} ${bias} ${pct}%</span>
          </div>
          <div style="font-size:.68rem;color:var(--muted);margin-top:6px">
            Range: ${p.p5} – ${p.p95}
          </div>
        </div>
      </div>`;
  }).join("");

  // CB stance table
  const cbEl = document.getElementById("cb-table-body");
  const stanceClass = s =>
    /hawk/i.test(s) ? "stance-hawk" : /dove/i.test(s) ? "stance-dove" : "stance-neutral";
  cbEl.innerHTML = Object.entries(data.cb_stance).map(([bank, d]) => `
    <tr>
      <td><strong>${bank}</strong></td>
      <td class="num">${d.rate_pct.toFixed(2)}%</td>
      <td class="${stanceClass(d.stance)}">${d.stance}</td>
      <td style="color:var(--muted)">${d.last_move}</td>
      <td style="color:var(--muted);font-size:.72rem">${d.guidance}</td>
    </tr>
  `).join("");

  // Rate diff cards
  const rdEl = document.getElementById("rate-diff-cards");
  rdEl.innerHTML = Object.entries(data.rates).map(([label, d]) => {
    const pos = d.spread_bps >= 0;
    const col = pos ? "var(--green)" : "var(--red)";
    return `
      <div class="card">
        <div class="card-title">${label}</div>
        <div style="font-size:1.6rem;font-weight:700;color:${col}">
          ${d.spread_bps >= 0 ? "+" : ""}${d.spread_bps} bps
        </div>
        <div style="font-size:.75rem;color:var(--muted);margin-top:6px">${d.direction}</div>
        <div style="font-size:.73rem;margin-top:8px;line-height:1.5">${d.implication}</div>
      </div>`;
  }).join("");
}

/* ── SECTION: Macro ──────────────────────────────────────── */
async function loadMacro() {
  const data = macroData || await get("/api/macro");
  macroData = data;

  const tbl = document.getElementById("macro-table-body");
  const ratingColor = r =>
    r === "AAA" ? "var(--green)" : r.startsWith("AA") ? "var(--teal)" :
    r.startsWith("A")  ? "var(--accent)" :
    r.startsWith("BB") ? "var(--yellow)" : "var(--red)";

  tbl.innerHTML = Object.entries(data.macro).map(([country, d]) => `
    <tr>
      <td><strong>${country}</strong></td>
      <td class="num">${d.policy_rate_pct.toFixed(2)}%</td>
      <td class="num">${d.inflation_pct.toFixed(1)}%</td>
      <td class="num" style="color:${d.real_rate_pct >= 0 ? "var(--green)" : "var(--red)"}">${d.real_rate_pct >= 0 ? "+" : ""}${d.real_rate_pct.toFixed(2)}%</td>
      <td class="num" style="color:var(--green)">${d.gdp_growth_pct.toFixed(1)}%</td>
      <td class="num" style="color:${d.current_account_gdp >= 0 ? "var(--green)" : "var(--red)"}">${d.current_account_gdp >= 0 ? "+" : ""}${d.current_account_gdp.toFixed(1)}%</td>
      <td class="num">$${d.fx_reserves_bn_usd.toFixed(0)}bn</td>
      <td class="num" style="color:${d.debt_gdp_pct > 100 ? "var(--red)" : d.debt_gdp_pct > 60 ? "var(--yellow)" : "var(--green)"}">${d.debt_gdp_pct}%</td>
      <td><span style="color:${ratingColor(d.credit_rating)};font-weight:700">${d.credit_rating}</span></td>
      <td style="color:var(--muted);font-size:.72rem">${d.political_risk}</td>
    </tr>
  `).join("");

  // Capital flows
  const flowEl = document.getElementById("flow-cards");
  flowEl.innerHTML = Object.entries(data.flows).map(([theme, pts]) => {
    const col = /inflow|inflow/i.test(theme) && !/outflow/i.test(theme)
      ? "var(--green)" : /outflow|pressure/i.test(theme) ? "var(--red)" : "var(--accent)";
    return `
      <div class="card">
        <div class="card-title" style="color:${col}">${theme}</div>
        <ul style="list-style:none">
          ${pts.map(p => `<li style="font-size:.75rem;color:var(--muted);padding:4px 0 4px 14px;position:relative;border-bottom:1px solid rgba(48,54,61,.5)">
            <span style="position:absolute;left:0;color:${col};font-size:.65rem">▸</span>${p}
          </li>`).join("")}
        </ul>
      </div>`;
  }).join("");
}

/* ── SECTION: Technical (EUR/USD & GBP/USD) ──────────────── */
let currentTechPair = "EUR/USD";

async function loadTechnical(pair) {
  currentTechPair = pair;
  document.getElementById("tech-loading").style.display = "flex";
  document.getElementById("tech-content").style.display = "none";

  const series = seriesCache[pair] || await get(`/api/series/${pair.replace("/", "-")}`);
  seriesCache[pair] = series;

  // Stats bar
  const cb  = pair === "EUR/USD" ? macroData?.cb_stance?.ECB : macroData?.cb_stance?.BoE;
  const stEl = document.getElementById("tech-stats");
  const rsiVal = series.latest.rsi;
  const rsiZone = rsiVal > 70 ? "Overbought" : rsiVal < 30 ? "Oversold" : "Neutral";
  const rsiColor = rsiVal > 70 ? "var(--red)" : rsiVal < 30 ? "var(--green)" : "var(--yellow)";

  stEl.innerHTML = `
    <div class="card" style="display:flex;gap:32px;flex-wrap:wrap;align-items:center">
      <div class="stat">
        <div class="value">${series.latest.close}</div>
        <div class="label">${pair} Last Close</div>
      </div>
      <div class="stat">
        <div class="value" style="font-size:1.2rem;color:var(--accent)">${series.latest.sma20}</div>
        <div class="label">SMA-20</div>
      </div>
      <div class="stat">
        <div class="value" style="font-size:1.2rem;color:var(--red)">${series.latest.sma50}</div>
        <div class="label">SMA-50</div>
      </div>
      <div class="stat">
        <div class="value" style="font-size:1.2rem;color:${rsiColor}">${rsiVal}</div>
        <div class="label">RSI-14 · ${rsiZone}</div>
      </div>
      ${cb ? `
      <div style="flex:1;min-width:200px">
        <div class="card-title">${pair === "EUR/USD" ? "ECB" : "BoE"} Stance</div>
        <div style="font-size:.8rem">${cb.stance} · ${cb.rate_pct.toFixed(2)}%</div>
        <div style="font-size:.72rem;color:var(--muted);margin-top:4px">${cb.guidance}</div>
      </div>` : ""}
    </div>
  `;

  renderPriceChart(pair, series, "price-chart");
  renderRSIChart(pair, series, "rsi-chart");
  renderCrossTable(series.crossovers, "cross-table");

  document.getElementById("tech-loading").style.display = "none";
  document.getElementById("tech-content").style.display = "block";
}

/* ── SECTION: Forecast ───────────────────────────────────── */
let currentFcastPair = "CHF/INR";

async function loadForecast(pair) {
  currentFcastPair = pair;
  const fcast = forecastData || await get("/api/forecast");
  forecastData = fcast;

  const p      = fcast[pair];
  const series = seriesCache[pair] || await get(`/api/series/${pair.replace("/", "-")}`);
  seriesCache[pair] = series;

  renderPriceChart(pair, series, "fcast-price-chart");
  renderRSIChart(pair, series, "fcast-rsi-chart");
  renderGaugeChart(pair, "fcast-gauge", p);
  renderProbBars(pair, p, "fcast-prob-bars");

  // Range pointer
  const norm = Math.min(Math.max((p.p50 - p.p5) / (p.p95 - p.p5), 0), 1);
  const ptr  = document.getElementById("range-ptr");
  if (ptr) ptr.style.left = `${norm * 100}%`;

  const labEl = document.getElementById("range-labels");
  if (labEl) labEl.innerHTML = `
    <span style="color:var(--red)">${p.p5}</span>
    <span>${p.p25}</span>
    <span style="color:var(--accent);font-weight:700">${p.p50} base</span>
    <span>${p.p75}</span>
    <span style="color:var(--green)">${p.p95}</span>`;
}

/* ── SECTION: What If ───────────────────────────────────── */

const WI_RATE_FACTORS = {
  "CHF/INR": [
    { id: "rbi_rate_delta",  label: "RBI Rate Δ (bps)",  min: -100, max: 100 },
    { id: "snb_rate_delta",  label: "SNB Rate Δ (bps)",  min: -50,  max: 50  },
  ],
  "USD/INR": [
    { id: "rbi_rate_delta",  label: "RBI Rate Δ (bps)",  min: -100, max: 100 },
    { id: "fed_rate_delta",  label: "Fed Rate Δ (bps)",  min: -100, max: 100 },
  ],
  "EUR/USD": [
    { id: "ecb_rate_delta",  label: "ECB Rate Δ (bps)",  min: -100, max: 100 },
    { id: "fed_rate_delta",  label: "Fed Rate Δ (bps)",  min: -100, max: 100 },
  ],
  "GBP/USD": [
    { id: "boe_rate_delta",  label: "BoE Rate Δ (bps)",  min: -100, max: 100 },
    { id: "fed_rate_delta",  label: "Fed Rate Δ (bps)",  min: -100, max: 100 },
  ],
};

const PRESETS = {
  "oil-spike":  { oil_price_delta: 38, risk_sentiment: -1 },
  "risk-off":   { risk_sentiment: -3, oil_price_delta: 10 },
  "fed-pause":  { fed_rate_delta: 50 },
  "rbi-cut":    { rbi_rate_delta: -50 },
  "fpi-exit":   { fpi_flow_delta: -5, risk_sentiment: -1 },
  "reset":      {},
};

let wiPair    = "USD/INR";
let wiHorizon = 30;
let wiParams  = {};

function wiGetParams() {
  const p = {};
  // rate sliders
  document.querySelectorAll(".wi-rate-slider").forEach(el => {
    p[el.dataset.factor] = parseFloat(el.value);
  });
  p.oil_price_delta = parseFloat(document.getElementById("wi-oil")?.value || 0);
  p.risk_sentiment  = parseFloat(document.getElementById("wi-risk")?.value || 0);
  p.fpi_flow_delta  = parseFloat(document.getElementById("wi-fpi")?.value || 0);
  return p;
}

function wiSetSliders(overrides = {}) {
  document.querySelectorAll(".wi-rate-slider").forEach(el => {
    el.value = overrides[el.dataset.factor] ?? 0;
    el.dispatchEvent(new Event("input"));
  });
  ["oil", "risk", "fpi"].forEach(k => {
    const factorMap = { oil: "oil_price_delta", risk: "risk_sentiment", fpi: "fpi_flow_delta" };
    const el = document.getElementById(`wi-${k}`);
    if (el) { el.value = overrides[factorMap[k]] ?? 0; el.dispatchEvent(new Event("input")); }
  });
}

function buildRateSliders(pair) {
  const wrap = document.getElementById("wi-rate-sliders");
  if (!wrap) return;
  const factors = WI_RATE_FACTORS[pair] || [];
  wrap.innerHTML = factors.map(f => `
    <label class="wi-label">${f.label}
      <div style="display:flex;align-items:center;gap:8px">
        <input type="range" class="wi-rate-slider wi-slider"
               data-factor="${f.id}" min="${f.min}" max="${f.max}" value="0" step="5">
        <span class="wi-val" id="wi-val-${f.id}">0</span>
      </div>
    </label>
  `).join("");

  wrap.querySelectorAll(".wi-rate-slider").forEach(el => {
    el.addEventListener("input", () => {
      const valEl = document.getElementById(`wi-val-${el.dataset.factor}`);
      if (valEl) valEl.textContent = el.value > 0 ? `+${el.value}` : el.value;
    });
  });
}

async function runWhatIf() {
  wiParams = wiGetParams();
  const hasChange = Object.values(wiParams).some(v => v !== 0);

  document.getElementById("wi-loading").style.display = "flex";

  const res = await fetch("/api/whatif", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pair: wiPair, horizon: wiHorizon, params: wiParams }),
  });
  const d = await res.json();
  document.getElementById("wi-loading").style.display = "none";

  renderWiFanChart(d);
  renderWiKpi(d);
  renderWiProbDelta(d);
  renderWiModelParams(d, hasChange);
}

function renderWiFanChart(d) {
  const { dates, base, scenario } = d;
  const col = PAIR_COLORS[d.pair] || PAIR_COLORS["EUR/USD"];

  if (charts["wi-fan-chart"]) charts["wi-fan-chart"].destroy();
  charts["wi-fan-chart"] = new Chart(document.getElementById("wi-fan-chart"), {
    type: "line",
    data: {
      labels: dates,
      datasets: [
        // Scenario P25–P75 fill band
        {
          label: "Scenario P75",
          data: scenario.fan.p75,
          borderColor: "transparent",
          backgroundColor: "rgba(248,81,73,0.12)",
          fill: "+1",
          pointRadius: 0,
          tension: 0.3,
        },
        {
          label: "Scenario P25",
          data: scenario.fan.p25,
          borderColor: "transparent",
          backgroundColor: "rgba(248,81,73,0.12)",
          fill: false,
          pointRadius: 0,
          tension: 0.3,
        },
        // Base P25–P75 fill band
        {
          label: "Base P75",
          data: base.fan.p75,
          borderColor: "transparent",
          backgroundColor: "rgba(88,166,255,0.08)",
          fill: "+1",
          pointRadius: 0,
          tension: 0.3,
        },
        {
          label: "Base P25",
          data: base.fan.p25,
          borderColor: "transparent",
          backgroundColor: "rgba(88,166,255,0.08)",
          fill: false,
          pointRadius: 0,
          tension: 0.3,
        },
        // Base P50
        {
          label: "Base P50",
          data: base.fan.p50,
          borderColor: "#8b949e",
          borderWidth: 2,
          borderDash: [5, 3],
          pointRadius: 0,
          tension: 0.3,
          fill: false,
        },
        // Scenario P50
        {
          label: "Scenario P50",
          data: scenario.fan.p50,
          borderColor: "#f85149",
          borderWidth: 2.5,
          pointRadius: 0,
          tension: 0.3,
          fill: false,
        },
      ],
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        legend: { display: false },
        tooltip: { mode: "index", intersect: false,
          callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(4)}` }
        },
      },
      scales: {
        ...CHART_DEFAULTS.scales,
        y: { ...CHART_DEFAULTS.scales.y,
          title: { display: true, text: d.pair, color: "#8b949e", font: { size: 11 } } },
      },
    },
  });
}

function renderWiKpi(d) {
  const el = document.getElementById("wi-kpi");
  const { base, scenario } = d;
  const probDelta = (scenario.prob_up_pct - base.prob_up_pct).toFixed(1);
  const p50Delta  = (scenario.p50 - base.p50).toFixed(4);
  const p50DeltaPct = (((scenario.p50 - base.p50) / base.p50) * 100).toFixed(2);

  const pill = (v, suffix = "") => {
    const cls = v > 0 ? "delta-pos" : v < 0 ? "delta-neg" : "delta-neu";
    return `<span class="delta-pill ${cls}">${v > 0 ? "+" : ""}${v}${suffix}</span>`;
  };

  el.innerHTML = `
    <div class="card stat">
      <div class="card-title">Bullish Probability</div>
      <div class="value">${scenario.prob_up_pct}%</div>
      <div class="sub">Base: ${base.prob_up_pct}% &nbsp; ${pill(+probDelta, "%")}</div>
    </div>
    <div class="card stat">
      <div class="card-title">Base-Case Price (P50)</div>
      <div class="value" style="font-size:1.4rem">${scenario.p50}</div>
      <div class="sub">Base: ${base.p50} &nbsp; ${pill(+p50DeltaPct, "%")}</div>
    </div>
    <div class="card stat">
      <div class="card-title">Bear Tail (P5)</div>
      <div class="value" style="font-size:1.3rem;color:var(--red)">${scenario.p5}</div>
      <div class="sub">Base: ${base.p5} &nbsp; ${pill(+(scenario.p5 - base.p5).toFixed(4))}</div>
    </div>
    <div class="card stat">
      <div class="card-title">Bull Tail (P95)</div>
      <div class="value" style="font-size:1.3rem;color:var(--green)">${scenario.p95}</div>
      <div class="sub">Base: ${base.p95} &nbsp; ${pill(+(scenario.p95 - base.p95).toFixed(4))}</div>
    </div>
  `;
}

function renderWiProbDelta(d) {
  const el   = document.getElementById("wi-prob-delta");
  const b    = d.base;
  const s    = d.scenario;
  const upD  = (s.prob_up_pct - b.prob_up_pct).toFixed(1);
  const dnD  = (s.prob_dn_pct - b.prob_dn_pct).toFixed(1);

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div>
        <div style="font-size:.72rem;color:var(--muted);margin-bottom:6px">Base Case</div>
        <div class="prob-row">
          <span class="prob-label">Bullish ↑</span>
          <div class="prob-bar-wrap"><div class="prob-bar"
            style="width:${b.prob_up_pct}%;background:var(--green)"></div></div>
          <span class="prob-val" style="color:var(--green)">${b.prob_up_pct}%</span>
        </div>
        <div class="prob-row">
          <span class="prob-label">Bearish ↓</span>
          <div class="prob-bar-wrap"><div class="prob-bar"
            style="width:${b.prob_dn_pct}%;background:var(--red)"></div></div>
          <span class="prob-val" style="color:var(--red)">${b.prob_dn_pct}%</span>
        </div>
      </div>
      <div>
        <div style="font-size:.72rem;color:var(--muted);margin-bottom:6px">
          Scenario &nbsp;
          <span class="delta-pill ${upD > 0 ? "delta-pos" : upD < 0 ? "delta-neg" : "delta-neu"}">
            ${upD > 0 ? "+" : ""}${upD}% bull shift
          </span>
        </div>
        <div class="prob-row">
          <span class="prob-label">Bullish ↑</span>
          <div class="prob-bar-wrap"><div class="prob-bar"
            style="width:${s.prob_up_pct}%;background:var(--green)"></div></div>
          <span class="prob-val" style="color:var(--green)">${s.prob_up_pct}%</span>
        </div>
        <div class="prob-row">
          <span class="prob-label">Bearish ↓</span>
          <div class="prob-bar-wrap"><div class="prob-bar"
            style="width:${s.prob_dn_pct}%;background:var(--red)"></div></div>
          <span class="prob-val" style="color:var(--red)">${s.prob_dn_pct}%</span>
        </div>
      </div>
    </div>
  `;
}

function renderWiModelParams(d, hasChange) {
  const el = document.getElementById("wi-model-params");
  const b  = d.base;
  const s  = d.scenario;
  const driftDelta = (s.adj_drift_pct - b.adj_drift_pct).toFixed(3);
  const volDelta   = (s.adj_vol_pct   - b.adj_vol_pct).toFixed(3);
  const dCol = driftDelta > 0 ? "var(--green)" : driftDelta < 0 ? "var(--red)" : "var(--muted)";
  const vCol = volDelta   > 0 ? "var(--yellow)": "var(--muted)";

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 24px">
      <span>Annual Drift (base)</span>  <span>${b.adj_drift_pct}%</span>
      <span>Annual Drift (scenario)</span>
        <span style="color:${dCol};font-weight:700">${s.adj_drift_pct}%
          (${driftDelta > 0 ? "+" : ""}${driftDelta}%)</span>
      <span>Annual Vol (base)</span>    <span>${b.adj_vol_pct}%</span>
      <span>Annual Vol (scenario)</span>
        <span style="color:${vCol};font-weight:700">${s.adj_vol_pct}%
          (${volDelta > 0 ? "+" : ""}${volDelta}%)</span>
    </div>
    ${!hasChange ? `<p style="margin-top:10px;font-style:italic">
      Scenario matches base — adjust sliders or pick a preset to see divergence.</p>` : ""}
  `;
}

function initWhatIf() {
  // Pair tabs
  setupPairTabs("#wi-pair-tabs", ["CHF/INR", "USD/INR", "EUR/USD", "GBP/USD"], async (pair) => {
    wiPair = pair;
    wiSetSliders({});
    buildRateSliders(pair);
    await runWhatIf();
  });

  buildRateSliders(wiPair);

  // Horizon slider
  const hSlider = document.getElementById("wi-horizon");
  const hVal    = document.getElementById("wi-horizon-val");
  hSlider?.addEventListener("input", () => {
    wiHorizon = parseInt(hSlider.value);
    hVal.textContent = `${wiHorizon} days`;
  });
  hSlider?.addEventListener("change", runWhatIf);

  // Macro sliders — live update label, run on release
  [
    { id: "wi-oil",  valId: "wi-oil-val",  fmt: v => (v > 0 ? `+$${v}` : `$${v}`) },
    { id: "wi-risk", valId: "wi-risk-val", fmt: v => (v > 0 ? `+${v}` : `${v}`) },
    { id: "wi-fpi",  valId: "wi-fpi-val",  fmt: v => (v > 0 ? `+$${v}bn` : `$${v}bn`) },
  ].forEach(({ id, valId, fmt }) => {
    const el  = document.getElementById(id);
    const val = document.getElementById(valId);
    el?.addEventListener("input",  () => { if (val) val.textContent = fmt(el.value); });
    el?.addEventListener("change", runWhatIf);
  });

  // Rate sliders — run on release (built dynamically, use delegation)
  document.getElementById("wi-rate-sliders")?.addEventListener("change", runWhatIf);

  // Presets
  document.querySelectorAll(".wi-preset").forEach(btn => {
    btn.addEventListener("click", async () => {
      const overrides = PRESETS[btn.dataset.preset] || {};
      wiSetSliders(overrides);
      await runWhatIf();
    });
  });

  // Initial run
  runWhatIf();
}

/* ── Boot ────────────────────────────────────────────────── */
async function boot() {
  // pre-fetch
  [macroData, forecastData] = await Promise.all([
    get("/api/macro"),
    get("/api/forecast"),
  ]);

  await loadOverview();

  // Technical section tabs
  setupPairTabs("#tech-pair-tabs", ["EUR/USD", "GBP/USD"], loadTechnical);
  await loadTechnical("EUR/USD");

  // Forecast section tabs
  setupPairTabs("#fcast-pair-tabs", ["CHF/INR", "USD/INR", "EUR/USD", "GBP/USD"], loadForecast);
  await loadForecast("CHF/INR");

  // Macro section (lazy load when tab clicked)
  document.querySelector("[data-section='macro']")?.addEventListener("click", loadMacro, { once: true });

  // What If section (lazy init when tab clicked)
  document.querySelector("[data-section='whatif']")?.addEventListener("click", initWhatIf, { once: true });
}

document.addEventListener("DOMContentLoaded", boot);
