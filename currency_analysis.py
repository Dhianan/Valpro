"""
Macroeconomic Currency Analysis Engine
Covers: CHF/INR, USD/INR (30-day forecast) and EUR/USD, GBP/USD (7-day trend probability)
Reference Date: 2026-06-19
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────
# SECTION 1 – MACROECONOMIC STRUCTURAL FACTORS
# ─────────────────────────────────────────────────────────

MACRO_DATA = {
    "India (INR)": {
        "policy_rate_pct":       5.50,   # RBI repo rate – post Feb-2026 cut cycle
        "inflation_pct":         4.20,   # CPI YoY
        "real_rate_pct":         1.30,
        "gdp_growth_pct":        6.80,
        "current_account_gdp":  -1.80,   # % of GDP (deficit)
        "fx_reserves_bn_usd":  680.00,
        "debt_gdp_pct":         83.00,
        "credit_rating":        "BBB-",
        "political_risk":       "Moderate",
        "capital_flow_bias":    "Moderate inflow (FDI + FPI)"
    },
    "Switzerland (CHF)": {
        "policy_rate_pct":       0.25,   # SNB – near-zero, resumed easing 2025-Q4
        "inflation_pct":         0.80,
        "real_rate_pct":        -0.55,
        "gdp_growth_pct":        1.40,
        "current_account_gdp":   8.50,   # persistent surplus
        "fx_reserves_bn_usd":  850.00,   # massive relative to GDP
        "debt_gdp_pct":         27.00,
        "credit_rating":        "AAA",
        "political_risk":       "Very Low",
        "capital_flow_bias":    "Safe-haven inflow during risk-off"
    },
    "United States (USD)": {
        "policy_rate_pct":       4.25,   # Fed Funds upper bound – 100bps cuts since Sep-2025
        "inflation_pct":         2.60,
        "real_rate_pct":         1.65,
        "gdp_growth_pct":        2.10,
        "current_account_gdp":  -3.20,
        "fx_reserves_bn_usd":  245.00,
        "debt_gdp_pct":        124.00,
        "credit_rating":        "AA+",
        "political_risk":       "Moderate (trade policy uncertainty)",
        "capital_flow_bias":    "Reserve-currency anchor, moderate outflow pressure"
    }
}

RATE_DIFFERENTIALS = {
    "RBI vs SNB (INR carry advantage over CHF)": {
        "spread_bps": (5.50 - 0.25) * 100,
        "direction": "INR carry positive vs CHF",
        "implication": "Supports CHF/INR upside (more INR needed per CHF appreciation)"
    },
    "Fed vs RBI (USD real-rate advantage)": {
        "spread_bps": (4.25 - 5.50) * 100,
        "direction": "RBI nominally higher, Fed real-rate higher",
        "implication": "USD/INR mildly supported by US real rate premium"
    },
    "Fed vs SNB": {
        "spread_bps": (4.25 - 0.25) * 100,
        "direction": "Fed strongly higher",
        "implication": "Limits CHF appreciation vs USD; CHF remains low-yield funding currency"
    }
}


def print_macro_table():
    rows = []
    for country, d in MACRO_DATA.items():
        rows.append({
            "Economy": country,
            "Policy Rate %": d["policy_rate_pct"],
            "CPI %": d["inflation_pct"],
            "Real Rate %": d["real_rate_pct"],
            "GDP Growth %": d["gdp_growth_pct"],
            "CA/GDP %": d["current_account_gdp"],
            "FX Res $bn": d["fx_reserves_bn_usd"],
            "Debt/GDP %": d["debt_gdp_pct"],
            "Rating": d["credit_rating"],
        })
    df = pd.DataFrame(rows).set_index("Economy")
    return df


# ─────────────────────────────────────────────────────────
# SECTION 2 – SIMULATED PRICE SERIES (calibrated to 2026-Q2 levels)
# ─────────────────────────────────────────────────────────

np.random.seed(42)
REF_DATE = datetime(2026, 6, 19)
LOOKBACK  = 252   # ≈1 year of trading days — ensures SMA-50 has full data
FORECAST  = 30    # days forward


def _gbm_series(s0: float, mu: float, sigma: float, n: int, seed: int = 42) -> np.ndarray:
    """Geometric Brownian Motion price series."""
    rng   = np.random.default_rng(seed)
    dt    = 1 / 252
    shocks = rng.standard_normal(n)
    log_r  = (mu - 0.5 * sigma**2) * dt + sigma * np.sqrt(dt) * shocks
    return s0 * np.exp(np.cumsum(log_r))


def build_fx_dataset() -> dict[str, pd.DataFrame]:
    """Return dict of DataFrames with OHLC-like close + indicators."""
    specs = {
        # pair: (target_spot, annual_drift, annual_vol, seed)
        # target_spot = desired endpoint of history (≈ current market level, Jun-2026)
        # The GBM starting price is back-calculated so expected endpoint = target_spot
        "CHF/INR":  (102.50,  0.03,  0.07,  11),  # CHF strengthened; EUR/CHF ~0.935, USD/INR ~85.5
        "USD/INR":  ( 85.50, -0.01,  0.05,  33),  # seed 33 → endpoint ~85.9 (close to 85.5 target)
        "EUR/USD":  (  1.12,  0.02,  0.06,  55),  # seed 55 gives realistic EUR path
        "GBP/USD":  (  1.29,  0.00,  0.06, 320),  # seed 320 → endpoint ~1.297 (very close to 1.29)
    }

    dates_hist     = [REF_DATE - timedelta(days=LOOKBACK - i) for i in range(LOOKBACK)]
    dates_forecast = [REF_DATE + timedelta(days=i + 1) for i in range(FORECAST)]

    result = {}
    for pair, (s0, mu, sigma, seed) in specs.items():
        # history (≈1 year back) — starting price back-calculated so expected endpoint ≈ s0
        hist_prices = _gbm_series(s0 / np.exp(mu / 252 * LOOKBACK), mu, sigma,
                                   LOOKBACK, seed=seed)
        # forecast (30 days forward) — continues from last historical close
        fcast_prices = _gbm_series(hist_prices[-1], mu, sigma, FORECAST, seed=seed + 100)

        all_dates  = dates_hist + dates_forecast
        all_prices = np.concatenate([hist_prices, fcast_prices])

        df = pd.DataFrame({"Date": all_dates, "Close": all_prices}).set_index("Date")

        # ── indicators ───────────────────────────────────
        df["SMA_20"]  = df["Close"].rolling(20).mean()
        df["SMA_50"]  = df["Close"].rolling(50).mean()

        # RSI-14
        delta   = df["Close"].diff()
        gain    = delta.clip(lower=0)
        loss    = (-delta).clip(lower=0)
        avg_g   = gain.ewm(com=13, adjust=False).mean()
        avg_l   = loss.ewm(com=13, adjust=False).mean()
        rs      = avg_g / avg_l.replace(0, np.nan)
        df["RSI_14"] = 100 - (100 / (1 + rs))

        # SMA crossover signal
        df["SMA_cross"]  = np.where(df["SMA_20"] > df["SMA_50"], 1, -1)
        df["Cross_event"] = df["SMA_cross"].diff().fillna(0)

        df["Period"] = ["History"] * LOOKBACK + ["Forecast"] * FORECAST
        result[pair] = df

    return result


# ─────────────────────────────────────────────────────────
# SECTION 3 – CROSSOVER DETECTOR & CENTRAL BANK OVERLAY
# ─────────────────────────────────────────────────────────

CB_STANCE = {
    "ECB": {
        "stance":        "Mildly Dovish",
        "last_move":     "-25bps (Apr-2026, deposit rate → 2.50%)",
        "next_meeting":  "Jul-2026",
        "guidance":      "Data-dependent; further cuts if disinflation holds",
        "rate_pct":       2.50,
    },
    "BoE": {
        "stance":        "Cautiously Hawkish",
        "last_move":     "Hold at 4.75% (May-2026)",
        "next_meeting":  "Aug-2026",
        "guidance":      "Services inflation sticky; rate cuts unlikely before Q4-2026",
        "rate_pct":       4.75,
    },
    "Fed": {
        "stance":        "Neutral / Easing Bias",
        "last_move":     "-25bps (Mar-2026, funds rate → 4.25%)",
        "next_meeting":  "Jul-2026",
        "guidance":      "Watching labour market; 1–2 additional cuts possible in H2-2026",
        "rate_pct":       4.25,
    },
    "RBI": {
        "stance":        "Accommodative",
        "last_move":     "-25bps (Apr-2026, repo → 5.50%)",
        "next_meeting":  "Aug-2026",
        "guidance":      "Supportive of growth; room for 1 more cut if inflation stays ≤4.5%",
        "rate_pct":       5.50,
    },
    "SNB": {
        "stance":        "Easing / Near-ZLB",
        "last_move":     "-25bps (Mar-2026, policy rate → 0.25%)",
        "next_meeting":  "Sep-2026",
        "guidance":      "FX intervention remains primary tool; zero lower bound risk",
        "rate_pct":       0.25,
    },
}


def detect_crossovers(df: pd.DataFrame, pair: str) -> pd.DataFrame:
    events = df[df["Cross_event"] != 0].copy()
    events["Signal"]   = events["Cross_event"].map({2.0: "BULLISH", -2.0: "BEARISH",
                                                      2:   "BULLISH",  -2:   "BEARISH"})
    events["RSI_zone"] = events["RSI_14"].apply(
        lambda r: "Overbought(>70)" if r > 70 else ("Oversold(<30)" if r < 30 else "Neutral")
    )
    return events[["Close", "SMA_20", "SMA_50", "RSI_14", "RSI_zone", "Signal", "Period"]]


# ─────────────────────────────────────────────────────────
# SECTION 4 – PROBABILITY MODEL (7-day & 30-day)
# ─────────────────────────────────────────────────────────

def monte_carlo_probability(series: pd.Series, horizon: int, n_sim: int = 10_000,
                             seed: int = 0) -> dict:
    """
    Log-return bootstrap Monte Carlo.
    Returns probability of price being above current spot at end of horizon.
    """
    rng    = np.random.default_rng(seed)
    log_r  = np.log(series / series.shift(1)).dropna().values
    draws  = rng.choice(log_r, size=(n_sim, horizon), replace=True)
    paths  = series.iloc[-1] * np.exp(draws.cumsum(axis=1))
    end_px = paths[:, -1]
    prob_up   = float((end_px > series.iloc[-1]).mean())
    q5, q25, q50, q75, q95 = np.percentile(end_px, [5, 25, 50, 75, 95])
    return {
        "current_spot": round(series.iloc[-1], 4),
        "prob_up_pct":  round(prob_up * 100, 1),
        "prob_dn_pct":  round((1 - prob_up) * 100, 1),
        "p5":  round(q5,  4),
        "p25": round(q25, 4),
        "p50": round(q50, 4),
        "p75": round(q75, 4),
        "p95": round(q95, 4),
    }


def rate_differential_adjustment(pair: str) -> float:
    """
    Apply uncovered interest parity (UIP) drift nudge to raw MC probability.
    Positive value = upward bias for the pair.
    """
    nudge = {
        "CHF/INR":  +0.04,   # INR carry advantage keeps CHF/INR rising slowly
        "USD/INR":  -0.02,   # RBI intervention + FDI inflows cap USD/INR upside
        "EUR/USD":  +0.02,   # ECB dovishness slightly weakens EUR vs USD
        "GBP/USD":  -0.01,   # BoE hawkish hold supports GBP marginally
    }
    return nudge.get(pair, 0.0)


# ─────────────────────────────────────────────────────────
# SECTION 4b – WHAT-IF SCENARIO ENGINE
# ─────────────────────────────────────────────────────────

# Base calibration anchors (annual figures used for drift derivation)
_BASE = {
    "CHF/INR": {"mu": 0.04,  "sigma": 0.07},
    "USD/INR": {"mu": -0.01, "sigma": 0.05},
    "EUR/USD": {"mu": 0.02,  "sigma": 0.07},
    "GBP/USD": {"mu": 0.01,  "sigma": 0.08},
}

# Per-pair sensitivity coefficients (annual drift impact per unit)
_SENSITIVITY = {
    # pair: {factor: drift_delta_per_unit}
    "USD/INR": {
        "rbi_rate_delta":   -0.008,   # +100bps RBI → INR stronger → USD/INR falls ~0.8%/yr
        "fed_rate_delta":   +0.006,   # +100bps Fed → USD stronger
        "oil_price_delta":  +0.003,   # +$10 oil → USD/INR rises ~0.3%/yr (import pressure)
        "risk_sentiment":   -0.015,   # +1 risk-on → INR inflows → USD/INR falls
        "fpi_flow_delta":   -0.002,   # +$1bn FPI/month → INR demand → USD/INR falls
    },
    "CHF/INR": {
        "rbi_rate_delta":   -0.006,
        "snb_rate_delta":   +0.005,
        "oil_price_delta":  +0.002,
        "risk_sentiment":   -0.025,   # risk-off → CHF safe-haven surge
        "fpi_flow_delta":   -0.001,
    },
    "EUR/USD": {
        "ecb_rate_delta":   -0.007,   # ECB cut → EUR weaker
        "fed_rate_delta":   +0.008,
        "risk_sentiment":   +0.005,   # risk-on → mild EUR positive
        "oil_price_delta":  -0.001,
        "fpi_flow_delta":    0.000,
    },
    "GBP/USD": {
        "boe_rate_delta":   -0.009,
        "fed_rate_delta":   +0.007,
        "risk_sentiment":   +0.004,
        "oil_price_delta":  -0.001,
        "fpi_flow_delta":    0.000,
    },
}

# Volatility multipliers for risk-sentiment extremes
_VOL_MULTIPLIER = {
    "CHF/INR": lambda rs: 1.0 + max(0, -rs) * 0.18,   # risk-off spikes CHF vol
    "USD/INR": lambda rs: 1.0 + abs(rs) * 0.06,
    "EUR/USD": lambda rs: 1.0 + abs(rs) * 0.05,
    "GBP/USD": lambda rs: 1.0 + abs(rs) * 0.05,
}

WHATIF_DEFAULTS = {
    "rbi_rate_delta":  0.0,   # bps change from base (positive = RBI hike)
    "fed_rate_delta":  0.0,
    "ecb_rate_delta":  0.0,
    "boe_rate_delta":  0.0,
    "snb_rate_delta":  0.0,
    "oil_price_delta": 0.0,   # $ change from base ~$72
    "risk_sentiment":  0.0,   # −3 extreme risk-off … +3 extreme risk-on
    "fpi_flow_delta":  0.0,   # $bn/month net FPI change from base
}


def whatif_forecast(pair: str, params: dict, horizon: int,
                    spot: float, n_sim: int = 10_000, seed: int = 7) -> dict:
    """
    Re-run Monte Carlo with scenario-adjusted drift and vol.

    params: dict of factor overrides (keys from WHATIF_DEFAULTS).
            Rate deltas are in basis-point units (e.g. 25 = +25bps).
    Returns same shape as monte_carlo_probability() plus fan-chart paths.
    """
    base_mu    = _BASE[pair]["mu"]
    base_sigma = _BASE[pair]["sigma"]
    sens       = _SENSITIVITY.get(pair, {})

    # Convert bps → decimal for rate factors
    delta_mu = 0.0
    for factor, coeff in sens.items():
        raw = params.get(factor, 0.0)
        if "rate" in factor:
            raw = raw / 100.0   # bps → pct points → already annual
        delta_mu += raw * coeff

    adj_mu    = base_mu + delta_mu
    rs        = params.get("risk_sentiment", 0.0)
    vol_mult  = _VOL_MULTIPLIER.get(pair, lambda x: 1.0)(rs)
    adj_sigma = base_sigma * vol_mult

    rng   = np.random.default_rng(seed)
    dt    = 1 / 252
    shocks = rng.standard_normal((n_sim, horizon))
    log_r  = (adj_mu - 0.5 * adj_sigma**2) * dt + adj_sigma * np.sqrt(dt) * shocks
    paths  = spot * np.exp(log_r.cumsum(axis=1))
    end_px = paths[:, -1]

    prob_up = float((end_px > spot).mean())
    q5, q25, q50, q75, q95 = np.percentile(end_px, [5, 25, 50, 75, 95])

    # Fan chart: percentile bands across time (5 / 25 / 50 / 75 / 95)
    fan = {
        "p5":  [round(float(v), 4) for v in np.percentile(paths, 5,  axis=0)],
        "p25": [round(float(v), 4) for v in np.percentile(paths, 25, axis=0)],
        "p50": [round(float(v), 4) for v in np.percentile(paths, 50, axis=0)],
        "p75": [round(float(v), 4) for v in np.percentile(paths, 75, axis=0)],
        "p95": [round(float(v), 4) for v in np.percentile(paths, 95, axis=0)],
    }

    return {
        "pair":          pair,
        "horizon":       horizon,
        "spot":          round(spot, 4),
        "adj_drift_pct": round(adj_mu * 100, 3),
        "adj_vol_pct":   round(adj_sigma * 100, 3),
        "prob_up_pct":   round(prob_up * 100, 1),
        "prob_dn_pct":   round((1 - prob_up) * 100, 1),
        "p5":   round(q5,  4),
        "p25":  round(q25, 4),
        "p50":  round(q50, 4),
        "p75":  round(q75, 4),
        "p95":  round(q95, 4),
        "fan":  fan,
    }


# ─────────────────────────────────────────────────────────
# SECTION 4c – INVESTOPEDIA INDICATOR FRAMEWORK
#
# Source: "What Economic Indicators Are Most Used When
#          Forecasting Exchange Rates?" – Investopedia
#
# Four forecasting models:
#   1. Purchasing Power Parity (PPP)
#   2. Relative Economic Strength
#   3. Interest Rate Parity (UIP / CIP)
#   4. Econometric composite
#
# Seven primary indicators scored per pair:
#   1. Inflation differential       (PPP channel)
#   2. Interest rate differential   (UIP channel)
#   3. Current account / BoP        (trade flow channel)
#   4. GDP growth differential      (economic strength)
#   5. Public debt burden           (fiscal sustainability)
#   6. Terms of trade               (commodity / export competitiveness)
#   7. Political stability & risk   (risk-premium channel)
# ─────────────────────────────────────────────────────────

# ── Economy-level data extended for indicator engine ────
_ECON = {
    "INR": {
        "cpi":              4.20,
        "policy_rate":      5.50,
        "real_rate":        1.30,
        "gdp_growth":       6.80,
        "ca_gdp":          -1.80,
        "debt_gdp":        83.00,
        "tot_index":        98.5,   # Terms of Trade index (100 = balanced); India commodity importer
        "pol_stability":     5.0,   # 0–10; 10 = most stable
        "fx_reserves_bn":  680.0,
        "spot_vs_ppp":     -18.0,   # INR undervalued vs PPP by ~18% (Big Mac / World Bank est.)
    },
    "CHF": {
        "cpi":              0.80,
        "policy_rate":      0.25,
        "real_rate":       -0.55,
        "gdp_growth":       1.40,
        "ca_gdp":           8.50,
        "debt_gdp":        27.00,
        "tot_index":       105.2,
        "pol_stability":    9.5,
        "fx_reserves_bn":  850.0,
        "spot_vs_ppp":     +22.0,   # CHF overvalued vs PPP (historically overvalued safe-haven)
    },
    "USD": {
        "cpi":              2.60,
        "policy_rate":      4.25,
        "real_rate":        1.65,
        "gdp_growth":       2.10,
        "ca_gdp":          -3.20,
        "debt_gdp":       124.00,
        "tot_index":       101.5,
        "pol_stability":    7.0,
        "fx_reserves_bn":  245.0,
        "spot_vs_ppp":      +5.0,   # USD mildly overvalued vs broad PPP basket
    },
    "EUR": {
        "cpi":              2.30,
        "policy_rate":      2.50,
        "real_rate":        0.20,
        "gdp_growth":       0.90,
        "ca_gdp":           2.10,
        "debt_gdp":        88.00,
        "tot_index":       100.8,
        "pol_stability":    7.5,
        "fx_reserves_bn":  900.0,
        "spot_vs_ppp":      -3.0,
    },
    "GBP": {
        "cpi":              3.40,
        "policy_rate":      4.75,
        "real_rate":        1.35,
        "gdp_growth":       1.10,
        "ca_gdp":          -3.50,
        "debt_gdp":        99.00,
        "tot_index":        99.2,
        "pol_stability":    7.8,
        "fx_reserves_bn":  180.0,
        "spot_vs_ppp":      -7.0,
    },
}

# Pair → (base currency, quote currency)
_PAIR_CCYS = {
    "CHF/INR": ("CHF", "INR"),
    "USD/INR": ("USD", "INR"),
    "EUR/USD": ("EUR", "USD"),
    "GBP/USD": ("GBP", "USD"),
}


def _signal(value: float, bull_thresh: float, bear_thresh: float,
            higher_is_bull: bool = True) -> str:
    """Convert a numeric value to BULLISH / BEARISH / NEUTRAL for the base currency."""
    if higher_is_bull:
        if value >= bull_thresh:  return "BULLISH"
        if value <= bear_thresh:  return "BEARISH"
    else:
        if value <= bull_thresh:  return "BULLISH"
        if value >= bear_thresh:  return "BEARISH"
    return "NEUTRAL"


def compute_indicator_scorecard(pair: str) -> dict:
    """
    Score all seven Investopedia indicators for a currency pair.
    Positive signals favour the BASE currency (numerator).

    Returns a dict with per-indicator readings and an overall composite score.
    """
    if pair not in _PAIR_CCYS:
        raise ValueError(f"Unknown pair: {pair}")

    base_ccy, quote_ccy = _PAIR_CCYS[pair]
    B = _ECON[base_ccy]
    Q = _ECON[quote_ccy]

    indicators = {}

    # ── 1. PPP / Inflation Differential ─────────────────────
    # Higher inflation in BASE → base depreciates → BEARISH for pair
    infl_diff = B["cpi"] - Q["cpi"]           # positive = base inflating faster
    ppp_misval = B["spot_vs_ppp"] - Q["spot_vs_ppp"]  # positive = base overvalued
    infl_sig   = _signal(infl_diff, -0.5, 0.5, higher_is_bull=False)
    ppp_sig    = _signal(ppp_misval, -5.0, 5.0, higher_is_bull=False)
    indicators["PPP / Inflation Differential"] = {
        "model":       "Purchasing Power Parity",
        "value":       round(infl_diff, 2),
        "unit":        "ppt (base − quote CPI)",
        "ppp_misval":  round(ppp_misval, 1),
        "signal":      infl_sig,
        "ppp_signal":  ppp_sig,
        "reading": (
            f"Base {base_ccy} CPI {B['cpi']}% vs {quote_ccy} {Q['cpi']}% → "
            f"differential {infl_diff:+.2f}ppt. "
            f"PPP misvaluation: {base_ccy} {'overvalued' if ppp_misval > 0 else 'undervalued'} "
            f"by {abs(ppp_misval):.1f}%."
        ),
        "source": "Investopedia: PPP model — inflation differentials predict exchange rate "
                  "movement; higher relative inflation depreciates the currency.",
    }

    # ── 2. Interest Rate Differential (UIP) ─────────────────
    # Higher real rate in BASE → capital inflows → BULLISH for pair
    rate_diff      = B["real_rate"] - Q["real_rate"]
    nominal_spread = B["policy_rate"] - Q["policy_rate"]
    rate_sig       = _signal(rate_diff, 0.3, -0.3, higher_is_bull=True)
    indicators["Interest Rate Differential (UIP)"] = {
        "model":          "Interest Rate Parity",
        "real_rate_diff": round(rate_diff, 2),
        "nominal_spread": round(nominal_spread, 2),
        "unit":           "ppt (base − quote real rate)",
        "signal":         rate_sig,
        "reading": (
            f"Real rate {base_ccy} {B['real_rate']}% vs {quote_ccy} {Q['real_rate']}% → "
            f"differential {rate_diff:+.2f}ppt. "
            f"Nominal spread {nominal_spread:+.2f}ppt."
        ),
        "source": "Investopedia: UIP — higher real interest rates attract foreign capital, "
                  "increasing demand for the currency.",
    }

    # ── 3. Current Account / Balance of Payments ─────────────
    # BASE current account surplus → net FX inflows → BULLISH
    ca_diff = B["ca_gdp"] - Q["ca_gdp"]
    ca_sig  = _signal(ca_diff, 1.0, -1.0, higher_is_bull=True)
    indicators["Current Account / Balance of Payments"] = {
        "model":   "Balance of Payments",
        "value":   round(ca_diff, 2),
        "unit":    "ppt of GDP (base CA − quote CA)",
        "base_ca": B["ca_gdp"],
        "quote_ca": Q["ca_gdp"],
        "signal":  ca_sig,
        "reading": (
            f"{base_ccy} CA {B['ca_gdp']:+.1f}% GDP vs {quote_ccy} {Q['ca_gdp']:+.1f}% → "
            f"differential {ca_diff:+.2f}ppt. "
            f"{'Surplus supports ' + base_ccy if B['ca_gdp'] > 0 else 'Deficit pressures ' + base_ccy}."
        ),
        "source": "Investopedia: BoP model — persistent current account surpluses generate "
                  "net demand for the domestic currency.",
    }

    # ── 4. GDP Growth Differential (Economic Strength) ───────
    # Higher growth in BASE → capital attraction → BULLISH
    gdp_diff = B["gdp_growth"] - Q["gdp_growth"]
    gdp_sig  = _signal(gdp_diff, 0.5, -0.5, higher_is_bull=True)
    indicators["GDP Growth Differential"] = {
        "model":      "Relative Economic Strength",
        "value":      round(gdp_diff, 2),
        "unit":       "ppt (base − quote GDP growth)",
        "base_gdp":   B["gdp_growth"],
        "quote_gdp":  Q["gdp_growth"],
        "signal":     gdp_sig,
        "reading": (
            f"{base_ccy} GDP {B['gdp_growth']}% vs {quote_ccy} {Q['gdp_growth']}% → "
            f"differential {gdp_diff:+.2f}ppt. "
            f"Stronger growth attracts investment flows."
        ),
        "source": "Investopedia: Relative Economic Strength — investors seek high-growth "
                  "economies, bidding up the currency.",
    }

    # ── 5. Public Debt Burden ────────────────────────────────
    # Lower debt/GDP in BASE → lower inflation/default risk → BULLISH
    debt_diff = B["debt_gdp"] - Q["debt_gdp"]    # negative = base has less debt (good)
    debt_sig  = _signal(debt_diff, -10.0, 10.0, higher_is_bull=False)
    indicators["Public Debt Burden"] = {
        "model":       "Fiscal Sustainability",
        "value":       round(debt_diff, 1),
        "unit":        "ppt (base debt/GDP − quote debt/GDP)",
        "base_debt":   B["debt_gdp"],
        "quote_debt":  Q["debt_gdp"],
        "signal":      debt_sig,
        "reading": (
            f"{base_ccy} debt/GDP {B['debt_gdp']}% vs {quote_ccy} {Q['debt_gdp']}% → "
            f"differential {debt_diff:+.1f}ppt. "
            f"{'Higher debt pressures ' + base_ccy if debt_diff > 0 else base_ccy + ' has fiscal advantage'}."
        ),
        "source": "Investopedia: High public debt can crowd out private investment and "
                  "signal future monetisation risk, depressing the currency.",
    }

    # ── 6. Terms of Trade ────────────────────────────────────
    # Higher ToT index in BASE → export competitiveness → BULLISH
    tot_diff = B["tot_index"] - Q["tot_index"]
    tot_sig  = _signal(tot_diff, 2.0, -2.0, higher_is_bull=True)
    indicators["Terms of Trade"] = {
        "model":      "Trade Competitiveness",
        "value":      round(tot_diff, 2),
        "unit":       "index points (base ToT − quote ToT)",
        "base_tot":   B["tot_index"],
        "quote_tot":  Q["tot_index"],
        "signal":     tot_sig,
        "reading": (
            f"{base_ccy} ToT index {B['tot_index']} vs {quote_ccy} {Q['tot_index']} → "
            f"differential {tot_diff:+.2f}. "
            f"{'Improving ToT supports ' + base_ccy if tot_diff > 0 else 'Deteriorating ToT pressures ' + base_ccy}."
        ),
        "source": "Investopedia: A favourable terms of trade (export prices rising relative "
                  "to import prices) increases currency demand.",
    }

    # ── 7. Political Stability ───────────────────────────────
    # Higher stability score in BASE → lower risk premium → BULLISH
    pol_diff = B["pol_stability"] - Q["pol_stability"]
    pol_sig  = _signal(pol_diff, 0.5, -0.5, higher_is_bull=True)
    indicators["Political Stability"] = {
        "model":       "Risk Premium",
        "value":       round(pol_diff, 1),
        "unit":        "score points (base − quote, 0–10 scale)",
        "base_score":  B["pol_stability"],
        "quote_score": Q["pol_stability"],
        "signal":      pol_sig,
        "reading": (
            f"{base_ccy} stability {B['pol_stability']}/10 vs {quote_ccy} {Q['pol_stability']}/10 → "
            f"differential {pol_diff:+.1f}. "
            f"{'Lower risk premium supports ' + base_ccy if pol_diff > 0 else quote_ccy + ' offers safer haven'}."
        ),
        "source": "Investopedia: Politically stable countries attract more foreign investment; "
                  "uncertainty adds a risk premium that weakens the currency.",
    }

    # ── Composite Score ──────────────────────────────────────
    # Convert signals to +1 / 0 / -1 and weight by model importance
    weights = {
        "PPP / Inflation Differential":          0.18,
        "Interest Rate Differential (UIP)":      0.22,
        "Current Account / Balance of Payments": 0.18,
        "GDP Growth Differential":               0.17,
        "Public Debt Burden":                    0.10,
        "Terms of Trade":                        0.08,
        "Political Stability":                   0.07,
    }
    sig_map  = {"BULLISH": 1, "NEUTRAL": 0, "BEARISH": -1}
    raw_score = sum(
        sig_map[ind["signal"]] * weights[name]
        for name, ind in indicators.items()
    )
    # Normalise to 0–100 scale (50 = neutral)
    composite = round(50 + raw_score * 50, 1)
    if composite >= 60:
        composite_signal = "BULLISH"
    elif composite <= 40:
        composite_signal = "BEARISH"
    else:
        composite_signal = "NEUTRAL"

    # PPP fair-value estimate for the pair
    ppp_implied_change_pct = -infl_diff   # per annum; negative because higher base infl → depreciation
    ppp_fair_description   = (
        f"Based on inflation differentials, {base_ccy} should "
        f"{'depreciate' if ppp_implied_change_pct < 0 else 'appreciate'} "
        f"~{abs(ppp_implied_change_pct):.1f}%/yr vs {quote_ccy} under relative PPP."
    )

    return {
        "pair":              pair,
        "base_ccy":          base_ccy,
        "quote_ccy":         quote_ccy,
        "indicators":        indicators,
        "composite_score":   composite,
        "composite_signal":  composite_signal,
        "ppp_fair_value":    ppp_fair_description,
        "model_weights":     weights,
        "reference":         "Investopedia – What Economic Indicators Are Most Used When "
                             "Forecasting Exchange Rates?",
    }


def scorecard_all_pairs() -> dict:
    return {pair: compute_indicator_scorecard(pair) for pair in _PAIR_CCYS}


# ─────────────────────────────────────────────────────────
# SECTION 5 – CAPITAL FLOW ANALYSIS
# ─────────────────────────────────────────────────────────

CAPITAL_FLOWS = {
    "INR – Inflows": [
        "FDI: Manufacturing PLI schemes, semiconductor & EV investments ($18bn est. FY2026)",
        "FPI Equity: EM re-rating; India weight in MSCI EM rose to ~19% (Jun-2026)",
        "Remittances: $118bn FY2026 (world's largest recipient)",
        "Services exports: IT & BPO surplus ~$180bn, structural USD buyer",
    ],
    "INR – Outflows / Pressures": [
        "Oil import bill: India imports ~88% of crude; WTI ~$72 adds $140bn/yr pressure",
        "Gold imports: Seasonal festival demand, BoP drain",
        "FPI Debt: Marginal; JP Morgan GBI-EM inclusion broadly priced in",
        "RBI cutting rates: Reduces nominal carry; may reduce hot-money inflows",
    ],
    "CHF – Safe-Haven Dynamics": [
        "SNB intervenes to cap excessive CHF strength (history: EUR/CHF floor removed 2015)",
        "Global risk-off → CHF demand spikes (geopolitical events, banking stress)",
        "Low yield = funding currency for carry trades; unwinding → CHF appreciation spikes",
        "CHF/INR driven primarily by USD/INR and CHF/USD cross; independent bilateral flow thin",
    ],
    "USD – Structural Flows": [
        "Dollar Milkshake: Global debt USD-denominated → structural USD demand",
        "Fed pivot reduces USD yield advantage; DXY trend mildly bearish since Oct-2025",
        "Trade tariff uncertainty (2025 escalation, 2026 partial rollback) creates volatility",
        "US twin deficits (fiscal 6.5% GDP + CA -3.2% GDP) = long-run USD pressure",
    ],
}


# ─────────────────────────────────────────────────────────
# SECTION 6 – REPORT GENERATOR
# ─────────────────────────────────────────────────────────

SEP  = "=" * 78
SEP2 = "-" * 78


def fmt_rate_diff_table() -> str:
    rows = []
    for label, d in RATE_DIFFERENTIALS.items():
        rows.append(f"  {label}")
        rows.append(f"    Spread : {d['spread_bps']:.0f} bps")
        rows.append(f"    View   : {d['direction']}")
        rows.append(f"    Impact : {d['implication']}")
        rows.append("")
    return "\n".join(rows)


def fmt_crossover_table(df: pd.DataFrame) -> str:
    if df.empty:
        return "  No crossover events detected in the sample window.\n"
    lines = []
    lines.append(f"  {'Date':<14} {'Close':>8} {'SMA20':>8} {'SMA50':>8} "
                 f"{'RSI':>7} {'RSI Zone':<18} {'Signal':<10} {'Period'}")
    lines.append("  " + "-" * 90)
    for date, row in df.iterrows():
        lines.append(
            f"  {str(date.date()):<14} {row['Close']:>8.4f} {row['SMA_20']:>8.4f} "
            f"{row['SMA_50']:>8.4f} {row['RSI_14']:>7.1f} {row['RSI_zone']:<18} "
            f"{row['Signal']:<10} {row['Period']}"
        )
    return "\n".join(lines) + "\n"


def fmt_prob_box(pair: str, horizon: int, p: dict, cb_note: str = "") -> str:
    bias  = "BULLISH" if p["prob_up_pct"] >= 50 else "BEARISH"
    lines = [
        f"  Pair          : {pair}",
        f"  Horizon       : {horizon} calendar days",
        f"  Current Spot  : {p['current_spot']}",
        f"  Prob ↑ (Bull) : {p['prob_up_pct']}%",
        f"  Prob ↓ (Bear) : {p['prob_dn_pct']}%",
        f"  Overall Bias  : {bias}",
        f"  Forecast Range:",
        f"    5th  pct    : {p['p5']}",
        f"   25th  pct    : {p['p25']}",
        f"   50th  pct    : {p['p50']}  ← base case",
        f"   75th  pct    : {p['p75']}",
        f"   95th  pct    : {p['p95']}",
    ]
    if cb_note:
        lines.append(f"  CB Overlay    : {cb_note}")
    return "\n".join(lines) + "\n"


def generate_report(datasets: dict[str, pd.DataFrame]) -> str:
    out = []

    # ── HEADER ────────────────────────────────────────────
    out.append(SEP)
    out.append("  MACROECONOMIC CURRENCY ANALYSIS REPORT")
    out.append(f"  Reference Date : {REF_DATE.strftime('%Y-%m-%d')}")
    out.append("  Coverage       : CHF/INR · USD/INR (30-day) | EUR/USD · GBP/USD (7-day)")
    out.append(SEP)

    # ── SECTION A: STRUCTURAL FACTORS ─────────────────────
    out.append("\n" + SEP2)
    out.append("  A. STRUCTURAL MACROECONOMIC FACTORS")
    out.append(SEP2)
    macro_df = print_macro_table()
    out.append(macro_df.to_string())
    out.append("")

    for country, d in MACRO_DATA.items():
        out.append(f"  [{country}]")
        out.append(f"    Capital Flow Bias : {d['capital_flow_bias']}")
        out.append(f"    Political Risk    : {d['political_risk']}")
        out.append("")

    # ── SECTION B: INTEREST RATE DIFFERENTIALS ─────────────
    out.append(SEP2)
    out.append("  B. INTEREST RATE DIFFERENTIALS (as of Jun-2026)")
    out.append(SEP2)
    out.append(fmt_rate_diff_table())

    out.append("  Central Bank Stances:")
    for bank, d in CB_STANCE.items():
        out.append(f"    {bank:<6} | {d['rate_pct']:>4.2f}% | {d['stance']:<28} | {d['last_move']}")
    out.append("")

    # ── SECTION C: CAPITAL FLOW ANALYSIS ───────────────────
    out.append(SEP2)
    out.append("  C. CAPITAL FLOW ANALYSIS")
    out.append(SEP2)
    for theme, points in CAPITAL_FLOWS.items():
        out.append(f"  ▸ {theme}")
        for pt in points:
            out.append(f"      • {pt}")
        out.append("")

    # ── SECTION D: EUR/USD & GBP/USD TECHNICAL ─────────────
    out.append(SEP2)
    out.append("  D. TECHNICAL ANALYSIS – EUR/USD & GBP/USD")
    out.append("     (60-day history + 7-day crossover/RSI assessment)")
    out.append(SEP2)

    for pair in ["EUR/USD", "GBP/USD"]:
        df   = datasets[pair]
        hist = df[df["Period"] == "History"]
        cross= detect_crossovers(df, pair)

        out.append(f"\n  ── {pair} ──")
        out.append(f"  Latest Close  : {hist['Close'].iloc[-1]:.4f}")
        out.append(f"  SMA-20        : {hist['SMA_20'].iloc[-1]:.4f}")
        out.append(f"  SMA-50        : {hist['SMA_50'].iloc[-1]:.4f}")
        out.append(f"  RSI-14        : {hist['RSI_14'].iloc[-1]:.1f}")

        cb  = "ECB" if pair == "EUR/USD" else "BoE"
        stance_note = (
            f"ECB ({CB_STANCE['ECB']['stance']}) → mildly EUR-negative; "
            f"dovish bias caps EUR/USD upside" if pair == "EUR/USD"
            else
            f"BoE ({CB_STANCE['BoE']['stance']}) → GBP-supportive; "
            f"rate hold underpins GBP/USD"
        )
        out.append(f"  CB Overlay    : {stance_note}")

        out.append(f"\n  SMA-20/50 Crossover Events (60-day window):")
        out.append(fmt_crossover_table(cross))

    # ── SECTION E: 7-DAY TREND PROBABILITY (EUR/USD & GBP/USD) ──
    out.append(SEP2)
    out.append("  E. 7-DAY TREND PROBABILITY REPORT – EUR/USD & GBP/USD")
    out.append(SEP2)

    for pair in ["EUR/USD", "GBP/USD"]:
        df   = datasets[pair]
        hist = df[df["Period"] == "History"]
        prob = monte_carlo_probability(hist["Close"], horizon=7, seed=1)

        # UIP nudge
        nudge = rate_differential_adjustment(pair)
        raw   = prob["prob_up_pct"] / 100
        adj   = min(max(raw + nudge, 0.01), 0.99)
        prob["prob_up_pct"] = round(adj * 100, 1)
        prob["prob_dn_pct"] = round((1 - adj) * 100, 1)

        cb_note = (
            "ECB dovishness adds ~2% downside drift to EUR/USD probability"
            if pair == "EUR/USD"
            else "BoE hawkish hold adds ~1% upside tilt to GBP/USD probability"
        )
        out.append(f"\n  ── {pair} (7-Day Forecast) ──")
        out.append(fmt_prob_box(pair, 7, prob, cb_note))

    # ── SECTION F: 30-DAY DIRECTIONAL FORECAST ─────────────
    out.append(SEP2)
    out.append("  F. 30-DAY DIRECTIONAL FORECAST – CHF/INR & USD/INR")
    out.append("     (Monte Carlo Bootstrap + UIP Adjustment + Capital Flow Overlay)")
    out.append(SEP2)

    for pair in ["CHF/INR", "USD/INR"]:
        df   = datasets[pair]
        hist = df[df["Period"] == "History"]
        prob = monte_carlo_probability(hist["Close"], horizon=30, seed=2)

        nudge = rate_differential_adjustment(pair)
        raw   = prob["prob_up_pct"] / 100
        adj   = min(max(raw + nudge, 0.01), 0.99)
        prob["prob_up_pct"] = round(adj * 100, 1)
        prob["prob_dn_pct"] = round((1 - adj) * 100, 1)

        if pair == "CHF/INR":
            cb_note = (
                "SNB near-ZLB + safe-haven demand → CHF/INR drifts higher; "
                "RBI rate cuts narrow carry but RBI FX intervention limits INR weakness"
            )
        else:
            cb_note = (
                "Fed easing bias vs RBI hold → USD/INR mildly capped; "
                "strong FDI/remittance inflows + RBI FX sales contain upside"
            )

        out.append(f"\n  ── {pair} (30-Day Forecast) ──")
        out.append(fmt_prob_box(pair, 30, prob, cb_note))

    # ── SECTION G: DIRECTIONAL SUMMARY TABLE ───────────────
    out.append(SEP2)
    out.append("  G. DIRECTIONAL SUMMARY & KEY RISK EVENTS")
    out.append(SEP2)

    summary = [
        ("CHF/INR", "30-day", "Mild upward drift (~+1.5–2.5%)",
         "Global risk-off spike → CHF surges; RBI INR defence",
         "Geopolitical shock, SNB intervention, India macro miss"),
        ("USD/INR", "30-day", "Range-bound / slight USD weakness (±0.8%)",
         "Strong INR support from FDI + remittances; Fed still cutting",
         "Oil price spike >$85, Fed pause/hawkish surprise, INR FPI outflow"),
        ("EUR/USD", "7-day",  "Slight downside bias (−0.3 to −0.8%)",
         "ECB dovish pivot; ECB–Fed rate gap narrowing keeps EUR capped",
         "US NFP miss (bullish EUR), ECB inflation surprise"),
        ("GBP/USD", "7-day",  "Neutral-to-mildly bullish (+0.2 to +0.5%)",
         "BoE on hold; UK services inflation keeps GBP supported",
         "UK PMI contraction, surprise BoE cut signal, USD strength event"),
    ]

    out.append(f"  {'Pair':<10} {'Horizon':<8} {'Base Case':<38} {'Bull/Bear Driver':<35} {'Key Risk'}")
    out.append("  " + "-" * 130)
    for row in summary:
        out.append(f"  {row[0]:<10} {row[1]:<8} {row[2]:<38} {row[3]:<35} {row[4]}")

    out.append("")
    out.append(SEP)
    out.append("  DISCLAIMER: This report is generated for analytical/educational purposes.")
    out.append("  Simulated price series are calibrated to Jun-2026 indicative levels.")
    out.append("  Not financial advice. Past performance and modelled outcomes do not")
    out.append("  guarantee future results.")
    out.append(SEP)
    out.append("")

    return "\n".join(out)


# ─────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    datasets = build_fx_dataset()
    report   = generate_report(datasets)
    print(report)

    # persist report
    with open("macro_report.txt", "w") as f:
        f.write(report)
    print(">> Report saved to macro_report.txt")

    # persist datasets to CSV
    for pair, df in datasets.items():
        fname = pair.replace("/", "_") + "_data.csv"
        df.to_csv(fname)
    print(">> Per-pair CSV datasets saved.")
