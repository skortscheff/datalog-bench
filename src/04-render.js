  /* ==========================================================
     ACTIVE-LOG STATE
     ========================================================== */
  var LOGS = [], AI = -1;
  var L = null, C = null, N = 0, ST = null, HAVE = {}, T0 = 0, T1 = 1;
  var F = { win: [0, 1], state: "all" };
  var VIEW = [], HOVER = null, painters = [];

  var STATES = [
    { id: "all", label: "All frames" }, { id: "warmup", label: "Warm-up" },
    { id: "idle", label: "Idle" }, { id: "driving", label: "Driving" }
  ];

  /* ---------- helpers ---------- */
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function fmt(v, d) { return v == null || !isFinite(v) ? "—" : v.toFixed(d == null ? 1 : d); }
  function sgn(v, d) { return v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : "") + v.toFixed(d == null ? 1 : d); }
  function clock(s) {
    if (L && L.noTime) return "#" + Math.round(s);
    var m = Math.floor(s / 60), r = Math.round(s % 60);
    if (r === 60) { m += 1; r = 0; }
    return m + ":" + (r < 10 ? "0" : "") + r;
  }
  function pick(a, idx) { var o = [], k; for (k = 0; k < idx.length; k++) o.push(a[idx[k]]); return o; }
  function nice(lo, hi) {
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    if (lo === hi) { lo -= 1; hi += 1; }
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log(span / 4) / Math.LN10));
    [1, 2, 2.5, 5, 10].some(function (m) { if (step * m >= span / 5.5) { step = step * m; return true; } return false; });
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step: step };
  }
  function widthOf(node) { return Math.max(280, Math.round(node.clientWidth)); }

  function recompute() {
    VIEW = [];
    for (var k = 0; k < N; k++) {
      if (C.t[k] < F.win[0] || C.t[k] > F.win[1]) continue;
      if (F.state !== "all" && ST[k] !== F.state) continue;
      VIEW.push(k);
    }
    if (HOVER != null && HOVER >= VIEW.length) HOVER = null;
  }

  /* ==========================================================
     CHART ENGINE
     ========================================================== */
  var PAD = { l: 46, r: 14, t: 10, b: 22 };
  var SC = { s1: "var(--s1)", s2: "var(--s2)", s3: "var(--s3)" };
  function svgEl(name, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    return e;
  }

  function drawTime(host, spec, w) {
    var h = spec.h || 158;
    host.textContent = "";
    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, height: h, role: "img" });
    svg.setAttribute("aria-label", spec.title + " over time, " + spec.unit);
    var iw = w - PAD.l - PAD.r, ih = h - PAD.t - PAD.b;

    var lo = Infinity, hi = -Infinity, s, j, v;
    for (s = 0; s < spec.series.length; s++)
      for (j = 0; j < VIEW.length; j++) {
        v = C[spec.series[s].k][VIEW[j]];
        if (v == null || !isFinite(v)) continue;
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    (spec.bands || []).forEach(function (b) { lo = Math.min(lo, b.from); hi = Math.max(hi, b.to); });
    (spec.ref || []).forEach(function (r) { lo = Math.min(lo, r.v); hi = Math.max(hi, r.v); });
    if (spec.zero != null) { lo = Math.min(lo, spec.zero); hi = Math.max(hi, spec.zero); }
    var nz = nice(lo, hi);

    var xt = function (t) { return PAD.l + (t - F.win[0]) / (F.win[1] - F.win[0] || 1) * iw; };
    var yv = function (val) { return PAD.t + ih - (val - nz.lo) / (nz.hi - nz.lo) * ih; };

    (spec.bands || []).forEach(function (b) {
      svg.appendChild(svgEl("rect", { x: PAD.l, y: yv(b.to), width: iw, height: Math.max(1, yv(b.from) - yv(b.to)), fill: "var(--band)" }));
    });
    for (v = nz.lo; v <= nz.hi + nz.step * 0.001; v += nz.step) {
      var y = yv(v);
      svg.appendChild(svgEl("line", { x1: PAD.l, x2: w - PAD.r, y1: y, y2: y, stroke: "var(--grid)", "stroke-width": 1 }));
      var lab = svgEl("text", { x: PAD.l - 7, y: y + 3.5, "text-anchor": "end", fill: "var(--ink-muted)", "font-size": 9.5, "font-family": "var(--mono)" });
      lab.textContent = Math.abs(nz.step) < 1 ? v.toFixed(nz.step < 0.1 ? 2 : 1) : String(Math.round(v));
      svg.appendChild(lab);
    }
    if (spec.zero != null && nz.lo < spec.zero && nz.hi > spec.zero)
      svg.appendChild(svgEl("line", { x1: PAD.l, x2: w - PAD.r, y1: yv(spec.zero), y2: yv(spec.zero), stroke: "var(--axis)", "stroke-width": 1 }));
    (spec.ref || []).forEach(function (r) {
      svg.appendChild(svgEl("line", { x1: PAD.l, x2: w - PAD.r, y1: yv(r.v), y2: yv(r.v), stroke: "var(--axis)", "stroke-width": 1 }));
      if (r.label) {
        var tl = svgEl("text", { x: w - PAD.r - 2, y: yv(r.v) - 4, "text-anchor": "end", fill: "var(--ink-muted)", "font-size": 9.5, "font-family": "var(--mono)" });
        tl.textContent = r.label; svg.appendChild(tl);
      }
    });
    svg.appendChild(svgEl("line", { x1: PAD.l, x2: w - PAD.r, y1: PAD.t + ih, y2: PAD.t + ih, stroke: "var(--axis)", "stroke-width": 1 }));
    for (j = 0; j <= 5; j++) {
      var tv = F.win[0] + (F.win[1] - F.win[0]) * j / 5;
      var tx = svgEl("text", { x: xt(tv), y: h - 6, "text-anchor": j === 0 ? "start" : j === 5 ? "end" : "middle", fill: "var(--ink-muted)", "font-size": 9.5, "font-family": "var(--mono)" });
      tx.textContent = clock(tv); svg.appendChild(tx);
    }

    if (spec.kind === "bar") {
      var bw = Math.max(1, Math.min(5, iw / Math.max(VIEW.length, 1) - 2));
      /* one bar per pixel column at most: keep the tallest value in each, so a
         long log does not create one DOM node per frame on every redraw */
      var bars = [], bcol = {};
      for (j = 0; j < VIEW.length; j++) {
        v = C[spec.series[0].k][VIEW[j]];
        if (v == null || !isFinite(v)) continue;
        var bx = xt(C.t[VIEW[j]]), key = VIEW.length > iw ? Math.round(bx) : j;
        if (bcol[key] != null) { if (v > bars[bcol[key]].v) bars[bcol[key]].v = v; continue; }
        bcol[key] = bars.length; bars.push({ x: bx, v: v });
      }
      bars.forEach(function (b) {
        svg.appendChild(svgEl("rect", {
          x: b.x - bw / 2, y: yv(b.v), width: bw, height: Math.max(1, PAD.t + ih - yv(b.v)),
          rx: Math.min(2, bw / 2),
          fill: (spec.flagAbove != null && b.v > spec.flagAbove) ? "var(--serious)" : SC[spec.series[0].color]
        }));
      });
    } else if (VIEW.length > iw * 2) {
      /* dense log: one min/max column per pixel keeps every spike instead of
         throwing them away the way stride sampling would */
      spec.series.forEach(function (se) {
        var buckets = new Array(Math.ceil(iw)), q, bi, val;
        for (q = 0; q < VIEW.length; q++) {
          val = C[se.k][VIEW[q]];
          if (val == null || !isFinite(val)) continue;
          bi = Math.max(0, Math.min(buckets.length - 1, Math.round(xt(C.t[VIEW[q]]) - PAD.l)));
          if (!buckets[bi]) buckets[bi] = [val, val];
          else { if (val < buckets[bi][0]) buckets[bi][0] = val; if (val > buckets[bi][1]) buckets[bi][1] = val; }
        }
        var d = "", open = false;
        for (bi = 0; bi < buckets.length; bi++) {
          if (!buckets[bi]) { open = false; continue; }
          var x = PAD.l + bi;
          d += (open ? "L" : "M") + x + " " + yv(buckets[bi][1]).toFixed(1) +
               "L" + x + " " + yv(buckets[bi][0]).toFixed(1);
          open = true;
        }
        svg.appendChild(svgEl("path", { d: d, fill: "none", stroke: SC[se.color], "stroke-width": 1.5, "stroke-linecap": "round" }));
      });
    } else {
      spec.series.forEach(function (se) {
        var d = "", open = false;
        for (var q = 0; q < VIEW.length; q++) {
          var vv = C[se.k][VIEW[q]];
          if (vv == null || !isFinite(vv)) { open = false; continue; }
          var gap = q > 0 && VIEW[q] !== VIEW[q - 1] + 1;
          if (!open || gap) { d += "M" + xt(C.t[VIEW[q]]).toFixed(1) + " " + yv(vv).toFixed(1); open = true; }
          else d += "L" + xt(C.t[VIEW[q]]).toFixed(1) + " " + yv(vv).toFixed(1);
        }
        svg.appendChild(svgEl("path", { d: d, fill: "none", stroke: SC[se.color], "stroke-width": VIEW.length > 600 ? 1.4 : 1.8, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      });
      /* two series that track each other collide at the endpoint, so label
         them where they separate most and push each away from the other */
      if (spec.directLabels && spec.series.length === 2 && VIEW.length) {
        var ka = spec.series[0].k, kb = spec.series[1].k, bq = -1, bsep = -1;
        for (var q2 = 0; q2 < VIEW.length; q2++) {
          var va = C[ka][VIEW[q2]], vb = C[kb][VIEW[q2]];
          if (va == null || vb == null || !isFinite(va) || !isFinite(vb)) continue;
          var xa = xt(C.t[VIEW[q2]]);
          if (xa < PAD.l + 34 || xa > w - PAD.r - 34) continue;
          var sep = Math.abs(yv(va) - yv(vb));
          if (sep > bsep) { bsep = sep; bq = q2; }
        }
        if (bq >= 0 && bsep >= 13) {
          var xl = xt(C.t[VIEW[bq]]);
          [[spec.series[0], yv(C[ka][VIEW[bq]])], [spec.series[1], yv(C[kb][VIEW[bq]])]]
            .sort(function (p, r) { return p[1] - r[1]; })
            .forEach(function (pr, pi) {
              var ly2 = pi === 0 ? Math.max(PAD.t + 9, pr[1] - 7) : Math.min(PAD.t + ih - 2, pr[1] + 15);
              var g = svgEl("text", { x: xl, y: ly2, "text-anchor": "middle", fill: "var(--ink-2)",
                "font-size": 10, "font-weight": 600, "font-family": "var(--sans)",
                stroke: "var(--surface)", "stroke-width": 3.5, "paint-order": "stroke" });
              g.textContent = pr[0].label; svg.appendChild(g);
            });
        }
      }
    }

    var cross = svgEl("g", { opacity: 0 });
    var cl = svgEl("line", { y1: PAD.t, y2: PAD.t + ih, stroke: "var(--hair-strong)", "stroke-width": 1 });
    cross.appendChild(cl);
    var dots = spec.series.map(function (se) {
      var c = svgEl("circle", { r: 4.5, fill: SC[se.color], stroke: "var(--surface)", "stroke-width": 2 });
      cross.appendChild(c); return c;
    });
    svg.appendChild(cross);
    var hit = svgEl("rect", { x: PAD.l, y: PAD.t, width: iw, height: ih, fill: "transparent", style: "cursor:crosshair" });
    svg.appendChild(hit);
    host.appendChild(svg);
    var tip = el("div", "tip"); host.appendChild(tip);

    function nearest(px) {
      var best = null, bd = Infinity;
      for (var q = 0; q < VIEW.length; q++) {
        var d2 = Math.abs(xt(C.t[VIEW[q]]) - px);
        if (d2 < bd) { bd = d2; best = q; }
      }
      return best;
    }
    hit.addEventListener("pointermove", function (ev) {
      var r = svg.getBoundingClientRect();
      setHover(nearest((ev.clientX - r.left) * (w / r.width)));
    });
    hit.addEventListener("pointerleave", function () { setHover(null); });
    svg.setAttribute("tabindex", "0");
    svg.addEventListener("keydown", function (ev) {
      if (!VIEW.length) return;
      if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        var cur = HOVER == null ? (ev.key === "ArrowRight" ? -1 : VIEW.length) : HOVER;
        setHover(Math.max(0, Math.min(VIEW.length - 1, cur + (ev.key === "ArrowRight" ? 1 : -1))));
        ev.preventDefault();
      } else if (ev.key === "Escape") setHover(null);
    });

    return function paintHover(q) {
      if (q == null || !VIEW.length) { cross.setAttribute("opacity", 0); tip.className = "tip"; return; }
      var idx = VIEW[q], x = xt(C.t[idx]);
      cross.setAttribute("opacity", 1);
      cl.setAttribute("x1", x); cl.setAttribute("x2", x);
      var html = '<div class="tt">' + clock(C.t[idx]) + " &middot; frame " + (idx + 1) + "</div>", any = false;
      spec.series.forEach(function (se, si) {
        var vv = C[se.k][idx];
        if (vv == null || !isFinite(vv)) { dots[si].setAttribute("opacity", 0); return; }
        any = true;
        dots[si].setAttribute("opacity", 1);
        dots[si].setAttribute("cx", x); dots[si].setAttribute("cy", yv(vv));
        html += '<div class="row"><i style="background:' + SC[se.color] + '"></i>' + esc(se.label) +
                "<b>" + fmt(vv, spec.dp == null ? 1 : spec.dp) + "</b></div>";
      });
      if (!any) cross.setAttribute("opacity", 0);
      tip.innerHTML = html;
      tip.className = "tip on";
      var r = svg.getBoundingClientRect(), sc2 = r.width / w;
      var left = x * sc2 + 14;
      if (left + 150 > r.width) left = x * sc2 - 150;
      tip.style.left = Math.max(2, left) + "px";
      tip.style.top = Math.max(2, PAD.t * sc2 + 6) + "px";
    };
  }

  /* ==========================================================
     PANELS (built per log from the channels it actually has)
     ========================================================== */
  var PANELS = [];
  function buildPanelDefs() {
    var d = [];
    function one(k, title, unit, dp, extra) {
      if (!HAVE[k]) return;
      var spec = { id: k, title: title, unit: unit, dp: dp, series: [{ k: k, label: title, color: "s1" }] };
      if (extra) for (var p in extra) spec[p] = extra[p];
      d.push(spec);
    }
    one("rpm", "Engine speed", "RPM", 0);
    one("vss", "Vehicle speed", "km/h", 0);
    one("maf", "Air mass flow", "g/s", 2);
    one("load", "Calculated load", "%", 1);

    if (HAVE.ect && HAVE.iat) d.push({ id: "temp", title: "Coolant vs intake air", unit: "°C", dp: 0,
      series: [{ k: "ect", label: "Coolant", color: "s3" }, { k: "iat", label: "Intake air", color: "s2" }],
      note: "One axis, one unit — both channels are °C, so they share a scale honestly." });
    else { one("ect", "Coolant temperature", "°C", 0); one("iat", "Intake air temp", "°C", 0); }

    if (HAVE.lam1) d.push({ id: "lam", title: "Lambda", unit: "λ", dp: 3,
      series: HAVE.lam2 ? [{ k: "lam1", label: "Bank 1", color: "s1" }, { k: "lam2", label: "Bank 2", color: "s2" }]
                        : [{ k: "lam1", label: "Lambda", color: "s1" }],
      ref: [{ v: 1, label: "λ 1.00" }],
      note: L && L.afrCols && L.afrCols.lam1 ? "Converted from the log's air/fuel ratio column, assuming gasoline at 14.7:1." : null });

    one("spark", "Ignition advance", "deg", 1, { zero: 0 });
    one("tps", "Throttle position", "%", 1);
    one("map", "Manifold pressure (MAP)", "kPa", 0);
    function o2panel(id, title, k1, k2, note) {
      var se = [];
      if (HAVE[k1]) se.push({ k: k1, label: "Bank 1", color: "s1" });
      if (HAVE[k2]) se.push({ k: k2, label: "Bank 2", color: "s2" });
      if (se.length) d.push({ id: id, title: title, unit: "V", dp: 2, series: se, ref: [{ v: 0.45, label: "0.45 V" }], note: note });
    }
    o2panel("o2f", "Front O2 voltage (pre-catalyst)", "o2b1s1", "o2b2s1",
      "A healthy narrow-band sensor swings between about 0.1 V and 0.9 V around the 0.45 V line.");
    o2panel("o2r", "Rear O2 voltage (post-catalyst)", "o2b1s2", "o2b2s2",
      "A working catalyst holds the rear sensor steadier than the front one, usually near 0.6-0.8 V.");
    one("knock", "Knock retard", "deg", 1, { zero: 0 });
    one("knocksum", "Knock sum", "count", 0, { zero: 0,
      note: "The ECU's knock count, not degrees of retard. A few counts are common background noise on a 4G63." });
    one("mafhz", "Airflow (MAF frequency)", "Hz", 0, { note: "Raw Karman-vortex MAF frequency; it rises with airflow but is not a mass flow." });
    one("injdc", "Injector duty cycle", "%", 1, { ref: [{ v: 85, label: "85 %" }] });
    one("batt", "Battery voltage", "V", 2);
    PANELS = d;
  }

  function buildPanelCards() {
    var hostP = document.getElementById("panels");
    hostP.textContent = "";
    PANELS.forEach(function (p) {
      var card = el("div", "card");
      var hd = document.createElement("header");
      hd.appendChild(el("h3", null, p.title));
      hd.appendChild(el("span", "unit", p.unit));
      hd.appendChild(el("span", "grow"));
      if (p.series.length > 1) {
        var lg = el("div", "legend");
        p.series.forEach(function (se) {
          var sp = document.createElement("span");
          var i3 = el("i"); i3.style.background = SC[se.color];
          sp.appendChild(i3); sp.appendChild(document.createTextNode(se.label));
          lg.appendChild(sp);
        });
        hd.appendChild(lg);
      }
      card.appendChild(hd);
      var ch = el("div", "chart"); card.appendChild(ch);
      if (p.note) card.appendChild(el("p", "note", p.note));
      hostP.appendChild(card);
      p.host = ch;
    });
  }

  /* ---------- shared frame readout ---------- */
  var READ = [];
  function buildReadoutDefs() {
    var r = [["Time", function (i) { return clock(C.t[i]); }]];
    function add(k, label, unit, dp) { if (HAVE[k]) r.push([label, function (i) { return fmt(C[k][i], dp) + (unit ? " " + unit : ""); }]); }
    add("rpm", "RPM", "", 0);
    add("vss", "Speed", "km/h", 0);
    add("maf", "MAF", "g/s", 2);
    add("ect", "Coolant", "°C", 0);
    add("iat", "Intake air", "°C", 0);
    if (HAVE.tt1) r.push([HAVE.tt2 ? "Trim B1" : "Trim", function (i) { return sgn(C.tt1[i], 1) + " %"; }]);
    if (HAVE.tt2) r.push(["Trim B2", function (i) { return sgn(C.tt2[i], 1) + " %"; }]);
    if (HAVE.lam1) r.push(["λ", function (i) { return fmt(C.lam1[i], 3); }]);
    add("spark", "Advance", "°", 1);
    add("tps", "Throttle", "%", 1);
    add("map", "MAP", "kPa", 0);
    add("o2b1s1", "O2 B1", "V", 2);
    add("o2b2s1", "O2 B2", "V", 2);
    add("knock", "Knock", "°", 1);
    add("knocksum", "Knock sum", "", 0);
    add("injdc", "Inj. duty", "%", 1);
    add("batt", "Battery", "V", 2);
    r.push(["State", function (i) { return ST[i] === "other" ? "transition" : ST[i]; }]);
    READ = r;
    var host = document.getElementById("readout");
    host.textContent = "";
    READ.forEach(function (x) {
      var d = el("div"); d.appendChild(el("dt", null, x[0])); d.appendChild(el("dd", null, "—")); host.appendChild(d);
    });
  }
  function paintReadout(q) {
    var host = document.getElementById("readout"), dds = host.querySelectorAll("dd");
    if (q == null || !VIEW.length) {
      host.className = "readout idle";
      for (var k = 0; k < dds.length; k++) dds[k].textContent = "—";
      return;
    }
    host.className = "readout";
    var idx = VIEW[q];
    for (var j = 0; j < READ.length && j < dds.length; j++) dds[j].textContent = READ[j][1](idx);
  }

  function setHover(q) {
    HOVER = q;
    for (var k = 0; k < painters.length; k++) painters[k](q);
    paintReadout(q);
  }
