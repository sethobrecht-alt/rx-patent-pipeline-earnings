/* Specialty Pipeline Tracker — front end
 * Reads site/data/pipeline.json (produced by scripts/build_pipeline_data.py)
 * and renders a searchable/filterable table, a launch-year timeline, and a
 * detail drawer per drug. Mirrors assets/app.js's structure and helpers,
 * adapted to the pipeline schema (drug_name/developer/modality/expected_launch/
 * peak_sales_projection instead of brand_name/company/type/earliest_loss_of_
 * exclusivity_date/sales_2025). No build step, no framework.
 */
(function () {
  "use strict";

  var state = {
    data: null,
    filtered: [],
    sortKey: "expected_launch",
    sortDir: 1,
    view: "table",
  };

  var els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    els.kpiRow = document.getElementById("kpiRow");
    els.lastUpdated = document.getElementById("lastUpdated");
    els.search = document.getElementById("searchInput");
    els.modalityFilter = document.getElementById("modalityFilter");
    els.settingFilter = document.getElementById("settingFilter");
    els.salesFilter = document.getElementById("salesFilter");
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
    els.modalityFilter.addEventListener("change", applyFilters);
    els.settingFilter.addEventListener("change", applyFilters);
    els.salesFilter.addEventListener("change", applyFilters);
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

    fetch("data/pipeline.json")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        state.data = data;
        state.filtered = data.drugs.slice();
        els.lastUpdated.textContent = "Data generated " + formatDateTime(data.generated_at) + " · hand-curated research (no live database for unapproved drugs)";
        els.disclaimer.textContent = data.disclaimer || "";
        renderKPIs();
        applyFilters();
      })
      .catch(function (err) {
        els.lastUpdated.textContent = "Could not load data/pipeline.json";
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

  function modalityLabel(modality) {
    if (modality === "biologic") return "Biologic";
    if (modality === "cell_gene_therapy") return "Cell & gene therapy";
    return "Small molecule";
  }

  function settingLabel(setting) {
    return setting === "clinic" ? "Clinic-administered" : "Pharmacy prescription";
  }

  // Expected-launch strings are free text ("FDA filing planned Q1 2027; launch
  // most likely 2027-2028 pending review") rather than ISO dates, since these
  // drugs aren't approved yet. Pull out the earliest plausible year mentioned
  // so we can sort/bucket chronologically without pretending we have a real date.
  function parseLaunchYear(expectedLaunch) {
    if (!expectedLaunch) return null;
    var matches = expectedLaunch.match(/20\d{2}/g);
    if (!matches) return null;
    return Math.min.apply(null, matches.map(function (m) { return parseInt(m, 10); }));
  }

  function peakSalesValue(d) {
    var p = d.peak_sales_projection;
    if (!p) return null;
    if (p.usd_b_high != null) return p.usd_b_high;
    if (p.usd_b_low != null) return p.usd_b_low;
    return null;
  }

  function hasEstimate(d) {
    return peakSalesValue(d) != null;
  }

  function renderKPIs() {
    var drugs = state.data.drugs;
    var smallMolecule = drugs.filter(function (d) { return d.modality === "small_molecule"; }).length;
    var biologicOrCg = drugs.filter(function (d) { return d.modality === "biologic" || d.modality === "cell_gene_therapy"; }).length;
    var clinicCount = drugs.filter(function (d) { return d.administration && d.administration.setting === "clinic"; }).length;
    var withEstimate = drugs.filter(hasEstimate).length;

    var withYear = drugs
      .map(function (d) { return { d: d, year: parseLaunchYear(d.expected_launch) }; })
      .filter(function (x) { return x.year != null; })
      .sort(function (a, b) { return a.year - b.year; });
    var nearest = withYear[0];

    var tiles = [
      { label: "Drugs tracked", value: drugs.length, sub: "in active clinical development" },
      { label: "Small molecule", value: smallMolecule, sub: "of " + drugs.length + " tracked" },
      { label: "Biologic / cell & gene", value: biologicOrCg, sub: "of " + drugs.length + " tracked" },
      { label: "Clinic-administered", value: clinicCount, sub: (drugs.length - clinicCount) + " pharmacy-dispensed" },
      {
        label: "Nearest expected launch",
        value: nearest ? nearest.d.drug_name : "—",
        sub: nearest ? nearest.d.expected_launch : "No parseable launch estimates in data",
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
    var modality = els.modalityFilter.value;
    var setting = els.settingFilter.value;
    var sales = els.salesFilter.value;

    state.filtered = state.data.drugs.filter(function (d) {
      if (modality !== "all" && d.modality !== modality) return false;
      if (setting !== "all" && (!d.administration || d.administration.setting !== setting)) return false;
      if (sales === "estimated" && !hasEstimate(d)) return false;
      if (sales === "unestimated" && hasEstimate(d)) return false;
      if (q) {
        var hay = [d.drug_name, d.developer, d.indication, d.development_phase].filter(Boolean).join(" ").toLowerCase();
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

  // A couple of sort keys aren't plain object paths (expected_launch needs the
  // parsed year, peak_sales isn't a real field) -- special-case those, fall
  // back to getPath for everything else.
  function sortValue(d, key) {
    if (key === "expected_launch") { var y = parseLaunchYear(d.expected_launch); return y == null ? 9999 : y; }
    if (key === "peak_sales") { var v = peakSalesValue(d); return v == null ? -1 : v; }
    return getPath(d, key);
  }

  function sortedFiltered() {
    var key = state.sortKey, dir = state.sortDir;
    return state.filtered.slice().sort(function (a, b) {
      var av = sortValue(a, key), bv = sortValue(b, key);
      if (av == null) av = "";
      if (bv == null) bv = "";
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  function peakSalesCell(d) {
    var p = d.peak_sales_projection;
    if (!p || !p.label) return "<span style=\"color:var(--text-muted);\">Not yet estimated</span>";
    return "<span title=\"" + escapeAttr(p.note || "") + "\">" + escapeHtml(p.label) + "</span>";
  }

  function renderTable() {
    var rows = sortedFiltered();
    els.tableBody.innerHTML = rows.map(function (d) {
      var admin = d.administration || {};
      return "<tr data-id=\"" + escapeHtml(d.id) + "\">" +
        "<td><strong>" + escapeHtml(d.drug_name) + "</strong></td>" +
        "<td>" + escapeHtml(d.developer || "—") + "</td>" +
        "<td><span class=\"badge type-" + d.modality + "\"><span class=\"dot\"></span>" + modalityLabel(d.modality) + "</span></td>" +
        "<td style=\"max-width:220px;\">" + escapeHtml(d.indication || "—") + "</td>" +
        "<td style=\"max-width:180px;\">" + escapeHtml(d.development_phase || "—") + "</td>" +
        "<td>" + escapeHtml(d.expected_launch || "Unknown") + "</td>" +
        "<td><span class=\"setting-pill\" title=\"" + escapeAttr(admin.note || "") + "\">" + escapeHtml(settingLabel(admin.setting)) + "</span></td>" +
        "<td class=\"date-cell\">" + peakSalesCell(d) + "</td>" +
        "</tr>";
    }).join("");
    Array.prototype.forEach.call(els.tableBody.querySelectorAll("tr"), function (tr) {
      tr.addEventListener("click", function () { openDrawer(tr.getAttribute("data-id")); });
    });
  }

  function renderTimeline() {
    var rows = state.filtered.slice().sort(function (a, b) {
      return sortValue(a, "expected_launch") - sortValue(b, "expected_launch");
    });
    var groups = {};
    var order = [];
    rows.forEach(function (d) {
      var year = parseLaunchYear(d.expected_launch);
      var label = year == null ? "Unknown timeline" : "~" + year;
      if (!groups[label]) { groups[label] = []; order.push(label); }
      groups[label].push(d);
    });

    els.timelineContainer.innerHTML = order.map(function (label) {
      var cards = groups[label].map(function (d) {
        return "<div class=\"tl-card " + d.modality + "\" data-id=\"" + escapeHtml(d.id) + "\">" +
          "<div class=\"date\">" + escapeHtml(d.expected_launch || "Unknown") + "</div>" +
          "<div class=\"name\">" + escapeHtml(d.drug_name) + "</div>" +
          "<div class=\"company\">" + escapeHtml(d.developer || "") + "</div>" +
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
    var admin = d.administration || {};
    var sales = d.peak_sales_projection || {};
    var sources = d.sources || [];

    var html = "";
    html += "<h2>" + escapeHtml(d.drug_name) + "</h2>";
    html += "<div class=\"sub\">" + escapeHtml(d.developer || "") + " · <span class=\"badge type-" + d.modality + "\"><span class=\"dot\"></span>" + modalityLabel(d.modality) + "</span></div>";

    html += "<div class=\"loe-highlight\"><div class=\"date\">" + escapeHtml(d.expected_launch || "Unknown") + "</div>";
    html += "<div class=\"caveat\">Estimated launch window · " + escapeHtml(d.development_phase || "development stage not recorded") + "</div></div>";

    html += "<section><h4>Projected indication</h4><p>" + escapeHtml(d.indication || "Not recorded") + "</p></section>";

    html += "<section><h4>Administration setting</h4>";
    html += "<p><span class=\"setting-pill\">" + escapeHtml(settingLabel(admin.setting)) + "</span>" + (admin.note ? " — " + escapeHtml(admin.note) : "") + "</p>";
    html += "</section>";

    html += "<section><h4>Potential revenue (peak sales projection)</h4>";
    html += "<p><strong>" + escapeHtml(sales.label || "Not yet estimated") + "</strong>" + (sales.note ? " — " + escapeHtml(sales.note) : "") +
      (sales.source_url ? " <a href=\"" + escapeAttr(sales.source_url) + "\" target=\"_blank\" rel=\"noopener\">Source ↗</a>" : "") + "</p>";
    html += "</section>";

    if (d.notes) html += "<section><h4>Notes</h4><p>" + escapeHtml(d.notes) + "</p></section>";

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
