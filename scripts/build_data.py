#!/usr/bin/env python3
"""Build docs/data/products.js (+ .json twin for the tests) and the
research-notes backtest tables in results/.

    .venv/bin/python scripts/build_data.py

Reads data/weekly_top30.csv (derived from Online Retail II, UCI, CC BY
4.0; see DATA_SOURCES.md). The method race for all 30 products is the
slow part: a few minutes.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from orderplan import pipeline  # noqa: E402


def main() -> None:
    df = pipeline.load_weekly(ROOT / "data" / "weekly_top30.csv")
    print("loaded", len(df), "rows;", df["product"].nunique(), "products")

    products = pipeline.build_products(df)
    pipeline.write_products_js(products, ROOT / "docs" / "data" / "products.js")
    (ROOT / "docs" / "data" / "products.json").write_text(json.dumps(products))
    print("wrote docs/data/products.js with", len(products), "entries")

    table = pipeline.backtest_table(df)
    table.to_csv(ROOT / "results" / "backtest_by_product.csv", index=False)
    wins = table[table["winner"]]["method"].value_counts().to_dict()
    lines = [
        "# Research notes: the forecast method race on 30 retail products",
        "",
        "Each product's own weekly history (Online Retail II, 104 weeks) was",
        "backtested by rolling origin (8 one-step origins): seasonal naive,",
        "ETS and ARIMA race, and the lowest MAE wins. The 80% interval is the",
        "point forecast plus or minus 1.2816 residual standard deviations.",
        "",
        "Wins by method: " + ", ".join(f"{m} {n}" for m, n in sorted(wins.items())) + ".",
        "",
        "| Method | Mean MAE | Mean 80% coverage (target 0.80) |",
        "|---|---|---|",
    ]
    for method, g in table.groupby("method"):
        lines.append(f"| {method} | {g['mae'].mean():.1f} | {g['coverage80'].mean():.2f} |")
    lines += [
        "",
        "Full table: backtest_by_product.csv. The earlier classic backtest",
        "from the demand-risk-simulator build (seasonal naive with bootstrap",
        "intervals over 4-week horizons, plus the order/profit simulation) is",
        "kept as backtest_classic.csv.",
        "",
    ]
    (ROOT / "results" / "summary.md").write_text("\n".join(lines))
    print("wrote results/backtest_by_product.csv and results/summary.md; wins:", wins)


if __name__ == "__main__":
    main()
