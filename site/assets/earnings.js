/* Pharma Earnings Tracker — front end
 * Reads site/data/earnings.json (produced by scripts/build_earnings_data.py)
 * and renders a searchable/filterable table, a market-cap-tier grouped view,
 * and a per-company detail drawer with product-level call-outs. Mirrors
 * app.js/pipeline.js's structure and helpers, adapted to the earnings
 * schema. No build step, no framework.
 */
(function () {
  "use strict";

  var state = {
    data: null,
    filtered: [],
    sortKey: "company_name",
    sortDir: 1,
    view: "table",
  };

  var els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    els.kpiRow = document.getElementById("kpiRow");
    els.lastUpdated = document.getElementById("lastUpdated");
    els.search = document.getElementById("searchInput");
    els.tierFilter = document.getElementById("tierFilter");
    els.growthFilter = document.getElementById("growthFilter");
    els.statusFilter = document.getElementById("statusFilter");
    els.tableBody = document.getElementById("drugTableBody");
    els.tableView = document.getElementById("tableView");
    els.timelineView = document.getElementById("timelineView");
    els.timelineContainer = document.getElementById("timelineContainer");
    els.emptyState = document.getElementById("emptyState");
    els.disclaimer = document.getElementById("disclaimerText");
    els.viewTableBtn = document.getElementById("viewTableBtn");
    els.viewTimelineBtn = document.getElementById("viewTimelineBtn");
    els.drawerOverlay = document.getElementById("drawerOverlay");
    els.drawerContent = document.getElementById("drawerContent");
    els.drawerClose = document.getElementById("drawerClose");
    els.themeToggle = document.getElementById("themeToggle");

    initTheme();

    els.search.addEventListener("input", applyFilters);
    els.tierFilter.addEventListener("change", applyFilters);
    els.growthFilter.addEventListener("change", applyFilters);
    els.statusFilter.addEventListener("change", applyFilters);
    els.viewTableBtn.addEventListener("click", function () { setView("table"); });
    els.viewTimelineBtn.addEventListener("click", function () { setView("timeline"); });
    els.drawerClose.addEventListener("click", closeDrawer);
    els.drawerOverlay.addEventListener("click", function (e) {
      if (e.target === els.drawerOverlay) closeDrawer();
    });
    document.querySelectorAll("#drugTable th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-sort");
        if (state.sortKey === key) { state.sortDir *= -1; } else { state.sortKey = key; state.sortDir = 1; }
        renderTable();
      });
    });

    fetch("data/earnings.json")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        state.data = data;
        state.filtered = data.companies.slice();
        els.lastUpdated.textContent = "Data generated " + formatDateTime(data.generated_at) + " · hand-researched from company earnings releases";
        els.disclaimer.textContent = data.disclaimer || "";
        renderKPIs();
        applyFilters();
      })
      .catch(function (err) {
        els.lastUpdated.textContent = "Could not load data/earnings.json";
        els.emptyState.style.display = "block";
        els.emptyState.textContent = "Could not load data: " + err.message;
        console.error(err);
      });
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem("rx-tracker-theme"); } catch (e) { /* storage unavailable, ignore */ }
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    els.themeToggle.addEventListener("click", function () {
      var current = document.documentElement.getAttribute("data-theme");
      var next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("rx-tracker-theme", next); } catch (e) { /* ignore */ }
    });
  }

  function formatDateTime(iso) {
    if (!iso) return "unknown time";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function tierLabel(tier) {
    if (tier === "large") return "Large-cap";
    if (tier === "small") return "Small-cap";
    return "Mid-cap";
  }

  function formatUsdM(usdM) {
    if (usdM == null) return null;
    var abs = Math.abs(usdM);
    var sign = usdM < 0 ? "-" : "";
    if (abs >= 1000) return sign + "$" + (abs / 1000).toFixed(2) + "B";
    return sign + "$" + Math.round(abs) + "M";
  }

  function formatPct(pct) {
    if (pct == null) return null;
    var sign = pct > 0 ? "+" : "";
    return sign + pct.toFixed(1) + "%";
  }

  // Revenue growth is shown as a status pill: good (growing), warning (small
  // decline), serious (steep decline) -- a status semantic, not a fourth
  // categorical color channel, per the site's existing status-pill pattern.
  function growthPillClass(pct) {
    if (pct == null) return "";
    if (pct >= 0) return "good";
    if (pct < -10) return "serious";
    return "warning";
  }

  function profitPillClass(usdM) {
    if (usdM == null) return "";
    return usdM >= 0 ? "good" : "critical";
  }

  function isAcquired(c) {
    return c.status === "acquired";
  }

  // Estimates each product's approximate year-over-year dollar swing from its
  // reported current-quarter revenue and YoY growth rate (swing = current -
  // implied prior-year revenue). This is derived on the front end, not a
  // company-disclosed decomposition -- flagged as such everywhere it's shown.
  function productSwing(p) {
    if (p == null || p.revenue_usd_m == null || p.yoy_growth_pct == null) return null;
    var g = p.yoy_growth_pct / 100;
    if (g <= -0.999) return -p.revenue_usd_m; // near-total decline; prior-year base is unreliable to back out
    var prior = p.revenue_usd_m / (1 + g);
    var swing = p.revenue_usd_m - prior;
    return isFinite(swing) ? swing : null;
  }

  // The product highlight with the single largest absolute dollar swing --
  // i.e. the drug most responsible for this quarter's outperformance (positive
  // swing) or underperformance (negative swing) among reported product lines.
  function quarterDriver(c) {
    var highlights = c.product_highlights || [];
    var scored = highlights
      .map(function (p) { return { p: p, swing: productSwing(p) }; })
      .filter(function (x) { return x.swing != null; });
    if (!scored.length) return null;
    scored.sort(function (a, b) { return Math.abs(b.swing) - Math.abs(a.swing); });
    return scored[0];
  }

  function renderKPIs() {
    var companies = state.data.companies;
    var reporting = companies.filter(function (c) { return c.revenue && c.revenue.yoy_growth_pct != null; });
    var growing = reporting.filter(function (c) { return c.revenue.yoy_growth_pct >= 0; });
    var declining = reporting.filter(function (c) { return c.revenue.yoy_growth_pct < 0; });
    var inLoss = companies.filter(function (c) { return c.profit && c.profit.usd_m != null && c.profit.usd_m < 0; });
    var acquired = companies.filter(isAcquired);

    var sortedGrowth = reporting.map(function (c) { return c.revenue.yoy_growth_pct; }).sort(function (a, b) { return a - b; });
    var median = sortedGrowth.length
      ? (sortedGrowth.length % 2
          ? sortedGrowth[(sortedGrowth.length - 1) / 2]
          : (sortedGrowth[sortedGrowth.length / 2 - 1] + sortedGrowth[sortedGrowth.length / 2]) / 2)
      : null;

    var tiles = [
      { label: "Companies tracked", value: companies.length, sub: "large, mid, and small-cap" },
      { label: "Revenue growing YoY", value: growing.length, sub: growing.length + " of " + reporting.length + " reporting" },
      { label: "Revenue declining YoY", value: declining.length, sub: declining.length + " of " + reporting.length + " reporting" },
      { label: "Median revenue growth", value: median != null ? formatPct(median) : "—", sub: "across tracked companies" },
      { label: "Reporting a net loss", value: inLoss.length, sub: acquired.length + " acquired since last report" },
    ];

    els.kpiRow.innerHTML = tiles.map(function (t) {
      return '<div class="kpi-tile"><div class="label">' + escapeHtml(t.label) + '</div>' +
        '<div class="value">' + escapeHtml(String(t.value)) + '</div>' +
        '<div class="sub">' + escapeHtml(t.sub) + '</div></div>';
    }).join("");
  }

  function applyFilters() {
    var q = els.search.value.trim().toLowerCase();
    var tier = els.tierFilter.value;
    var growth = els.growthFilter.value;
    var status = els.statusFilter.value;

    state.filtered = state.data.companies.filter(function (c) {
      if (tier !== "all" && c.tier !== tier) return false;
      if (status === "active" && isAcquired(c)) return false;
      if (growth !== "all") {
        var pct = c.revenue && c.revenue.yoy_growth_pct;
        if (pct == null) return false;
        if (growth === "growing" && pct < 0) return false;
        if (growth === "declining" && pct >= 0) return false;
      }
      if (q) {
        var productNames = (c.product_highlights || []).map(function (p) { return p.product; }).join(" ");
        var hay = [c.company_name, c.ticker, c.hq_country, productNames].filter(Boolean).join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    render();
  }

  function render() {
    if (state.view === "table") renderTable(); else renderTimeline();
    els.emptyState.style.display = state.filtered.length === 0 ? "block" : "none";
  }

  function setView(view) {
    state.view = view;
    els.viewTableBtn.classList.toggle("active", view === "table");
    els.viewTimelineBtn.classList.toggle("active", view === "timeline");
    els.tableView.style.display = view === "table" ? "block" : "none";
    els.timelineView.style.display = view === "timeline" ? "block" : "none";
    render();
  }

  function getPath(obj, path) {
    return path.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, obj);
  }

  function sortValueFor(c, key) {
    if (key === "driver_swing") {
      var d = quarterDriver(c);
      return d ? d.swing : null;
    }
    return getPath(c, key);
  }

  function sortedFiltered() {
    var key = state.sortKey, dir = state.sortDir;
    return state.filtered.slice().sort(function (a, b) {
      var av = sortValueFor(a, key), bv = sortValueFor(b, key);
      if (av == null) av = "";
      if (bv == null) bv = "";
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  function revenueCell(c) {
    var rev = c.revenue || {};
    if (rev.usd_m == null) return "<span style=\"color:var(--text-muted);\">Not disclosed</span>";
    var pillCls = growthPillClass(rev.yoy_growth_pct);
    var growthText = rev.yoy_growth_pct != null ? formatPct(rev.yoy_growth_pct) + " YoY" : "YoY n/a";
    return "<span title=\"" + escapeAttr(rev.note || "") + "\">" + escapeHtml(formatUsdM(rev.usd_m)) + "</span> " +
      "<span class=\"status-pill " + pillCls + "\">" + (pillCls ? "<span class=\"dot\"></span>" : "") + escapeHtml(growthText) + "</span>";
  }

  function profitCell(c) {
    var profit = c.profit || {};
    if (profit.usd_m == null) return "<span style=\"color:var(--text-muted);\">Not disclosed</span>";
    var pillCls = profitPillClass(profit.usd_m);
    var growthText = profit.yoy_growth_pct != null ? formatPct(profit.yoy_growth_pct) + " YoY" : (profit.usd_m < 0 ? "net loss" : "n/a");
    return "<span title=\"" + escapeAttr((profit.metric || "") + " — " + (profit.note || "")) + "\">" + escapeHtml(formatUsdM(profit.usd_m)) + "</span> " +
      "<span class=\"status-pill " + pillCls + "\">" + (pillCls ? "<span class=\"dot\"></span>" : "") + escapeHtml(growthText) + "</span>";
  }

  function driverCell(c) {
    var d = quarterDriver(c);
    if (!d) return "<span style=\"color:var(--text-muted);\">—</span>";
    var pillCls = growthPillClass(d.p.yoy_growth_pct);
    var titleParts = [
      d.p.product + ":",
      d.p.yoy_growth_pct != null ? formatPct(d.p.yoy_growth_pct) + " YoY" : "",
      d.p.revenue_usd_m != null ? formatUsdM(d.p.revenue_usd_m) + " in the quarter" : "",
      "— approx. " + formatUsdM(Math.abs(d.swing)) + (d.swing >= 0 ? " added" : " lost") + " YoY (largest product-level dollar swing this quarter, estimated).",
      d.p.note || "",
    ];
    var title = titleParts.filter(Boolean).join(" ");
    return "<span class=\"status-pill " + pillCls + "\" title=\"" + escapeAttr(title) + "\">" +
      "<span class=\"dot\"></span>" + escapeHtml(d.p.product) + "</span>";
  }

  function statusCell(c) {
    if (c.status === "acquired") return "<span class=\"setting-pill\" title=\"" + escapeAttr(c.status_note || "") + "\">Acquired</span>";
    if (c.status === "pending_acquisition") return "<span class=\"setting-pill\" title=\"" + escapeAttr(c.status_note || "") + "\">Pending acquisition</span>";
    return "<span class=\"setting-pill\">Independent</span>";
  }

  function renderTable() {
    var rows = sortedFiltered();
    els.tableBody.innerHTML = rows.map(function (c) {
      return "<tr data-id=\"" + escapeHtml(c.id) + "\">" +
        "<td><strong>" + escapeHtml(c.company_name) + "</strong><br><span style=\"color:var(--text-muted);font-size:12px;\">" + escapeHtml(c.hq_country || "") + "</span></td>" +
        "<td>" + escapeHtml(c.ticker || "—") + "<br><span style=\"color:var(--text-muted);font-size:12px;\">" + escapeHtml(c.exchange || "") + "</span></td>" +
        "<td><span class=\"badge tier-" + c.tier + "\"><span class=\"dot\"></span>" + tierLabel(c.tier) + "</span></td>" +
        "<td>" + escapeHtml(c.latest_quarter || "—") + "</td>" +
        "<td class=\"date-cell\">" + revenueCell(c) + "</td>" +
        "<td class=\"date-cell\">" + profitCell(c) + "</td>" +
        "<td>" + driverCell(c) + "</td>" +
        "<td>" + statusCell(c) + "</td>" +
        "</tr>";
    }).join("");
    Array.prototype.forEach.call(els.tableBody.querySelectorAll("tr"), function (tr) {
      tr.addEventListener("click", function () { openDrawer(tr.getAttribute("data-id")); });
    });
  }

  function renderTimeline() {
    var rows = state.filtered.slice().sort(function (a, b) {
      var av = a.revenue && a.revenue.usd_m != null ? a.revenue.usd_m : -Infinity;
      var bv = b.revenue && b.revenue.usd_m != null ? b.revenue.usd_m : -Infinity;
      return bv - av;
    });
    var order = ["large", "mid", "small"];
    var labels = { large: "Large-cap", mid: "Mid-cap", small: "Small-cap" };
    var groups = { large: [], mid: [], small: [] };
    rows.forEach(function (c) { (groups[c.tier] || groups.mid).push(c); });

    els.timelineContainer.innerHTML = order.filter(function (t) { return groups[t].length; }).map(function (tier) {
      var cards = groups[tier].map(function (c) {
        var pillCls = growthPillClass(c.revenue && c.revenue.yoy_growth_pct);
        var growthText = c.revenue && c.revenue.yoy_growth_pct != null ? formatPct(c.revenue.yoy_growth_pct) : "n/a";
        return "<div class=\"tl-card\" data-id=\"" + escapeHtml(c.id) + "\">" +
          "<div class=\"date\">" + escapeHtml(c.revenue && c.revenue.usd_m != null ? formatUsdM(c.revenue.usd_m) : "Revenue n/a") +
          " · <span class=\"status-pill " + pillCls + "\">" + escapeHtml(growthText) + "</span></div>" +
          "<div class=\"name\">" + escapeHtml(c.company_name) + "</div>" +
          "<div class=\"company\">" + escapeHtml(c.ticker || "") + " · " + escapeHtml(c.latest_quarter || "") + "</div>" +
          "</div>";
      }).join("");
      return "<div class=\"timeline-group\"><h3>" + escapeHtml(labels[tier]) + "</h3><div class=\"timeline-cards\">" + cards + "</div></div>";
    }).join("");

    Array.prototype.forEach.call(els.timelineContainer.querySelectorAll(".tl-card"), function (card) {
      card.addEventListener("click", function () { openDrawer(card.getAttribute("data-id")); });
    });
  }

  function openDrawer(id) {
    var c = state.data.companies.find(function (x) { return x.id === id; });
    if (!c) return;
    var rev = c.revenue || {};
    var profit = c.profit || {};
    var highlights = c.product_highlights || [];
    var sources = c.sources || [];
    var driver = quarterDriver(c);

    var html = "";
    html += "<h2>" + escapeHtml(c.company_name) + "</h2>";
    html += "<div class=\"sub\">" + escapeHtml(c.ticker || "") + " · " + escapeHtml(c.exchange || "") + " · " + escapeHtml(c.hq_country || "") +
      " · <span class=\"badge tier-" + c.tier + "\"><span class=\"dot\"></span>" + tierLabel(c.tier) + "</span></div>";

    if (c.status === "acquired" || c.status === "pending_acquisition") {
      html += "<div class=\"loe-highlight\"><div class=\"caveat\"><strong>" +
        (c.status === "acquired" ? "No longer independently publicly traded." : "Pending acquisition — still trading independently.") +
        "</strong> " + escapeHtml(c.status_note || "") + "</div></div>";
    }

    html += "<div class=\"loe-highlight\"><div class=\"date\">" + escapeHtml(rev.usd_m != null ? formatUsdM(rev.usd_m) : "Not disclosed") +
      (rev.yoy_growth_pct != null ? " <span style=\"font-size:14px;\">(" + formatPct(rev.yoy_growth_pct) + " YoY)</span>" : "") + "</div>";
    html += "<div class=\"caveat\">Total revenue, " + escapeHtml(c.latest_quarter || "latest reported quarter") +
      (rev.note ? " — " + escapeHtml(rev.note) : "") +
      (rev.source_url ? " <a href=\"" + escapeAttr(rev.source_url) + "\" target=\"_blank\" rel=\"noopener\">Source ↗</a>" : "") + "</div></div>";

    if (driver) {
      var driverPositive = driver.swing >= 0;
      html += "<div class=\"loe-highlight\" style=\"background: color-mix(in srgb, var(--status-" + (driverPositive ? "good" : "critical") + ") 14%, transparent);\">" +
        "<div class=\"caveat\"><strong>" + (driverPositive ? "Quarter driver: " : "Quarter drag: ") + escapeHtml(driver.p.product) + "</strong> — " +
        (driver.p.yoy_growth_pct != null ? escapeHtml(formatPct(driver.p.yoy_growth_pct)) + " YoY" : "") +
        (driver.p.revenue_usd_m != null ? ", " + escapeHtml(formatUsdM(driver.p.revenue_usd_m)) + " in the quarter" : "") +
        ". Approximately " + escapeHtml(formatUsdM(Math.abs(driver.swing))) + (driverPositive ? " added" : " lost") +
        " year-over-year — the largest dollar swing among this company's reported product lines this quarter." +
        (driver.p.note ? " " + escapeHtml(driver.p.note) : "") +
        "<br><span style=\"font-size:11px;\">Estimated from reported YoY growth rates, not a company-disclosed decomposition.</span></div></div>";
    }

    html += "<section><h4>Profit</h4>";
    html += "<p><strong>" + escapeHtml(profit.usd_m != null ? formatUsdM(profit.usd_m) : "Not disclosed") + "</strong>" +
      (profit.metric ? " (" + escapeHtml(profit.metric) + ")" : "") +
      (profit.yoy_growth_pct != null ? ", " + formatPct(profit.yoy_growth_pct) + " YoY" : "") +
      (profit.note ? " — " + escapeHtml(profit.note) : "") +
      (profit.source_url ? " <a href=\"" + escapeAttr(profit.source_url) + "\" target=\"_blank\" rel=\"noopener\">Source ↗</a>" : "") + "</p>";
    html += "</section>";

    if (highlights.length) {
      html += "<section><h4>Product-specific call-outs</h4>";
      highlights.forEach(function (p) {
        var pillCls = growthPillClass(p.yoy_growth_pct);
        var isDriver = driver && driver.p === p;
        html += "<div class=\"competitor-row\"><div class=\"name\">" +
          (isDriver ? "<span class=\"setting-pill\" style=\"margin-right:6px;\">★ " + (driver.swing >= 0 ? "Quarter driver" : "Quarter drag") + "</span>" : "") +
          escapeHtml(p.product) +
          (p.revenue_usd_m != null ? " — " + escapeHtml(formatUsdM(p.revenue_usd_m)) : "") +
          (p.yoy_growth_pct != null ? " <span class=\"status-pill " + pillCls + "\">" + escapeHtml(formatPct(p.yoy_growth_pct)) + " YoY</span>" : "") +
          "</div>" +
          (p.note ? "<div>" + escapeHtml(p.note) + "</div>" : "") +
          "</div>";
      });
      html += "</section>";
    }

    if (c.notes) html += "<section><h4>Notes</h4><p>" + escapeHtml(c.notes) + "</p></section>";

    if (sources.length) {
      html += "<section class=\"sources\"><h4>Sources</h4>";
      sources.forEach(function (s) { html += "<a href=\"" + escapeAttr(s) + "\" target=\"_blank\" rel=\"noopener\">" + escapeHtml(s) + "</a>"; });
      html += "</section>";
    }

    els.drawerContent.innerHTML = html;
    els.drawerOverlay.classList.add("open");
  }

  function closeDrawer() {
    els.drawerOverlay.classList.remove("open");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
