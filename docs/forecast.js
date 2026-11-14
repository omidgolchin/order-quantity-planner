/* Order Quantity Planner: forecasting for a series the visitor pastes,
 * no DOM. Mirrors src/orderplan/forecast.py with one honest difference:
 * the browser races seasonal naive against Holt-Winters ETS; the built-in
 * products were also raced against ARIMA offline (statsmodels), and the
 * page says so. Same rules otherwise: rolling-origin backtest picks the
 * winner, intermittent series fall back to a bootstrap of past periods,
 * and sold-out periods are uncensored before anything is fit.
 *
 *   Forecast.fromSeries(series, { season, stock, seed })
 *     -> { method, forecast, draws, backtest, zeroShare, intermittent,
 *          shortHistory, censored: {flag, count, share} }
 */
(function (g) {
  "use strict";
  var Z80 = 1.2816, INTERMITTENT_ZERO_SHARE = 0.30;

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mean(xs) { return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : 0; }
  function std(xs, m) {
    if (xs.length < 2) return 0;
    var s = 0; xs.forEach(function (x) { s += (x - m) * (x - m); });
    return Math.sqrt(s / (xs.length - 1));
  }

  function snaive(train, season) {
    var point, resid = [], i;
    if (season > 1 && train.length > season) {
      point = train[train.length - season];
      for (i = season; i < train.length; i++) resid.push(train[i] - train[i - season]);
    } else if (train.length >= 2) {
      point = train[train.length - 1];
      for (i = 1; i < train.length; i++) resid.push(train[i] - train[i - 1]);
    } else { point = train.length ? train[train.length - 1] : 0; resid = [0]; }
    return { point: point, resid: resid };
  }

  /* Holt-Winters (additive trend, additive season), parameters by a small
   * grid search on one-step squared error. */
  function holtWinters(train, season) {
    var n = train.length, seasonal = season > 1 && n >= 2 * season;
    var m = seasonal ? season : 1;
    function init() {
      var first = train.slice(0, m);
      var level = mean(first), trend = 0, seas = first.map(function (v) { return v - level; });
      if (n >= 2 * m) {
        var second = train.slice(m, 2 * m);
        trend = (mean(second) - level) / m;
      }
      return { level: level, trend: trend, seas: seas };
    }
    function run(alpha, beta, gamma) {
      var st = init(), errs = [], level = st.level, trend = st.trend, seas = st.seas.slice();
      for (var t = 0; t < n; t++) {
        var sIdx = t % m;
        var pred = level + trend + (seasonal ? seas[sIdx] : 0);
        if (t >= m) errs.push(train[t] - pred);
        var prevLevel = level;
        level = alpha * (train[t] - (seasonal ? seas[sIdx] : 0)) + (1 - alpha) * (level + trend);
        trend = beta * (level - prevLevel) + (1 - beta) * trend;
        if (seasonal) seas[sIdx] = gamma * (train[t] - prevLevel - trend) + (1 - gamma) * seas[sIdx];
      }
      var nextSeas = seasonal ? seas[n % m] : 0;
      return { point: level + trend + nextSeas, resid: errs, sse: errs.reduce(function (a, e) { return a + e * e; }, 0) };
    }
    var alphas = [0.05, 0.2, 0.4, 0.6, 0.8], betas = [0.01, 0.05, 0.15, 0.3],
        gammas = seasonal ? [0.01, 0.1, 0.25, 0.45] : [0];
    var best = null;
    alphas.forEach(function (a) { betas.forEach(function (b) { gammas.forEach(function (gm) {
      var r = run(a, b, gm);
      if (!best || r.sse < best.sse) best = r;
    }); }); });
    return { point: best.point, resid: best.resid };
  }

  function fitMethod(name, train, season) { return name === "snaive" ? snaive(train, season) : holtWinters(train, season); }

  function backtest(series, season, origins) {
    origins = origins || 8;
    if (series.length < 20) return null;
    var start = Math.max(series.length - origins, 12);
    if (series.length - start < 3) return null;
    var out = {};
    ["snaive", "ets"].forEach(function (name) {
      var errs = [], covered = 0, total = 0;
      for (var t = start; t < series.length; t++) {
        var train = series.slice(0, t), r;
        try { r = fitMethod(name, train, season); } catch (e) { continue; }
        var sigma = Math.max(std(r.resid, mean(r.resid)), Math.max(1, 0.05 * mean(train)));
        var lo = r.point - Z80 * sigma, hi = r.point + Z80 * sigma;
        errs.push(Math.abs(series[t] - r.point));
        if (series[t] >= lo && series[t] <= hi) covered++;
        total++;
      }
      if (total) out[name] = { mae: mean(errs), coverage80: covered / total, origins: total };
    });
    return Object.keys(out).length ? out : null;
  }

  function detectCensoring(sales, stock) {
    if (!stock || stock.length !== sales.length || !sales.length) return { flag: false, count: 0, share: 0 };
    var count = 0;
    for (var i = 0; i < sales.length; i++) if (stock[i] > 0 && sales[i] >= stock[i]) count++;
    var share = count / sales.length;
    return { flag: count >= 3 && share >= 0.20, count: count, share: share };
  }

  function uncensor(sales, stock, rand) {
    var out = sales.slice(), pool = [];
    for (var i = 0; i < sales.length; i++) if (!(stock[i] > 0 && sales[i] >= stock[i])) pool.push(sales[i]);
    for (var j = 0; j < sales.length; j++) {
      if (stock[j] > 0 && sales[j] >= stock[j]) {
        var above = pool.filter(function (v) { return v >= sales[j]; });
        out[j] = above.length ? above[Math.floor(rand() * above.length)] : sales[j] * 1.25;
      }
    }
    return out;
  }

  function fromSeries(series, opts) {
    opts = opts || {};
    var season = opts.season || 52, stock = opts.stock || null;
    var rand = rng(opts.seed || 42);
    var cens = detectCensoring(series, stock);
    var work = cens.flag ? uncensor(series, stock, rand) : series.slice();
    var zeroShare = work.length ? work.filter(function (v) { return v === 0; }).length / work.length : 0;
    var nonzero = work.filter(function (v) { return v > 0; }).length;
    function draws(pool, point, n) {
      var out = [];
      for (var i = 0; i < n; i++) out.push(Math.max(0, Math.round(point + pool[Math.floor(rand() * pool.length)])));
      return out;
    }
    if (zeroShare >= INTERMITTENT_ZERO_SHARE && work.length >= 8) {
      var boot = [];
      for (var i = 0; i < 2000; i++) boot.push(work[Math.floor(rand() * work.length)]);
      return { method: "bootstrap", forecast: mean(work), draws: boot, backtest: null,
        zeroShare: zeroShare, nonzero: nonzero, intermittent: true, censored: cens, shortHistory: work.length < 20 };
    }
    var bt = backtest(work, season, 8);
    if (!bt) {
      if (work.length >= 8) {
        var r = holtWinters(work, season);
        return { method: "ets", forecast: r.point, draws: draws(r.resid.length >= 4 ? r.resid : [0], r.point, 2000),
          backtest: null, zeroShare: zeroShare, nonzero: nonzero, intermittent: false,
          censored: cens, shortHistory: true };
      }
      var emp = [];
      for (var j = 0; j < 2000 && work.length; j++) emp.push(work[Math.floor(rand() * work.length)]);
      return { method: "average", forecast: mean(work), draws: emp, backtest: null,
        zeroShare: zeroShare, nonzero: nonzero, intermittent: false, censored: cens, shortHistory: true };
    }
    var winner = Object.keys(bt).sort(function (a, b) {
      return bt[a].mae - bt[b].mae || (a === "snaive" ? -1 : 1);
    })[0];
    var fit = fitMethod(winner, work, season);
    var pool = fit.resid.slice();
    var startAt = work.length - bt[winner].origins;
    for (var t = startAt; t < work.length; t++) {
      try { pool.push(work[t] - fitMethod(winner, work.slice(0, t), season).point); } catch (e) { /* keep pool */ }
    }
    return { method: winner, forecast: fit.point, draws: draws(pool.length ? pool : [0], fit.point, 2000),
      backtest: bt, zeroShare: zeroShare, nonzero: nonzero, intermittent: false,
      censored: cens, shortHistory: work.length < 20 };
  }

  var api = { fromSeries: fromSeries, snaive: snaive, holtWinters: holtWinters,
    backtest: backtest, detectCensoring: detectCensoring, uncensor: uncensor };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  g.Forecast = api;
})(typeof window !== "undefined" ? window : globalThis);
