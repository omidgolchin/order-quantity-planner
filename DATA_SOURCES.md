# Data sources

## Online Retail II (the dataset behind the built-in products and the backtest)

- **Source:** UCI Machine Learning Repository, dataset 502 —
  https://archive.ics.uci.edu/dataset/502/online+retail+ii
- **Citation:** Chen, D. (2012). *Online Retail II* [Dataset]. UCI
  Machine Learning Repository. https://doi.org/10.24432/C5CG6D
- **License:** Creative Commons Attribution 4.0 International (CC BY
  4.0), the UCI repository's standard dataset license.
- **What it is:** all transactions of a UK-based, non-store online
  retailer (mainly all-occasion giftware, many wholesale customers)
  between 01/12/2009 and 09/12/2011: 1,067,371 rows with invoice,
  product code, description, quantity, date, unit price (£), customer,
  country. Cancellations are invoices starting with "C" and carry
  negative quantities.
- **How it is used here:** net weekly units (Monday-start weeks,
  missing weeks = 0) for the 30 best-selling products by total net
  units; first and last partial weeks trimmed, leaving 104 weeks
  (2009-12-07 to 2011-11-28). Each product's price is its median unit
  price. In 14 of the 3,120 product-weeks, returns exceeded sales and
  the net is negative; the pipeline floors those weeks at zero,
  because demand cannot be negative. The derived file
  `data/weekly_top30.csv` is committed as received, with this
  attribution; the raw spreadsheet (45 MB) is not.
- **Provenance:** the weekly file and the classic backtest table in
  `results/backtest_classic.csv` were produced by the earlier
  demand-risk-simulator build (the v2 project this tool replaces) and
  are reused unchanged. `scripts/build_data.py` regenerates everything
  else from the weekly file.

## What the page ships

`docs/data/products.js` holds, for six example products, the weekly and
monthly sales history and the forecast distribution computed offline by
`src/orderplan/` (method race, backtest, scenario draws). It is derived
data under the same CC BY 4.0 license, with the attribution above.
