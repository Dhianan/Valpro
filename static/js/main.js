/* ── Globals ─────────────────────────────────────────── */
const PAIR_COLORS = {
  "CHF/INR": { price: "#4F46E5", sma20: "#0EA5E9", sma50: "#F59E0B", rsi: "#8B5CF6" },
  "USD/INR": { price: "#10B981", sma20: "#0EA5E9", sma50: "#F59E0B", rsi: "#8B5CF6" },
  "EUR/USD": { price: "#6366F1", sma20: "#0EA5E9", sma50: "#F59E0B", rsi: "#8B5CF6" },
  "GBP/USD": { price: "#0EA5E9", sma20: "#6366F1", sma50: "#F59E0B", rsi: "#8B5CF6" },
};
const CHART_DEFAULTS = {
  animation: false,
  plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false } },
  scales: {
    x: {
      ticks: { color: "#94A3B8", font: { size: 10 }, maxRotation: 0, maxTicksLimit: 8 },
      grid:  { color: "rgba(226,232,240,.8)" },
    },
    y: {
      ticks: { color: "#94A3B8", font: { size: 10 } },
      grid:  { color: "rgba(226,232,240,.8)" },
    },
  },
};

const charts = {};
let macroData    = null;
let forecastData = null;
let seriesCache  = {};
let liveRates    = null;   // { "USD/INR": 84.21, "CHF/INR": 96.4, "EUR/USD": 1.094, "GBP/USD": 1.279, timestamp }

/* ── Fetch helpers ─────────────────────────────────────── */
async function get(url) {
  const r = await fetch(url);
  return r.json();
}

/* ── Live FX rates — multi-source with fallback ───────────
   All sources are free, key-less, CORS-enabled and EUR-based.
   We try each in order until one returns the four crosses we need.
   The single-source build silently failed whenever frankfurter.app
   was unreachable, leaving every card on the stale MODEL baseline. */
const RATE_SOURCES = [
  {
    name: "Frankfurter (ECB)",
    url:  "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD,INR,CHF,GBP",
    parse: d => ({ rates: d.rates, date: d.date }),
  },
  {
    name: "Frankfurter (ECB)",
    url:  "https://api.frankfurter.app/latest?from=EUR&to=USD,INR,CHF,GBP",
    parse: d => ({ rates: d.rates, date: d.date }),
  },
  {
    name: "ExchangeRate-API",
    url:  "https://open.er-api.com/v6/latest/EUR",
    parse: d => ({
      rates: d.rates,
      date:  (d.time_last_update_utc || "").slice(5, 16) || new Date().toISOString().slice(0, 10),
    }),
  },
];

async function fetchLiveRates() {
  for (const src of RATE_SOURCES) {
    try {
      const r = await fetch(src.url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const { rates, date } = src.parse(await r.json());
      if (!rates || !rates.USD || !rates.INR || !rates.CHF || !rates.GBP) continue;

      // All sources are EUR-based → derive the four crosses consistently
      liveRates = {
        "EUR/USD": parseFloat(rates.USD.toFixed(4)),                 // USD per EUR
        "GBP/USD": parseFloat((rates.USD / rates.GBP).toFixed(4)),   // USD÷GBP
        "USD/INR": parseFloat((rates.INR / rates.USD).toFixed(4)),   // INR÷USD
        "CHF/INR": parseFloat((rates.INR / rates.CHF).toFixed(4)),   // INR÷CHF
        timestamp: date,
        source:    src.name,
      };

      // Show live badge + note
      const badge = document.getElementById("live-rates-badge");
      const note  = document.getElementById("live-rates-note");
      const ts    = document.getElementById("rates-timestamp");
      if (badge) badge.style.display = "block";
      if (note)  note.style.display  = "block";
      if (ts)    ts.textContent = `${liveRates.timestamp} · ${src.name}`;

      return liveRates;
    } catch {
      // try next source
    }
  }
  return null;  // all sources failed → fall back to model spot
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

  // If live rates are available, rescale the entire price series so the last
  // historical close matches the live rate. This keeps the chart shape (all
  // relative moves) while anchoring the price level to current market reality.
  const liveSpot   = liveRates?.[pair];
  const modelClose = series.history.close[series.history.close.length - 1];
  const scale      = (liveSpot && modelClose) ? liveSpot / modelClose : 1;

  const rescale = arr => arr.map(v => v != null ? parseFloat((v * scale).toFixed(4)) : null);

  const allClose = rescale([...series.history.close, ...series.forecast.close]);
  const sma20    = rescale([...series.history.sma20,  ...series.forecast.sma20]);
  const sma50    = rescale([...series.history.sma50,  ...series.forecast.sma50]);

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
            borderColor: "#64748B",
            borderWidth: 1,
            borderDash: [4, 4],
            label: {
              display: true,
              content: "Forecast →",
              color: "#64748B",
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
        title: { display: true, text: pair, color: "#64748B", font: { size: 11 } },
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
          ob: { type: "line", yMin: 70, yMax: 70, borderColor: "#f87171", borderWidth: 1, borderDash: [4,4] },
          os: { type: "line", yMin: 30, yMax: 30, borderColor: "#4ade80", borderWidth: 1, borderDash: [4,4] },
          mid: { type: "line", yMin: 50, yMax: 50, borderColor: "#2d1b69", borderWidth: 1 },
        },
      },
    },
    scales: {
      ...CHART_DEFAULTS.scales,
      y: {
        ...CHART_DEFAULTS.scales.y,
        min: 0, max: 100,
        title: { display: true, text: "RSI-14", color: "#8b7ec8", font: { size: 11 } },
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
      backgroundColor: ["rgba(74,222,128,.75)", "rgba(248,113,113,.75)"],
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
  const spot   = liveRates?.[pair] ?? probData.current_spot;
  const isLive = !!(liveRates?.[pair]);

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <span class="badge ${biasClass}">${bias}</span>
      <span style="font-size:.75rem;color:var(--muted)">
        Spot: <strong style="color:var(--text)">${spot}</strong>
        ${isLive
          ? `<span class="live-badge" style="margin-left:4px;font-size:.55rem"><span class="live-dot"></span>LIVE</span>`
          : `<span style="margin-left:4px;font-size:.6rem;color:var(--muted)">(MODEL)</span>`}
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

  // KPI cards — violet-bloom style with live-rate overlay
  const pairs = [
    { pair: "CHF/INR", horizon: "30d", glowColor: "#4F46E5" },
    { pair: "USD/INR", horizon: "30d", glowColor: "#10B981" },
    { pair: "EUR/USD", horizon: "7d",  glowColor: "#6366F1" },
    { pair: "GBP/USD", horizon: "7d",  glowColor: "#0EA5E9" },
  ];
  const kpiWrap = document.getElementById("kpi-cards");
  kpiWrap.innerHTML = pairs.map(({ pair, horizon, glowColor }) => {
    const raw     = fcast[pair];
    const spot    = liveRates?.[pair] ?? raw.current_spot;
    const isLive  = !!(liveRates?.[pair]);
    // Rescale forecast percentiles to live spot so P50 / P5 / P95 are consistent
    const sc      = (isLive && raw.current_spot) ? spot / raw.current_spot : 1;
    const p50     = parseFloat((raw.p50 * sc).toFixed(4));
    const p5      = parseFloat((raw.p5  * sc).toFixed(4));
    const p95     = parseFloat((raw.p95 * sc).toFixed(4));
    const bias    = raw.prob_up_pct >= 50 ? "BULLISH" : "BEARISH";
    const bclass  = raw.prob_up_pct >= 50 ? "badge-green" : "badge-red";
    const arrow   = raw.prob_up_pct >= 50 ? "↑" : "↓";
    const pct     = raw.prob_up_pct >= 50 ? raw.prob_up_pct : raw.prob_dn_pct;
    const delta   = (((p50 - spot) / spot) * 100).toFixed(2);
    const dcolor  = delta >= 0 ? "var(--green)" : "var(--red)";
    return `
      <div class="kpi-card">
        <div class="corner-glow" style="background:${glowColor}"></div>
        <div class="pair-label">${pair} &nbsp;·&nbsp; ${horizon} forecast</div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between">
          <div class="spot-price">${spot}</div>
          <div class="live-tag">
            ${isLive
              ? `<span class="live-badge"><span class="live-dot"></span>LIVE</span>`
              : `<span style="font-size:.64rem;color:var(--muted)">MODEL</span>`}
          </div>
        </div>
        <div class="p50-line" style="color:${dcolor}">
          P50 ${p50} &nbsp;<span style="font-size:.72rem">(${delta >= 0 ? "+" : ""}${delta}%)</span>
        </div>
        <div style="margin-top:12px;display:flex;align-items:center;justify-content:space-between">
          <span class="badge ${bclass}">${arrow} ${bias} ${pct}%</span>
          <span style="font-size:.68rem;color:var(--muted)">${p5} – ${p95}</span>
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
          ${pts.map(p => `<li style="font-size:.75rem;color:var(--muted);padding:4px 0 4px 14px;position:relative;border-bottom:1px solid rgba(226,232,240,.8)">
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
  const techSpot   = liveRates?.[pair] ?? series.latest.close;
  const techIsLive = !!(liveRates?.[pair]);

  stEl.innerHTML = `
    <div class="card" style="display:flex;gap:32px;flex-wrap:wrap;align-items:center">
      <div class="stat">
        <div class="value" style="display:flex;align-items:center;gap:8px">
          ${techSpot}
          ${techIsLive
            ? `<span class="live-badge" style="font-size:.58rem"><span class="live-dot"></span>LIVE</span>`
            : `<span style="font-size:.58rem;color:var(--muted)">MODEL</span>`}
        </div>
        <div class="label">${pair} Spot</div>
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

  const series = seriesCache[pair] || await get(`/api/series/${pair.replace("/", "-")}`);
  seriesCache[pair] = series;

  // Rescale Monte Carlo percentiles to the live rate when available.
  // The GBM history is a simulated path; the model spot may differ from the
  // current market rate. Rescaling keeps relative fan-chart proportions intact
  // while anchoring all levels to the actual live spot.
  const raw      = fcast[pair];
  const liveSpot = liveRates?.[pair];
  const pScale   = (liveSpot && raw.current_spot) ? liveSpot / raw.current_spot : 1;
  const p = pScale === 1 ? raw : {
    ...raw,
    current_spot: liveSpot,
    p5:  parseFloat((raw.p5  * pScale).toFixed(4)),
    p25: parseFloat((raw.p25 * pScale).toFixed(4)),
    p50: parseFloat((raw.p50 * pScale).toFixed(4)),
    p75: parseFloat((raw.p75 * pScale).toFixed(4)),
    p95: parseFloat((raw.p95 * pScale).toFixed(4)),
  };

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

/* ── SECTION: Indicators ────────────────────────────────── */

let indicatorData = null;

const IND_LABELS = [
  "PPP / Inflation",
  "Interest Rate (UIP)",
  "Current Account",
  "GDP Growth",
  "Public Debt",
  "Terms of Trade",
  "Political Stability",
];
const IND_KEYS = [
  "PPP / Inflation Differential",
  "Interest Rate Differential (UIP)",
  "Current Account / Balance of Payments",
  "GDP Growth Differential",
  "Public Debt Burden",
  "Terms of Trade",
  "Political Stability",
];
const MODEL_COLOR = {
  "Purchasing Power Parity":       "#6366F1",
  "Interest Rate Parity":          "#0EA5E9",
  "Balance of Payments":           "#10B981",
  "Relative Economic Strength":    "#F59E0B",
  "Fiscal Sustainability":         "#EF4444",
  "Trade Competitiveness":         "#14B8A6",
  "Risk Premium":                  "#64748B",
};

function sigColor(sig) {
  return sig === "BULLISH" ? "var(--green)" : sig === "BEARISH" ? "var(--red)" : "var(--yellow)";
}
function sigBadge(sig) {
  const cls = sig === "BULLISH" ? "badge-green" : sig === "BEARISH" ? "badge-red" : "badge-yellow";
  return `<span class="badge ${cls}">${sig}</span>`;
}

async function loadIndicators(pair) {
  document.getElementById("ind-loading").style.display = "flex";
  document.getElementById("ind-content").style.display = "none";

  if (!indicatorData) {
    indicatorData = await get("/api/indicators");
  }
  const sc = indicatorData[pair];

  // Composite score bar
  const compEl = document.getElementById("ind-composite");
  const score  = sc.composite_score;
  const sig    = sc.composite_signal;
  const col    = sigColor(sig);
  compEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:12px">
      <div class="stat">
        <div class="value" style="color:${col};font-size:2.4rem">${score}</div>
        <div class="label">Composite Score</div>
      </div>
      <div>
        ${sigBadge(sig)}
        <div style="font-size:.75rem;color:var(--muted);margin-top:6px">
          ${sc.base_ccy} vs ${sc.quote_ccy} · weighted across 7 indicators
        </div>
      </div>
    </div>
    <div style="position:relative;height:12px;border-radius:6px;
                background:linear-gradient(to right,var(--red),var(--yellow) 50%,var(--green));
                margin-top:8px">
      <div style="position:absolute;top:-4px;left:${score}%;transform:translateX(-50%);
                  width:20px;height:20px;background:white;border-radius:50%;
                  border:2px solid ${col};box-shadow:0 0 6px ${col}44"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:.68rem;
                color:var(--muted);margin-top:6px">
      <span>0 · Max Bearish</span><span>50 · Neutral</span><span>100 · Max Bullish</span>
    </div>
  `;

  // Radar chart
  const sigToScore = s => s === "BULLISH" ? 3 : s === "NEUTRAL" ? 2 : 1;
  const radarData  = IND_KEYS.map(k => sigToScore(sc.indicators[k]?.signal || "NEUTRAL"));
  if (charts["ind-radar"]) charts["ind-radar"].destroy();
  charts["ind-radar"] = new Chart(document.getElementById("ind-radar"), {
    type: "radar",
    data: {
      labels: IND_LABELS,
      datasets: [{
        label: pair,
        data: radarData,
        borderColor: "#4F46E5",
        backgroundColor: "rgba(79,70,229,0.10)",
        borderWidth: 2,
        pointBackgroundColor: radarData.map(v =>
          v === 3 ? "#10B981" : v === 1 ? "#EF4444" : "#F59E0B"),
        pointRadius: 5,
      }],
    },
    options: {
      animation: false,
      scales: {
        r: {
          min: 0, max: 3,
          ticks: { display: false },
          grid:  { color: "rgba(226,232,240,.9)" },
          pointLabels: { color: "#64748B", font: { size: 10 } },
          angleLines: { color: "rgba(226,232,240,.9)" },
        },
      },
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => ["Bearish","","Neutral","","Bullish"][ctx.raw - 1] || "" }
      }},
    },
  });

  // PPP fair value
  document.getElementById("ind-ppp").textContent = sc.ppp_fair_value;

  // Per-indicator table
  const rows = IND_KEYS.map(name => {
    const ind = sc.indicators[name];
    const modelCol = MODEL_COLOR[ind.model] || "var(--muted)";
    return `
      <tr>
        <td><strong>${name}</strong></td>
        <td><span style="color:${modelCol};font-size:.7rem;font-weight:600">${ind.model}</span></td>
        <td class="num">${ind.value !== undefined ? (ind.value > 0 ? "+" : "") + ind.value : "—"}</td>
        <td style="color:var(--muted);font-size:.72rem">${ind.unit}</td>
        <td>${sigBadge(ind.signal)}</td>
        <td style="color:var(--muted);font-size:.72rem;max-width:320px">${ind.reading}</td>
      </tr>`;
  }).join("");

  document.getElementById("ind-table").innerHTML = `
    <table>
      <thead><tr>
        <th>Indicator</th><th>Model</th><th>Value</th>
        <th>Unit</th><th>Signal</th><th>Reading</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  // Model weights
  document.getElementById("ind-weights").innerHTML = Object.entries(sc.model_weights)
    .map(([name, w]) => {
      const shortName = name.split(" ").slice(0, 3).join(" ");
      return `<div class="card" style="padding:10px 14px;min-width:140px">
        <div style="font-size:.7rem;color:var(--muted)">${shortName}</div>
        <div style="font-size:1rem;font-weight:700;color:var(--accent)">${(w * 100).toFixed(0)}%</div>
      </div>`;
    }).join("");

  document.getElementById("ind-loading").style.display = "none";
  document.getElementById("ind-content").style.display = "block";
}

function initIndicators() {
  setupPairTabs("#ind-pair-tabs",
    ["CHF/INR", "USD/INR", "EUR/USD", "GBP/USD"],
    loadIndicators);
  loadIndicators("USD/INR");
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
    body: JSON.stringify({
      pair:          wiPair,
      horizon:       wiHorizon,
      params:        wiParams,
      spot_override: liveRates?.[wiPair] ?? null,   // send live rate so Monte Carlo starts from actual spot
    }),
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
          backgroundColor: "rgba(239,68,68,0.08)",
          fill: "+1",
          pointRadius: 0,
          tension: 0.3,
        },
        {
          label: "Scenario P25",
          data: scenario.fan.p25,
          borderColor: "transparent",
          backgroundColor: "rgba(239,68,68,0.08)",
          fill: false,
          pointRadius: 0,
          tension: 0.3,
        },
        // Base P25–P75 fill band
        {
          label: "Base P75",
          data: base.fan.p75,
          borderColor: "transparent",
          backgroundColor: "rgba(79,70,229,0.05)",
          fill: "+1",
          pointRadius: 0,
          tension: 0.3,
        },
        {
          label: "Base P25",
          data: base.fan.p25,
          borderColor: "transparent",
          backgroundColor: "rgba(79,70,229,0.05)",
          fill: false,
          pointRadius: 0,
          tension: 0.3,
        },
        // Base P50
        {
          label: "Base P50",
          data: base.fan.p50,
          borderColor: "#64748B",
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
          borderColor: "#EF4444",
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
          title: { display: true, text: d.pair, color: "#64748B", font: { size: 11 } } },
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
  const liveSpot  = liveRates?.[d.pair];
  const isLive    = !!liveSpot;

  const pill = (v, suffix = "") => {
    const cls = v > 0 ? "delta-pos" : v < 0 ? "delta-neg" : "delta-neu";
    return `<span class="delta-pill ${cls}">${v > 0 ? "+" : ""}${v}${suffix}</span>`;
  };

  el.innerHTML = `
    <div class="card stat">
      <div class="card-title">Starting Spot</div>
      <div class="value" style="display:flex;align-items:center;gap:8px">
        ${isLive ? liveSpot : base.spot}
        ${isLive
          ? `<span class="live-badge" style="font-size:.58rem"><span class="live-dot"></span>LIVE</span>`
          : `<span style="font-size:.58rem;color:var(--muted)">MODEL</span>`}
      </div>
      <div class="sub">${isLive ? `Model was ${base.spot}` : "Live rate unavailable"}</div>
    </div>
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

/* ── Converter ───────────────────────────────────────────── */
const CVT_CURRENCIES = {
  CHF: { flag: "🇨🇭", name: "Swiss Franc",    symbol: "Fr." },
  INR: { flag: "🇮🇳", name: "Indian Rupee",    symbol: "₹"   },
  USD: { flag: "🇺🇸", name: "US Dollar",       symbol: "$"   },
  EUR: { flag: "🇪🇺", name: "Euro",             symbol: "€"   },
  GBP: { flag: "🇬🇧", name: "British Pound",   symbol: "£"   },
};

// Model spot prices — last-resort fallback only (when every live feed
// is unreachable). Kept internally cross-consistent off USD/INR≈86.4,
// EUR/USD≈1.12, CHF/USD≈1.20, GBP/USD≈1.27 so derived crosses agree.
const CVT_MODEL_SPOTS = {
  "USD/INR":  86.40,
  "EUR/USD":   1.120,
  "GBP/USD":   1.270,
  "CHF/INR": 103.70,   // 1.20 × 86.40
  "EUR/INR":  96.77,   // 1.12 × 86.40
  "GBP/INR": 109.73,   // 1.27 × 86.40
  "EUR/CHF":   0.933,  // 1.12 / 1.20
  "EUR/GBP":   0.882,  // 1.12 / 1.27
};

let cvtFrom = "CHF";
let cvtTo   = "INR";
let cvtActivePicker = null; // "send" | "recv"
let cvtChartInst = null;
let cvtTf = 7;
let cvtSeriesCache = {};
let cvtConverterReady = false;

function cvtGetRate(from, to) {
  if (from === to) return 1;
  const key   = `${from}/${to}`;
  const keyRev= `${to}/${from}`;
  // Try liveRates first
  if (liveRates?.[key])    return liveRates[key];
  if (liveRates?.[keyRev]) return 1 / liveRates[keyRev];

  // Try EUR as bridge via liveRates
  // e.g. GBP/INR = (INR/EUR) / (GBP/EUR) — liveRates are all X/EUR-base
  // liveRates["EUR/USD"] = USD per EUR, liveRates["USD/INR"] = INR per USD, etc.
  // Build EUR-based amounts: 1 EUR = liveRates["EUR/USD"] USD, etc.
  if (liveRates) {
    const eurPer = {
      EUR: 1,
      USD: liveRates["EUR/USD"],
      GBP: liveRates["EUR/USD"] / liveRates["GBP/USD"],
      INR: liveRates["EUR/USD"] * liveRates["USD/INR"],
      CHF: liveRates["EUR/USD"] * liveRates["USD/INR"] / liveRates["CHF/INR"],
    };
    if (eurPer[from] && eurPer[to]) return eurPer[to] / eurPer[from];
  }

  // Fall back to model spots
  if (CVT_MODEL_SPOTS[key])    return CVT_MODEL_SPOTS[key];
  if (CVT_MODEL_SPOTS[keyRev]) return 1 / CVT_MODEL_SPOTS[keyRev];

  // Bridge via USD using model spots (value of 1 unit in USD)
  const usdValue = {
    USD: 1,
    EUR: CVT_MODEL_SPOTS["EUR/USD"],                              // 1.120
    GBP: CVT_MODEL_SPOTS["GBP/USD"],                              // 1.270
    CHF: CVT_MODEL_SPOTS["EUR/USD"] / CVT_MODEL_SPOTS["EUR/CHF"], // 1.200
    INR: 1 / CVT_MODEL_SPOTS["USD/INR"],                          // 1/86.40
  };
  if (usdValue[from] && usdValue[to]) return usdValue[from] / usdValue[to];
  return null;
}

function cvtFormatAmount(val, currency) {
  if (val === null || isNaN(val)) return "—";
  // Indian numbering system for INR
  if (currency === "INR") {
    const parts = val.toFixed(2).split(".");
    const int = parts[0];
    const dec = parts[1];
    if (int.length <= 3) return int + "." + dec;
    const last3 = int.slice(-3);
    const rest   = int.slice(0, -3);
    const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    return grouped + "," + last3 + "." + dec;
  }
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
}

function cvtUpdateWidget() {
  const rate = cvtGetRate(cvtFrom, cvtTo);
  if (!rate) return;

  const sendAmt = parseFloat(document.getElementById("cvt-send-amt")?.value) || 0;
  const recvAmt = sendAmt * rate;

  const recvEl = document.getElementById("cvt-recv-amt");
  if (recvEl) recvEl.value = recvAmt.toFixed(2);

  // Hero rate
  const sym   = CVT_CURRENCIES[cvtFrom]?.symbol || "";
  const heroRate = document.getElementById("cvt-hero-rate");
  const heroLbl  = document.getElementById("cvt-hero-label");
  const heroSrc  = document.getElementById("cvt-hero-src");
  if (heroRate) heroRate.textContent = `${sym}1 ${cvtFrom} = ${cvtFormatAmount(rate, cvtTo)} ${cvtTo}`;
  if (heroLbl)  heroLbl.textContent  = "Mid-market exchange rate";
  if (heroSrc)  heroSrc.textContent  = liveRates
    ? `Live · ${liveRates.source || "ECB"} · ${liveRates.timestamp}`
    : "Model estimate (live feed unavailable)";

  // Inline rate line
  const rateLine = document.getElementById("cvt-rate-line");
  if (rateLine) rateLine.textContent = `1 ${cvtFrom} = ${rate.toFixed(4)} ${cvtTo}`;
}

function cvtUpdatePicker(side, code) {
  const { flag, name } = CVT_CURRENCIES[code];
  document.getElementById(`cvt-${side}-flag`).textContent  = flag;
  document.getElementById(`cvt-${side}-code`).textContent  = code;
}

function cvtBuildDropdown(search = "") {
  const list = document.getElementById("cvt-dropdown-list");
  if (!list) return;
  const q = search.toLowerCase();
  list.innerHTML = "";
  Object.entries(CVT_CURRENCIES).forEach(([code, { flag, name }]) => {
    if (q && !code.toLowerCase().includes(q) && !name.toLowerCase().includes(q)) return;
    const item = document.createElement("div");
    item.className = "cvt-ccy-option";
    item.innerHTML = `<span class="cvt-opt-flag">${flag}</span><span class="cvt-opt-code">${code}</span><span class="cvt-opt-name">${name}</span>`;
    item.addEventListener("click", () => {
      if (cvtActivePicker === "send") {
        cvtFrom = code;
        cvtUpdatePicker("send", code);
      } else {
        cvtTo = code;
        cvtUpdatePicker("recv", code);
      }
      cvtCloseDropdown();
      cvtUpdateWidget();
      cvtLoadChart();
    });
    list.appendChild(item);
  });
}

function cvtOpenDropdown(side) {
  cvtActivePicker = side;
  const dd = document.getElementById("cvt-dropdown");
  const search = document.getElementById("cvt-search");
  if (!dd) return;
  dd.style.display = "block";
  search.value = "";
  cvtBuildDropdown("");
  search.focus();
}

function cvtCloseDropdown() {
  const dd = document.getElementById("cvt-dropdown");
  if (dd) dd.style.display = "none";
  cvtActivePicker = null;
}

async function cvtLoadChart() {
  const key = `${cvtFrom}/${cvtTo}`;
  const revKey = `${cvtTo}/${cvtFrom}`;
  const API_PAIRS = ["CHF/INR", "USD/INR", "EUR/USD", "GBP/USD"];
  let pair = null;
  let invert = false;
  if (API_PAIRS.includes(key))    { pair = key;    invert = false; }
  else if (API_PAIRS.includes(revKey)) { pair = revKey; invert = true;  }

  const title = document.getElementById("cvt-chart-title");
  const sub   = document.getElementById("cvt-chart-sub");
  if (title) title.textContent = `${cvtFrom} / ${cvtTo} rate`;
  if (sub)   sub.textContent   = "Historical mid-market rate";

  // Generate simulated history if no API pair available
  let dates, values;
  if (pair) {
    let cached = cvtSeriesCache[pair];
    if (!cached) {
      cached = await get(`/api/series/${pair.replace("/", "-")}`);
      cvtSeriesCache[pair] = cached;
    }
    const hist = cached?.history;
    if (!hist) return;
    dates  = hist.dates;
    values = invert ? hist.close.map(v => v ? parseFloat((1/v).toFixed(4)) : null) : hist.close;
  } else {
    // Synthetic: simulate 90 days ending today using current rate
    const rate = cvtGetRate(cvtFrom, cvtTo);
    if (!rate) return;
    const n = 90;
    dates  = [];
    values = [];
    const today = new Date();
    let s = rate / Math.exp(0.05 * (n/365));
    for (let i = 0; i < n; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - (n - 1 - i));
      dates.push(d.toISOString().slice(0, 10));
      s = s * Math.exp((0.05/365) + (0.06/Math.sqrt(365)) * (Math.random() * 2 - 1));
      values.push(parseFloat(s.toFixed(4)));
    }
  }

  // Anchor the simulated history to the current live rate so the chart's
  // endpoint matches the rate shown above (no jump between chart & hero).
  const liveRate = cvtGetRate(cvtFrom, cvtTo);
  const lastVal  = [...values].reverse().find(v => v != null);
  if (liveRate && lastVal) {
    const scale = liveRate / lastVal;
    values = values.map(v => v != null ? parseFloat((v * scale).toFixed(4)) : null);
  }

  // Slice to selected timeframe
  const sliced = { dates: dates.slice(-cvtTf), values: values.slice(-cvtTf) };

  // Compute stats
  const nums = sliced.values.filter(v => v != null);
  const high = Math.max(...nums);
  const low  = Math.min(...nums);
  const open = nums[0];
  const close= nums[nums.length - 1];
  const chgPct = open ? ((close - open) / open * 100).toFixed(2) : "—";
  const chgSign = parseFloat(chgPct) >= 0 ? "+" : "";
  const chgColor = parseFloat(chgPct) >= 0 ? "var(--green)" : "var(--red)";

  const statRow = document.getElementById("cvt-stat-row");
  if (statRow) {
    statRow.innerHTML = `
      <div class="cvt-stat-item"><div class="cvt-stat-val">${cvtFormatAmount(high, cvtTo)}</div><div class="cvt-stat-lbl">High</div></div>
      <div class="cvt-stat-item"><div class="cvt-stat-val">${cvtFormatAmount(low, cvtTo)}</div><div class="cvt-stat-lbl">Low</div></div>
      <div class="cvt-stat-item"><div class="cvt-stat-val" style="color:${chgColor}">${chgSign}${chgPct}%</div><div class="cvt-stat-lbl">Change</div></div>
    `;
  }

  // Draw chart
  const canvas = document.getElementById("cvt-chart");
  if (!canvas) return;
  if (cvtChartInst) { cvtChartInst.destroy(); cvtChartInst = null; }

  const isUp = parseFloat(chgPct) >= 0;
  const lineColor = isUp ? "#10B981" : "#EF4444";
  const gradColor = isUp ? "rgba(16,185,129,.15)" : "rgba(239,68,68,.10)";

  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.offsetHeight || 120);
  grad.addColorStop(0, gradColor);
  grad.addColorStop(1, "rgba(255,255,255,0)");

  cvtChartInst = new Chart(canvas, {
    type: "line",
    data: {
      labels: sliced.dates,
      datasets: [{
        data: sliced.values,
        borderColor: lineColor,
        backgroundColor: grad,
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        mode: "index", intersect: false,
        callbacks: { label: ctx => `${ctx.parsed.y.toFixed(4)} ${cvtTo}` },
      }},
      scales: {
        x: { display: false },
        y: {
          grid: { color: "rgba(226,232,240,.8)" },
          ticks: { color: "var(--muted)", maxTicksLimit: 4,
            callback: v => v.toFixed(3) },
        },
      },
    },
  });
}

function initConverter() {
  if (cvtConverterReady) return;
  cvtConverterReady = true;

  // Populate initial picker display
  cvtUpdatePicker("send", cvtFrom);
  cvtUpdatePicker("recv", cvtTo);

  // Amount input
  document.getElementById("cvt-send-amt")?.addEventListener("input", cvtUpdateWidget);

  // Swap button
  document.getElementById("cvt-swap-btn")?.addEventListener("click", () => {
    [cvtFrom, cvtTo] = [cvtTo, cvtFrom];
    cvtUpdatePicker("send", cvtFrom);
    cvtUpdatePicker("recv", cvtTo);
    cvtUpdateWidget();
    cvtLoadChart();
  });

  // Picker buttons open dropdown
  document.getElementById("cvt-send-ccy-btn")?.addEventListener("click", () => cvtOpenDropdown("send"));
  document.getElementById("cvt-recv-ccy-btn")?.addEventListener("click", () => cvtOpenDropdown("recv"));

  // Dropdown search
  document.getElementById("cvt-search")?.addEventListener("input", e => cvtBuildDropdown(e.target.value));

  // Close dropdown on outside click
  document.addEventListener("click", e => {
    if (!e.target.closest("#cvt-dropdown") && !e.target.closest(".cvt-ccy-picker")) cvtCloseDropdown();
  });

  // Timeframe tabs
  document.querySelectorAll(".cvt-tf").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".cvt-tf").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      cvtTf = parseInt(btn.dataset.tf);
      cvtLoadChart();
    });
  });

  cvtUpdateWidget();
  cvtLoadChart();
}

/* ── Boot ────────────────────────────────────────────────── */
async function boot() {
  // Fetch model data and live rates in parallel — all three must resolve
  // before rendering so KPI cards always get real spot prices when available
  [macroData, forecastData] = await Promise.all([
    get("/api/macro"),
    get("/api/forecast"),
    fetchLiveRates(),   // awaited in parallel; null if network unavailable
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

  // Indicators section (lazy init when tab clicked)
  document.querySelector("[data-section='indicators']")?.addEventListener("click", initIndicators, { once: true });

  // Converter section (lazy init when tab clicked)
  document.querySelector("[data-section='convert']")?.addEventListener("click", initConverter, { once: true });
}

document.addEventListener("DOMContentLoaded", boot);
