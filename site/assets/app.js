/* Rx Patent Expiration Tracker — front end
 * Reads site/data/drugs.json (produced by scripts/build_data.py) and renders
 * a searchable/filterable table, a chronological timeline, and a detail
 * drawer per drug. No build step, no framework — plain JS so this deploys
 * as-is to GitHub Pages / Netlify / any static host.
 */
(function () {
  "use strict";

  var state = {
    data: null,
    filtered: [],
    sortKey: "earliest_loss_of_exclusivity_date",
    sortDir: 1,
    view: "table",
  };

  var els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    els.kpiRow = document.getElementById("kpiRow");
    els.lastUpdated = document.getElementById("lastUpdated");
    els.search = document.getElementById("searchInput");
    els.typeFilter = document.getElementById("typeFilter");
    els.settingFilter = document.getElementById("settingFilter");
    els.horizonFilter = document.getElementById("horizonFilter");
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
    els.typeFilter.addEventListener("change", applyFilters);
    els.settingFilter.addEventListener("change", applyFilters);
    els.horizonFilter.addEventListener("change", applyFilters);
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

    fetch("data/drugs.json")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        state.data = data;
        state.filtered = data.drugs.slice();
        els.lastUpdated.textContent = "Data generated " + formatDateTime(data.generated_at) +
          (data.live_data_fetched && (data.live_data_fetched.orange_book || data.live_data_fetched.purple_book)
            ? " · live FDA data" : " · seed data (live pipeline not yet run)");
        els.disclaimer.textContent = data.disclaimer || "";
        renderKPIs();
        applyFilters();
      })
      .catch(function (err) {
        els.lastUpdated.textContent = "Could not load data/drugs.json";
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

  function daysUntil(dateStr) {
    if (!dateStr) return Infinity;
    var target = new Date(dateStr + "T00:00:00Z").getTime();
    var now = Date.now();
    return Math.round((target - now) / 86400000);
  }

  function formatDate(dateStr) {
    if (!dateStr) return "Unknown";
    var d = new Date(dateStr + "T00:00:00Z");
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  }

  function formatDateTime(iso) {
    if (!iso) return "unknown time";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function typeLabel(type) {
    return type === "biologic" ? "Biologic" : "Small molecule";
  }

  function settingLabel(setting) {
    return setting === "clinic" ? "Clinic-administered" : "Pharmacy prescription";
  }

  function formatUsdM(usdM) {
    if (usdM == null) return null;
    if (usdM >= 1000) return "$" + (usdM / 1000).toFixed(2) + "B";
    return "$" + Math.round(usdM) + "M";
  }

  function renderKPIs() {
    var drugs = state.data.drugs;
    var in90 = drugs.filter(function (d) { var n = daysUntil(d.earliest_loss_of_exclusivity_date); return n >= 0 && n <= 90; }).length;
    var in365 = drugs.filter(function (d) { var n = daysUntil(d.earliest_loss_of_exclusivity_date); return n >= 0 && n <= 365; }).length;
    var upcoming = drugs.filter(function (d) { return daysUntil(d.earliest_loss_of_exclusivity_date) >= 0; })
      .sort(function (a, b) { return (a.earliest_loss_of_exclusivity_date || "9999").localeCompare(b.earliest_loss_of_exclusivity_date || "9999"); });
    var next = upcoming[0];

    var withSales = drugs.filter(function (d) { return d.sales_2025 && d.sales_2025.usd_m != null; });
    var totalSalesM = withSales.reduce(function (sum, d) { return sum + d.sales_2025.usd_m; }, 0);
    var clinicCount = drugs.filter(function (d) { return d.administration && d.administration.setting === "clinic"; }).length;

    var tiles = [
      { label: "Drugs tracked", value: drugs.length, sub: "small molecules + biologics" },
      { label: "Expiring in 90 days", value: in90, sub: "loss-of-exclusivity estimate" },
      { label: "Expiring in 12 months", value: in365, sub: "loss-of-exclusivity estimate" },
      {
        label: "Next up",
        value: next ? next.brand_name : "—",
        sub: next ? formatDate(next.earliest_loss_of_exclusivity_date) : "No upcoming dates in data",
      },
      {
        label: "FY2025 sales tracked",
        value: formatUsdM(totalSalesM) || "—",
        sub: withSales.length + " of " + drugs.length + " disclosed, mixed US/global scope · " + clinicCount + " clinic-administered",
      },
    ];

    els.kpiRow.innerHTML = tiles.map(function (t) {
      return '<div class="kpi-tile"><div class="label">' + escapeHtml(t.label) + '</div>' +
        '<div class="value">' + escapeHtml(String(t.value)) + '</div>' +
        '<div class="sub">' + escapeHtml(t.sub) + '</div></div>';
    }).join("");
  }

  function applyFilters() {
    var q = els.search.value.trim().toLowerCase();
    var type = els.typeFilter.value;
    var setting = els.settingFilter.value;
    var horizon = els.horizonFilter.value;

    state.filtered = state.data.drugs.filter(function (d) {
      if (type !== "all" && d.type !== type) return false;
      if (setting !== "all" && (!d.administration || d.administration.setting !== setting)) return false;
      if (horizon !== "all") {
        var n = daysUntil(d.earliest_loss_of_exclusivity_date);
        if (!(n >= 0 && n <= parseInt(horizon, 10))) return false;
      }
      if (q) {
        var hay = [d.brand_name, d.generic_name, d.company, d.indication].filter(Boolean).join(" ").toLowerCase();
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

  function competitionSummary(drug) {
    var comp = drug.competition || [];
    if (comp.length === 0) return { text: "No competitor data yet", cls: "" };
    var resolved = comp.filter(function (c) { return /settled|approved|marketed/i.test(c.status || ""); });
    if (resolved.length > 0) {
      return { text: resolved.length + " of " + comp.length + " settled/approved", cls: "good" };
    }
    return { text: comp.length + " expected / in litigation", cls: "warning" };
  }

  function getPath(obj, path) {
    return path.split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, obj);
  }

  function sortedFiltered() {
    var key = state.sortKey, dir = state.sortDir;
    return state.filtered.slice().sort(function (a, b) {
      var av = getPath(a, key), bv = getPath(b, key);
      if (av == null) av = "";
      if (bv == null) bv = "";
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  function renderTable() {
    var rows = sortedFiltered();
    els.tableBody.innerHTML = rows.map(function (d) {
      var comp = competitionSummary(d);
      var sales = d.sales_2025 || {};
      var admin = d.administration || {};
      var salesCell = sales.label
        ? "<span title=\"" + escapeAttr(sales.note || "") + "\">" + escapeHtml(sales.label) + "</span>"
        : "<span style=\"color:var(--text-muted);\">Not disclosed</span>";
      return "<tr data-id=\"" + escapeHtml(d.id) + "\">" +
        "<td><strong>" + escapeHtml(d.brand_name) + "</strong><br><span style=\"color:var(--text-muted);font-size:12px;\">" + escapeHtml(d.generic_name || "") + (d.indication ? " · " + escapeHtml(d.indication) : "") + "</span></td>" +
        "<td>" + escapeHtml(d.company || "—") + "</td>" +
        "<td><span class=\"badge type-" + d.type + "\"><span class=\"dot\"></span>" + typeLabel(d.type) + "</span></td>" +
        "<td><span class=\"setting-pill\" title=\"" + escapeAttr(admin.note || "") + "\">" + escapeHtml(settingLabel(admin.setting)) + "</span></td>" +
        "<td class=\"date-cell\">" + salesCell + "</td>" +
        "<td class=\"date-cell\">" + formatDate(d.earliest_loss_of_exclusivity_date) + "</td>" +
        "<td><span class=\"status-pill " + comp.cls + "\">" + (comp.cls ? "<span class=\"dot\"></span>" : "") + escapeHtml(comp.text) + "</span></td>" +
        "</tr>";
    }).join("");
    Array.prototype.forEach.call(els.tableBody.querySelectorAll("tr"), function (tr) {
      tr.addEventListener("click", function () { openDrawer(tr.getAttribute("data-id")); });
    });
  }

  function renderTimeline() {
    var rows = state.filtered.slice().sort(function (a, b) {
      return (a.earliest_loss_of_exclusivity_date || "9999").localeCompare(b.earliest_loss_of_exclusivity_date || "9999");
    });
    var groups = {};
    var order = [];
    rows.forEach(function (d) {
      var dt = d.earliest_loss_of_exclusivity_date;
      var label = "Undated";
      if (dt) {
        var year = dt.slice(0, 4), month = parseInt(dt.slice(5, 7), 10);
        var q = Math.floor((month - 1) / 3) + 1;
        label = "Q" + q + " " + year;
      }
      if (!groups[label]) { groups[label] = []; order.push(label); }
      groups[label].push(d);
    });

    els.timelineContainer.innerHTML = order.map(function (label) {
      var cards = groups[label].map(function (d) {
        return "<div class=\"tl-card " + d.type + "\" data-id=\"" + escapeHtml(d.id) + "\">" +
          "<div class=\"date\">" + formatDate(d.earliest_loss_of_exclusivity_date) + "</div>" +
          "<div class=\"name\">" + escapeHtml(d.brand_name) + "</div>" +
          "<div class=\"company\">" + escapeHtml(d.company || "") + "</div>" +
          "</div>";
      }).join("");
      return "<div class=\"timeline-group\"><h3>" + escapeHtml(label) + "</h3><div class=\"timeline-cards\">" + cards + "</div></div>";
    }).join("");

    Array.prototype.forEach.call(els.timelineContainer.querySelectorAll(".tl-card"), function (card) {
      card.addEventListener("click", function () { openDrawer(card.getAttribute("data-id")); });
    });
  }

  function openDrawer(id) {
    var d = state.data.drugs.find(function (x) { return x.id === id; });
    if (!d) return;
    var n = daysUntil(d.earliest_loss_of_exclusivity_date);
    var patents = (d.patents || []).filter(function (p) { return p.patent_no; });
    var excl = d.exclusivity || [];
    var comp = d.competition || [];
    var sources = d.sources || [];

    var sales = d.sales_2025 || {};
    var admin = d.administration || {};

    var html = "";
    html += "<h2>" + escapeHtml(d.brand_name) + "</h2>";
    html += "<div class=\"sub\">" + escapeHtml(d.generic_name || "") + " · " + escapeHtml(d.company || "") + " · <span class=\"badge type-" + d.type + "\"><span class=\"dot\"></span>" + typeLabel(d.type) + "</span></div>";

    html += "<div class=\"loe-highlight\"><div class=\"date\">" + formatDate(d.earliest_loss_of_exclusivity_date) + "</div>";
    html += "<div class=\"caveat\">Estimated loss of exclusivity" + (n >= 0 ? " · " + n + " days from today" : "") +
      (d.loe_date_source === "fda_live_data" ? " · sourced from live FDA data" : " · curated estimate, verify against live Orange/Purple Book data") + "</div></div>";

    html += "<section><h4>FY2025 sales &amp; administration</h4>";
    html += "<p><strong>" + escapeHtml(sales.label || "Not disclosed") + "</strong>" + (sales.note ? " — " + escapeHtml(sales.note) : "") +
      (sales.source_url ? " <a href=\"" + escapeAttr(sales.source_url) + "\" target=\"_blank\" rel=\"noopener\">Source ↗</a>" : "") + "</p>";
    html += "<p><span class=\"setting-pill\">" + escapeHtml(settingLabel(admin.setting)) + "</span>" + (admin.note ? " — " + escapeHtml(admin.note) : "") + "</p>";
    html += "</section>";

    html += "<section><h4>Indication</h4><p>" + escapeHtml(d.indication || "Not recorded") + "</p></section>";

    if (d.notes) html += "<section><h4>Notes</h4><p>" + escapeHtml(d.notes) + "</p></section>";

    if (comp.length) {
      html += "<section><h4>Generic / biosimilar competition</h4>";
      comp.forEach(function (c) {
        html += "<div class=\"competitor-row\"><div class=\"name\">" + escapeHtml(c.name) + "</div>" +
          "<div>Status: " + escapeHtml(c.status || "unknown") + (c.expected_launch ? " · Expected: " + escapeHtml(c.expected_launch) : "") + "</div>" +
          (c.note ? "<div>" + escapeHtml(c.note) + "</div>" : "") +
          (c.source_url ? "<a href=\"" + escapeAttr(c.source_url) + "\" target=\"_blank\" rel=\"noopener\">Source ↗</a>" : "") +
          "</div>";
      });
      html += "</section>";
    }

    if (patents.length) {
      html += "<section><h4>Listed patents (Orange Book)</h4><ul class=\"patent-list\">";
      patents.forEach(function (p) {
        html += "<li>Patent " + escapeHtml(p.patent_no) + " — expires " + escapeHtml(p.expires || "unknown") + (p.use_code ? " (" + escapeHtml(p.use_code) + ")" : "") + "</li>";
      });
      html += "</ul></section>";
    }

    if (excl.length) {
      html += "<section><h4>Exclusivity</h4><ul class=\"excl-list\">";
      excl.forEach(function (e) {
        html += "<li>" + escapeHtml(e.code || "Exclusivity") + " — expires " + escapeHtml(e.expires || "unknown") + "</li>";
      });
      html += "</ul></section>";
    }

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
