/* Order Quantity Planner: the newsvendor decision math, no DOM.
 *
 * Mirrors src/orderplan/newsvendor.py exactly (the tests run both on
 * fixed cases and compare). Demand is a list of scenario draws.
 *
 *   Newsvendor.criticalRatio(price, cost, salvage, goodwill)
 *   Newsvendor.planOrder(draws, price, cost, salvage, goodwill, opts)
 *   Newsvendor.profitCurve(draws, price, cost, salvage, goodwill)
 *   Newsvendor.checkPeriod(draws, price, cost, salvage, goodwill, ordered, sold, ranOut)
 */
(function (g) {
  "use strict";

  function criticalRatio(price, cost, salvage, goodwill) {
    goodwill = goodwill || 0;
    var over = cost - salvage;            // loss on one unit too many
    var under = price - cost + goodwill;  // loss on one unit too few
    if (under <= 0) return 0;
    if (over <= 0) return 1;
    return under / (under + over);
  }

  function sortedDraws(draws) { return draws.slice().sort(function (a, b) { return a - b; }); }

  function quantileOrder(draws, ratio) {
    if (!draws.length) return 0;
    var s = sortedDraws(draws);
    if (ratio <= 0) return Math.floor(s[0]);
    if (ratio >= 1) return Math.ceil(s[s.length - 1]);
    var rank = Math.min(s.length, Math.max(1, Math.ceil(ratio * s.length)));
    return Math.ceil(s[rank - 1]);
  }

  function profitOne(q, d, price, cost, salvage, goodwill) {
    return price * Math.min(q, d) + salvage * Math.max(q - d, 0) - cost * q - (goodwill || 0) * Math.max(d - q, 0);
  }

  function expectedProfit(q, draws, price, cost, salvage, goodwill) {
    if (!draws.length) return 0;
    var t = 0;
    for (var i = 0; i < draws.length; i++) t += profitOne(q, draws[i], price, cost, salvage, goodwill || 0);
    return t / draws.length;
  }

  function percentile(sortedVals, p) {
    if (!sortedVals.length) return 0;
    if (sortedVals.length === 1) return sortedVals[0];
    var k = (sortedVals.length - 1) * p;
    var lo = Math.floor(k), hi = Math.min(lo + 1, sortedVals.length - 1);
    return sortedVals[lo] + (sortedVals[hi] - sortedVals[lo]) * (k - lo);
  }

  function profitCurve(draws, price, cost, salvage, goodwill, points) {
    goodwill = goodwill || 0; points = points || 61;
    var out = { q: [], mean: [], p5: [], p95: [] };
    if (!draws.length) return out;
    var s = sortedDraws(draws);
    var lo = 0, hi = Math.ceil(percentile(s, 0.995));
    if (hi <= lo) hi = lo + 1;
    var seen = {}, qs = [];
    for (var i = 0; i < points; i++) {
      var q = Math.round(lo + (hi - lo) * i / (points - 1));
      if (!seen[q]) { seen[q] = 1; qs.push(q); }
    }
    qs.sort(function (a, b) { return a - b; });
    qs.forEach(function (q) {
      var profits = draws.map(function (d) { return profitOne(q, d, price, cost, salvage, goodwill); }).sort(function (a, b) { return a - b; });
      var t = 0; profits.forEach(function (x) { t += x; });
      out.q.push(q); out.mean.push(t / profits.length);
      out.p5.push(percentile(profits, 0.05)); out.p95.push(percentile(profits, 0.95));
    });
    return out;
  }

  /* opts: { historyLen, nonzeroCount, forecast } */
  function planOrder(draws, price, cost, salvage, goodwill, opts) {
    goodwill = goodwill || 0; opts = opts || {};
    var ratio = criticalRatio(price, cost, salvage, goodwill);
    var order = draws.length ? quantileOrder(draws, ratio) : 0;
    var fc = opts.forecast != null ? opts.forecast
      : (draws.length ? draws.reduce(function (a, b) { return a + b; }, 0) / draws.length : 0);
    var profits = draws.map(function (d) { return profitOne(order, d, price, cost, salvage, goodwill); })
      .sort(function (a, b) { return a - b; });
    var expProfit = profits.length ? profits.reduce(function (a, b) { return a + b; }, 0) / profits.length : 0;
    var stockout = 0, leftovers = 0, shortage = 0;
    draws.forEach(function (d) {
      if (d > order) stockout++;
      leftovers += Math.max(order - d, 0);
      shortage += Math.max(d - order, 0);
    });
    if (draws.length) { stockout /= draws.length; leftovers /= draws.length; shortage /= draws.length; }
    var qFc = Math.round(fc);
    var warnBelow = opts.warnBelow != null ? opts.warnBelow : 26;
    var reasons = [], state;
    if (price <= cost) { state = "bad"; reasons.push("price<=cost"); }
    else if ((opts.historyLen != null && opts.historyLen < warnBelow) || (opts.nonzeroCount != null && opts.nonzeroCount < 12)) {
      state = "warn";
      if (opts.historyLen != null && opts.historyLen < warnBelow) reasons.push("short history");
      if (opts.nonzeroCount != null && opts.nonzeroCount < 12) reasons.push("sparse history");
    } else state = "good";
    var sens = {};
    if (draws.length) {
      var scaled = draws.map(function (d) { return d * 1.1; });
      sens.demand_up = quantileOrder(scaled, ratio);
      sens.price_down = quantileOrder(draws, criticalRatio(price * 0.9, cost, salvage, goodwill));
      sens.salvage_zero = quantileOrder(draws, criticalRatio(price, cost, 0, goodwill));
    }
    return {
      order: order, ratio: ratio, forecast: fc, expProfit: expProfit,
      profitP5: percentile(profits, 0.05), profitP95: percentile(profits, 0.95),
      stockoutProb: stockout, expLeftovers: leftovers, expShortage: shortage,
      profitAtForecast: draws.length ? expectedProfit(qFc, draws, price, cost, salvage, goodwill) : 0,
      state: state, reasons: reasons, sensitivity: sens
    };
  }

  function checkPeriod(draws, price, cost, salvage, goodwill, ordered, sold, ranOut) {
    var plan = planOrder(draws, price, cost, salvage, goodwill || 0);
    var realized = ranOut ? price * ordered - cost * ordered
      : profitOne(ordered, sold, price, cost, salvage, goodwill || 0);
    var expYours = expectedProfit(ordered, draws, price, cost, salvage, goodwill || 0);
    return {
      planOrder: plan.order, yourOrder: ordered, realizedProfit: realized,
      expProfitPlan: plan.expProfit, expProfitYours: expYours,
      leftOnTable: plan.expProfit - expYours, ranOut: !!ranOut, censored: !!ranOut
    };
  }

  var api = { criticalRatio: criticalRatio, quantileOrder: quantileOrder, profitOne: profitOne,
    expectedProfit: expectedProfit, percentile: percentile, profitCurve: profitCurve,
    planOrder: planOrder, checkPeriod: checkPeriod };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  g.Newsvendor = api;
})(typeof window !== "undefined" ? window : globalThis);
