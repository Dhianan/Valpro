"""Flask web server for the Macroeconomic Currency Analysis Dashboard."""

from flask import Flask, jsonify, render_template, request
from currency_analysis import (
    build_fx_dataset,
    detect_crossovers,
    monte_carlo_probability,
    rate_differential_adjustment,
    whatif_forecast,
    scorecard_all_pairs,
    WHATIF_DEFAULTS,
    MACRO_DATA,
    RATE_DIFFERENTIALS,
    CB_STANCE,
    CAPITAL_FLOWS,
    REF_DATE,
)

app = Flask(__name__)

# ── build datasets once at startup ──────────────────────
_datasets = build_fx_dataset()


def _series_payload(pair: str) -> dict:
    df   = _datasets[pair]
    hist = df[df["Period"] == "History"]
    fcast= df[df["Period"] == "Forecast"]

    def _fmt(d):
        return {
            "dates":  [str(x.date()) for x in d.index],
            "close":  [round(v, 4) for v in d["Close"]],
            "sma20":  [round(v, 4) if v == v else None for v in d["SMA_20"]],
            "sma50":  [round(v, 4) if v == v else None for v in d["SMA_50"]],
            "rsi":    [round(v, 1) if v == v else None for v in d["RSI_14"]],
        }

    crossovers = detect_crossovers(df, pair)
    cross_list = [
        {
            "date":   str(idx.date()),
            "close":  round(row["Close"], 4),
            "sma20":  round(row["SMA_20"], 4),
            "sma50":  round(row["SMA_50"], 4),
            "rsi":    round(row["RSI_14"], 1),
            "zone":   row["RSI_zone"],
            "signal": row["Signal"],
            "period": row["Period"],
        }
        for idx, row in crossovers.iterrows()
    ]

    return {
        "history":  _fmt(hist),
        "forecast": _fmt(fcast),
        "crossovers": cross_list,
        "latest": {
            "close": round(hist["Close"].iloc[-1], 4),
            "sma20": round(hist["SMA_20"].iloc[-1], 4),
            "sma50": round(hist["SMA_50"].iloc[-1], 4),
            "rsi":   round(hist["RSI_14"].iloc[-1], 1),
        },
    }


def _prob_payload(pair: str, horizon: int, seed: int) -> dict:
    df   = _datasets[pair]
    hist = df[df["Period"] == "History"]
    prob = monte_carlo_probability(hist["Close"], horizon=horizon, seed=seed)
    nudge = rate_differential_adjustment(pair)
    raw   = prob["prob_up_pct"] / 100
    adj   = min(max(raw + nudge, 0.01), 0.99)
    prob["prob_up_pct"] = round(adj * 100, 1)
    prob["prob_dn_pct"] = round((1 - adj) * 100, 1)
    return prob


# ── routes ──────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html", ref_date=REF_DATE.strftime("%Y-%m-%d"))


@app.route("/api/macro")
def api_macro():
    return jsonify({
        "macro":     MACRO_DATA,
        "rates":     RATE_DIFFERENTIALS,
        "cb_stance": CB_STANCE,
        "flows":     CAPITAL_FLOWS,
    })


@app.route("/api/series/<pair>")
def api_series(pair: str):
    key = pair.replace("-", "/")
    if key not in _datasets:
        return jsonify({"error": "unknown pair"}), 404
    return jsonify(_series_payload(key))


@app.route("/api/forecast")
def api_forecast():
    return jsonify({
        "EUR/USD": _prob_payload("EUR/USD", 7,  seed=1),
        "GBP/USD": _prob_payload("GBP/USD", 7,  seed=1),
        "CHF/INR": _prob_payload("CHF/INR", 30, seed=2),
        "USD/INR": _prob_payload("USD/INR", 30, seed=2),
    })


@app.route("/api/whatif", methods=["POST"])
def api_whatif():
    body    = request.get_json(force=True) or {}
    pair    = body.get("pair", "USD/INR")
    horizon = int(body.get("horizon", 30))

    if pair not in _datasets:
        return jsonify({"error": "unknown pair"}), 400

    # Build params: start from defaults, overlay user values
    params = {**WHATIF_DEFAULTS, **{k: float(v) for k, v in body.get("params", {}).items()}}

    df   = _datasets[pair]
    hist = df[df["Period"] == "History"]
    spot = float(hist["Close"].iloc[-1])

    # Base case (zero deltas) for comparison
    base = whatif_forecast(pair, WHATIF_DEFAULTS, horizon, spot, seed=7)

    # Scenario case
    scenario = whatif_forecast(pair, params, horizon, spot, seed=7)

    # Forecast date labels
    from datetime import timedelta
    dates = [(REF_DATE + timedelta(days=i + 1)).strftime("%Y-%m-%d")
             for i in range(horizon)]

    return jsonify({
        "pair":     pair,
        "horizon":  horizon,
        "dates":    dates,
        "base":     base,
        "scenario": scenario,
        "params":   params,
    })


@app.route("/api/indicators")
def api_indicators():
    return jsonify(scorecard_all_pairs())


@app.route("/api/whatif/defaults")
def api_whatif_defaults():
    return jsonify(WHATIF_DEFAULTS)


if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=5000)
