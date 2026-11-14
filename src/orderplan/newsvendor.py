"""The newsvendor decision: how many units to order for one period.

Demand for the next period is a discrete distribution, given as scenario
draws (a list of possible demands). The classic solution (Arrow, Harris &
Marschak 1951) orders the quantile of demand at the critical ratio

    (price - cost + goodwill) / (price - salvage + goodwill),

the point where the cost of one unit too many (cost - salvage) balances
the cost of one unit too few (price - cost + goodwill). Expected profit
is computed exactly over the scenarios, so the quantile rule and brute
force agree; the tests check that they do.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field


def critical_ratio(price: float, cost: float, salvage: float, goodwill: float = 0.0) -> float:
    """The service level the economics ask for, between 0 and 1."""
    over = cost - salvage            # loss on one unit too many
    under = price - cost + goodwill  # loss on one unit too few
    if under <= 0:
        return 0.0
    if over <= 0:
        return 1.0
    return under / (under + over)


def _sorted_draws(draws):
    return sorted(float(d) for d in draws)


def quantile_order(draws, ratio: float) -> int:
    """Smallest order quantity whose chance of covering demand is >= ratio."""
    if not draws:
        return 0
    s = _sorted_draws(draws)
    if ratio <= 0:
        return int(math.floor(s[0]))
    if ratio >= 1:
        return int(math.ceil(s[-1]))
    # Empirical quantile: the draw at rank ceil(ratio * n), as an integer order.
    rank = min(len(s), max(1, math.ceil(ratio * len(s))))
    return int(math.ceil(s[rank - 1]))


def profit_one(q: float, d: float, price: float, cost: float, salvage: float, goodwill: float) -> float:
    sold = min(q, d)
    return price * sold + salvage * max(q - d, 0.0) - cost * q - goodwill * max(d - q, 0.0)


def expected_profit(q: float, draws, price, cost, salvage, goodwill=0.0) -> float:
    if not draws:
        return 0.0
    return sum(profit_one(q, d, price, cost, salvage, goodwill) for d in draws) / len(draws)


def _percentile(sorted_vals, p: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return float(sorted_vals[0])
    k = (len(sorted_vals) - 1) * p
    lo = int(math.floor(k))
    hi = min(lo + 1, len(sorted_vals) - 1)
    return float(sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo))


@dataclass
class Plan:
    order: int
    ratio: float
    forecast: float
    exp_profit: float
    profit_p5: float
    profit_p95: float
    stockout_prob: float
    exp_leftovers: float
    exp_shortage: float
    profit_at_forecast: float
    state: str  # "good" | "warn" | "bad"
    reasons: list = field(default_factory=list)
    sensitivity: dict = field(default_factory=dict)


def profit_curve(draws, price, cost, salvage, goodwill=0.0, points: int = 61):
    """Expected profit and the 5-95% profit band across order quantities."""
    if not draws:
        return {"q": [], "mean": [], "p5": [], "p95": []}
    s = _sorted_draws(draws)
    lo = 0.0
    hi = float(math.ceil(_percentile(s, 0.995)))
    if hi <= lo:
        hi = lo + 1
    qs = sorted({int(round(lo + (hi - lo) * i / (points - 1))) for i in range(points)})
    out = {"q": [], "mean": [], "p5": [], "p95": []}
    for q in qs:
        profits = sorted(profit_one(q, d, price, cost, salvage, goodwill) for d in s)
        out["q"].append(q)
        out["mean"].append(sum(profits) / len(profits))
        out["p5"].append(_percentile(profits, 0.05))
        out["p95"].append(_percentile(profits, 0.95))
    return out


def plan_order(draws, price, cost, salvage, goodwill=0.0,
               history_len: int | None = None, nonzero_count: int | None = None,
               forecast: float | None = None, warn_below: int = 26) -> Plan:
    """The full verdict math for one product.

    State rules (spec): "bad" when price <= cost (you lose money on every
    sale); "warn" when the history is too short (fewer periods than
    warn_below: 26 weeks, or 12 months, one full seasonal cycle) or too
    sparse (< 12 periods with any sales) to trust; otherwise "good".
    """
    draws = [float(d) for d in draws]
    ratio = critical_ratio(price, cost, salvage, goodwill)
    order = quantile_order(draws, ratio) if draws else 0
    fc = float(forecast) if forecast is not None else (sum(draws) / len(draws) if draws else 0.0)
    profits = sorted(profit_one(order, d, price, cost, salvage, goodwill) for d in draws) if draws else [0.0]
    exp_profit = sum(profits) / len(profits)
    stockout = (sum(1 for d in draws if d > order) / len(draws)) if draws else 0.0
    leftovers = (sum(max(order - d, 0.0) for d in draws) / len(draws)) if draws else 0.0
    shortage = (sum(max(d - order, 0.0) for d in draws) / len(draws)) if draws else 0.0
    q_fc = int(round(fc))
    profit_fc = expected_profit(q_fc, draws, price, cost, salvage, goodwill) if draws else 0.0

    reasons: list[str] = []
    if price <= cost:
        state = "bad"
        reasons.append("price<=cost")
    elif (history_len is not None and history_len < warn_below) or (nonzero_count is not None and nonzero_count < 12):
        state = "warn"
        if history_len is not None and history_len < warn_below:
            reasons.append("short history")
        if nonzero_count is not None and nonzero_count < 12:
            reasons.append("sparse history")
    else:
        state = "good"

    # Sensitivity strip: the recommended order under three changes.
    sens = {}
    if draws:
        scaled = [d * 1.1 for d in draws]
        sens["demand_up"] = quantile_order(scaled, ratio)
        sens["price_down"] = quantile_order(draws, critical_ratio(price * 0.9, cost, salvage, goodwill))
        sens["salvage_zero"] = quantile_order(draws, critical_ratio(price, cost, 0.0, goodwill))
    return Plan(order=order, ratio=ratio, forecast=fc, exp_profit=exp_profit,
                profit_p5=_percentile(profits, 0.05), profit_p95=_percentile(profits, 0.95),
                stockout_prob=stockout, exp_leftovers=leftovers, exp_shortage=shortage,
                profit_at_forecast=profit_fc, state=state, reasons=reasons, sensitivity=sens)


def check_period(draws, price, cost, salvage, goodwill,
                 ordered: int, sold: int, ran_out: bool) -> dict:
    """Grade last period: your order against what the plan would have said.

    Realized profit uses the demand you actually saw. If you ran out, all
    you know is demand was at least what you ordered, so realized profit
    is a floor and the gap to the plan is stated in expectations.
    """
    plan = plan_order(draws, price, cost, salvage, goodwill)
    if ran_out:
        realized = price * ordered - cost * ordered  # everything sold, no leftovers
    else:
        realized = profit_one(ordered, sold, price, cost, salvage, goodwill)
    exp_yours = expected_profit(ordered, draws, price, cost, salvage, goodwill)
    return {
        "plan_order": plan.order,
        "your_order": int(ordered),
        "realized_profit": realized,
        "exp_profit_plan": plan.exp_profit,
        "exp_profit_yours": exp_yours,
        "left_on_table": plan.exp_profit - exp_yours,
        "ran_out": bool(ran_out),
        "censored": bool(ran_out),
    }
