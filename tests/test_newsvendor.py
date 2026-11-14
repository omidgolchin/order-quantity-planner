"""The newsvendor decision math: the critical-ratio quantile against
brute-force profit maximization, and the profit formula by hand."""

import numpy as np
import pytest

from orderplan.newsvendor import (
    check_period,
    critical_ratio,
    expected_profit,
    plan_order,
    profit_one,
    quantile_order,
)


def _brute_best(draws, price, cost, salvage, goodwill=0.0):
    """Smallest and largest integer orders maximizing expected profit."""
    qs = range(0, int(max(draws)) + 2)
    profits = [expected_profit(q, draws, price, cost, salvage, goodwill) for q in qs]
    best = max(profits)
    winners = [q for q, p in zip(qs, profits) if p >= best - 1e-9]
    return winners[0], winners[-1], best


CASES = [
    # (draw generator, price, cost, salvage, goodwill) — integer draws,
    # because demand is a count; for integer demand the critical-ratio
    # quantile is an exact maximizer of the empirical expected profit.
    (lambda rng: np.round(np.clip(rng.normal(500, 80, 20000), 0, None)).astype(int), 10.0, 6.0, 2.0, 0.0),
    (lambda rng: rng.integers(0, 1001, 20000), 10.0, 4.0, 2.0, 0.0),
    (lambda rng: np.round(rng.lognormal(6.0, 0.5, 20000)).astype(int), 12.0, 7.0, 1.0, 1.5),
]


@pytest.mark.parametrize("gen,price,cost,salvage,goodwill", CASES)
def test_quantile_order_maximizes_profit(gen, price, cost, salvage, goodwill):
    rng = np.random.default_rng(7)
    draws = list(gen(rng))
    q_star = quantile_order(draws, critical_ratio(price, cost, salvage, goodwill))
    lo, hi, best = _brute_best(draws, price, cost, salvage, goodwill)
    # The quantile order sits in (or within one unit of) the optimal plateau
    # and earns the optimal expected profit.
    assert lo - 1 <= q_star <= hi + 1
    assert expected_profit(q_star, draws, price, cost, salvage, goodwill) >= best - 1e-6


def test_profit_formula_by_hand():
    # Demand is 100 or 200, equally likely. Order 150, price 10, cost 6,
    # salvage 3, goodwill 1.
    # D=100: 10*100 + 3*50 - 6*150 - 0    = 250
    # D=200: 10*150 + 0    - 6*150 - 1*50 = 550
    # Mean: 400.
    assert profit_one(150, 100, 10, 6, 3, 1) == 250
    assert profit_one(150, 200, 10, 6, 3, 1) == 550
    assert expected_profit(150, [100, 200], 10, 6, 3, 1) == 400


def test_critical_ratio_values():
    assert critical_ratio(10, 6, 2) == pytest.approx(0.5)          # 4 / (4 + 4)
    assert critical_ratio(10, 6, 2, goodwill=2) == pytest.approx(0.6)  # 6 / (6 + 4)
    assert critical_ratio(10, 12, 2) == 0.0                          # under-cost <= 0
    assert critical_ratio(10, 6, 12) == 1.0                          # salvage above cost


def test_check_period_by_hand():
    draws = [100] * 50
    out = check_period(draws, price=10, cost=6, salvage=3, goodwill=0,
                       ordered=120, sold=100, ran_out=False)
    assert out["plan_order"] == 100
    assert out["realized_profit"] == 340   # 1000 + 3*20 - 6*120
    assert out["exp_profit_plan"] == 400   # 10*100 - 6*100
    assert out["left_on_table"] == pytest.approx(60)
    out2 = check_period(draws, price=10, cost=6, salvage=3, goodwill=0,
                        ordered=80, sold=80, ran_out=True)
    assert out2["realized_profit"] == 320  # everything sold: (10 - 6) * 80
    assert out2["censored"] is True


def test_sensitivity_directions():
    rng = np.random.default_rng(3)
    draws = list(np.clip(rng.normal(400, 60, 5000), 0, None))
    plan = plan_order(draws, price=10, cost=6, salvage=2, goodwill=0)
    assert plan.sensitivity["demand_up"] >= plan.order
    assert plan.sensitivity["price_down"] <= plan.order
    assert plan.sensitivity["salvage_zero"] <= plan.order
