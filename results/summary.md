# Research notes: the forecast method race on 30 retail products

Each product's own weekly history (Online Retail II, 104 weeks) was
backtested by rolling origin (8 one-step origins): seasonal naive,
ETS and ARIMA race, and the lowest MAE wins. The 80% interval is the
point forecast plus or minus 1.2816 residual standard deviations.

Wins by method: arima 13, ets 14, snaive 3.

| Method | Mean MAE | Mean 80% coverage (target 0.80) |
|---|---|---|
| arima | 290.4 | 0.87 |
| ets | 287.7 | 0.86 |
| snaive | 545.7 | 0.73 |

Full table: backtest_by_product.csv. The earlier classic backtest
from the demand-risk-simulator build (seasonal naive with bootstrap
intervals over 4-week horizons, plus the order/profit simulation) is
kept as backtest_classic.csv.
