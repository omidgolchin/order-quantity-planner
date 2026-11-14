"""Forecasting: ETS and ARIMA against statsmodels directly, backtest
coverage on series whose coverage is known by construction, and the
intermittent / censored demand handling."""

import warnings

import numpy as np
import pytest

from orderplan.forecast import (
    _arima,
    _ets,
    backtest,
    demand_distribution,
    detect_censoring,
    uncensor_series,
)


def _seasonal_series(n=72, season=12, seed=5):
    rng = np.random.default_rng(seed)
    t = np.arange(n)
    return 200 + 40 * np.sin(2 * np.pi * t / season) + t * 0.5 + rng.normal(0, 5, n)


def test_ets_matches_statsmodels():
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    y = _seasonal_series()
    point, _ = _ets(y, 12)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fit = ExponentialSmoothing(y, trend="add", damped_trend=True, seasonal="add",
                                   seasonal_periods=12, initialization_method="estimated").fit()
        direct = float(np.asarray(fit.forecast(1))[0])
    assert point == pytest.approx(direct, rel=1e-9)


def test_arima_matches_statsmodels_grid():
    from statsmodels.tsa.arima.model import ARIMA

    rng = np.random.default_rng(11)
    y = np.cumsum(rng.normal(0.4, 1.0, 60)) + 50
    point, _ = _arima(y)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fits = []
        for order in [(1, 1, 1), (0, 1, 1), (1, 1, 2), (2, 1, 1)]:
            f = ARIMA(y, order=order).fit()
            fits.append((f.aic, float(np.asarray(f.forecast(1))[0])))
        direct = min(fits)[1]
    assert point == pytest.approx(direct, rel=1e-9)


def test_backtest_coverage_known_cases():
    # Constant series: the interval always covers -> coverage exactly 1.
    bt = backtest([50.0] * 40, season=52)
    assert bt["snaive"]["coverage80"] == 1.0
    # Linear series y_t = t+1 with season 1: naive point is the last value,
    # the error is exactly 1 at every origin, residual std is 0 so the
    # sigma floor (5% of the mean) keeps the interval wide enough: coverage
    # exactly 1 and MAE exactly 1.
    bt = backtest([float(i + 1) for i in range(40)], season=1)
    assert bt["snaive"]["mae"] == pytest.approx(1.0)
    assert bt["snaive"]["coverage80"] == 1.0
    # Perfectly alternating series with season 2: seasonal naive is exact.
    alt = [100.0 if i % 2 == 0 else 120.0 for i in range(40)]
    bt = backtest(alt, season=2)
    assert bt["snaive"]["mae"] == pytest.approx(0.0)
    assert bt["snaive"]["coverage80"] == 1.0


def test_intermittent_goes_to_bootstrap():
    series = [0, 0, 120, 0, 85, 0, 0, 140, 0, 95, 0, 0] * 4  # half zeros
    d = demand_distribution(series, season=52)
    assert d["intermittent"] is True
    assert d["method"] == "bootstrap"
    assert len(d["draws"]) == 4000


def test_censoring_detected_and_uncensored():
    demand = [100.0] * 20
    stock = [60.0] * 15 + [200.0] * 5
    sales = [min(d, s) for d, s in zip(demand, stock)]
    cens = detect_censoring(sales, stock)
    assert cens["flag"] is True and cens["count"] == 15
    adjusted = uncensor_series(sales, stock, seed=42)
    assert np.mean(adjusted) == pytest.approx(100.0)  # all imputed from the 100s
    assert np.mean(adjusted) > np.mean(sales)


def test_no_censoring_without_stock():
    assert detect_censoring([10, 20, 30], None)["flag"] is False


def test_distribution_on_steady_series():
    rng = np.random.default_rng(9)
    series = list(np.clip(rng.normal(300, 40, 80), 0, None))
    d = demand_distribution(series, season=52)
    assert d["method"] in {"snaive", "ets", "arima"}
    assert d["backtest"] is not None
    assert len(d["draws"]) == 4000
    assert d["forecast"] > 0
