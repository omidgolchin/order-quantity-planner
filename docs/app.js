/* Order Quantity Planner: page logic. Math lives in newsvendor.js and
 * forecast.js; built-in products arrive precomputed in data/products.js. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var F = Tool.fmt;
  var PRODUCTS = window.ORDER_PRODUCTS || [];
  var byId = {};
  PRODUCTS.forEach(function (p) { byId[p.id] = p; });

  var CENSOR_EXAMPLE = {
    sold: [60, 60, 58, 60, 60, 52, 60, 60, 60, 47, 60, 60, 55, 60, 60, 60, 49, 60, 60, 60, 53, 60, 60, 60, 57, 60],
    stock: [60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60]
  };
  var EXAMPLES = [
    { label: "Heart t-light holder (steady seller)", product: "85123A" },
    { label: "Jumbo spotty bag (steady seller)", product: "85099B" },
    { label: "Christmas paper chains (seasonal)", product: "22086" },
    { label: "Christmas cake cases (intermittent)", product: "22952" },
    { label: "Lunch bag, last 10 weeks only (short history)", product: "20725-short" },
    { label: "A shop that sold out most weeks (pasted, with stock)", paste: CENSOR_EXAMPLE, price: 14.99, cost: 6.20, salvage: 3.00, goodwill: "" },
    { label: "Cost above price (a pricing slip)", product: "85123A", cost: 3.40 }
  ];

  var DEFAULTS = { mode: "plan", product: "85123A", period: "week", price: "", cost: "", salvage: "", goodwill: "",
    cOrdered: "", cSold: "", cRanOut: "no" };
  var state = Tool.readParams(DEFAULTS);
  var source = { type: "product", id: state.product && byId[state.product] ? state.product : "85123A" };
  var cur = null; // last plan computation: {dist, plan, prices, series, stock, period}
  var markerQ = null; // quantity the chart's exploration marker sits on (readout only)

  /* ---------- helpers ---------- */
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function num(id) { var v = $(id).value; return v === "" ? null : Number(v); }
  function amt(x) { return (x < 0 ? "−" : "") + F.num(Math.abs(x), Math.abs(x) >= 100 ? 0 : 2); }
  /* profits and totals: whole currency units once they are past 10 */
  function money(x) { return (x < 0 ? "−" : "") + F.num(Math.abs(x), Math.abs(x) >= 10 ? 0 : 2); }
  function fieldError(id, msg) {
    var f = $(id).closest(".field"); if (!f) return;
    var e = f.querySelector(".err");
    f.classList.toggle("invalid", !!msg);
    if (msg) { if (!e) { e = document.createElement("div"); e.className = "err"; f.appendChild(e); } e.textContent = msg; }
    else if (e) e.remove();
  }
  var METHOD_NAMES = { snaive: "seasonal naive", ets: "ETS", arima: "ARIMA", bootstrap: "a bootstrap of past periods", average: "the average" };

  function parseHistoryText(text) {
    var lines = String(text).split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!lines.length) return { values: [], stock: null };
    var pair = lines.every(function (l) { return /^-?[\d.]+[,\s]\s*-?[\d.]+$/.test(l); });
    var values = [], stock = pair ? [] : null;
    if (pair) {
      lines.forEach(function (l) { var p = l.split(/[,\s]\s*/); values.push(Number(p[0])); stock.push(Number(p[1])); });
    } else {
      String(text).split(/[\s,;]+/).filter(Boolean).forEach(function (t) { values.push(Number(t)); });
    }
    if (values.some(function (v) { return !isFinite(v) || v < 0; })) return { values: [], stock: null, error: "Numbers only, none negative." };
    if (stock && stock.some(function (v) { return !isFinite(v) || v < 0; })) return { values: [], stock: null, error: "Numbers only, none negative." };
    return { values: values, stock: stock };
  }
  function seriesText(values, stock) {
    return values.map(function (v, i) { return stock ? v + ", " + stock[i] : String(v); }).join("\n");
  }

  /* ---------- product / source loading ---------- */
  function productPrices(p) {
    var price = p.medianPrice, cost = Math.round(price * 0.6 * 100) / 100;
    return { price: price, cost: cost, salvage: Math.round(cost * 0.1 * 100) / 100 };
  }
  function loadProduct(id, keepPrices) {
    var p = byId[id]; if (!p) return;
    source = { type: "product", id: id };
    var per = state.period === "month" && p.month ? "month" : "week";
    if (per !== state.period) { state.period = per; $("period").value = per; }
    var slot = p[per];
    $("history").value = seriesText(slot.history, null);
    if (!keepPrices) {
      var pr = productPrices(p);
      $("price").value = pr.price; $("cost").value = pr.cost; $("salvage").value = pr.salvage; $("goodwill").value = "";
    }
    $("historyHint").textContent = p.name + " · " + slot.history.length + " " + per + "s of sales (Online Retail II, UCI, CC BY 4.0). Prices start at the product's median price; cost at 60% of it.";
    Tool.exampleBanner($("f-plan"), "<b>" + p.name + "</b>: real sales from a UK giftware shop, with prices set by formula. Paste your own history and prices over it; the verdict updates as you type.");
  }
  function currentDist(series, stock, period) {
    if (source.type === "product") {
      var p = byId[source.id];
      var slot = p && p[period];
      if (slot && slot.history.length === series.length &&
          slot.history.every(function (v, i) { return v === series[i]; }) && !stock) {
        return { dist: slot.dist, precomputed: true };
      }
    }
    var d = Forecast.fromSeries(series, { season: period === "month" ? 12 : 52, stock: stock, seed: 42 });
    return { dist: { method: d.method, forecast: d.forecast, draws: d.draws, backtest: d.backtest,
      zeroShare: d.zeroShare, intermittent: d.intermittent, shortHistory: d.shortHistory,
      censored: d.censored }, precomputed: false };
  }

  /* ---------- plan ---------- */
  function readPlan() {
    var parsed = parseHistoryText($("history").value);
    var v = { price: num("price"), cost: num("cost"), salvage: num("salvage"), goodwill: num("goodwill") || 0,
      period: $("period").value, series: parsed.values, stock: parsed.stock };
    var ok = true;
    function need(id, cond, msg) { fieldError(id, cond ? "" : msg); if (!cond) ok = false; }
    need("history", !parsed.error && parsed.values.length >= 3, parsed.error || "Paste at least 3 periods of sales.");
    need("price", v.price !== null && v.price > 0, "Enter the selling price for one unit, above 0.");
    need("cost", v.cost !== null && v.cost >= 0, "Enter what one unit costs you, 0 or more.");
    need("salvage", v.salvage !== null && v.salvage >= 0, "Enter what an unsold unit brings back, 0 or more. Use 0 if it is thrown away.");
    need("goodwill", v.goodwill >= 0, "Enter the extra cost of turning a customer away, 0 or more. Use 0 if there is none.");
    return ok ? v : null;
  }

  function runPlan() {
    var v = readPlan();
    state.period = $("period").value;
    writeUrl();
    if (!v) {
      $("vTitle").textContent = "Check the highlighted inputs"; $("vBody").textContent = "";
      $("verdict").className = "panel verdict v-neutral"; $("kpis").innerHTML = ""; $("checksP").innerHTML = "";
      cur = null; return;
    }
    var got = currentDist(v.series, v.stock, v.period);
    var dist = got.dist;
    var nonzero = v.series.filter(function (x) { return x > 0; }).length;
    var plan = Newsvendor.planOrder(dist.draws, v.price, v.cost, v.salvage, v.goodwill, {
      historyLen: v.series.length, nonzeroCount: nonzero, forecast: dist.forecast,
      warnBelow: v.period === "month" ? 12 : 26 });
    cur = { dist: dist, plan: plan, prices: v, series: v.series, stock: v.stock, precomputed: got.precomputed };
    renderVerdict(); renderChecks(); renderChart(); renderDetails();
    if ($("cOrdered").value !== "" || $("cSold").value !== "") runCheck();
  }

  function renderVerdict() {
    var plan = cur.plan, v = cur.prices, dist = cur.dist;
    var title, body, cls = plan.state;
    var diff = plan.expProfit - plan.profitAtForecast;
    var fcLine;
    if (Math.abs(diff) < Math.max(1, 0.005 * Math.abs(plan.expProfit))) {
      fcLine = "Ordering exactly the forecast (" + F.int(Math.round(plan.forecast)) + ") earns about the same.";
    } else if (plan.order > Math.round(plan.forecast)) {
      fcLine = "Ordering exactly the forecast (" + F.int(Math.round(plan.forecast)) + ") would earn " + money(diff) + " less on average, because a lost sale costs you more than a leftover.";
    } else {
      fcLine = "Ordering exactly the forecast (" + F.int(Math.round(plan.forecast)) + ") would earn " + money(diff) + " less on average, because a leftover costs you more than a lost sale.";
    }
    var zeroNote = plan.order === 0
      ? "At these prices the math says do not stock: " + (dist.intermittent
          ? F.pct(dist.zeroShare, 0) + " of periods sold nothing, and your prices only ask for the " + F.pct(plan.ratio, 0) + " quantile of demand (the amount that demand stays at or below in " + F.pct(plan.ratio, 0) + " of periods), which is zero here. "
          : "your prices only ask for the " + F.pct(plan.ratio, 0) + " quantile of demand (the amount that demand stays at or below in " + F.pct(plan.ratio, 0) + " of periods), which is zero here. ")
        + "A higher price, a lower cost, or a real cost for a lost sale would change that. "
      : "";
    if (plan.state === "bad") {
      title = "Do not order yet: the price does not cover the cost";
      body = "Each unit sells for " + amt(v.price) + " and costs " + amt(v.cost) + ", so every sale loses money before leftovers are even counted. Fix the price or the cost first; the numbers below show what the math gives if you ordered anyway.";
    } else if (plan.state === "warn") {
      title = "Order " + F.int(plan.order) + " units, but treat it as a rough guide";
      body = zeroNote + "The history behind this is thin (" + plan.reasons.join(" and ") + "), so the spread is wide and the forecast is shaky. Expected profit " + money(plan.expProfit) +
        " (5th to 95th percentile: " + money(plan.profitP5) + " to " + money(plan.profitP95) + "). Chance of running out: " + F.pct(plan.stockoutProb, 0) +
        ". Expected leftovers: " + F.num(plan.expLeftovers, 0) + " units. " + fcLine;
    } else {
      title = "Order " + F.int(plan.order) + " units";
      body = zeroNote + "Expected profit " + money(plan.expProfit) + " (5th to 95th percentile: " + money(plan.profitP5) + " to " + money(plan.profitP95) +
        "). Chance of running out: " + F.pct(plan.stockoutProb, 0) + ". Expected leftovers: " + F.num(plan.expLeftovers, 0) + " units. " + fcLine;
    }
    $("vTitle").textContent = title; $("vBody").textContent = body;
    $("verdict").className = "panel verdict v-" + cls;
    cur.title = title; cur.body = body;
    $("kpis").innerHTML = [
      [F.int(plan.order), "units to order", "cr"],
      [money(plan.expProfit), "expected profit"],
      [F.pct(plan.stockoutProb, 0), "chance of running out", "stockout"],
      [F.num(plan.expLeftovers, 0), "expected leftovers"]
    ].map(function (it) { return '<div class="kpi"><span class="k-val">' + it[0] + '</span><span class="k-lbl">' + it[1] + (it[2] ? ' <button type="button" data-tip="' + it[2] + '"></button>' : "") + "</span></div>"; }).join("");
  }

  function renderChecks() {
    var plan = cur.plan, v = cur.prices, dist = cur.dist, out = [];
    out.push(["info", "ORDER LEVEL", "Critical ratio", "Your prices aim to cover demand " + F.pct(plan.ratio, 0) + " of the time: (" +
      amt(v.price) + " − " + amt(v.cost) + (v.goodwill ? " + " + amt(v.goodwill) : "") + ") / (" + amt(v.price) + " − " + amt(v.salvage) +
      (v.goodwill ? " + " + amt(v.goodwill) : "") + "). The order is the demand quantile <button type=\"button\" data-tip=\"quantile\"></button> at that level: the amount that demand stays at or below " + F.pct(plan.ratio, 0) + " of the time."]);
    if (dist.intermittent) {
      out.push(["warn", "SPARSE", "Intermittent demand", F.pct(dist.zeroShare, 0) + " of periods sold nothing, so ETS and ARIMA are set aside: the plan samples your past periods directly."]);
    } else if (dist.backtest) {
      var w = dist.backtest[dist.method], names = Object.keys(dist.backtest).map(function (m) {
        return METHOD_NAMES[m] + " " + F.num(dist.backtest[m].mae, 0); }).join(", ");
      var covOff = Math.abs(w.coverage80 - 0.8) > 0.15;
      out.push([covOff ? "warn" : "ok", "BACKTEST", "Forecast method",
        (METHOD_NAMES[dist.method] || dist.method) + " won the rolling-origin backtest (average error " + names + "). Its 80% interval covered the actual " +
        F.pct(w.coverage80, 0) + " of the time; the target is 80%." + (covOff ? " Off target, so treat the spread with care." : "")]);
    } else {
      out.push(["warn", "SHORT", "Forecast method", "Too little history to race methods, so this uses " + (METHOD_NAMES[dist.method] || dist.method) + " with a wide spread."]);
    }
    var cens = dist.censored;
    if (cur.stock) {
      out.push(cens && cens.flag
        ? ["warn", "SOLD OUT", "Censored demand", cens.count + " of " + cur.series.length + " periods sold exactly the stock on hand, so sales understate demand. Those periods were uncensored before fitting, which widens the top of the range."]
        : ["ok", "OK", "Censored demand", "No period sold exactly its stock level, so sales are taken as demand."]);
    } else {
      out.push(["info", "NOTE", "Censored demand", "No stock column, so sales are taken at face value. If you sold out in some periods, add a second column with the stock you held: those sales hide demand."]);
    }
    if (plan.state === "warn") {
      out.push(["warn", "THIN", "History", "Only " + cur.series.length + " periods (" + cur.series.filter(function (x) { return x > 0; }).length + " with any sales). The tool runs from 3 periods, races forecast methods from 20, and trusts the forecast fully from " + (cur.prices.period === "month" ? "12 months" : "26 weeks") + " with at least 12 periods of sales."]);
    } else if (plan.state === "good") {
      out.push(["ok", "OK", "History", cur.series.length + " periods: enough to race the forecast methods and judge the winner."]);
    }
    $("checksP").innerHTML = out.map(function (c) {
      return '<div class="check is-' + c[0] + '"><span class="badge">' + c[1] + '</span><div><span class="c-name">' + c[2] + '.</span> <span class="c-text">' + c[3] + "</span></div></div>";
    }).join("");
    cur.checks = out;
  }

  function renderChart() {
    var plan = cur.plan, v = cur.prices;
    /* show the region a decision lives in: up to about twice the larger of
     * the order and the forecast, never past the 99.5th demand percentile */
    var sorted = cur.dist.draws.slice().sort(function (a, b) { return a - b; });
    var top = Math.ceil(Newsvendor.percentile(sorted, 0.995));
    var hiQ = Math.max(10, Math.min(top, Math.ceil(2.2 * Math.max(plan.order, plan.forecast, 1))));
    var curve = Newsvendor.profitCurve(cur.dist.draws, v.price, v.cost, v.salvage, v.goodwill, 61, hiQ);
    var pts = curve.q.map(function (q, i) { return [q, curve.mean[i]]; });
    var p5 = curve.q.map(function (q, i) { return [q, curve.p5[i]]; });
    var p95 = curve.q.map(function (q, i) { return [q, curve.p95[i]]; });
    var hl = 0, best = -Infinity;
    curve.q.forEach(function (q, i) { if (Math.abs(q - plan.order) < Math.abs(curve.q[hl] - plan.order)) hl = i; if (curve.mean[i] > best) best = curve.mean[i]; });
    /* exploration marker: a readout over the same curve data. It never
     * feeds back into the plan; it only reads curve.mean/p5/p95. */
    if (markerQ === null || markerQ < curve.q[0] || markerQ > curve.q[curve.q.length - 1]) markerQ = plan.order;
    var mi = 0;
    curve.q.forEach(function (q, i) { if (Math.abs(q - markerQ) < Math.abs(curve.q[mi] - markerQ)) mi = i; });
    markerQ = curve.q[mi];
    var vls = (function () {
      var fq = Math.round(plan.forecast), close = Math.abs(fq - plan.order) < 0.22 * hiQ;
      return [{ x: plan.order, label: "order " + F.int(plan.order) + (close ? " · forecast " + F.int(fq) + " (orange)" : ""), color: "accent" },
              { x: fq, label: close ? "" : "forecast " + F.int(fq), color: "series2" }];
    })();
    var exploring = mi !== hl; // marker sits on a grid point other than the order's
    if (exploring) vls.push({ x: markerQ, label: "exploring " + F.int(markerQ), color: "series2" });
    Tool.lineChart($("profitChart"), {
      series: [
        { label: "Expected profit", color: "accent", points: pts, markers: true, highlight: mi },
        { label: "95th percentile", color: "neutral", points: p95, dash: "5 4" },
        { label: "5th percentile", color: "neutral", points: p5, dash: "5 4" }
      ],
      vLines: vls,
      xTitle: "units ordered", yTitle: "profit for the period", legend: true, height: 260,
      xFormat: function (x) { return F.int(x); }, yFormat: function (y) { return (y < 0 ? "−" : "") + F.int(Math.abs(y)); }
    });
    $("profitCaption").textContent = "The dashed lines are the 5th and 95th percentiles of profit at each quantity: the spread is the risk the verdict weighs. The curve peaks at the recommended order.";
    var slider = $("qMarker");
    if (slider && curve.q.length > 1) {
      slider.min = curve.q[0]; slider.max = curve.q[curve.q.length - 1];
      slider.step = Math.max(1, curve.q[1] - curve.q[0]);
      if (Number(slider.value) !== markerQ) slider.value = markerQ;
      $("qReadout").textContent = exploring
        ? "At " + F.int(markerQ) + " units, expected profit is about " + money(curve.mean[mi]) +
          " (5th to 95th percentile: " + money(curve.p5[mi]) + " to " + money(curve.p95[mi]) + ")." +
          " Exploring only — the recommended order stays " + F.int(plan.order) + "."
        : "Marker on the recommended order: " + F.int(plan.order) + " units, expected profit about " + money(curve.mean[hl]) +
          " (5th to 95th percentile: " + money(curve.p5[hl]) + " to " + money(curve.p95[hl]) + "). Drag the marker to explore other quantities.";
    }
  }

  function quantile(sortedDraws, p) { return Newsvendor.percentile(sortedDraws, p); }

  function renderDetails() {
    var dist = cur.dist, plan = cur.plan, v = cur.prices;
    var series = cur.series;
    var hist = series.map(function (val, i) { return [i, val]; });
    var drawsSorted = dist.draws.slice().sort(function (a, b) { return a - b; });
    var n = series.length;
    Tool.lineChart($("fanChart"), {
      series: [
        { label: "Units sold per " + v.period, color: "accent", points: hist },
        { label: "Next " + v.period + " forecast (95% range)", color: "series2", points: [[n, dist.forecast]],
          ci: [[quantile(drawsSorted, 0.025), quantile(drawsSorted, 0.975)]], markersOnly: true, markers: true }
      ],
      xTitle: v.period + " (oldest first)", yTitle: "units sold", legend: true, height: 240,
      xFormat: function (x) { return x >= n ? "next" : String(Math.round(x) + 1); },
      yFormat: function (y) { return F.int(y); }
    });
    $("fanCaption").textContent = "Next " + v.period + ": median demand " + F.int(quantile(drawsSorted, 0.5)) +
      ", 80% range " + F.int(quantile(drawsSorted, 0.1)) + " to " + F.int(quantile(drawsSorted, 0.9)) +
      ", 95% range " + F.int(quantile(drawsSorted, 0.025)) + " to " + F.int(quantile(drawsSorted, 0.975)) + ".";
    if (dist.backtest) {
      $("tBacktest").innerHTML = "<thead><tr><th>Method</th><th class=\"num\">Average error (units)</th><th class=\"num\">80% interval covered</th></tr></thead><tbody>" +
        Object.keys(dist.backtest).map(function (m) {
          var b = dist.backtest[m];
          return "<tr><td>" + (METHOD_NAMES[m] || m) + (m === dist.method ? " (used)" : "") + '</td><td class="num">' +
            F.num(b.mae, 1) + '</td><td class="num">' + F.pct(b.coverage80, 0) + "</td></tr>";
        }).join("") + "</tbody>";
    } else if (dist.intermittent) {
      $("tBacktest").innerHTML = "<tbody><tr><td>No method race: with this much zero demand, the tool samples past periods directly instead of fitting ETS or ARIMA.</td></tr></tbody>";
    } else {
      $("tBacktest").innerHTML = "<tbody><tr><td>Too little history to backtest (needs about 20 periods). The forecast uses " + (METHOD_NAMES[dist.method] || dist.method) + ".</td></tr></tbody>";
    }
    $("forecastNote").textContent = cur.precomputed
      ? "This product's forecast was computed offline by this repository's Python reference implementation, which also races ARIMA; the table above is its backtest."
      : "For a pasted series, your browser races seasonal naive against ETS (Holt-Winters). The built-in products were also raced against ARIMA offline.";
    var s = plan.sensitivity;
    $("tFull").innerHTML = "<tbody>" + [
      ["Critical ratio", F.pct(plan.ratio, 1)],
      ["Forecast for next " + v.period, F.int(Math.round(plan.forecast)) + " units"],
      ["Recommended order", F.int(plan.order) + " units"],
      ["Expected profit at the recommended order", money(plan.expProfit)],
      ["Expected profit at the forecast itself", amt(plan.profitAtForecast)],
      ["Expected units sold", F.num(plan.order - plan.expLeftovers, 0)],
      ["Expected leftovers", F.num(plan.expLeftovers, 1) + " units"],
      ["Expected unmet demand", F.num(plan.expShortage, 1) + " units"],
      ["If demand runs 10% higher", "order " + F.int(s.demand_up || plan.order)],
      ["If the price drops 10%", "order " + F.int(s.price_down || plan.order)],
      ["If leftovers are worth nothing", "order " + F.int(s.salvage_zero || plan.order)]
    ].map(function (r) { return "<tr><td>" + r[0] + '</td><td class="num">' + r[1] + "</td></tr>"; }).join("") + "</tbody>";
  }

  /* ---------- check last period ---------- */
  function runCheck() {
    var ordered = num("cOrdered"), sold = num("cSold"), ranOut = $("cRanOut").value === "yes";
    var ok = true;
    function need(id, cond, msg) { fieldError(id, cond ? "" : msg); if (!cond) ok = false; }
    need("cOrdered", ordered !== null && ordered >= 0 && Number.isInteger(ordered), "Enter the units you ordered, as a whole number, 0 or more.");
    need("cSold", sold !== null && sold >= 0 && Number.isInteger(sold) && (ordered === null || sold <= ordered), "Enter the units you sold, as a whole number no larger than what you ordered.");
    writeUrl();
    if (!ok || !cur) {
      $("cTitle").textContent = !cur ? "Work out the order above first" : "Check the highlighted inputs";
      $("cBody").textContent = !cur ? "The grade uses the product, prices and forecast from the order above." : "";
      $("cVerdict").className = "panel verdict v-neutral"; $("cKpis").innerHTML = ""; $("cChecks").innerHTML = "";
      return;
    }
    var v = cur.prices;
    var r = Newsvendor.checkPeriod(cur.dist.draws, v.price, v.cost, v.salvage, v.goodwill, ordered, sold, ranOut);
    var gap = r.leftOnTable, tol = Math.max(1, 0.02 * Math.abs(r.expProfitPlan));
    var title, cls = "good";
    if (ranOut && ordered < r.planOrder) { title = "You ordered too few, and sold out"; cls = "warn"; }
    else if (gap > tol) { title = "You left about " + money(gap) + " on the table"; cls = "warn"; }
    else if (ordered > r.planOrder && !ranOut && sold < ordered) { title = "You ordered more than the plan, and it shows"; cls = "warn"; }
    else title = "Close to the plan";
    var basis = (source.type === "product" && byId[source.id] ? byId[source.id].name : "your pasted sales history") +
      " at price " + amt(v.price) + ", cost " + amt(v.cost) + ", leftover worth " + amt(v.salvage) + (v.goodwill ? ", lost-sale cost " + amt(v.goodwill) : "");
    var body = "Graded against " + basis + ", taken from the order above; change them in sections 1 and 2 if they are not this product's. " +
      "The plan would have ordered " + F.int(r.planOrder) + " units; you ordered " + F.int(ordered) + " and sold " + F.int(sold) +
      ". Your realized profit was " + money(r.realizedProfit) + ". In expectation (one period is a single draw, so luck plays its part), your quantity earns " +
      money(r.expProfitYours) + " against the plan's " + money(r.expProfitPlan) + "." +
      (ranOut ? " Because you sold out, demand was at least " + F.int(ordered) + " units: your sales are a floor on demand, not demand itself." : "");
    $("cTitle").textContent = title; $("cBody").textContent = body;
    $("cVerdict").className = "panel verdict v-" + cls;
    cur.checkTitle = title; cur.checkBody = body;
    $("cKpis").innerHTML = [
      [F.int(r.planOrder), "plan's order"],
      [F.int(ordered), "your order"],
      [money(r.realizedProfit), "your realized profit"],
      [money(Math.max(0, gap)), "expected gap to the plan", "gap"]
    ].map(function (it) { return '<div class="kpi"><span class="k-val">' + it[0] + '</span><span class="k-lbl">' + it[1] + (it[2] ? ' <button type="button" data-tip="' + it[2] + '"></button>' : "") + "</span></div>"; }).join("");
    var cks = [];
    cks.push(ranOut
      ? ["warn", "SOLD OUT", "Censored demand", "You ran out, so this period's sales hide its demand. In section 1, a stock column would uncensor periods like this one."]
      : ["ok", "OK", "Stock-out", "You did not run out, so this period's demand is fully observed."]);
    cks.push(ordered === r.planOrder
      ? ["ok", "MATCH", "Against the plan", "You ordered exactly what the plan recommends."]
      : ["info", "NOTE", "Against the plan", "You ordered " + Math.abs(ordered - r.planOrder) + (ordered > r.planOrder ? " more" : " fewer") + " than the plan. The expected cost of that gap is " + money(Math.max(0, gap)) + " a period."]);
    cks.push(["info", "LUCK VS DECISION", "Luck", "A single period cannot prove an order was wrong: judge the rule over many periods, not this one."]);
    $("cChecks").innerHTML = cks.map(function (c) {
      return '<div class="check is-' + c[0] + '"><span class="badge">' + c[1] + '</span><div><span class="c-name">' + c[2] + '.</span> <span class="c-text">' + c[3] + "</span></div></div>";
    }).join("");
  }

  /* ---------- URL / wiring ---------- */
  function writeUrl() {
    var s = { mode: state.mode, period: $("period").value, price: $("price").value, cost: $("cost").value,
      salvage: $("salvage").value, goodwill: $("goodwill").value,
      cOrdered: $("cOrdered").value, cSold: $("cSold").value, cRanOut: $("cRanOut").value };
    if (source.type === "product") s.product = source.id;
    else {
      var txt = $("history").value;
      if (txt.length <= 1500) s.history = txt;
    }
    Tool.writeParams(s);
  }
  /* No tabs in the document layout: sections 1–3 are the plan, section 4 is
   * the check, all in one flow. setMode now only records the mode for the
   * URL and primes the check section when the page opens in check mode. */
  function primeCheck() {
    if (!cur) return;
    if ($("cOrdered").value === "" && $("cSold").value === "") {
      /* start from the common habit, ordering the forecast, against the
       * last period's sales, so the grade has something to say */
      var fq = Math.round(cur.plan.forecast), last = cur.series.length ? Math.round(cur.series[cur.series.length - 1]) : 0;
      $("cOrdered").value = fq; $("cSold").value = Math.min(fq, last); $("cRanOut").value = last >= fq ? "yes" : "no";
    }
    runCheck();
  }
  function setMode(m) {
    state.mode = m;
    if (m === "check") {
      if (!cur) runPlan();
      primeCheck();
    } else runPlan();
  }

  EXAMPLES.forEach(function (ex, i) { var o = document.createElement("option"); o.value = i; o.textContent = ex.label; $("example").appendChild(o); });
  $("example").addEventListener("change", function () {
    if (this.value === "") return;
    var ex = EXAMPLES[+this.value]; this.value = "";
    document.querySelectorAll(".field.filled").forEach(function (f) { f.classList.remove("filled"); });
    if (ex.paste) {
      source = { type: "paste" };
      $("history").value = seriesText(ex.paste.sold, ex.paste.stock);
      $("period").value = "week";
      $("price").value = ex.price; $("cost").value = ex.cost; $("salvage").value = ex.salvage; $("goodwill").value = ex.goodwill;
      $("historyHint").textContent = "A pasted example: two columns, units sold and units stocked. Most weeks sold everything on the shelf.";
      Tool.exampleBanner($("f-plan"), "<b>" + ex.label + "</b>: a constructed example. Paste your own history and prices over it.");
    } else {
      state.period = "week"; $("period").value = "week";
      loadProduct(ex.product, false);
      if (ex.cost !== undefined) $("cost").value = ex.cost;
    }
    runPlan();
  });
  ["price", "cost", "salvage", "goodwill"].forEach(function (id) {
    $(id).addEventListener("input", debounce(runPlan, 150));
  });
  $("qMarker").addEventListener("input", function () { markerQ = Number(this.value); if (cur) renderChart(); });
  $("history").addEventListener("input", debounce(function () { source = { type: "paste" }; Tool.exampleBanner($("f-plan"), null); runPlan(); }, 300));
  $("period").addEventListener("change", function () {
    state.period = this.value;
    if (source.type === "product") loadProduct(source.id, true);
    runPlan();
  });
  $("csvFile").addEventListener("change", function () {
    var file = this.files && this.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var rows = String(reader.result).split(/\n/).map(function (l) { return l.split(",").map(function (c) { return c.trim(); }); })
        .filter(function (r) { return r.length && r.some(Boolean); });
      var head = rows[0].join(" ").toLowerCase();
      var hasHead = /date|week|month/.test(head) || /units|sales|qty/.test(head);
      var ui = 1, si = 2;
      if (hasHead) {
        ui = rows[0].findIndex(function (c) { return /units|sales|qty|sold/.test(c.toLowerCase()); });
        si = rows[0].findIndex(function (c) { return /stock|inventor/.test(c.toLowerCase()); });
        if (ui < 0) ui = 1;
        rows = rows.slice(1);
      }
      var values = [], stock = si >= 0 ? [] : null;
      rows.forEach(function (r) {
        var u = Number(r[ui]); if (!isFinite(u)) return;
        values.push(u); if (stock) { var s = Number(r[si]); stock.push(isFinite(s) ? s : 0); }
      });
      if (values.length) { source = { type: "paste" }; $("history").value = seriesText(values, stock); runPlan(); }
    };
    reader.readAsText(file);
  });
  ["cOrdered", "cSold", "cRanOut"].forEach(function (id) {
    $(id).addEventListener("input", debounce(runCheck, 150));
    $(id).addEventListener("change", runCheck);
  });
  $("copyLink").addEventListener("click", function () { Tool.copy(location.href, $("toastP"), "Link copied: it opens with these inputs."); });
  $("cCopyLink").addEventListener("click", function () { Tool.copy(location.href, $("toastC"), "Link copied."); });
  $("copySummary").addEventListener("click", function () {
    if (!cur) return;
    Tool.copy(["Order plan: " + cur.title, cur.body, "",
      "Checks: " + cur.checks.map(function (c) { return c[2].toLowerCase() + " " + c[1].toLowerCase(); }).join(", "),
      "", "Open with these inputs: " + location.href].join("\n"), $("toastP"), "Summary copied.");
  });
  $("cCopySummary").addEventListener("click", function () {
    if (!cur || !cur.checkTitle) return;
    Tool.copy(["Last period: " + cur.checkTitle, cur.checkBody, "", "Open with these inputs: " + location.href].join("\n"),
      $("toastC"), "Summary copied.");
  });
  window.addEventListener("resize", debounce(function () { if (cur) { renderChart(); renderDetails(); } }, 200));
  if (window.KitTheme) KitTheme.onChange(function () { setTimeout(function () { if (cur) { renderChart(); renderDetails(); } }, 0); });

  Tool.assist(Object.assign({}, window.ASSIST_CONFIG, {
    mount: $("assistMount"), toggle: $("assistToggle"),
    apply: function (vals) {
      document.querySelectorAll(".field.filled").forEach(function (f) { f.classList.remove("filled"); });
      function mark(id, val) {
        if (val === undefined || val === null) return;
        $(id).value = val; var f = $(id).closest(".field"); if (f) f.classList.add("filled");
      }
      mark("price", vals.price); mark("cost", vals.cost); mark("salvage", vals.salvage); mark("goodwill", vals.goodwill);
      if (Array.isArray(vals.history) && vals.history.length) {
        source = { type: "paste" };
        $("history").value = vals.history.join(", ");
        var hf = $("history").closest(".field"); if (hf) hf.classList.add("filled");
      }
      if (vals.period === "month" || vals.period === "week") { $("period").value = vals.period; state.period = vals.period; }
      runPlan();
    }
  }));

  /* ---------- init ---------- */
  (function init() {
    var urlHistory = null;
    try { urlHistory = new URLSearchParams(location.search).get("history"); } catch (e) { /* file:// */ }
    if (urlHistory) {
      source = { type: "paste" };
      $("history").value = urlHistory;
      $("period").value = state.period === "month" ? "month" : "week";
      if (state.price !== "") $("price").value = state.price;
      if (state.cost !== "") $("cost").value = state.cost;
      if (state.salvage !== "") $("salvage").value = state.salvage;
      if (state.goodwill !== "") $("goodwill").value = state.goodwill;
      if (!$("price").value) { $("price").value = 10; $("cost").value = 6; $("salvage").value = 1; }
    } else {
      $("period").value = state.period === "month" ? "month" : "week";
      loadProduct(source.id, false);
      if (state.price !== "") $("price").value = state.price;
      if (state.cost !== "") $("cost").value = state.cost;
      if (state.salvage !== "") $("salvage").value = state.salvage;
      if (state.goodwill !== "") $("goodwill").value = state.goodwill;
    }
    if (state.cOrdered !== "") $("cOrdered").value = state.cOrdered;
    if (state.cSold !== "") $("cSold").value = state.cSold;
    if (state.cRanOut) $("cRanOut").value = state.cRanOut;
    Tool.explain({
      demand: { t: "Why the sales history matters", d: "The right order depends on the whole spread of possible demand, not just the average. The tool fits several forecasts to your history, keeps the one that predicted your own past periods best (a backtest), and uses its errors to estimate how uncertain next period is." },
      salvage: { t: "Salvage value", d: "What an unsold unit is worth at the end of the period: clearance price, outlet value, or 0 if it is thrown away. High salvage makes overstocking cheap, so the tool orders more." },
      goodwill: { t: "Cost of a lost sale", d: "Anything you lose beyond the margin when a customer finds you sold out, such as a customer who does not come back. It makes running out more expensive, so the tool orders more. Leave it at 0 if you are unsure." },
      cr: { t: "How the order size is chosen", d: "This is the newsvendor problem. Order until one more unit is as likely to lose money as to make it. That happens at the <i>critical ratio</i>: underage cost ÷ (underage + overage), where underage = price − cost (+ lost-sale cost) and overage = cost − salvage. The order is the demand level with that probability of not being exceeded." },
      stockout: { t: "Chance of running out", d: "The probability that demand next period exceeds the order. Ordering for zero stockouts is almost never profitable; the right level depends on your margins." },
      gap: { t: "Gap to the plan", d: "How much more profit the plan's order would have earned on average than your order, given what was known before the period. It grades the decision, not the luck of one period." },
      quantile: { t: "Quantile", d: "A level of demand named by how often demand stays at or below it. For example, the 60% quantile is the amount that demand stays at or below in 60% of periods. The tool orders the quantile at your critical ratio (shown in the ORDER LEVEL check), so you run out in the remaining share of periods: exactly the balance your prices make worthwhile." },
      censored: { t: "Sold-out periods", d: "When you sell out, true demand was at least what you sold, maybe more. Treating that period as exact demand underestimates demand and leads to ordering too little next time. The tool treats sold-out periods as 'at least'." },
      curve: { t: "Profit by order size", d: "For every order size, the average profit over thousands of simulated demand draws from the forecast. The peak is the best order. A flat top means you have room; a steep side shows which mistake (too few or too many) costs more." }
    });

    setMode(state.mode === "check" ? "check" : "plan");
    if (state.mode !== "check") primeCheck();
  })();
})();
