"""Every verdict state reached by a constructed case, through the page's
own JavaScript engine (the same code app.js renders)."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not available")


def _plan(draws, price, cost, salvage, goodwill, opts):
    proc = subprocess.run(
        [NODE, "-e",
         "const N=require('./docs/newsvendor.js');"
         f"const r=N.planOrder({json.dumps(draws)},{price},{cost},{salvage},{goodwill},{json.dumps(opts)});"
         "console.log(JSON.stringify(r))"],
        capture_output=True, text=True, timeout=60, cwd=ROOT)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


DRAWS = [int(400 + 60 * ((i * 37) % 13 - 6)) for i in range(600)]  # fixed spread around 400


def test_state_good():
    r = _plan(DRAWS, 10, 6, 2, 0, {"historyLen": 104, "nonzeroCount": 100})
    assert r["state"] == "good"


def test_state_warn_short_history():
    r = _plan(DRAWS, 10, 6, 2, 0, {"historyLen": 10, "nonzeroCount": 10})
    assert r["state"] == "warn" and "short history" in r["reasons"]


def test_state_warn_sparse():
    r = _plan(DRAWS, 10, 6, 2, 0, {"historyLen": 60, "nonzeroCount": 5})
    assert r["state"] == "warn" and "sparse history" in r["reasons"]


def test_state_bad_price_below_cost():
    r = _plan(DRAWS, 2.95, 3.40, 0.18, 0, {"historyLen": 104, "nonzeroCount": 100})
    assert r["state"] == "bad" and "price<=cost" in r["reasons"]


def test_browser_forecast_flags():
    proc = subprocess.run(
        [NODE, "-e",
         "const F=require('./docs/forecast.js');"
         # intermittent: half the periods are zero
         "const inter=F.fromSeries([0,0,120,0,85,0,0,140,0,95,0,0,0,130,0,0,110,0,0,90],{season:52,seed:42});"
         # censored: sold equals stock in most periods
         "const sold=[60,60,58,60,60,52,60,60,60,47,60,60,55,60,60,60,49,60,60,60,53,60,60,60,57,60];"
         "const stock=sold.map(()=>60);"
         "const cens=F.fromSeries(sold,{season:52,stock:stock,seed:42});"
         "console.log(JSON.stringify({intermittent:inter.intermittent,method:inter.method,"
         "censored:cens.censored.flag,censCount:cens.censored.count}))"],
        capture_output=True, text=True, timeout=60, cwd=ROOT)
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout)
    assert out == {"intermittent": True, "method": "bootstrap", "censored": True, "censCount": 19}
