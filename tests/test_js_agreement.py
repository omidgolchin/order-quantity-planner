"""The page's JavaScript math must agree with the Python reference:
the verdict on three fixed built-in products, the profit curve on a
fixed distribution, and seasonal naive on a fixture series."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from orderplan.forecast import _snaive
from orderplan.newsvendor import plan_order, profit_curve

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not available")


def _node(js: str):
    proc = subprocess.run([NODE, "-e", js], capture_output=True, text=True, timeout=120, cwd=ROOT)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def _prices(p):
    price = p["medianPrice"]
    cost = round(price * 0.6, 2)
    return price, cost, round(cost * 0.1, 2)


PRODUCT_CASES = [("85123A", "week"), ("22952", "week"), ("22086", "month")]


@pytest.mark.parametrize("code,period", PRODUCT_CASES)
def test_verdict_agrees_on_fixed_products(code, period):
    products = {p["id"]: p for p in json.loads((ROOT / "docs" / "data" / "products.json").read_text())}
    p = products[code]
    dist = p[period]["dist"]
    price, cost, salvage = _prices(p)
    hist_len = len(p[period]["history"])
    nonzero = sum(1 for v in p[period]["history"] if v > 0)
    py = plan_order(dist["draws"], price, cost, salvage, 0.0,
                    history_len=hist_len, nonzero_count=nonzero,
                    forecast=dist["forecast"], warn_below=12 if period == "month" else 26)
    js = _node(
        "const N=require('./docs/newsvendor.js');"
        f"const dist={json.dumps(dist['draws'])};"
        f"const r=N.planOrder(dist,{price},{cost},{salvage},0,"
        f"{{historyLen:{hist_len},nonzeroCount:{nonzero},forecast:{dist['forecast']},warnBelow:{12 if period == 'month' else 26}}});"
        "console.log(JSON.stringify(r))")
    assert js["order"] == py.order
    assert js["state"] == py.state
    assert js["expProfit"] == pytest.approx(py.exp_profit, rel=1e-9)
    assert js["stockoutProb"] == pytest.approx(py.stockout_prob, abs=1e-9)
    assert js["expLeftovers"] == pytest.approx(py.exp_leftovers, rel=1e-9)
    assert js["sensitivity"] == py.sensitivity


def test_profit_curve_agrees():
    draws = [80, 120, 100, 200, 150, 90, 110, 130, 170, 160] * 10
    py = profit_curve(draws, 10, 6, 3, 1)
    js = _node(
        "const N=require('./docs/newsvendor.js');"
        f"console.log(JSON.stringify(N.profitCurve({json.dumps(draws)},10,6,3,1)))")
    assert js["q"] == py["q"]
    for a, b in zip(js["mean"], py["mean"]):
        assert a == pytest.approx(b, rel=1e-9)


def test_seasonal_naive_agrees():
    series = [100 + (i % 4) * 15 + i for i in range(40)]
    point, _ = _snaive(__import__("numpy").array(series, dtype=float), 4)
    js = _node(
        "const F=require('./docs/forecast.js');"
        f"console.log(JSON.stringify(F.snaive({json.dumps(series)},4)))")
    assert js["point"] == pytest.approx(float(point))
