"""Order Quantity Planner: reference implementation of the tool's engine.

The browser page (docs/) mirrors this math in JavaScript; the tests check
the two against each other on fixed cases. Everything here is offline:
forecasts, backtests and the newsvendor decision. No model calls.
"""

from .forecast import (
    backtest,
    demand_distribution,
    detect_censoring,
    uncensor_series,
)
from .newsvendor import (
    check_period,
    critical_ratio,
    expected_profit,
    plan_order,
    profit_curve,
    quantile_order,
)

__all__ = [
    "backtest",
    "check_period",
    "critical_ratio",
    "demand_distribution",
    "detect_censoring",
    "expected_profit",
    "plan_order",
    "profit_curve",
    "quantile_order",
    "uncensor_series",
]
