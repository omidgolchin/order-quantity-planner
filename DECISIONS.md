# Decisions

Judgment calls made while building the Order Quantity Planner, in the
open. The spec is `tools_v3/P10v2_order-quantity-planner.md`; the build
contract is `tools_v3/CONTRACT.md`.

1. **Built-in products are precomputed in Python; pasted series are
   forecast in the browser, with one method fewer.** The full race
   (seasonal naive, ETS, ARIMA) needs statsmodels, so it runs offline
   for the six example products and ships as `docs/data/products.js`.
   A series the visitor pastes races seasonal naive against a
   Holt-Winters ETS implemented in `docs/forecast.js`. The page says
   exactly this in "Forecast and backtest". Dropping ARIMA from the
   browser race is a real limitation, recorded here and in the README,
   not a silent one.
2. **Demand is a scenario distribution, not a formula.** The winner's
   point forecast plus a bootstrap of its residuals (in-sample plus
   backtest errors) gives the draws every number on the page integrates
   over. That keeps the browser and Python engines identical in shape:
   both consume draws.
3. **Default prices for example products** follow the earlier frozen
   design for this dataset: selling price = the product's median unit
   price, cost = 60% of it, salvage = 10% of cost. They are starting
   values in editable fields, not claims about the retailer's margins.
4. **No currency symbol on the page.** The dataset's prices are pounds,
   a visitor's prices are their own currency, so amounts print as plain
   numbers. The assist's test notes use $, £ and € as written; the
   extraction returns bare numbers.
5. **The warn threshold is period-aware.** "Too short to trust" means
   fewer than 26 weekly periods or fewer than 12 monthly ones (one
   full seasonal cycle), plus a sparsity rule (fewer than 12 periods
   with any sales). A flat 26 would have flagged every monthly view of
   a two-year product.
6. **Monthly series are calendar months** summed from Monday-start
   weeks by the week-start date's month. A week straddling a month
   boundary lands entirely in its starting month; noted so nobody
   treats the monthly figures as exact accounting.
7. **Censoring needs a stock column.** Sales alone cannot prove a
   stock-out. With stock, periods selling exactly the stock level
   (at least 3, and at least 20% of periods) are uncensored by drawing
   from observed sales at or above that level (Kaplan-Meier style).
   Without stock, the check says sales are taken at face value.
8. **ARIMA is plain, not seasonal.** The grid is (1,1,1), (0,1,1),
   (1,1,2), (2,1,1) by AIC. On strongly seasonal series it usually
   loses to seasonal naive, and the 30-product backtest shows that
   honestly rather than hiding the method that loses.
9. **Check last period grades in expectation as well as in fact.**
   Realized profit uses the demand actually seen; "left on the table"
   compares expected profit at the two quantities, because one period
   is a single draw and a good order can lose money by luck.
10. **The old build's work is research notes, not page features.** The
    classic 30-product backtest (seasonal naive, bootstrap intervals,
    order/profit simulation) is kept in `results/`; the LLM
    forecasting comparison from the v2 spec is out of this repo
    entirely (it belongs to study S01 or a post, per the spec).
11. **Negative weeks are floored at zero.** The source data nets
    returns against sales, and in 14 of 3,120 product-weeks returns
    win (one wholesale product nets −10,196 in a week). Demand cannot
    be negative, so the pipeline floors weekly units at zero before
    forecasting or aggregating to months. Recorded in DATA_SOURCES.md.
12. **An order of zero is a verdict, and it is explained as one.**
    With intermittent demand and a low critical ratio, the optimal
    order can genuinely be 0 (the cake-cases example: 53% empty
    weeks, ratio 0.42). Rather than hide that case or pick a tamer
    product (no other top-30 product crosses the 30% threshold), the
    verdict body says why: the share of empty periods and the
    quantile the prices ask for.
13. **History is written to the URL only when it is short enough**
    (about 1,500 characters). A 104-week series fits; a long pasted
    series does not, and then the link opens with the prices and the
    default product instead. Copy summary always carries the verdict.

## 2026-11-18: what a screen reader announces

- Only the verdict title is announced. The whole verdict panel used to
  be one `aria-live` region, and its KPI tiles and checks are rewritten
  on every run, so a screen reader read them all again after each pause
  in typing. Now the title alone carries `aria-live="polite"` and
  `aria-atomic="true"`: a changed verdict is announced in full, and the
  KPIs and checks stay on the page for the reader to move to. The title
  is written only when its text changes, so an unchanged verdict is not
  read out again.
