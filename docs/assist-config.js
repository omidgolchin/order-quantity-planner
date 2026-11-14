/* The AI assist's prompt configuration: what the model is asked to extract.
 * Shared by the page (app.js) and the extraction test (scripts/eval_assist.js),
 * so the test scores exactly the prompt visitors get. */
(function (g) {
  "use strict";
  var ASSIST_CONFIG = {
    title: "Fill from my notes.",
    lede: "Paste whatever you have: a supplier email, a few lines of notes, last period's numbers. The model only fills the form; every value shows the phrase it came from, and you choose what to keep.",
    placeholder: "e.g. We buy the spotty jumbo bags at 1.17 and sell them at 1.95. Whatever is left at the end of the week goes in the clearance bin at about 20p. Last 8 weeks we sold: 812, 905, 877, 940, 865, 990, 1024, 958.",
    examples: [
      { label: "Supplier email", text: "Hi, confirming prices for the heart t-light holders: your cost is £1.77 per unit on orders over 500. Retail is £2.95. End-of-line units can go to the outlet at 18p each. Weekly sales for the last two months were roughly: 690, 745, 810, 702, 866, 913, 788, 845." },
      { label: "Notebook lines", text: "Paper chains: sell $4.50, margin is 40%, so cost works out from that. Leftovers after Christmas are worthless. Stockouts really hurt, figure about $1 of goodwill per lost sale. We order monthly. Last 6 months: 210, 260, 240, 300, 890, 1450." }
    ],
    instructions: "The calculator plans how many units of one product to order for the next period. Extract the selling price per unit, the unit cost, the salvage value of an unsold unit at the end of the period, any goodwill cost per lost sale, the sales history (units per period, in the order given), and the period length. Rules: if the text gives a margin as a percentage, cost = price x (1 - margin); if it gives a markup on cost, cost = price / (1 + markup). 'Worthless', 'we throw them away' or 'no salvage' means salvage 0. Convert pence/cents to the main unit (18p = 0.18). If the history is a table, take the units column in row order; if it is weekly sales over a stated number of weeks with some weeks missing, return only the numbers given. Period is 'week' or 'month' as stated; if the text says 'weekly' the period is week.",
    fields: [
      { key: "price", label: "Selling price per unit", type: "number" },
      { key: "cost", label: "Unit cost", type: "number" },
      { key: "salvage", label: "Salvage value per unsold unit", type: "number" },
      { key: "goodwill", label: "Goodwill cost per lost sale", type: "number" },
      { key: "history", label: "Sales history (units per period, in order)", type: "array" },
      { key: "period", label: "Period length (week or month)", type: "text" }
    ]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = ASSIST_CONFIG;
  g.ASSIST_CONFIG = ASSIST_CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
