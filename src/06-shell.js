  /* ==========================================================
     KPIs — the first six that this log can actually support
     ========================================================== */
  /* The idle-hunting spread, coolant, intake-air and trim limits come from the
     active engine profile (see PROFILES in 02-parse.js). On the M54 profile the
     hunting limit is 250 rpm: without a road-speed channel, "idle" also takes in
     coasting and the fall back to idle after a lift-off, so a healthy warm idle
     measures about 140-180 rpm there. */
  function drawKpis() {
    var P = profileOf(L);
    var host = document.getElementById("kpis");
    host.textContent = "";
    var sel = VIEW, cand = [];
    function sev(v, warn, crit) { return v == null ? "neutral" : v >= crit ? "critical" : v >= warn ? "warning" : "good"; }
    function peak(k) { var b = null, i, v; for (i = 0; i < sel.length; i++) { v = C[k][sel[i]]; if (v != null && isFinite(v) && (b == null || v > b)) b = v; } return b; }

    var trimSel = sel;
    if (HAVE.ect) {
      var wq = sel.filter(function (i) { return C.ect[i] > 70; });
      if (wq.length > 8) trimSel = wq;
    }

    if (HAVE.tt1) {
      var m1 = medOf(pick(C.tt1, trimSel));
      cand.push({ k: HAVE.tt2 ? "Trim, bank 1" : "Fuel trim", v: sgn(m1, 1), u: "%", sub: "median STFT+LTFT",
        chip: sev(m1 == null ? null : Math.abs(m1), P.trimKpiWarn, P.trimKpiCrit),
        lab: m1 == null ? "no data" : Math.abs(m1) >= P.trimKpiCrit ? "out of authority" : Math.abs(m1) >= P.trimKpiWarn ? "over limit" : "in range" });
    }
    if (HAVE.tt2) {
      var m2 = medOf(pick(C.tt2, trimSel));
      cand.push({ k: "Trim, bank 2", v: sgn(m2, 1), u: "%", sub: "median STFT+LTFT",
        chip: sev(m2 == null ? null : Math.abs(m2), P.trimKpiWarn, P.trimKpiCrit),
        lab: m2 == null ? "no data" : Math.abs(m2) >= P.trimKpiCrit ? "out of authority" : Math.abs(m2) >= P.trimKpiWarn ? "over limit" : "in range" });
    }
    if (HAVE.ect) { var e = peak("ect");
      cand.push({ k: "Peak coolant", v: fmt(e, 0), u: "°C", sub: "highest in window",
        chip: sev(e, P.ectWarn, P.ectCrit), lab: e == null ? "no data" : e >= P.ectCrit ? "overheating" : e >= P.ectWarn ? "hot" : "normal" }); }
    if (HAVE.iat) { var a = peak("iat");
      cand.push({ k: "Peak intake air", v: fmt(a, 0), u: "°C", sub: "charge temperature",
        chip: sev(a, P.iatKpiWarn, P.iatKpiCrit), lab: a == null ? "no data" : a >= P.iatKpiCrit ? "very hot" : a >= P.iatKpiWarn ? "hot" : "normal" }); }
    if (HAVE.rpm) { var r = peak("rpm");
      cand.push({ k: "Peak engine speed", v: fmt(r, 0), u: "rpm", sub: "highest in window", chip: "neutral", lab: "logged" }); }
    if (HAVE.rpm) {
      var idleSel = sel.filter(function (i) { return ST[i] === "idle" && (!HAVE.ect || C.ect[i] > 70); });
      var iv = pick(C.rpm, idleSel).filter(function (x) { return x != null; });
      if (iv.length >= 8) {
        var isd = Math.sqrt(iv.reduce(function (a, x) { var d = x - medOf(iv); return a + d * d; }, 0) / iv.length);
        cand.push({ k: "Idle speed", v: fmt(medOf(iv), 0), u: "rpm", sub: "spread " + fmt(isd, 0) + " rpm, " + iv.length + " frames",
          chip: isd > P.idleHuntSd ? "warning" : "good", lab: isd > P.idleHuntSd ? "hunting" : "steady" });
      }
      var rs = rpmStability(L, sel);
      cand.push({ k: "Stalls", v: String(rs.stalls), u: "", sub: rs.dips + " dip" + (rs.dips === 1 ? "" : "s") + " under " + P.rpmDipBelow + " rpm" + (rs.lowest != null ? ", lowest " + Math.round(rs.lowest) : "") +
          (rs.keyOffs ? ", " + rs.keyOffs + " key-off" + (rs.keyOffs === 1 ? "" : "s") + " not counted" : ""),
        chip: rs.stalls ? "critical" : rs.dips ? "warning" : "good",
        lab: rs.stalls ? "engine stopped" : rs.dips ? "near stall" : "none seen" });
    }
    if (HAVE.map) {
      var mapIdle = sel.filter(function (i) { return ST[i] === "idle" && (!HAVE.ect || C.ect[i] > 70); });
      var mv = pick(C.map, mapIdle).filter(function (x) { return x != null; });
      if (mv.length >= 8) {
        var mm = medOf(mv);
        cand.push({ k: "Idle manifold", v: fmt(mm, 0), u: "kPa", sub: "absolute, " + mv.length + " idle frames",
          chip: mm > P.idleMapHigh ? "warning" : "good", lab: mm > P.idleMapHigh ? "weak vacuum" : "healthy" });
      }
    }
    if (HAVE.knock) { var kr = peak("knock");
      cand.push({ k: "Peak knock retard", v: fmt(kr, 1), u: "°", sub: "highest in window",
        chip: sev(kr, 4, 8), lab: kr == null ? "no data" : kr >= 8 ? "heavy" : kr >= 4 ? "notable" : kr > 0.5 ? "light" : "none" }); }
    /* trims logged but flat at 0 %: see the trim-flat rule in 03-analyze.js */
    if (!HAVE.tt1 && L.deadTrims && L.deadTrims.length)
      cand.push({ k: "Fuel trim", v: "0", u: "%", sub: "flat for the whole log: not read, or open loop",
        chip: "warning", lab: "check O2 sensor" });
    /* Mitsubishi load 120+ is boost building; same frames as the timing-load rule */
    if (P.id === "evo" && HAVE.spark && HAVE.load && HAVE.rpm) {
      var tl = sel.filter(function (i) {
        return C.rpm[i] != null && C.rpm[i] >= 1500 && C.rpm[i] <= 4500 && C.load[i] != null && C.load[i] >= 120 &&
          (!HAVE.ect || C.ect[i] > 70) && !(HAVE.injdc && C.injdc[i] != null && C.injdc[i] <= 0);
      });
      var tv2 = pick(C.spark, tl).filter(function (x) { return x != null; });
      if (tv2.length >= 10) { var tm = medOf(tv2);
        cand.push({ k: "Timing under load", v: fmt(tm, 0), u: "°", sub: "median, load 120+, " + tv2.length + " frames",
          chip: tm > 5 ? "good" : "warning", lab: tm > 5 ? "holding" : "near zero" }); }
    }
    if (HAVE.knocksum) { var ks = peak("knocksum");
      cand.push({ k: "Peak knock sum", v: fmt(ks, 0), u: "", sub: "highest in window",
        chip: sev(ks, 4, 6), lab: ks == null ? "no data" : ks >= 6 ? "heavy" : ks >= 4 ? "notable" : ks > 0 ? "light" : "none" }); }
    if (HAVE.injdc) { var dc = peak("injdc");
      cand.push({ k: "Peak injector duty", v: fmt(dc, 0), u: "%", sub: "highest in window",
        chip: sev(dc, 85, 95), lab: dc == null ? "no data" : dc >= 95 ? "maxed out" : dc >= 85 ? "near limit" : "headroom" }); }
    if (HAVE.vss) { var s = peak("vss");
      cand.push({ k: "Peak road speed", v: fmt(s, 0), u: "km/h", sub: "highest in window", chip: "neutral", lab: "logged" }); }
    if (!L.noTime) {
      var dtm = medOf(pick(C.dt, sel)), thr = dtm ? Math.max(dtm * 3, dtm + 1) : Infinity;
      var gaps = sel.filter(function (i) { return C.dt[i] != null && C.dt[i] > thr; }).length;
      cand.push({ k: "Logging gaps", v: String(gaps), u: "", sub: dtm ? "median " + fmt(dtm, 2) + " s" : "",
        chip: gaps === 0 ? "good" : gaps > 5 ? "serious" : "warning",
        lab: gaps === 0 ? "clean capture" : "adapter dropouts" });
    }
    cand.push({ k: "Frames", v: String(sel.length), u: "", sub: "in this window", chip: "neutral", lab: L.n + " total" });

    var tiles = cand;
    var perRow = window.innerWidth < 620 ? 2 : window.innerWidth < 1080 ? 3 : 6;
    var cols = Math.min(tiles.length, perRow);
    host.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0,1fr))";

    tiles.forEach(function (it) {
      var d = el("div", "kpi");
      d.appendChild(el("span", "k", it.k));
      var v = el("span", "v"); v.textContent = it.v;
      if (it.u) { var sm = el("small"); sm.textContent = " " + it.u; v.appendChild(sm); }
      d.appendChild(v);
      if (it.chip !== "neutral") {
        var c = el("span", "chip " + it.chip);
        c.appendChild(el("i", "dot")); c.appendChild(el("span", null, it.lab));
        d.appendChild(c);
      }
      if (it.sub) d.appendChild(el("span", "sub", it.sub));
      host.appendChild(d);
    });
    /* stretch the tiles of a short last row across the full width, so no empty
       cell shows the hairline background and no gap is left at the end */
    var lastN = tiles.length % cols;
    if (lastN) {
      var kids = host.children, base = Math.floor(cols / lastN), extra = cols % lastN;
      for (var ti = 0; ti < lastN; ti++)
        kids[tiles.length - lastN + ti].style.gridColumn = "span " + (base + (ti < extra ? 1 : 0));
    }

    /* session summary: frame count and duration in window */
    var vl = document.getElementById("verdict-line");
    if (!sel.length) { vl.textContent = "No frames match the current window and state filter."; return; }
    var durMin = (!L.noTime && C.t && C.t.length > 1) ? ((C.t[sel[sel.length - 1]] - C.t[sel[0]]) / 60) : null;
    vl.textContent = sel.length === L.n
      ? L.n + " frames" + (durMin != null ? " (" + n1(durMin, 1) + " min)" : "") + "."
      : sel.length + " of " + L.n + " frames in selected window" + (durMin != null ? " (" + n1(durMin, 1) + " min)" : "") + ".";
  }

  function drawFindings() {}

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

    if (rep.format) row("Log format", rep.format);
    /* the vehicle profile is chosen in the app bar; this row says where it came from */
    row("Vehicle profile", profileOf(L).name + (L.profileOverride
      ? " (chosen by you" + (L.profileAuto !== L.profileId ? "; the log looks like " + PROFILES[L.profileAuto].short : "") + ")"
      : " (auto-detected" + (L.profileWhy && L.profileWhy.length ? " from: " + L.profileWhy.join(", ") : "") + ")"));

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

    /* refresh() rebuilds this svg on every move, so drag state and the move/up
       listeners live on window (registered once, below), not on the svg itself */
    svg.addEventListener("pointerdown", function (ev) {
      var r = svg.getBoundingClientRect();
      BRUSH_DRAG = { a: brushT(ev, r), r: r };
      ev.preventDefault();
    });
    svg.setAttribute("tabindex", "0");
    svg.addEventListener("keydown", function (ev) {
      var span = F.win[1] - F.win[0], step = span * 0.1, lo = F.win[0], hi = F.win[1];
      if (ev.key === "ArrowLeft") { lo -= step; hi -= step; }
      else if (ev.key === "ArrowRight") { lo += step; hi += step; }
      else if (ev.key === "+" || ev.key === "=") { lo += step; hi -= step; }
      else if (ev.key === "-") { lo -= step; hi += step; }
      else if (ev.key === "Home" || ev.key === "Escape") { lo = T0; hi = T1; }
      else return;
      ev.preventDefault();
      if (lo < T0) { hi += T0 - lo; lo = T0; }
      if (hi > T1) { lo -= hi - T1; hi = T1; }
      lo = Math.max(T0, lo); hi = Math.min(T1, hi);
      if (hi - lo < (T1 - T0) / 300) return;
      F.win = [lo, hi]; HOVER = null; refresh();
      var nb = document.querySelector("#brush svg"); if (nb) nb.focus();
    });
  }
  var BRUSH_DRAG = null;
  function brushT(ev, r) { return T0 + Math.max(0, Math.min(1, (ev.clientX - r.left) / (r.width || 1))) * (T1 - T0); }
  window.addEventListener("pointermove", function (ev) {
    if (!BRUSH_DRAG) return;
    var b = brushT(ev, BRUSH_DRAG.r);
    if (Math.abs(b - BRUSH_DRAG.a) < (T1 - T0) / 300) return;
    F.win = [Math.min(BRUSH_DRAG.a, b), Math.max(BRUSH_DRAG.a, b)];
    HOVER = null; refresh();
  });
  window.addEventListener("pointerup", function () { BRUSH_DRAG = null; });
  window.addEventListener("pointercancel", function () { BRUSH_DRAG = null; });

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
    [["ltft", "Long-term fuel trim"], ["stft", "Short-term fuel trim"]].forEach(function (pt) {
      var id = pt[0], has1 = HAVE[id + "1"], has2 = HAVE[id + "2"];
      document.getElementById("card-" + id).hidden = !has1;
      if (!has1) return;
      var spec = { id: id, title: pt[1], unit: "%", dp: 1, h: 200, zero: 0,
        series: has2 ? [{ k: id + "1", label: "Bank 1", color: "s1" }, { k: id + "2", label: "Bank 2", color: "s2" }]
                     : [{ k: id + "1", label: "Bank 1", color: "s1" }] };
      var host = document.getElementById("ch-" + id);
      painters.push(drawTime(host, spec, widthOf(host)));
      document.getElementById(id + "-legend").innerHTML = has2
        ? '<span><i style="background:var(--s1)"></i>Bank 1</span><span><i style="background:var(--s2)"></i>Bank 2</span>'
        : '<span><i style="background:var(--s1)"></i>Bank 1</span>';
    });
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
    T0 = Infinity; T1 = -Infinity;
    for (var ti = 0; ti < N; ti++) { var tv = C.t[ti]; if (tv != null && isFinite(tv)) { if (tv < T0) T0 = tv; if (tv > T1) T1 = tv; } }
    if (!isFinite(T0)) { T0 = 0; T1 = 1; }
    if (T1 <= T0) T1 = T0 + 1;
    TILE_FAIL = false; tileErr = 0; tileOk = 0;
    var saveNote = document.getElementById("pg-foot-save");
    if (saveNote) saveNote.textContent = "";
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
    drawFileChips();
    drawVehiclePicker();

    var mapped = Object.keys(L.mapping).length;
    document.getElementById("pg-foot").innerHTML =
      "<b>" + esc(L.name) + "</b> — " + L.n + " frames, " + L.head.length + " source columns, " + mapped +
      " mapped to known channels. Every value shown is computed here in this browser with no smoothing or interpolation, and the table view holds the source columns verbatim.";
    refresh();
  }

  function drawFileChips() {
    var host = document.getElementById("files");
    host.textContent = "";
    LOGS.forEach(function (lg, i) {
      var c = el("span", "fchip" + (lg.error ? " bad" : ""));
      c.setAttribute("aria-current", String(i === AI));
      var nm = el(lg.error ? "span" : "button", "nm", lg.name);
      nm.title = lg.name;
      if (!lg.error) { nm.type = "button"; nm.addEventListener("click", function () { activate(i); }); }
      c.appendChild(nm);
      c.appendChild(el("span", "ct", lg.error ? "failed" : profileOf(lg).short + " · " + lg.n + " rows"));
      var x = el("button", "x", "×");
      x.type = "button";
      x.setAttribute("aria-label", "Remove " + lg.name);
      x.addEventListener("click", function () {
        var wasActive = i === AI;
        LOGS.splice(i, 1);
        if (!wasActive && AI > i) AI--;
        /* a failed-parse entry has no data to show, so only a good log can become active */
        var want = wasActive ? Math.max(0, i - 1) : AI, pick2 = -1, d;
        for (d = 0; d < LOGS.length && pick2 < 0; d++) {
          if (want + d < LOGS.length && !LOGS[want + d].error) pick2 = want + d;
          else if (want - d >= 0 && want - d < LOGS.length && !LOGS[want - d].error) pick2 = want - d;
        }
        if (pick2 < 0) { L = null; AI = -1; show("app", false); show("empty", true); drawFileChips(); drawVehiclePicker(); return; }
        if (pick2 === AI && !wasActive) { drawFileChips(); return; }
        activate(pick2);
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
    /* the bundled sample is a BMW log, so it always gets its detected profile */
    if (!isSample && vehiclePref()) { lg.profileOverride = vehiclePref(); applyProfile(lg); }
    analyze(lg);
    /* the bundled sample goes away only once a real log has parsed */
    if (!isSample) LOGS = LOGS.filter(function (x) { return !x.isSample; });
    lg.sourceText = text;
    LOGS.push(lg);
    hideAlert();
    activate(LOGS.length - 1);
    /* the sample is bundled fixture data, not a real session, and a log
       reloaded from history is already saved. Anything else is saved only if
       the user has turned saving on. */
    if (!isSample && !fromHistory && saveEnabled()) saveToHistory(text, name);
    return true;
  }

  /* ==========================================================
     HISTORY — save-on-load and the saved-sessions panel
     ========================================================== */
  /* Saving to the history service is opt-in and off by default: logs can
     contain GPS positions, and nothing leaves the browser unless asked. */
  /* ==========================================================
     VEHICLE PROFILE — the app-bar menu and the empty-state cards
     ========================================================== */
  /* "" means auto-detect. The choice applies to the open log and to every log
     added after it, and is remembered in this browser. */
  function vehiclePref() {
    try { var v = localStorage.getItem("dlb-profile") || ""; return PROFILES[v] ? v : ""; } catch (e) { return ""; }
  }
  function setVehiclePref(v) { try { localStorage.setItem("dlb-profile", v); } catch (e) {} }

  function chooseVehicle(v) {
    setVehiclePref(v);
    if (L && !L.error) {
      L.profileOverride = v || null;
      applyProfile(L);
      analyze(L);
      activate(AI, true);
    } else drawVehiclePicker();
  }

  function drawVehiclePicker() {
    var cur = (L && !L.error) ? (L.profileOverride || "") : vehiclePref();
    var sel = document.getElementById("vehicle-select");
    if (sel) {
      sel.textContent = "";
      var oa = document.createElement("option");
      oa.value = "";
      oa.textContent = "Auto-detect" + (L && !L.error && !L.profileOverride ? " (" + PROFILES[L.profileAuto].short + ")" : "");
      sel.appendChild(oa);
      PROFILE_IDS.forEach(function (id) {
        var o = document.createElement("option"); o.value = id; o.textContent = PROFILES[id].short; o.title = PROFILES[id].name; sel.appendChild(o);
      });
      sel.value = cur;
    }
    var host = document.getElementById("profile-cards");
    if (!host) return;
    host.textContent = "";
    [{ id: "", short: "Auto-detect", blurb: "Pick the profile from the channels in the log", loggerNote: "any supported logger" }]
      .concat(PROFILE_IDS.map(function (id) { return PROFILES[id]; }))
      .forEach(function (p) {
        var b = el("button", "pcard");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(p.id === vehiclePref()));
        b.appendChild(el("b", null, p.short));
        b.appendChild(el("span", null, p.blurb));
        b.appendChild(el("small", null, p.loggerNote));
        b.addEventListener("click", function () { chooseVehicle(p.id); });
        host.appendChild(b);
      });
  }

  function saveEnabled() { try { return localStorage.getItem("dlb-save") === "1"; } catch (e) { return false; } }
  function setSaveEnabled(on) { try { localStorage.setItem("dlb-save", on ? "1" : "0"); } catch (e) {} }

  /* parse an API reply without assuming it is JSON (a proxy error page is not) */
  function apiJson(r) {
    return r.text().then(function (t) {
      var b = null;
      try { b = JSON.parse(t); } catch (e) { b = null; }
      if (b == null || typeof b !== "object") b = { error: "HTTP " + r.status };
      return { ok: r.ok, status: r.status, body: b };
    });
  }

  function saveToHistory(text, name) {
    var note = document.getElementById("pg-foot-save");
    if (note) note.textContent = "Saving to history…";
    fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, text: text })
    }).then(apiJson)
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

  var CMP_MAX = 4;
  var CMP_SEL = {}; /* id -> {id, name} */

  function updateCompareBtn() {
    var n = Object.keys(CMP_SEL).length;
    var b = document.getElementById("btn-compare");
    b.textContent = "Compare selected (" + n + ")";
    b.disabled = n < 2;
  }

  function fetchRawLog(id) {
    return fetch("/api/logs/" + id + "/raw").then(function (r) {
      if (!r.ok) throw new Error("fetch failed");
      return r.text();
    });
  }

  /* "10/06/2026 02:33:24.1554 PM" -> "6 Oct 2026, 14:33" */
  function niceTime(s) {
    if (!s) return null;
    var t = Date.parse(String(s).replace(/(\d{2}:\d{2}:\d{2})\.\d+/, "$1"));
    if (isNaN(t)) return s;
    var d = new Date(t);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) + ", " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function loadHistoryList() {
    var tb = document.getElementById("history-tbl").tBodies[0], note = document.getElementById("history-note");
    note.textContent = "Loading…";
    CMP_SEL = {};
    updateCompareBtn();
    fetch("/api/logs").then(apiJson)
      .then(function (res) {
        tb.textContent = "";
        if (!res.ok || !Array.isArray(res.body)) { note.textContent = "Could not load history (" + (res.body.error || "unexpected reply") + ")."; return; }
        document.getElementById("history-count").textContent = res.body.length + " saved";
        if (!res.body.length) { note.textContent = "Nothing saved yet. Turn on “Save opened logs” in the app bar, or use “Save this log”, to keep sessions here."; return; }
        note.textContent = "Click a row to reopen that log, or check up to " + CMP_MAX + " to compare them.";
        res.body.forEach(function (row) {
         try {
          var tr = document.createElement("tr");
          tr.className = "hrow";
          tr.tabIndex = 0;

          var tdc = el("td", "cbx");
          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.setAttribute("aria-label", "Select " + row.name + " to compare");
          cb.addEventListener("click", function (ev) { ev.stopPropagation(); });
          cb.addEventListener("change", function () {
            if (cb.checked) {
              if (Object.keys(CMP_SEL).length >= CMP_MAX) {
                cb.checked = false;
                note.textContent = "Up to " + CMP_MAX + " at a time — uncheck one first.";
                return;
              }
              CMP_SEL[row.id] = { id: row.id, name: row.name, note: row.note };
            } else {
              delete CMP_SEL[row.id];
            }
            updateCompareBtn();
          });
          tdc.appendChild(cb);
          tr.appendChild(tdc);

          tr.appendChild(el("td", "nm", row.name));
          tr.appendChild(el("td", "when", niceTime(row.sessionStart) || new Date(row.uploadedAt).toLocaleString()));
          tr.appendChild(el("td", "num", String(row.rows)));
          var tdn = el("td", "note-cell", row.note || "");
          tr.appendChild(tdn);
          var td = document.createElement("td");
          td.innerHTML = sevChip(row.severity || "neutral") + " " + esc(row.headline || "");
          tr.appendChild(td);
          var tdd = el("td", "acts");
          var ed = el("button", "btn ghost", row.note ? "Edit note" : "Add note");
          ed.type = "button";
          ed.setAttribute("aria-label", "Edit note for " + row.name);
          ed.addEventListener("click", function (ev) {
            ev.stopPropagation();
            var nv = window.prompt("Note for “" + row.name + "” (for example: AC on, used OEM MAF fitted). Leave empty to clear.", row.note || "");
            if (nv == null) return;
            fetch("/api/logs/" + row.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: nv }) })
              .then(apiJson).then(function (res3) {
                if (!res3.ok) { note.textContent = "Could not save the note: " + (res3.body.error || "server error") + "."; return; }
                loadHistoryList();
              }).catch(function () { note.textContent = "Could not reach the history database."; });
          });
          ed.addEventListener("keydown", function (ev) { ev.stopPropagation(); });
          tdd.appendChild(ed);
          var del = el("button", "btn ghost danger", "Delete");
          del.type = "button";
          del.setAttribute("aria-label", "Delete " + row.name + " from history");
          del.addEventListener("click", function (ev) {
            ev.stopPropagation();
            if (!window.confirm("Delete “" + row.name + "” from history? This cannot be undone.")) return;
            fetch("/api/logs/" + row.id, { method: "DELETE" }).then(apiJson).then(function (res2) {
              if (!res2.ok) { note.textContent = "Could not delete: " + (res2.body.error || "server error") + "."; return; }
              loadHistoryList();
            }).catch(function () { note.textContent = "Could not reach the history database."; });
          });
          del.addEventListener("keydown", function (ev) { ev.stopPropagation(); });
          tdd.appendChild(del);
          tr.appendChild(tdd);
          function open() {
            fetchRawLog(row.id).then(function (text) {
              addText(text, row.name, false, true);
              show("history-wrap", false);
            }).catch(function () { note.textContent = "Could not load that log."; });
          }
          tr.addEventListener("click", open);
          tr.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && ev.target === tr) open(); });
          tb.appendChild(tr);
         } catch (rowErr) { /* one malformed row must not blank the table */ }
        });
      })
      .catch(function () { note.textContent = "Could not reach the history database."; });
  }

  /* ==========================================================
     COMPARE — two to four saved sessions, side by side
     ========================================================== */
  function startTimeOf(L) {
    var line = (L.report.preamble || []).filter(function (x) { return /^#\s*StartTime\s*=/.test(x); })[0];
    return line ? line.replace(/^#\s*StartTime\s*=\s*/, "") : null;
  }

  function compareMetrics(L, name, note) {
    var ctx = L.ctx, C = L.cols;
    var idle = ctx.byState.idle, drive = ctx.byState.driving;
    return {
      name: name, note: note || "", sessionStart: startTimeOf(L), rows: L.n,
      tt1Idle: L.have.tt1 ? medOf(pick(C.tt1, idle)) : null, tt1Drive: L.have.tt1 ? medOf(pick(C.tt1, drive)) : null,
      tt2Idle: L.have.tt2 ? medOf(pick(C.tt2, idle)) : null, tt2Drive: L.have.tt2 ? medOf(pick(C.tt2, drive)) : null,
      peakEct: L.have.ect ? maxOf(C.ect, ctx.all) : null, peakIat: L.have.iat ? maxOf(C.iat, ctx.all) : null,
      metrics: L.metrics,
      channels: Object.keys(L.mapping).length, columns: L.head.length,
    };
  }

  function runCompare() {
    var sel = Object.keys(CMP_SEL).map(function (k) { return CMP_SEL[k]; });
    var note = document.getElementById("compare-note");
    note.textContent = "Loading…";
    show("compare-wrap", true); show("history-wrap", false);
    Promise.all(sel.map(function (s) { return fetchRawLog(s.id).then(function (text) { return { text: text, name: s.name, note: s.note }; }); }))
      .then(function (loaded) {
        var cols = loaded.map(function (x) {
          var L = parseLog(x.text, x.name, false);
          if (L.error) return { name: x.name, error: L.error };
          analyze(L);
          return compareMetrics(L, x.name, x.note);
        });
        renderCompare(cols);
        note.textContent = "Idle and driving trim come from each log's own warm frames.";
      })
      .catch(function () { note.textContent = "Could not load the selected logs."; });
  }

  function renderCompare(cols) {
    var thead = document.getElementById("compare-tbl").tHead, tb = document.getElementById("compare-tbl").tBodies[0];
    thead.textContent = ""; tb.textContent = "";
    var tr0 = document.createElement("tr");
    tr0.appendChild(document.createElement("th"));
    cols.forEach(function (c) {
      var th = document.createElement("th");
      th.innerHTML = "<div>" + esc(c.name.replace(/\.csv$/i, "")) + "</div><div class=\"u\">" + esc(niceTime(c.sessionStart) || "") + "</div>";
      tr0.appendChild(th);
    });
    thead.appendChild(tr0);

    function grpRow(label) {
      var tr = document.createElement("tr"); tr.className = "grp";
      var td = document.createElement("td"); td.colSpan = cols.length + 1; td.textContent = label;
      tr.appendChild(td); tb.appendChild(tr);
    }
    function metricRow(label, get, fmtFn, unit) {
      var tr = document.createElement("tr");
      tr.appendChild(el("td", "mlab", label));
      cols.forEach(function (c) {
        var td = el("td", "mval", c.error ? "—" : fmtFn(get(c)) + (get(c) == null ? "" : " " + (unit || "")));
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    }

    function textRow(label, get) {
      var tr = document.createElement("tr");
      tr.appendChild(el("td", "mlab", label));
      cols.forEach(function (c) { tr.appendChild(el("td", "mval", c.error || !c.metrics ? "—" : get(c))); });
      tb.appendChild(tr);
    }

    var anyErr = cols.some(function (c) { return c.error; });
    if (anyErr) {
      var tre = document.createElement("tr");
      tre.appendChild(el("td", "mlab", "Parse status"));
      cols.forEach(function (c) { tre.appendChild(el("td", "mval", c.error || "OK")); });
      tb.appendChild(tre);
    }

    grpRow("Session");
    var tn = document.createElement("tr");
    tn.appendChild(el("td", "mlab", "Note"));
    cols.forEach(function (c) { tn.appendChild(el("td", "mval", c.note || "—")); });
    tb.appendChild(tn);
    metricRow("Rows", function (c) { return c.rows; }, function (v) { return String(v); });

    grpRow("Fuel trim (STFT+LTFT)");
    metricRow("Bank 1, idle", function (c) { return c.tt1Idle; }, sgn, "%");
    metricRow("Bank 1, driving", function (c) { return c.tt1Drive; }, sgn, "%");
    metricRow("Bank 2, idle", function (c) { return c.tt2Idle; }, sgn, "%");
    metricRow("Bank 2, driving", function (c) { return c.tt2Drive; }, sgn, "%");

    grpRow("Trim vs intake air (warm idle)");
    function slopeCell(c) { return c.metrics && c.metrics.iatSlope; }
    metricRow("Slope", function (c) { var s = slopeCell(c); return s ? s.slope : null; }, function (v) { return v == null ? "—" : sgn(v, 2); }, "%/°C");
    metricRow("Correlation r", function (c) { var s = slopeCell(c); return s ? s.r : null; }, function (v) { return fmt(v, 2); });
    metricRow("Idle frames used", function (c) { var s = slopeCell(c); return s ? s.n : null; }, function (v) { return v == null ? "—" : String(v); });
    textRow("Intake air range", function (c) { var s = slopeCell(c); return s ? Math.round(s.iatLo) + "–" + Math.round(s.iatHi) + " °C" : "—"; });
    textRow("Not computed because", function (c) { return c.metrics.iatSlopeReason || "—"; });

    grpRow("Engine speed");
    function rpmCell(c, k) { return c.metrics && c.metrics.rpmInfo ? c.metrics.rpmInfo[k] : null; }
    metricRow("Idle speed, median", function (c) { return rpmCell(c, "idleMedian"); }, function (v) { return fmt(v, 0); }, "rpm");
    metricRow("Idle speed, spread (sd)", function (c) { return rpmCell(c, "idleSd"); }, function (v) { return fmt(v, 0); }, "rpm");
    metricRow("Stalls", function (c) { return rpmCell(c, "stalls"); }, function (v) { return v == null ? "—" : String(v); });
    metricRow("Dips under 450 rpm", function (c) { return rpmCell(c, "dips"); }, function (v) { return v == null ? "—" : String(v); });
    metricRow("Lowest dip", function (c) { return rpmCell(c, "lowest"); }, function (v) { return v == null ? "none" : fmt(v, 0); }, "rpm");

    grpRow("Capture");
    metricRow("Row spacing", function (c) { return c.metrics && c.metrics.cadence.dt; }, function (v) { return fmt(v, 2); }, "s");
    metricRow("Repeated-value run", function (c) { return c.metrics && c.metrics.cadence.repeatRun; },
      function (v) { return v == null ? "—" : String(v); }, "rows");
    textRow("Units", function (c) { return c.metrics.unitsConverted ? "converted from imperial" : "metric"; });
    textRow("Channels mapped", function (c) { return c.channels + " of " + c.columns + " columns"; });
    textRow("Checks skipped", function (c) {
      var s = c.metrics.skippedRules;
      return s.length ? s.length + " (" + s.map(function (x) { return x.id; }).join(", ") + ")" : "none";
    });

    grpRow("Other channels");
    metricRow("Peak coolant", function (c) { return c.peakEct; }, function (v) { return fmt(v, 0); }, "°C");
    metricRow("Peak intake air", function (c) { return c.peakIat; }, function (v) { return fmt(v, 0); }, "°C");
  }

  document.getElementById("btn-compare").addEventListener("click", runCompare);
  document.getElementById("compare-close").addEventListener("click", function () { show("compare-wrap", false); });

  var optSave = document.getElementById("opt-save");
  optSave.checked = saveEnabled();
  optSave.addEventListener("change", function () { setSaveEnabled(optSave.checked); });
  document.getElementById("btn-save-current").addEventListener("click", function () {
    if (L && L.sourceText && !L.isSample) saveToHistory(L.sourceText, L.name);
    else { var n = document.getElementById("pg-foot-save"); if (n) n.textContent = "The bundled sample is not saved."; }
  });
  document.getElementById("btn-history").addEventListener("click", function () {
    var willShow = document.getElementById("history-wrap").hidden;
    show("history-wrap", willShow);
    if (willShow) loadHistoryList();
  });
  document.getElementById("history-refresh").addEventListener("click", loadHistoryList);
  document.getElementById("history-close").addEventListener("click", function () { show("history-wrap", false); });

  function alertBanner(msg) {
    var b = document.getElementById("alert-banner");
    b.hidden = false;
    b.innerHTML = '<span class="chip critical"><i class="dot"></i><span>Problem</span></span><span>' + esc(msg) + "</span>";
  }
  function hideAlert() { var b = document.getElementById("alert-banner"); if (b) b.hidden = true; }

  function readFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    var pending = files.length;
    files.forEach(function (f) {
      var rd = new FileReader();
      rd.onload = function () {
        try { addText(String(rd.result), f.name, false); }
        catch (err) { alertBanner(f.name + ": could not be analysed (" + ((err && err.message) || "unexpected error") + ")."); }
        if (!--pending) drawFileChips();
      };
      rd.onerror = function () { alertBanner("Could not read " + f.name + "."); if (!--pending) drawFileChips(); };
      rd.readAsText(f);
    });
  }

  var input = document.getElementById("file-input");
  input.addEventListener("change", function () { readFiles(input.files); input.value = ""; });
  document.getElementById("btn-add").addEventListener("click", function () { input.click(); });
  document.getElementById("btn-pick").addEventListener("click", function () { input.click(); });
  document.getElementById("btn-sample").addEventListener("click", function () { loadSample(); });
  document.getElementById("vehicle-select").addEventListener("change", function (e) { chooseVehicle(e.target.value); });
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
    addText(txt, "Sample session.csv", true);
  }

  var rt2;
  window.addEventListener("resize", function () { clearTimeout(rt2); rt2 = setTimeout(function () { if (L) refresh(); }, 140); });

  /* open in a working state rather than an empty shell */
  loadSample();
  if (!LOGS.length) { show("empty", true); show("app", false); }
  drawVehiclePicker();
})();
</script>
