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
}

document.addEventListener("DOMContentLoaded", boot);
