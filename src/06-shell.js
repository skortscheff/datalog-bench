  /* ==========================================================
     KPIs — the first six that this log can actually support
     ========================================================== */
  function drawKpis() {
    var host = document.getElementById("kpis");
    host.textContent = "";
    var sel = VIEW, cand = [];
    function sev(v, warn, crit) { return v == null ? "neutral" : v >= crit ? "critical" : v >= warn ? "warning" : "good"; }
    function peak(k) { var b = null, i, v; for (i = 0; i < sel.length; i++) { v = C[k][sel[i]]; if (v != null && isFinite(v) && (b == null || v > b)) b = v; } return b; }

    var trimSel = sel;
    if (L.closedLoop) {
      var s2 = {}, j;
      for (j = 0; j < L.closedLoop.length; j++) s2[L.closedLoop[j]] = 1;
      var cl = sel.filter(function (i) { return s2[i] && (!HAVE.ect || C.ect[i] > 70); });
      if (cl.length > 8) trimSel = cl;
    } else if (HAVE.ect) {
      var wq = sel.filter(function (i) { return C.ect[i] > 70; });
      if (wq.length > 8) trimSel = wq;
    }

    if (HAVE.tt1) {
      var m1 = medOf(pick(C.tt1, trimSel));
      cand.push({ k: HAVE.tt2 ? "Trim, bank 1" : "Fuel trim", v: sgn(m1, 1), u: "%", sub: "median STFT+LTFT",
        chip: sev(m1 == null ? null : Math.abs(m1), 10, 18),
        lab: m1 == null ? "no data" : Math.abs(m1) >= 18 ? "out of authority" : Math.abs(m1) >= 10 ? "over limit" : "in range" });
    }
    if (HAVE.tt2) {
      var m2 = medOf(pick(C.tt2, trimSel));
      cand.push({ k: "Trim, bank 2", v: sgn(m2, 1), u: "%", sub: "median STFT+LTFT",
        chip: sev(m2 == null ? null : Math.abs(m2), 10, 18),
        lab: m2 == null ? "no data" : Math.abs(m2) >= 18 ? "out of authority" : Math.abs(m2) >= 10 ? "over limit" : "in range" });
    }
    if (HAVE.ect) { var e = peak("ect");
      cand.push({ k: "Peak coolant", v: fmt(e, 0), u: "°C", sub: "highest in window",
        chip: sev(e, 105, 112), lab: e == null ? "no data" : e >= 112 ? "overheating" : e >= 105 ? "hot" : "normal" }); }
    if (HAVE.iat) { var a = peak("iat");
      cand.push({ k: "Peak intake air", v: fmt(a, 0), u: "°C", sub: "charge temperature",
        chip: sev(a, 70, 95), lab: a == null ? "no data" : a >= 95 ? "very hot" : a >= 70 ? "hot" : "normal" }); }
    if (HAVE.rpm) { var r = peak("rpm");
      cand.push({ k: "Peak engine speed", v: fmt(r, 0), u: "rpm", sub: "highest in window", chip: "neutral", lab: "logged" }); }
    if (HAVE.vss) { var s = peak("vss");
      cand.push({ k: "Peak road speed", v: fmt(s, 0), u: "km/h", sub: "highest in window", chip: "neutral", lab: "logged" }); }
    if (HAVE.fs1) {
      var run = sel.filter(function (i) { return !HAVE.ect || C.ect[i] > 70; });
      var clc = run.filter(function (i) { return C.fs1[i] === 2 || C.fs1[i] === 16; });
      var share = run.length ? clc.length / run.length : null;
      cand.push({ k: "Closed loop", v: share == null ? "—" : (share * 100).toFixed(0), u: "%", sub: "of warm frames",
        chip: share == null ? "neutral" : share > 0.8 ? "good" : "warning",
        lab: share == null ? "no data" : share > 0.8 ? "fuelling in control" : "mostly open loop" });
    }
    if (HAVE.volt) { var vv = medOf(pick(C.volt, sel));
      cand.push({ k: "Module voltage", v: fmt(vv, 2), u: "V", sub: "median",
        chip: vv == null ? "neutral" : (vv < 12.9 || vv > 15.1) ? "warning" : "good",
        lab: vv == null ? "no data" : vv < 12.9 ? "low" : vv > 15.1 ? "high" : "normal" }); }
    if (!L.noTime) {
      var dtm = medOf(pick(C.dt, sel)), thr = dtm ? Math.max(dtm * 3, dtm + 1) : Infinity;
      var gaps = sel.filter(function (i) { return C.dt[i] != null && C.dt[i] > thr; }).length;
      cand.push({ k: "Logging gaps", v: String(gaps), u: "", sub: dtm ? "median " + fmt(dtm, 2) + " s" : "",
        chip: gaps === 0 ? "good" : gaps > 5 ? "serious" : "warning",
        lab: gaps === 0 ? "clean capture" : "adapter dropouts" });
    }
    cand.push({ k: "Frames", v: String(sel.length), u: "", sub: "in this window", chip: "neutral", lab: L.n + " total" });

    var tiles = cand.slice(0, 6);
    var perRow = window.innerWidth < 620 ? 2 : window.innerWidth < 1080 ? 3 : 6;
    host.style.gridTemplateColumns = "repeat(" + Math.min(tiles.length, perRow) + ", minmax(0,1fr))";

    tiles.forEach(function (it) {
      var d = el("div", "kpi");
      d.appendChild(el("span", "k", it.k));
      var v = el("span", "v"); v.textContent = it.v;
      if (it.u) { var sm = el("small"); sm.textContent = " " + it.u; v.appendChild(sm); }
      d.appendChild(v);
      var c = el("span", "chip " + it.chip);
      c.appendChild(el("i", "dot")); c.appendChild(el("span", null, it.lab));
      d.appendChild(c);
      d.appendChild(el("span", "sub", it.sub));
      host.appendChild(d);
    });

    /* headline sentence, assembled from the worst findings this log produced */
    var vl = document.getElementById("verdict-line");
    if (!sel.length) { vl.textContent = "No frames match the current window and state filter."; return; }
    var bad = (L.findings || []).filter(function (f) { return f.sev === "critical" || f.sev === "serious" || f.sev === "warning"; });
    vl.textContent = bad.length
      ? bad.slice(0, 2).map(function (f) { return f.h; }).join("; ") +
        (bad.length > 2 ? "; and " + (bad.length - 2) + " more below." : ".")
      : "Nothing in this log crosses a diagnostic threshold — see the findings below for what was checked and passed.";
  }

  /* ==========================================================
     FINDINGS
     ========================================================== */
  function drawFindings() {
    var host = document.getElementById("finds");
    host.textContent = "";
    var fs = L.findings || [];
    if (!fs.length) {
      host.appendChild(el("div", "ev-empty", "No rule had enough channels to run on this log. Map more columns in the Channels panel above, or log more PIDs."));
      return;
    }
    fs.forEach(function (f) {
      var d = el("div", "find");
      var left = el("div");
      var c = el("span", "chip " + f.sev);
      c.appendChild(el("i", "dot"));
      c.appendChild(el("span", null, f.sev === "neutral" ? "Note" : f.sev.charAt(0).toUpperCase() + f.sev.slice(1)));
      left.appendChild(c);
      left.appendChild(el("div", "ev", f.tag));
      d.appendChild(left);
      var mid = el("div");
      mid.appendChild(el("h4", null, f.h));
      mid.appendChild(el("p", null, f.p));
      d.appendChild(mid);
      var ev = el("div", "ev");
      ev.innerHTML = (f.ev || []).map(function (x) { return esc(x[0]) + " <b>" + esc(x[1]) + "</b>"; }).join("<br>");
      d.appendChild(ev);
      host.appendChild(d);
    });
  }

  /* ==========================================================
     PARSE REPORT + CHANNEL MAPPING
     ========================================================== */
  function drawChannelPanel() {
    var rep = L.report;
    var host = document.getElementById("parse-report");
    host.textContent = "";
    function row(k, v) { var d = el("div"); d.appendChild(el("dt", null, k)); d.appendChild(el("dd", null, v)); host.appendChild(d); }
    row("Delimiter", rep.delim === "tab" ? "tab" : "“" + rep.delim + "”");
    row("Header line", String(rep.headerLine));
    row("Columns", String(rep.columns));
    row("Data rows", String(rep.rows));
    row("Mapped channels", Object.keys(L.mapping).length + " of " + CHAN.length);
    row("Time base", L.noTime ? "frame index (no time column)" : "elapsed seconds");
    if (rep.decComma) row("Decimals", "comma");

    var wl = document.getElementById("parse-warnings");
    wl.textContent = "";
    var warns = (rep.warnings || []).concat(L.unitWarnings || []);
    warns.forEach(function (t) {
      var li = document.createElement("li");
      var c = el("span", "chip warning");
      c.appendChild(el("i", "dot")); c.appendChild(el("span", null, "Note"));
      li.appendChild(c);
      li.appendChild(el("span", null, t));
      wl.appendChild(li);
    });

    /* mapping table with a per-channel override */
    var tb = document.getElementById("maptbl").tBodies[0];
    tb.textContent = "";
    CHAN.forEach(function (ch) {
      var tr = document.createElement("tr");
      var ci = L.mapping[ch.k];
      if (ci == null) tr.className = "miss";
      var td1 = el("td", "ch", ch.nm); tr.appendChild(td1);
      var td2 = document.createElement("td");
      var sel = document.createElement("select");
      sel.setAttribute("aria-label", "Source column for " + ch.nm);
      var o0 = document.createElement("option");
      o0.value = ""; o0.textContent = "— not mapped —";
      sel.appendChild(o0);
      L.head.forEach(function (hh, hi) {
        if (!hh) return;
        var o = document.createElement("option");
        o.value = String(hi);
        o.textContent = hh + (L.numeric[hi] ? "" : "  (text)");
        sel.appendChild(o);
      });
      sel.value = ci == null ? "" : String(ci);
      sel.addEventListener("change", function () {
        var nv = sel.value === "" ? null : parseInt(sel.value, 10);
        /* one source column per channel: releasing it from any other holder */
        if (nv != null) {
          for (var kk in L.mapping) if (L.mapping[kk] === nv && kk !== ch.k) delete L.mapping[kk];
        }
        if (nv == null) delete L.mapping[ch.k]; else L.mapping[ch.k] = nv;
        buildChannels(L);
        analyze(L);
        activate(AI, true);
      });
      td2.appendChild(sel); tr.appendChild(td2);
      tr.appendChild(el("td", "u", ch.unit || "—"));
      tb.appendChild(tr);
    });

    var missing = CHAN.filter(function (ch) { return L.mapping[ch.k] == null; }).length;
    document.getElementById("chan-title").textContent =
      "Channels — " + Object.keys(L.mapping).length + " mapped, " + missing + " unmapped";
    document.getElementById("chan-hint").textContent =
      warns.length ? warns.length + " parse note" + (warns.length > 1 ? "s" : "") + " · click to review or remap"
                   : "click to review the mapping or override a column";
  }

  /* ==========================================================
     TABLE VIEW (source columns, verbatim)
     ========================================================== */
  var TBL_CAP = 4000;
  function drawTable() {
    var tbl = document.getElementById("tbl");
    var thead = tbl.tHead;
    thead.textContent = "";
    var tr0 = document.createElement("tr");
    L.head.forEach(function (h) { var th = document.createElement("th"); th.textContent = h; tr0.appendChild(th); });
    thead.appendChild(tr0);

    var body = document.createElement("tbody");
    var frag = document.createDocumentFragment();
    var lim = Math.min(VIEW.length, TBL_CAP);
    for (var k = 0; k < lim; k++) {
      var i2 = VIEW[k], tr = document.createElement("tr");
      for (var c = 0; c < L.head.length; c++) {
        var td = document.createElement("td");
        td.textContent = L.raw[c][i2];
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }
    body.appendChild(frag);
    tbl.replaceChild(body, tbl.tBodies[0]);
    document.getElementById("tbl-meta").textContent =
      VIEW.length + " of " + L.n + " frames · " + L.head.length + " columns · window " +
      clock(F.win[0]) + "–" + clock(F.win[1]) + " · state: " +
      (STATES.filter(function (s) { return s.id === F.state; })[0] || {}).label +
      (VIEW.length > lim ? " · showing the first " + lim + " rows" : "");
  }

  /* ==========================================================
     FILTER ROW
     ========================================================== */
  function buildSeg() {
    var seg = document.getElementById("state-seg");
    seg.textContent = "";
    STATES.forEach(function (s) {
      var n = 0;
      for (var k = 0; k < N; k++) if (s.id === "all" || ST[k] === s.id) n++;
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-pressed", String(F.state === s.id));
      b.appendChild(document.createTextNode(s.label));
      b.appendChild(el("span", "ct", String(n)));
      if (!n && s.id !== "all") b.disabled = true;
      b.addEventListener("click", function () { F.state = s.id; HOVER = null; refresh(); });
      seg.appendChild(b);
    });
  }

  var BH = 52;
  function buildBrush(w) {
    var bh = document.getElementById("brush");
    var old = bh.querySelector("svg"); if (old) old.remove();
    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + BH, height: BH });
    svg.setAttribute("aria-label", "Session timeline; drag to select a time window");
    var iw = w, ih = BH - 22;
    var Xb = function (t) { return (t - T0) / (T1 - T0 || 1) * iw; };
    var refKey = HAVE.rpm ? "rpm" : (HAVE.vss ? "vss" : (HAVE.ect ? "ect" : null));
    if (refKey) {
      var mx = 0, mn = Infinity, i;
      for (i = 0; i < N; i++) { var v = C[refKey][i]; if (v == null) continue; if (v > mx) mx = v; if (v < mn) mn = v; }
      if (!(mx > mn)) { mx = mn + 1; }
      var d = "M0 " + (ih + 6);
      for (i = 0; i < N; i++) {
        var vv = C[refKey][i];
        if (vv == null) continue;
        d += "L" + Xb(C.t[i]).toFixed(1) + " " + (6 + ih - (vv - mn) / (mx - mn) * ih).toFixed(1);
      }
      d += "L" + w + " " + (ih + 6) + "Z";
      svg.appendChild(svgEl("path", { d: d, fill: "var(--band)", stroke: "var(--s1)", "stroke-width": 1 }));
    }
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: Math.max(0, Xb(F.win[0])), height: BH, fill: "var(--plane)", opacity: 0.78 }));
    svg.appendChild(svgEl("rect", { x: Xb(F.win[1]), y: 0, width: Math.max(0, w - Xb(F.win[1])), height: BH, fill: "var(--plane)", opacity: 0.78 }));
    [F.win[0], F.win[1]].forEach(function (t) {
      svg.appendChild(svgEl("line", { x1: Xb(t), x2: Xb(t), y1: 0, y2: ih + 6, stroke: "var(--ink-2)", "stroke-width": 1.5 }));
    });
    var lt = svgEl("text", { x: 0, y: BH - 3, fill: "var(--ink-muted)", "font-size": 9.5, "font-family": "var(--mono)" });
    lt.textContent = clock(T0); svg.appendChild(lt);
    var rt = svgEl("text", { x: w, y: BH - 3, "text-anchor": "end", fill: "var(--ink-muted)", "font-size": 9.5, "font-family": "var(--mono)" });
    rt.textContent = clock(T1); svg.appendChild(rt);
    var ct2 = svgEl("text", { x: w / 2, y: BH - 3, "text-anchor": "middle", fill: "var(--ink-muted)", "font-size": 9.5, "font-family": "var(--mono)" });
    ct2.textContent = refKey ? ({ rpm: "engine speed", vss: "vehicle speed", ect: "coolant" })[refKey] : "timeline";
    svg.appendChild(ct2);
    bh.appendChild(svg);

    var drag = null;
    function tAt(ev) {
      var r = svg.getBoundingClientRect();
      return T0 + Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * (T1 - T0);
    }
    svg.addEventListener("pointerdown", function (ev) { drag = { a: tAt(ev) }; svg.setPointerCapture(ev.pointerId); ev.preventDefault(); });
    svg.addEventListener("pointermove", function (ev) {
      if (!drag) return;
      var b = tAt(ev);
      if (Math.abs(b - drag.a) < (T1 - T0) / 300) return;
      F.win = [Math.min(drag.a, b), Math.max(drag.a, b)];
      HOVER = null; refresh();
    });
    svg.addEventListener("pointerup", function () { drag = null; });
    svg.addEventListener("pointercancel", function () { drag = null; });
  }

  /* ==========================================================
     REFRESH
     ========================================================== */
  function show(id, on) { document.getElementById(id).hidden = !on; }

  function refresh() {
    if (!L) return;
    recompute();
    buildSeg();
    buildBrush(widthOf(document.getElementById("brush")));
    document.getElementById("win-label").textContent =
      (F.win[0] <= T0 + 1e-6 && F.win[1] >= T1 - 1e-6 ? "full session" : clock(F.win[0]) + "–" + clock(F.win[1])) +
      " · " + VIEW.length + " frames";

    painters = [];
    if (HAVE.tt1) {
      var trimSpec = { id: "trim", title: "Total fuel correction", unit: "%", dp: 1, h: 250, zero: 0,
        series: HAVE.tt2 ? [{ k: "tt1", label: "Bank 1", color: "s1" }, { k: "tt2", label: "Bank 2", color: "s2" }]
                         : [{ k: "tt1", label: "Total trim", color: "s1" }],
        bands: [{ from: -10, to: 10 }] };
      painters.push(drawTime(document.getElementById("ch-trim"), trimSpec, widthOf(document.getElementById("ch-trim"))));
      var lg = document.getElementById("trim-legend");
      lg.innerHTML = (HAVE.tt2
        ? '<span><i style="background:var(--s1)"></i>Bank 1</span><span><i style="background:var(--s2)"></i>Bank 2</span>'
        : '<span><i style="background:var(--s1)"></i>Total trim</span>') +
        '<span><i class="sw" style="background:var(--band-swatch);border:1px solid var(--hair-strong)"></i>±10 % authority</span>';
      document.getElementById("trim-note").textContent = HAVE.tt2
        ? "Two banks that track each other point upstream of the intake split or at the fuel supply; two that diverge point at one bank's own hardware."
        : "This log reports one bank, so a bank-to-bank comparison is not available — the bank-balance check was skipped rather than guessed at.";
      document.getElementById("state-legend").innerHTML = HAVE.tt2
        ? '<span><i style="background:var(--s1)"></i>Bank 1</span><span><i style="background:var(--s2)"></i>Bank 2</span>'
        : '<span><i style="background:var(--s1)"></i>Total trim</span>';
    }
    PANELS.forEach(function (p) { painters.push(drawTime(p.host, p, widthOf(p.host))); });

    var dtSpec = { id: "dt", title: "Sample interval", unit: "s", dp: 2, kind: "bar",
      series: [{ k: "dt", label: "Interval", color: "s1" }] };
    var dtm = medOf(pick(C.dt, VIEW));
    if (dtm) { dtSpec.flagAbove = Math.max(dtm * 3, dtm + 1); dtSpec.ref = [{ v: dtSpec.flagAbove, label: "gap threshold" }]; }
    painters.push(drawTime(document.getElementById("ch-dt"), dtSpec, widthOf(document.getElementById("ch-dt"))));
    document.getElementById("dt-note").textContent = L.noTime
      ? "This log has no time column, so intervals are all 1 frame by definition."
      : "Median " + fmt(dtm, 2) + " s. Bars past the threshold line are flagged — anything read across one may be an artefact.";

    if (HAVE.lat && HAVE.lon) {
      buildEvents(); buildEventList(); buildBasemapSeg();
      painters.push(drawMap(document.getElementById("ch-map"), widthOf(document.getElementById("ch-map"))));
      setEvent(null);
    }
    if (HAVE.alt) drawAlt(document.getElementById("ch-alt"), widthOf(document.getElementById("ch-alt")));
    if (HAVE.tt1) drawState(document.getElementById("ch-state"), widthOf(document.getElementById("ch-state")));

    drawKpis();
    drawTable();
    paintReadout(HOVER);
  }

  /* ==========================================================
     LOG ACTIVATION + FILE INTAKE
     ========================================================== */
  function activate(i, keepWindow) {
    AI = i;
    L = LOGS[i];
    C = L.cols; N = L.n; ST = L.state; HAVE = L.have;
    T0 = C.t[0]; T1 = C.t[N - 1];
    if (T1 <= T0) T1 = T0 + 1;
    if (!keepWindow) { F.win = [T0, T1]; F.state = "all"; HOVER = null; }
    else { F.win = [Math.max(T0, F.win[0]), Math.min(T1, F.win[1])]; }

    show("app", true); show("empty", false);
    show("sec-trim", !!HAVE.tt1);
    show("sec-map", !!(HAVE.lat && HAVE.lon));
    show("sec-state", !!HAVE.tt1);
    show("card-alt", !!HAVE.alt);
    show("sample-banner", !!L.isSample);

    buildPanelDefs();
    buildPanelCards();
    buildReadoutDefs();
    drawChannelPanel();
    drawFindings();
    drawFileChips();

    var mapped = Object.keys(L.mapping).length;
    document.getElementById("pg-foot").innerHTML =
      "<b>" + esc(L.name) + "</b> — " + L.n + " frames, " + L.head.length + " source columns, " + mapped +
      " mapped to known channels. Every value shown is computed here in this browser with no smoothing or interpolation, and the table view holds the source columns verbatim. " +
      "Findings are computed from thresholds that are conventional for OBD-II diagnostics, not vehicle-specific — treat them as where to look first, not as a verdict.";
    refresh();
  }

  function drawFileChips() {
    var host = document.getElementById("files");
    host.textContent = "";
    LOGS.forEach(function (lg, i) {
      var c = el("span", "fchip" + (lg.error ? " bad" : ""));
      c.setAttribute("aria-current", String(i === AI));
      var nm = el("span", "nm", lg.name);
      nm.title = lg.name;
      if (!lg.error) nm.addEventListener("click", function () { activate(i); });
      c.appendChild(nm);
      c.appendChild(el("span", "ct", lg.error ? "failed" : lg.n + " rows"));
      var x = el("button", "x", "×");
      x.type = "button";
      x.setAttribute("aria-label", "Remove " + lg.name);
      x.addEventListener("click", function () {
        LOGS.splice(i, 1);
        if (!LOGS.length) { L = null; AI = -1; show("app", false); show("empty", true); drawFileChips(); return; }
        activate(Math.max(0, Math.min(AI >= i ? AI - 1 : AI, LOGS.length - 1)));
      });
      c.appendChild(x);
      host.appendChild(c);
    });
  }

  function addText(text, name, isSample, fromHistory) {
    var lg = parseLog(text, name, isSample);
    if (lg.error) {
      LOGS.push({ name: name, error: lg.error, n: 0 });
      drawFileChips();
      alertBanner(name + ": " + lg.error);
      return false;
    }
    analyze(lg);
    LOGS.push(lg);
    activate(LOGS.length - 1);
    /* the sample is bundled fixture data, not a real session, and a log
       reloaded from history is already saved — either way there is nothing
       new to persist */
    if (!isSample && !fromHistory) saveToHistory(text, name);
    return true;
  }

  /* ==========================================================
     HISTORY — save-on-load and the saved-sessions panel
     ========================================================== */
  function saveToHistory(text, name) {
    var note = document.getElementById("pg-foot-save");
    fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, text: text })
    }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!note) return;
        if (!res.ok) { note.textContent = "Could not save to history: " + (res.body.error || "server error") + "."; return; }
        note.textContent = res.body.duplicate
          ? "Already in history, saved " + new Date(res.body.uploadedAt).toLocaleString() + " as “" + res.body.name + "”."
          : "Saved to history.";
      })
      .catch(function () { if (note) note.textContent = "Could not reach the history database."; });
  }

  function sevChip(sev) {
    return '<span class="chip ' + esc(sev) + '"><i class="dot"></i><span>' +
      esc(sev === "neutral" ? "Note" : sev.charAt(0).toUpperCase() + sev.slice(1)) + "</span></span>";
  }

  function loadHistoryList() {
    var tb = document.getElementById("history-tbl").tBodies[0], note = document.getElementById("history-note");
    note.textContent = "Loading…";
    fetch("/api/logs").then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        tb.textContent = "";
        if (!res.ok) { note.textContent = "Could not load history."; return; }
        document.getElementById("history-count").textContent = res.body.length + " saved";
        if (!res.body.length) { note.textContent = "Nothing saved yet — every log you open here is added automatically."; return; }
        note.textContent = "Click a row to reopen that log.";
        res.body.forEach(function (row) {
          var tr = document.createElement("tr");
          tr.className = "hrow";
          tr.tabIndex = 0;
          tr.appendChild(el("td", "nm", row.name));
          tr.appendChild(el("td", "u", row.sessionStart || new Date(row.uploadedAt).toLocaleString()));
          tr.appendChild(el("td", "u", String(row.rows)));
          var td = document.createElement("td");
          td.innerHTML = sevChip(row.severity) + " " + esc(row.headline);
          tr.appendChild(td);
          function open() {
            fetch("/api/logs/" + row.id + "/raw").then(function (r) {
              if (!r.ok) throw new Error("fetch failed");
              return r.text();
            }).then(function (text) {
              addText(text, row.name, false, true);
              show("history-wrap", false);
            }).catch(function () { note.textContent = "Could not load that log."; });
          }
          tr.addEventListener("click", open);
          tr.addEventListener("keydown", function (ev) { if (ev.key === "Enter") open(); });
          tb.appendChild(tr);
        });
      })
      .catch(function () { note.textContent = "Could not reach the history database."; });
  }

  document.getElementById("btn-history").addEventListener("click", function () {
    var willShow = document.getElementById("history-wrap").hidden;
    show("history-wrap", willShow);
    if (willShow) loadHistoryList();
  });
  document.getElementById("history-refresh").addEventListener("click", loadHistoryList);
  document.getElementById("history-close").addEventListener("click", function () { show("history-wrap", false); });

  function alertBanner(msg) {
    var b = document.getElementById("sample-banner");
    b.hidden = false;
    b.innerHTML = '<span class="chip critical"><i class="dot"></i><span>Parse failed</span></span><span>' + esc(msg) + "</span>";
  }

  function readFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    /* drop the bundled sample as soon as a real log arrives */
    if (LOGS.length === 1 && LOGS[0].isSample) { LOGS = []; AI = -1; }
    var pending = files.length;
    files.forEach(function (f) {
      var rd = new FileReader();
      rd.onload = function () { addText(String(rd.result), f.name, false); if (!--pending) drawFileChips(); };
      rd.onerror = function () { alertBanner("Could not read " + f.name + "."); if (!--pending) drawFileChips(); };
      rd.readAsText(f);
    });
  }

  var input = document.getElementById("file-input");
  input.addEventListener("change", function () { readFiles(input.files); input.value = ""; });
  document.getElementById("btn-add").addEventListener("click", function () { input.click(); });
  document.getElementById("btn-pick").addEventListener("click", function () { input.click(); });
  document.getElementById("btn-sample").addEventListener("click", function () { loadSample(); });
  document.getElementById("brush-reset").addEventListener("click", function () { F.win = [T0, T1]; HOVER = null; refresh(); });
  document.getElementById("events").addEventListener("pointerleave", function () { setEvent(null); });

  /* drag and drop anywhere on the page */
  var dz = document.getElementById("dropzone-big");
  ["dragenter", "dragover"].forEach(function (t) {
    window.addEventListener(t, function (e) { e.preventDefault(); if (dz) dz.classList.add("over"); });
  });
  ["dragleave", "dragend"].forEach(function (t) {
    window.addEventListener(t, function () { if (dz) dz.classList.remove("over"); });
  });
  window.addEventListener("drop", function (e) {
    e.preventDefault();
    if (dz) dz.classList.remove("over");
    if (e.dataTransfer && e.dataTransfer.files) readFiles(e.dataTransfer.files);
  });

  function loadSample() {
    var node = document.getElementById("sample-csv");
    var txt = node ? node.textContent : "";
    if (!txt || txt.length < 200) { show("empty", true); return; }
    if (LOGS.length === 1 && LOGS[0].isSample) { activate(0); return; }
    addText(txt, "Sample — Gunther session.csv", true);
  }

  var rt2;
  window.addEventListener("resize", function () { clearTimeout(rt2); rt2 = setTimeout(function () { if (L) refresh(); }, 140); });

  /* open in a working state rather than an empty shell */
  loadSample();
  if (!LOGS.length) { show("empty", true); show("app", false); }
})();
</script>
