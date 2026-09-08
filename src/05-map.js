  /* ==========================================================
     EVENT MAP
     ========================================================== */
  function merX(lon) { return (lon + 180) / 360; }
  function merY(lat) { var s = Math.sin(lat * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); }
  var EARTH_CIRC = 40075016.686;
  var TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  var TILE_ATTR = "Imagery © Esri, Maxar, Earthstar Geographics";
  var SAT = true, TILE_FAIL = false, tileFellBack = false;
  try { if (localStorage.getItem("dlb-basemap") === "clean") SAT = false; } catch (e) {}

  var EVENT_DEFS = [
    { id: "rpm",  nm: "Peak engine speed",    col: "rpm",  dp: 0, unit: "RPM" },
    { id: "vss",  nm: "Peak road speed",      col: "vss",  dp: 0, unit: "km/h" },
    { id: "maf",  nm: "Peak air mass flow",   col: "maf",  dp: 2, unit: "g/s" },
    { id: "ect",  nm: "Hottest coolant",      col: "ect",  dp: 0, unit: "°C" },
    { id: "iat",  nm: "Hottest intake air",   col: "iat",  dp: 0, unit: "°C" },
    { id: "lean", nm: "Worst lean excursion", col: "lean", dp: 1, unit: "%", signed: true },
    { id: "gap",  nm: "Longest logging gap",  col: "dt",   dp: 2, unit: "s" },
    { id: "alt",  nm: "Highest point",        col: "alt",  dp: 0, unit: "m" }
  ];
  var EVS = [], EV_ROWS = [], EV_PINS = [], ACTIVE_EV = null;

  function buildEvents() {
    EVS = [];
    EVENT_DEFS.forEach(function (def) {
      if (!HAVE[def.col]) return;
      var bi = -1, bq = -1, bv = -Infinity, q, v;
      for (q = 0; q < VIEW.length; q++) {
        v = C[def.col][VIEW[q]];
        if (v == null || !isFinite(v)) continue;
        if (def.col === "alt" && v <= 0) continue;   /* 0 m means no fix, not sea level */
        if (v > bv) { bv = v; bi = VIEW[q]; bq = q; }
      }
      if (bi < 0) return;
      var gi = bi, off = 0;
      if (!C.lat[bi] || !C.lon[bi]) {
        gi = -1;
        for (var d = 1; d < N; d++) {
          if (bi - d >= 0 && C.lat[bi - d] && C.lon[bi - d]) { gi = bi - d; off = -d; break; }
          if (bi + d < N && C.lat[bi + d] && C.lon[bi + d]) { gi = bi + d; off = d; break; }
        }
      }
      EVS.push({ def: def, i: bi, q: bq, v: bv, gi: gi, off: off });
    });
    EVS.sort(function (a, b) { return C.t[a.i] - C.t[b.i]; });
    EVS.forEach(function (e, n) { e.n = n + 1; });
  }
  function evValue(e) { return (e.def.signed && e.v > 0 ? "+" : "") + fmt(e.v, e.def.dp) + " " + e.def.unit; }

  function setEvent(n) {
    ACTIVE_EV = n;
    var k, e = null;
    for (k = 0; k < EVS.length; k++) if (EVS[k].n === n) e = EVS[k];
    for (k = 0; k < EV_ROWS.length; k++) EV_ROWS[k].className = "ev-row" + (EVS[k] && EVS[k].n === n ? " on" : "");
    for (k = 0; k < EV_PINS.length; k++) {
      var on = EV_PINS[k].n === n;
      EV_PINS[k].badge.setAttribute("r", on ? 14 : 11);
      EV_PINS[k].badge.setAttribute("fill", on ? "var(--s1)" : EV_PINS[k].pin);
      EV_PINS[k].label.setAttribute("font-size", on ? 12 : 10.5);
    }
    var hint = document.getElementById("map-hint");
    hint.lastChild.textContent = e ? e.def.nm + " · " + evValue(e) + " · " + clock(C.t[e.i]) : "hover a pin";
    setHover(e ? e.q : null);
  }

  function buildEventList() {
    var host = document.getElementById("events");
    host.textContent = "";
    EV_ROWS = [];
    if (!EVS.length) { host.appendChild(el("div", "ev-empty", "No frames in this window.")); return; }
    EVS.forEach(function (e) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "ev-row";
      b.appendChild(el("span", "num", String(e.n)));
      b.appendChild(el("span", "nm", e.def.nm));
      b.appendChild(el("span", "val", evValue(e)));
      var bits = [clock(C.t[e.i]), ST[e.i] === "other" ? "transition" : ST[e.i]];
      if (HAVE.rpm) bits.push(fmt(C.rpm[e.i], 0) + " rpm");
      if (HAVE.vss) bits.push(fmt(C.vss[e.i], 0) + " km/h");
      if (e.gi < 0) bits.push("no GPS fix");
      else if (e.off) bits.push("fix " + (e.off > 0 ? "+" : "") + e.off + " frame" + (Math.abs(e.off) > 1 ? "s" : ""));
      b.appendChild(el("span", "meta", bits.join(" · ")));
      b.addEventListener("pointerenter", function () { setEvent(e.n); });
      b.addEventListener("focus", function () { setEvent(e.n); });
      b.addEventListener("click", function () { setEvent(e.n); });
      host.appendChild(b);
      EV_ROWS.push(b);
    });
  }

  function buildBasemapSeg() {
    var host = document.getElementById("basemap-seg");
    host.textContent = "";
    [["sat", "Satellite"], ["clean", "Clean"]].forEach(function (o) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = o[1];
      b.setAttribute("aria-pressed", String((o[0] === "sat") === (SAT && !TILE_FAIL)));
      if (o[0] === "sat" && TILE_FAIL) { b.disabled = true; b.title = "Imagery can't load here — this viewer blocks external tiles"; }
      b.addEventListener("click", function () {
        SAT = (o[0] === "sat");
        try { localStorage.setItem("dlb-basemap", SAT ? "sat" : "clean"); } catch (e2) {}
        refresh();
      });
      host.appendChild(b);
    });
  }

  function drawMap(host, w) {
    host.textContent = "";
    EV_PINS = [];
    var pts = [], k;
    for (k = 0; k < VIEW.length; k++) {
      var i2 = VIEW[k];
      if (!C.lat[i2] || !C.lon[i2]) continue;
      pts.push({ la: C.lat[i2], lo: C.lon[i2], v: HAVE.vss ? C.vss[i2] : 0, i: i2, q: k });
    }
    var note = document.getElementById("route-note");
    if (pts.length < 2) {
      host.appendChild(el("p", "note", "Fewer than two GPS fixes in this window — nothing to draw."));
      note.textContent = "—";
      return function () {};
    }

    var nx0 = Infinity, nx1 = -Infinity, ny0 = Infinity, ny1 = -Infinity,
        laMin = Infinity, laMax = -Infinity, loMin = Infinity, loMax = -Infinity;
    pts.forEach(function (pt) {
      var a = merX(pt.lo), b = merY(pt.la);
      if (a < nx0) nx0 = a; if (a > nx1) nx1 = a;
      if (b < ny0) ny0 = b; if (b > ny1) ny1 = b;
      if (pt.la < laMin) laMin = pt.la; if (pt.la > laMax) laMax = pt.la;
      if (pt.lo < loMin) loMin = pt.lo; if (pt.lo > loMax) loMax = pt.lo;
    });
    var spanNX = Math.max(nx1 - nx0, 1e-9), spanNY = Math.max(ny1 - ny0, 1e-9);
    var p = 30, legendH = 26;
    var h = Math.round(Math.max(360, Math.min(620, (w - 2 * p) * spanNY / spanNX + 2 * p + legendH)));
    var iw = w - 2 * p, ih = h - 2 * p - legendH, plotH = h - legendH;
    var scale = Math.min(iw / spanNX, ih / spanNY);
    var ox = p + (iw - spanNX * scale) / 2, oy = p + (ih - spanNY * scale) / 2;
    var X = function (lo) { return ox + (merX(lo) - nx0) * scale; };
    var Y = function (la) { return oy + (merY(la) - ny0) * scale; };
    var midLat = (laMin + laMax) / 2;
    var pxPerM = scale / (EARTH_CIRC * Math.cos(midLat * Math.PI / 180));

    var sat = SAT && !TILE_FAIL;
    var cInk2   = sat ? "rgba(255,255,255,0.94)" : "var(--ink-2)";
    var cMuted  = sat ? "rgba(255,255,255,0.82)" : "var(--ink-muted)";
    var cHalo   = sat ? "rgba(0,0,0,0.85)"       : "var(--surface)";
    var cRing   = sat ? "#ffffff"                : "var(--surface)";
    var cPin    = sat ? "rgba(10,12,15,0.94)"    : "var(--ink)";
    var cPinTxt = sat ? "#ffffff"                : "var(--surface)";

    var frame = el("div", "mapframe");
    var zUsed = null;
    if (sat) {
      var tileBox = el("div", "tiles");
      tileBox.style.height = (plotH / h * 100) + "%";
      var uAt = function (cx) { return nx0 + (cx - ox) / scale; };
      var vAt = function (cy) { return ny0 + (cy - oy) / scale; };
      var u0 = Math.max(0, uAt(0)), u1 = Math.min(1, uAt(w));
      var v0 = Math.max(0, vAt(0)), v1 = Math.min(1, vAt(plotH));
      var z = Math.max(3, Math.min(18, Math.round(Math.log(scale / 160) / Math.LN2)));
      var n2, tx0, tx1, ty0, ty1, count;
      while (true) {
        n2 = Math.pow(2, z);
        tx0 = Math.floor(u0 * n2); tx1 = Math.floor(u1 * n2);
        ty0 = Math.floor(v0 * n2); ty1 = Math.floor(v1 * n2);
        count = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
        if (count <= 96 || z <= 3) break;
        z--;
      }
      zUsed = z;
      var tPx = scale / n2;
      for (var tx = tx0; tx <= tx1; tx++) {
        for (var ty = ty0; ty <= ty1; ty++) {
          var img = document.createElement("img");
          img.alt = ""; img.setAttribute("aria-hidden", "true");
          img.style.left   = ((ox + (tx / n2 - nx0) * scale) / w * 100) + "%";
          img.style.top    = ((oy + (ty / n2 - ny0) * scale) / plotH * 100) + "%";
          img.style.width  = (tPx / w * 100) + "%";
          img.style.height = (tPx / plotH * 100) + "%";
          /* a blocked or missing tile fires error — fall back to vector, once */
          img.addEventListener("error", function () {
            if (tileFellBack) return;
            tileFellBack = true; TILE_FAIL = true;
            setTimeout(refresh, 0);
          });
          img.src = TILE_URL.replace("{z}", z).replace("{y}", ty).replace("{x}", tx);
          tileBox.appendChild(img);
        }
      }
      frame.appendChild(tileBox);
    }

    var ramp = ["var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)", "var(--seq-5)"];
    /* speed bins scale to the log's own top speed so a slow log isn't one flat colour */
    var vTop = 0;
    for (k = 0; k < pts.length; k++) if (pts[k].v > vTop) vTop = pts[k].v;
    var step = Math.max(5, Math.ceil(vTop / 5 / 5) * 5);
    var BINS = [0, step, step * 2, step * 3, step * 4];
    function bin(v) { var b = 0; for (var zz = 0; zz < BINS.length; zz++) if (v >= BINS[zz]) b = zz; return b; }

    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, height: h, role: "img" });
    svg.setAttribute("aria-label", "Driven route shaded by road speed" + (sat ? " over satellite imagery" : "") +
      ", with a numbered pin on each logged extreme");
    if (sat) svg.appendChild(svgEl("rect", { x: 0, y: 0, width: w, height: plotH, fill: "rgba(8,10,13,0.28)" }));

    function eachSeg(cb) {
      for (var s = 1; s < pts.length; s++) { if (pts[s].i !== pts[s - 1].i + 1) continue; cb(pts[s - 1], pts[s]); }
    }
    if (sat) eachSeg(function (a, b) {
      svg.appendChild(svgEl("line", { x1: X(a.lo).toFixed(1), y1: Y(a.la).toFixed(1), x2: X(b.lo).toFixed(1), y2: Y(b.la).toFixed(1),
        stroke: "rgba(0,0,0,0.65)", "stroke-width": 6.5, "stroke-linecap": "round" }));
    });
    eachSeg(function (a, b) {
      svg.appendChild(svgEl("line", { x1: X(a.lo).toFixed(1), y1: Y(a.la).toFixed(1), x2: X(b.lo).toFixed(1), y2: Y(b.la).toFixed(1),
        stroke: HAVE.vss ? ramp[bin(b.v)] : "var(--s1)", "stroke-width": 3, "stroke-linecap": "round" }));
    });
    [[pts[0], "start"], [pts[pts.length - 1], "end"]].forEach(function (pr) {
      svg.appendChild(svgEl("circle", { cx: X(pr[0].lo), cy: Y(pr[0].la), r: 5,
        fill: sat ? "rgba(10,12,15,0.9)" : "var(--surface)", stroke: cRing, "stroke-width": 2 }));
      var tx2 = svgEl("text", { x: X(pr[0].lo), y: Y(pr[0].la) - 11, "text-anchor": "middle", fill: cInk2,
        "font-size": 10, "font-weight": 600, "font-family": "var(--sans)",
        stroke: cHalo, "stroke-width": 3, "paint-order": "stroke" });
      tx2.textContent = pr[1]; svg.appendChild(tx2);
    });

    var nowDot = svgEl("circle", { r: 6, fill: "var(--s2)", stroke: cRing, "stroke-width": 2, opacity: 0 });
    svg.appendChild(nowDot);

    /* pins: a badge that would collide is nudged out and keeps a leader to its
       true point; start/end are seeded as occupied so nothing lands on them */
    var placed = [
      [X(pts[0].lo), Y(pts[0].la)], [X(pts[0].lo), Y(pts[0].la) - 11],
      [X(pts[pts.length - 1].lo), Y(pts[pts.length - 1].la)],
      [X(pts[pts.length - 1].lo), Y(pts[pts.length - 1].la) - 11]
    ];
    function place(x0, y0) {
      var tries = [[0, 0]], ring, ang;
      for (ring = 1; ring <= 5; ring++)
        for (ang = 0; ang < 8; ang++)
          tries.push([Math.cos(ang * Math.PI / 4 + ring * 0.4) * ring * 26,
                      Math.sin(ang * Math.PI / 4 + ring * 0.4) * ring * 26]);
      for (var t = 0; t < tries.length; t++) {
        var cx = x0 + tries[t][0], cy = y0 + tries[t][1];
        if (cx < 16 || cx > w - 16 || cy < 16 || cy > plotH - 8) continue;
        var ok = true;
        for (var zz = 0; zz < placed.length; zz++)
          if (Math.abs(cx - placed[zz][0]) < 28 && Math.abs(cy - placed[zz][1]) < 28) { ok = false; break; }
        if (ok) { placed.push([cx, cy]); return [cx, cy]; }
      }
      placed.push([x0, y0]); return [x0, y0];
    }

    var pinLayer = svgEl("g", {});
    EVS.forEach(function (e) {
      if (e.gi < 0) return;
      var tx0 = X(C.lon[e.gi]), ty0 = Y(C.lat[e.gi]);
      var pos = place(tx0, ty0), cx = pos[0], cy = pos[1];
      var g = svgEl("g", { style: "cursor:pointer" });
      if (Math.abs(cx - tx0) > 1 || Math.abs(cy - ty0) > 1) {
        g.appendChild(svgEl("line", { x1: tx0, y1: ty0, x2: cx, y2: cy, stroke: cMuted, "stroke-width": 1.5 }));
        g.appendChild(svgEl("circle", { cx: tx0, cy: ty0, r: 2.5, fill: cRing }));
      }
      var badge = svgEl("circle", { cx: cx, cy: cy, r: 11, fill: cPin, stroke: cRing, "stroke-width": 2 });
      g.appendChild(badge);
      var label = svgEl("text", { x: cx, y: cy + 3.6, "text-anchor": "middle", fill: cPinTxt,
        "font-size": 10.5, "font-weight": 600, "font-family": "var(--mono)", "pointer-events": "none" });
      label.textContent = String(e.n);
      g.appendChild(label);
      g.appendChild(svgEl("circle", { cx: cx, cy: cy, r: 16, fill: "transparent" }));
      g.addEventListener("pointerenter", function () { setEvent(e.n); });
      g.addEventListener("pointerleave", function () { setEvent(null); });
      pinLayer.appendChild(g);
      EV_PINS.push({ n: e.n, badge: badge, label: label, pin: cPin });
    });

    var hit = svgEl("rect", { x: 0, y: 0, width: w, height: plotH, fill: "transparent", style: "cursor:crosshair" });
    svg.appendChild(hit);
    svg.appendChild(pinLayer);

    if (sat) {
      var at2 = svgEl("text", { x: w - 6, y: plotH - 6, "text-anchor": "end", fill: "rgba(255,255,255,0.8)",
        "font-size": 9, "font-family": "var(--sans)", stroke: "rgba(0,0,0,0.7)", "stroke-width": 2.5, "paint-order": "stroke" });
      at2.textContent = TILE_ATTR; svg.appendChild(at2);
    }

    var ly = h - 8;
    if (HAVE.vss) {
      for (k = 0; k < ramp.length; k++) {
        svg.appendChild(svgEl("rect", { x: p + k * 36, y: ly - 15, width: 34, height: 6, rx: 2, fill: ramp[k] }));
        var lt = svgEl("text", { x: p + k * 36, y: ly, fill: "var(--ink-muted)", "font-size": 9.5, "font-family": "var(--mono)" });
        lt.textContent = k === ramp.length - 1 ? BINS[k] + "+" : String(BINS[k]); svg.appendChild(lt);
      }
      var lu = svgEl("text", { x: p + ramp.length * 36 + 4, y: ly, fill: "var(--ink-muted)", "font-size": 9.5, "font-family": "var(--mono)" });
      lu.textContent = "km/h"; svg.appendChild(lu);
    }
    var targets = [50, 100, 200, 500, 1000, 2000, 5000], barM = targets[0], px = 0;
    for (k = 0; k < targets.length; k++) { var cand = targets[k] * pxPerM; if (cand <= iw * 0.32) { barM = targets[k]; px = cand; } }
    if (!px) px = barM * pxPerM;
    var sbx = w - p - px;
    svg.appendChild(svgEl("line", { x1: sbx, x2: sbx + px, y1: ly - 9, y2: ly - 9, stroke: "var(--ink-2)", "stroke-width": 1.5 }));
    svg.appendChild(svgEl("line", { x1: sbx, x2: sbx, y1: ly - 13, y2: ly - 5, stroke: "var(--ink-2)", "stroke-width": 1.5 }));
    svg.appendChild(svgEl("line", { x1: sbx + px, x2: sbx + px, y1: ly - 13, y2: ly - 5, stroke: "var(--ink-2)", "stroke-width": 1.5 }));
    var sbt = svgEl("text", { x: sbx + px, y: ly, "text-anchor": "end", fill: "var(--ink-muted)", "font-size": 9.5, "font-family": "var(--mono)" });
    sbt.textContent = barM >= 1000 ? (barM / 1000) + " km" : barM + " m"; svg.appendChild(sbt);

    frame.appendChild(svg);
    host.appendChild(frame);
    var tip = el("div", "tip"); host.appendChild(tip);

    hit.addEventListener("pointermove", function (evt) {
      var r = svg.getBoundingClientRect(), s = w / r.width;
      var mxp = (evt.clientX - r.left) * s, myp = (evt.clientY - r.top) * s;
      var best = null, bd = Infinity;
      for (var zz = 0; zz < pts.length; zz++) {
        var dx = X(pts[zz].lo) - mxp, dy = Y(pts[zz].la) - myp, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = pts[zz]; }
      }
      if (best && bd < 1600) { ACTIVE_EV = null; setHover(best.q); } else setHover(null);
    });
    hit.addEventListener("pointerleave", function () { setHover(null); });

    var dist = 0, mPerDegLat = 111320, kx = Math.cos(midLat * Math.PI / 180);
    for (k = 1; k < pts.length; k++) {
      if (pts[k].i !== pts[k - 1].i + 1) continue;
      var dLa = (pts[k].la - pts[k - 1].la) * mPerDegLat;
      var dLo = (pts[k].lo - pts[k - 1].lo) * mPerDegLat * kx;
      dist += Math.sqrt(dLa * dLa + dLo * dLo);
    }
    var nulls = 0;
    for (k = 0; k < VIEW.length; k++) if (!C.lat[VIEW[k]] || !C.lon[VIEW[k]]) nulls++;
    note.innerHTML = "Ground track " + (dist / 1000).toFixed(2) + "&#8239;km across a " +
      Math.round((loMax - loMin) * mPerDegLat * kx) + "&#8239;&times;&#8239;" +
      Math.round((laMax - laMin) * mPerDegLat) + "&#8239;m box near " + laMax.toFixed(3) + "&#8239;" +
      (laMax >= 0 ? "N" : "S") + " " + Math.abs(loMin).toFixed(3) + "&#8239;" + (loMin >= 0 ? "E" : "W") + "." +
      (nulls ? " " + nulls + " frame" + (nulls > 1 ? "s" : "") + " had no GPS fix." : "") +
      " Pin positions are the logged fix nearest that frame. " +
      (sat ? "Basemap is Esri World Imagery, requested live at zoom&#8239;" + zUsed + " and registered in Web Mercator."
           : TILE_FAIL ? "<b>Satellite imagery is unavailable here</b> &mdash; this viewer blocks external map tiles, so the map fell back to the vector trace. Open this file directly in a browser and the imagery loads."
                       : "Vector basemap; switch to Satellite above for imagery.");

    return function paintMapHover(q) {
      if (q == null) { nowDot.setAttribute("opacity", 0); tip.className = "tip"; return; }
      var idx = VIEW[q];
      if (!C.lat[idx] || !C.lon[idx]) { nowDot.setAttribute("opacity", 0); tip.className = "tip"; return; }
      var cx = X(C.lon[idx]), cy = Y(C.lat[idx]);
      nowDot.setAttribute("opacity", 1);
      nowDot.setAttribute("cx", cx); nowDot.setAttribute("cy", cy);
      var rows = '<div class="tt">' + clock(C.t[idx]) + " &middot; frame " + (idx + 1) + "</div>";
      if (HAVE.vss) rows += '<div class="row"><i style="background:var(--s1)"></i>Speed<b>' + fmt(C.vss[idx], 0) + "</b></div>";
      if (HAVE.rpm) rows += '<div class="row"><i style="background:var(--s2)"></i>Engine<b>' + fmt(C.rpm[idx], 0) + "</b></div>";
      if (HAVE.ect) rows += '<div class="row"><i style="background:var(--s3)"></i>Coolant<b>' + fmt(C.ect[idx], 0) + "</b></div>";
      tip.innerHTML = rows;
      tip.className = "tip on";
      var r = svg.getBoundingClientRect(), s = r.width / w;
      var left = cx * s + 16;
      if (left + 160 > r.width) left = cx * s - 160;
      tip.style.left = Math.max(2, left) + "px";
      tip.style.top = Math.max(2, Math.min(r.height - 96, cy * s - 18)) + "px";
    };
  }

  /* ---------- altitude ---------- */
  function drawAlt(host, w) {
    host.textContent = "";
    var h = 158, iw = w - PAD.l - PAD.r, ih = h - PAD.t - PAD.b;
    var vals = [], k;
    for (k = 0; k < VIEW.length; k++) if (C.alt[VIEW[k]] > 0) vals.push(C.alt[VIEW[k]]);
    if (!vals.length) { host.appendChild(el("p", "note", "No altitude frames in this window.")); return; }
    var nz = nice(Math.min.apply(null, vals), Math.max.apply(null, vals));
    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, height: h, role: "img" });
    svg.setAttribute("aria-label", "Altitude over time, metres");
    var xt = function (t) { return PAD.l + (t - F.win[0]) / (F.win[1] - F.win[0] || 1) * iw; };
    var yv = function (v) { return PAD.t + ih - (v - nz.lo) / (nz.hi - nz.lo) * ih; };
    for (var v = nz.lo; v <= nz.hi + nz.step * 0.001; v += nz.step) {
      svg.appendChild(svgEl("line", { x1: PAD.l, x2: w - PAD.r, y1: yv(v), y2: yv(v), stroke: "var(--grid)", "stroke-width": 1 }));
      var lb = svgEl("text", { x: PAD.l - 7, y: yv(v) + 3.5, "text-anchor": "end", fill: "var(--ink-muted)", "font-size": 9.5, "font-family": "var(--mono)" });
      lb.textContent = String(Math.round(v)); svg.appendChild(lb);
    }
    var d = "", area = "", open = false, first = null, last = null;
    for (k = 0; k < VIEW.length; k++) {
      var i2 = VIEW[k], a = C.alt[i2];
      if (!(a > 0)) { open = false; continue; }
      var x = xt(C.t[i2]), y = yv(a);
      if (!open) { d += "M" + x.toFixed(1) + " " + y.toFixed(1); if (first == null) first = x; open = true; }
      else d += "L" + x.toFixed(1) + " " + y.toFixed(1);
      last = x; area += (area ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    }
    if (first != null) svg.appendChild(svgEl("path", { d: area + "L" + last.toFixed(1) + " " + (PAD.t + ih) + "L" + first.toFixed(1) + " " + (PAD.t + ih) + "Z", fill: "var(--band)" }));
    svg.appendChild(svgEl("line", { x1: PAD.l, x2: w - PAD.r, y1: PAD.t + ih, y2: PAD.t + ih, stroke: "var(--axis)", "stroke-width": 1 }));
    svg.appendChild(svgEl("path", { d: d, fill: "none", stroke: "var(--s1)", "stroke-width": 2, "stroke-linejoin": "round" }));
    for (k = 0; k <= 4; k++) {
      var tv = F.win[0] + (F.win[1] - F.win[0]) * k / 4;
      var tx = svgEl("text", { x: xt(tv), y: h - 6, "text-anchor": k === 0 ? "start" : k === 4 ? "end" : "middle", fill: "var(--ink-muted)", "font-size": 9.5, "font-family": "var(--mono)" });
      tx.textContent = clock(tv); svg.appendChild(tx);
    }
    host.appendChild(svg);
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    document.getElementById("alt-note").textContent =
      "Range " + Math.round(mn) + "–" + Math.round(mx) + " m, " + Math.round(mx - mn) + " m of relief. " +
      "Air density at " + Math.round((mn + mx) / 2) + " m is about " +
      Math.round(Math.pow(1 - 2.25577e-5 * ((mn + mx) / 2), 4.256) * 100) + "% of sea level; the ECU corrects for it through the MAF.";
  }

  /* ---------- median trim by operating state ---------- */
  function drawState(host, w) {
    host.textContent = "";
    var groups = [{ label: "Idle", id: "idle" }, { label: "Driving", id: "driving" },
                  { label: "Warm-up", id: "warmup" }, { label: "Whole window", id: "all" }];
    var rows = [];
    groups.forEach(function (g) {
      var sel = VIEW.filter(function (i2) { return g.id === "all" || ST[i2] === g.id; });
      if (sel.length < 4) return;
      rows.push({ label: g.label, n: sel.length,
                  b1: medOf(pick(C.tt1, sel)), b2: HAVE.tt2 ? medOf(pick(C.tt2, sel)) : null });
    });
    if (!rows.length) { host.appendChild(el("p", "note", "Not enough frames in this window.")); return; }
    var vals = [];
    rows.forEach(function (r) { if (r.b1 != null) vals.push(r.b1); if (r.b2 != null) vals.push(r.b2); });
    if (!vals.length) { host.appendChild(el("p", "note", "No trim data in this window.")); return; }
    var nzHi = Math.max(20, Math.ceil(Math.max.apply(null, vals) / 5) * 5);
    var nzLo = Math.min(0, Math.floor(Math.min.apply(null, vals) / 5) * 5);
    var rowH = HAVE.tt2 ? 46 : 36, padL = 108, padR = 58, top = 10;
    var h = top + rows.length * rowH + 26, iw = w - padL - padR;
    var Xs = function (v) { return padL + (v - nzLo) / (nzHi - nzLo) * iw; };
    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, height: h, role: "img" });
    svg.setAttribute("aria-label", "Median total fuel correction by operating state, percent");
    svg.appendChild(svgEl("rect", { x: Xs(0), y: top, width: Math.max(1, Xs(10) - Xs(0)), height: rows.length * rowH, fill: "var(--band)" }));
    var bl = svgEl("text", { x: Xs(10) + 4, y: top + 10, fill: "var(--ink-muted)", "font-size": 9.5, "font-family": "var(--mono)" });
    bl.textContent = "10 % limit"; svg.appendChild(bl);
    for (var g2 = 0; g2 <= 4; g2++) {
      var gv = nzLo + (nzHi - nzLo) * g2 / 4;
      svg.appendChild(svgEl("line", { x1: Xs(gv), x2: Xs(gv), y1: top, y2: top + rows.length * rowH, stroke: "var(--grid)", "stroke-width": 1 }));
      var gt = svgEl("text", { x: Xs(gv), y: h - 8, "text-anchor": g2 === 0 ? "start" : g2 === 4 ? "end" : "middle", fill: "var(--ink-muted)", "font-size": 9.5, "font-family": "var(--mono)" });
      gt.textContent = (gv > 0 ? "+" : "") + Math.round(gv); svg.appendChild(gt);
    }
    svg.appendChild(svgEl("line", { x1: Xs(0), x2: Xs(0), y1: top, y2: top + rows.length * rowH, stroke: "var(--axis)", "stroke-width": 1 }));
    rows.forEach(function (r, ri) {
      var y0 = top + ri * rowH;
      var nm = svgEl("text", { x: padL - 12, y: y0 + rowH / 2 - 2, "text-anchor": "end", fill: "var(--ink)", "font-size": 12, "font-weight": 600, "font-family": "var(--sans)" });
      nm.textContent = r.label; svg.appendChild(nm);
      var ct = svgEl("text", { x: padL - 12, y: y0 + rowH / 2 + 12, "text-anchor": "end", fill: "var(--ink-muted)", "font-size": 10, "font-family": "var(--mono)" });
      ct.textContent = r.n + " frames"; svg.appendChild(ct);
      [["b1", "var(--s1)"], ["b2", "var(--s2)"]].forEach(function (pr, bi) {
        var v = r[pr[0]]; if (v == null) return;
        var bh = 11, by = y0 + 8 + bi * (bh + 2);   /* 2px surface gap between adjacent bars */
        var x0 = Math.min(Xs(0), Xs(v)), bw2 = Math.max(2, Math.abs(Xs(v) - Xs(0)));
        svg.appendChild(svgEl("rect", { x: x0, y: by, width: bw2, height: bh, rx: 4, fill: pr[1] }));
        var vl = svgEl("text", { x: x0 + bw2 + 6, y: by + bh - 2, fill: "var(--ink-2)", "font-size": 10.5, "font-family": "var(--mono)", "font-weight": 500 });
        vl.textContent = (v > 0 ? "+" : "") + v.toFixed(1); svg.appendChild(vl);
      });
    });
    host.appendChild(svg);
  }

  function medOf(a) {
    var v = [], i;
    for (i = 0; i < a.length; i++) if (a[i] != null && isFinite(a[i])) v.push(a[i]);
    if (!v.length) return null;
    v.sort(function (p, q) { return p - q; });
    var m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
