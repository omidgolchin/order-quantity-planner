"""Forecasting demand for the next period, judged by backtest.

Three textbook methods race on the product's own history by rolling-origin
backtest (Hyndman & Athanasopoulos, *Forecasting: Principles and Practice*,
3rd ed., ch. 5): seasonal naive, ETS (exponential smoothing, statsmodels)
and ARIMA (statsmodels, order by AIC over a small grid). The winner makes
the forecast; its backtest 80% interval coverage is reported, because a
forecast is only as good as its calibration.

Two demand problems get their own handling:

- Intermittent demand (many zero periods): ETS and ARIMA break down, so
  the distribution is a bootstrap of the observed periods (the standard
  fallback; see Syntetos & Boylan 2005 on intermittent demand).
- Censored demand: periods that sold exactly the stock on hand understate
  demand. Those periods are replaced by a draw from the observed demand
  at or above the stock level (a Kaplan-Meier style imputation), which
  widens the upper tail instead of pretending sales were demand.
"""

from __future__ import annotations

import warnings

import numpy as np

Z80 = 1.2816
INTERMITTENT_ZERO_SHARE = 0.30
ARIMA_GRID = [(1, 1, 1), (0, 1, 1), (1, 1, 2), (2, 1, 1)]


def _as_array(series) -> np.ndarray:
    return np.asarray([float(x) for x in series], dtype=float)


# ---------------- base methods: (point, in-sample one-step residuals) ---------

def _snaive(train: np.ndarray, season: int):
    if season > 1 and len(train) > season:
        point = float(train[-season])
        resid = train[season:] - train[:-season]
    elif len(train) >= 2:
        point = float(train[-1])
        resid = np.diff(train)
    else:
        point = float(train[-1]) if len(train) else 0.0
        resid = np.array([0.0])
    return point, np.asarray(resid, dtype=float)


def _ets(train: np.ndarray, season: int):
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    seasonal = "add" if (season > 1 and len(train) >= 2 * season) else None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fit = ExponentialSmoothing(
            train, trend="add", damped_trend=True, seasonal=seasonal,
            seasonal_periods=season if seasonal else None,
            initialization_method="estimated",
        ).fit()
        point = float(np.asarray(fit.forecast(1))[0])
        resid = np.asarray(fit.resid, dtype=float)
    resid = resid[np.isfinite(resid)]
    return point, resid


def _arima(train: np.ndarray):
    from statsmodels.tsa.arima.model import ARIMA

    best = None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for order in ARIMA_GRID:
            try:
                fit = ARIMA(train, order=order).fit()
            except Exception:
                continue
            if best is None or fit.aic < best[0]:
                best = (fit.aic, fit)
        if best is None:
            return _snaive(train, 1)
        fit = best[1]
        point = float(np.asarray(fit.forecast(1))[0])
        resid = np.asarray(fit.resid, dtype=float)
    resid = resid[np.isfinite(resid)]
    return point, resid


METHODS = {"snaive": _snaive, "ets": _ets, "arima": _arima}


def _fit_method(name: str, train: np.ndarray, season: int):
    if name == "snaive":
        return _snaive(train, season)
    if name == "ets":
        return _ets(train, season)
    return _arima(train)


# ---------------- backtest ---------------------------------------------------

def backtest(series, season: int = 52, origins: int = 8) -> dict | None:
    """Rolling-origin one-step backtest. Returns per-method MAE and the
    coverage of the 80% interval (point +/- 1.2816 * residual std), or
    None when the series is too short to judge."""
    y = _as_array(series)
    if len(y) < 20:
        return None
    start = len(y) - origins
    if start < 12:
        start = 12
    idx = list(range(start, len(y)))
    if len(idx) < 3:
        return None
    out = {}
    for name in METHODS:
        errs, covered, total = [], 0, 0
        for t in idx:
            train = y[:t]
            try:
                point, resid = _fit_method(name, train, season)
            except Exception:
                continue
            sigma = float(np.std(resid, ddof=1)) if len(resid) > 2 else 0.0
            sigma = max(sigma, max(1.0, 0.05 * float(np.mean(train))))
            lo, hi = point - Z80 * sigma, point + Z80 * sigma
            errs.append(abs(y[t] - point))
            covered += 1 if lo <= y[t] <= hi else 0
            total += 1
        if total:
            out[name] = {"mae": float(np.mean(errs)), "coverage80": covered / total, "origins": total}
    return out or None


# ---------------- censoring --------------------------------------------------

def detect_censoring(sales, stock) -> dict:
    """Periods that sold exactly the stock on hand: sales hide demand."""
    if stock is None:
        return {"flag": False, "count": 0, "share": 0.0}
    s, k = _as_array(sales), _as_array(stock)
    if len(s) != len(k) or len(s) == 0:
        return {"flag": False, "count": 0, "share": 0.0}
    hit = (k > 0) & (s >= k)
    count = int(hit.sum())
    share = count / len(s)
    return {"flag": bool(count >= 3 and share >= 0.20), "count": count, "share": float(share)}


def uncensor_series(sales, stock, seed: int = 42) -> np.ndarray:
    """Replace each censored period by a draw from observed demand at or
    above its stock level (conditional empirical distribution)."""
    s = _as_array(sales).copy()
    if stock is None:
        return s
    k = _as_array(stock)
    hit = (k > 0) & (s >= k)
    pool = s[~hit]
    rng = np.random.default_rng(seed)
    for i in np.where(hit)[0]:
        above = pool[pool >= s[i]]
        s[i] = float(rng.choice(above)) if len(above) else float(s[i] * 1.25)
    return s


# ---------------- the distribution -------------------------------------------

def demand_distribution(series, season: int = 52, stock=None, seed: int = 42,
                        n_draws: int = 4000, origins: int = 8) -> dict:
    """Everything the verdict needs about next period's demand."""
    y = _as_array(series)
    rng = np.random.default_rng(seed)
    cens = detect_censoring(y, stock)
    work = uncensor_series(y, stock, seed=seed) if cens["flag"] else y
    zero_share = float(np.mean(work == 0)) if len(work) else 0.0
    nonzero = int(np.sum(work > 0))

    if zero_share >= INTERMITTENT_ZERO_SHARE and len(work) >= 8:
        draws = rng.choice(work, size=n_draws, replace=True)
        return {"method": "bootstrap", "forecast": float(np.mean(work)),
                "draws": [int(round(d)) for d in draws], "backtest": None,
                "zero_share": zero_share, "nonzero": nonzero,
                "intermittent": True, "censored": cens, "short_history": len(work) < 20}

    bt = backtest(work, season=season, origins=origins)
    if bt is None:
        # Too short to race methods: ETS if there is anything to fit, else
        # the empirical distribution of what little history exists.
        if len(work) >= 8:
            point, resid = _ets(work, season)
            pool = resid if len(resid) >= 4 else np.array([0.0])
            draws = np.clip(point + rng.choice(pool, size=n_draws, replace=True), 0, None)
            method = "ets"
        else:
            draws = rng.choice(work, size=n_draws, replace=True) if len(work) else np.zeros(n_draws)
            point, method = float(np.mean(work)) if len(work) else 0.0, "average"
        return {"method": method, "forecast": float(point),
                "draws": [int(round(d)) for d in draws], "backtest": None,
                "zero_share": zero_share, "nonzero": nonzero,
                "intermittent": False, "censored": cens, "short_history": True}

    winner = min(bt, key=lambda m: (bt[m]["mae"], ["snaive", "ets", "arima"].index(m)))
    point, resid = _fit_method(winner, work, season)
    pool = list(resid)
    # Add the winner's backtest errors: few, but they are honest out-of-sample.
    start = len(work) - bt[winner]["origins"]
    for t in range(start, len(work)):
        try:
            p_t, _ = _fit_method(winner, work[:t], season)
            pool.append(float(work[t] - p_t))
        except Exception:
            pass
    pool = np.asarray(pool, dtype=float)
    draws = np.clip(point + rng.choice(pool, size=n_draws, replace=True), 0, None)
    return {"method": winner, "forecast": float(point),
            "draws": [int(round(d)) for d in draws], "backtest": bt,
            "zero_share": zero_share, "nonzero": nonzero,
            "intermittent": False, "censored": cens, "short_history": len(work) < 20}
