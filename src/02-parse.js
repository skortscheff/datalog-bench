  /* ==========================================================
     CHANNEL SPEC
     Each canonical channel lists header patterns in priority
     order. Matching runs channel-by-channel over the columns a
     previous channel has not already claimed, so a log with both
     "Speed (OBD)" and "GPS Speed" gives vss the OBD one.
     `conv` normalises whatever unit the header advertises.
     ========================================================== */
  var CHAN = [
    { k: "t",      nm: "Elapsed time",        unit: "s",    grp: "time",
      pats: [/^time\b.*\bsec/, /^elapsed(\s|$)/, /^time$/, /^seconds?$/, /^t$/] },
    { k: "stamp",  nm: "Timestamp",           unit: "",     grp: "time", text: true,
      pats: [/device time/, /gps time/, /date ?\/? ?time/, /^datetime/, /time ?stamp/, /^date$/] },

    { k: "rpm",    nm: "Engine speed",        unit: "RPM",  grp: "core",
      pats: [/engine (speed|rpm)/, /^rpm$/, /revolutions/] },
    { k: "vss",    nm: "Vehicle speed",       unit: "km/h", grp: "core",
      pats: [/vehicle speed/, /speed \(obd/, /obd speed/, /road speed/, /^speed$/, /gps speed/] },
    { k: "load",   nm: "Calculated load",     unit: "%",    grp: "core",
      pats: [/calculated (engine )?load/, /engine load/, /^load$/] },
    { k: "aload",  nm: "Absolute load",       unit: "%",    grp: "core",
      pats: [/absolute load/] },
    { k: "tps",    nm: "Throttle position",   unit: "%",    grp: "core",
      pats: [/absolute throttle/, /throttle position(?!.*relative)/, /^tps$/, /throttle$/] },
    { k: "maf",    nm: "Air mass flow",       unit: "g/s",  grp: "core",
      pats: [/mass ?air ?flow/, /^maf$/, /air flow rate/] },
    { k: "map",    nm: "Manifold pressure",   unit: "kPa",  grp: "core",
      pats: [/(intake )?manifold (absolute )?pressure/, /^map$/, /boost/] },
    { k: "spark",  nm: "Ignition advance",    unit: "deg",  grp: "core",
      pats: [/ignition timing/, /timing advance/, /spark advance/] },

    { k: "ect",    nm: "Coolant temperature", unit: "°C", grp: "therm",
      pats: [/engine coolant/, /coolant temp/, /^ect$/, /water temp/] },
    { k: "iat",    nm: "Intake air temp",     unit: "°C", grp: "therm",
      pats: [/intake air temp/, /^iat$/, /air intake temp/, /charge air temp/] },
    { k: "aat",    nm: "Ambient air temp",    unit: "°C", grp: "therm",
      pats: [/ambient air temp/, /outside air temp/, /^aat$/] },
    { k: "oil",    nm: "Oil temperature",     unit: "°C", grp: "therm",
      pats: [/oil temp/] },

    { k: "stft1",  nm: "STFT bank 1",         unit: "%",    grp: "trim",
      pats: [/short.*term.*trim.*bank ?1/, /bank ?1.*short.*term/, /^stft ?1/, /short.*term.*trim(?!.*bank ?2)/] },
    { k: "ltft1",  nm: "LTFT bank 1",         unit: "%",    grp: "trim",
      pats: [/long.*term.*trim.*bank ?1/, /bank ?1.*long.*term/, /^ltft ?1/, /long.*term.*trim(?!.*bank ?2)/] },
    { k: "stft2",  nm: "STFT bank 2",         unit: "%",    grp: "trim",
      pats: [/short.*term.*trim.*bank ?2/, /bank ?2.*short.*term/, /^stft ?2/] },
    { k: "ltft2",  nm: "LTFT bank 2",         unit: "%",    grp: "trim",
      pats: [/long.*term.*trim.*bank ?2/, /bank ?2.*long.*term/, /^ltft ?2/] },

    { k: "lam1",   nm: "Lambda bank 1",       unit: "λ", grp: "mix",
      pats: [/lambda.*bank ?1/, /wide ?range.*bank ?1/, /equivalence ratio/, /^lambda$/, /^lam1/] },
    { k: "lam2",   nm: "Lambda bank 2",       unit: "λ", grp: "mix",
      pats: [/lambda.*bank ?2/, /wide ?range.*bank ?2/, /^lam2/] },
    { k: "o2b1s2", nm: "Post-cat O2 bank 1",  unit: "V",    grp: "mix",
      pats: [/o2.*bank ?1.*sensor ?2/, /bank ?1.*sensor ?2.*volt/, /^o2b1s2/, /downstream.*bank ?1/] },
    { k: "o2b2s2", nm: "Post-cat O2 bank 2",  unit: "V",    grp: "mix",
      pats: [/o2.*bank ?2.*sensor ?2/, /bank ?2.*sensor ?2.*volt/, /^o2b2s2/, /downstream.*bank ?2/] },
    { k: "fs1",    nm: "Fuel system status",  unit: "",     grp: "mix",
      pats: [/fuel system ?1? status/, /fuel system status/, /^fuel status/] },

    { k: "volt",   nm: "Module voltage",      unit: "V",    grp: "elec",
      pats: [/control module voltage/, /module volt/, /battery volt/, /^volt(age)?$/] },

    { k: "lat",    nm: "Latitude",            unit: "°", grp: "gps",
      pats: [/latitude/, /^lat$/] },
    { k: "lon",    nm: "Longitude",           unit: "°", grp: "gps",
      pats: [/longitude/, /^lon$/, /^lng$/] },
    { k: "alt",    nm: "Altitude",            unit: "m",    grp: "gps",
      pats: [/altitude/, /^alt$/, /elevation/] }
  ];

  /* AFR columns are read into lambda; the M54 is gasoline, so 14.7 is exact. */
  var AFR_PATS = [/air ?[\/ ]?fuel ratio/, /^afr/];
  var STOICH = 14.7;

  /* Channels where a constant-zero column means the PID is unsupported rather
     than measured. Deliberately excludes vss, tps, load, trims, spark, purge
     and O2 voltage, where a steady zero can be a real reading. */
  var ZERO_MEANS_ABSENT = {
    volt: 1, ect: 1, iat: 1, aat: 1, oil: 1, maf: 1,
    lam1: 1, lam2: 1, baro: 1, alt: 1, map: 1, rpm: 1
  };

  /* A parenthesised group is dropped only when it looks like a bare unit
     ("°C", "V", "km/h", "g/s" ...). Loggers such as OBD Fusion also use
     parentheses to carry channel-distinguishing text ("Bank 1  Sensor 2"),
     and blanket-stripping every "(...)" group destroyed that text, silently
     un-mapping every multi-bank O2 and wideband lambda channel. */
  var UNIT_GROUP = /^(deg\.?\s?[cf]?|°\s?[cf]?|[cf]|rpm|km\/h|km|mph|mi\/h|miles per hour|%|g\/s|lb\/?min|kpa|psi|v|volts?|ft|feet|m|sec|s|λ|lambda)$/i;

  function normHead(h) {
    return String(h)
      .replace(/﻿/g, "")
      .replace(/\(([^)]*)\)/g, function (m, inner) {
        return UNIT_GROUP.test(inner.trim()) ? " " : " " + inner + " ";
      })
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/[_\-.]+/g, " ")
      .replace(/[^A-Za-z0-9 /]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  /* unit hints read from the ORIGINAL header text, units included */
  function unitOf(raw) {
    var s = String(raw).toLowerCase();
    return {
      fahrenheit: /°?\s?f\b|\bdeg\.? ?f\b|fahrenheit/.test(s) && !/°?\s?c\b/.test(s),
      mph: /\bmph\b|mi\/h|miles per hour/.test(s),
      feet: /\bft\b|\bfeet\b/.test(s),
      kpaAbs: /\bkpa\b/.test(s),
      psi: /\bpsi\b/.test(s),
      lbmin: /lb\s?\/?\s?min/.test(s)
    };
  }

  function splitLine(line, d) {
    if (d !== ",") return line.split(d);
    /* quoted fields only matter for comma files */
    if (line.indexOf('"') < 0) return line.split(",");
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '"') { if (q && line.charAt(i + 1) === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === "," && !q) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  function looksNumeric(s) {
    return /^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/.test(String(s).trim());
  }

  function parseNum(s, decComma) {
    if (s == null) return null;
    var v = String(s).trim();
    if (!v || v === "-" || v === "--" || /^n\/?a$|^nan$|^null$|^inf(inity)?$/i.test(v)) return null;
    v = decComma ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }

  /* ==========================================================
     parseLog — text in, log object out. Never throws: problems
     land in report.warnings so the UI can show them.
     ========================================================== */
  function parseLog(text, name, isSample) {
    var warnings = [];
    var lines = String(text).replace(/\r\n?/g, "\n").split("\n");

    /* header row = first line that splits into >=3 fields of which most are non-numeric */
    var DELIMS = [",", ";", "\t", "|"];
    var hIdx = -1, delim = ",", head = null, preamble = [];
    for (var i = 0; i < Math.min(lines.length, 60); i++) {
      var raw = lines[i];
      if (!raw || !raw.trim()) continue;
      if (/^\s*[#;]/.test(raw) && i < 30) { preamble.push(raw.trim()); continue; }
      var best = null;
      for (var d = 0; d < DELIMS.length; d++) {
        var parts = splitLine(raw, DELIMS[d]);
        if (parts.length < 3) continue;
        var nonNum = 0;
        for (var p = 0; p < parts.length; p++) if (parts[p].trim() && !looksNumeric(parts[p])) nonNum++;
        var score = nonNum / parts.length;
        if (!best || parts.length > best.n) best = { d: DELIMS[d], n: parts.length, score: score, parts: parts };
      }
      if (best && best.score >= 0.6) { hIdx = i; delim = best.d; head = best.parts; break; }
      if (best && best.score < 0.6) { preamble.push(raw.trim()); }
    }
    if (hIdx < 0) return { error: "No header row found. Expected a delimited line of column names.", name: name };

    head = head.map(function (h) { return String(h).replace(/﻿/g, "").trim(); });
    /* a trailing empty header (line ends with the delimiter) is not a column */
    while (head.length && head[head.length - 1] === "") head.pop();
    var nCol = head.length;

    /* semicolon files usually mean decimal commas; confirm on the first data row */
    var decComma = false;
    if (delim === ";") {
      for (var r = hIdx + 1; r < Math.min(lines.length, hIdx + 12); r++) {
        if (!lines[r] || !lines[r].trim()) continue;
        if (/\d,\d/.test(lines[r])) { decComma = true; }
        break;
      }
    }

    /* ---- rows ---- */
    var cells = [], skipped = 0, ragged = 0;
    for (var q = hIdx + 1; q < lines.length; q++) {
      var ln = lines[q];
      if (!ln || !ln.trim()) continue;
      if (/^\s*[#]/.test(ln)) { skipped++; continue; }
      var f = splitLine(ln, delim);
      if (f.length < 2) { skipped++; continue; }
      if (f.length !== nCol) {
        ragged++;
        if (f.length < nCol) { while (f.length < nCol) f.push(""); }
        else f = f.slice(0, nCol);
      }
      cells.push(f);
    }
    if (!cells.length) return { error: "Header parsed, but no data rows followed it.", name: name };
    if (ragged) warnings.push(ragged + " row" + (ragged > 1 ? "s" : "") + " had a different column count than the header and were padded or trimmed.");
    if (skipped) warnings.push(skipped + " line" + (skipped > 1 ? "s" : "") + " were skipped as comments or fragments.");

    var n = cells.length;

    /* ---- raw columns, preserved verbatim for the table view ---- */
    var raw = [], numeric = [];
    for (var c = 0; c < nCol; c++) {
      var col = new Array(n), numOk = 0, seen = 0;
      for (var rr = 0; rr < n; rr++) {
        var s = cells[rr][c];
        col[rr] = s == null ? "" : String(s).trim();
        if (col[rr]) { seen++; if (looksNumeric(col[rr])) numOk++; }
      }
      raw.push(col);
      numeric.push(seen > 0 && numOk / seen > 0.9);
    }

    /* ---- map columns to canonical channels ---- */
    var normed = head.map(normHead);
    var claimed = {}, mapping = {}, autoMap = {};
    function claim(ch, idx) { claimed[idx] = ch.k; mapping[ch.k] = idx; autoMap[ch.k] = idx; }

    CHAN.forEach(function (ch) {
      for (var pi = 0; pi < ch.pats.length; pi++) {
        for (var ci = 0; ci < nCol; ci++) {
          if (claimed[ci] != null) continue;
          if (!ch.text && !numeric[ci]) continue;
          if (ch.text && numeric[ci]) continue;
          if (ch.pats[pi].test(normed[ci])) { claim(ch, ci); return; }
        }
      }
    });

    /* AFR stands in for lambda when no lambda column exists */
    var afrCols = {};
    if (mapping.lam1 == null) {
      for (var ai = 0; ai < nCol; ai++) {
        if (claimed[ai] != null || !numeric[ai]) continue;
        for (var ap = 0; ap < AFR_PATS.length; ap++) {
          if (AFR_PATS[ap].test(normed[ai])) {
            var tgt = (mapping.lam1 == null) ? "lam1" : (mapping.lam2 == null ? "lam2" : null);
            if (tgt) { claimed[ai] = tgt; mapping[tgt] = ai; autoMap[tgt] = ai; afrCols[tgt] = true; }
            break;
          }
        }
      }
      if (afrCols.lam1) warnings.push("No lambda column found, so air/fuel ratio was converted to lambda by dividing by " + STOICH + " (gasoline).");
    }

    /* a single-bank log: mirror nothing, just note it */
    var L = {
      name: name, isSample: !!isSample,
      head: head, normed: normed, raw: raw, numeric: numeric, n: n,
      mapping: mapping, autoMap: autoMap, afrCols: afrCols,
      report: {
        delim: delim === "\t" ? "tab" : delim, headerLine: hIdx + 1, columns: nCol,
        rows: n, skipped: skipped, ragged: ragged, decComma: decComma,
        preamble: preamble.slice(0, 4), warnings: warnings
      }
    };
    buildChannels(L);
    return L;
  }

  /* ==========================================================
     buildChannels — turn the current mapping into numeric
     channel arrays with normalised units. Re-runnable, so the
     manual override just calls it again.
     ========================================================== */
  function buildChannels(L) {
    var C = {}, n = L.n, m = L.mapping, warn = [];
    var decComma = L.report.decComma;

    function readNum(ci, conv) {
      var out = new Array(n);
      for (var i = 0; i < n; i++) {
        var v = parseNum(L.raw[ci][i], decComma);
        out[i] = (v == null) ? null : (conv ? conv(v) : v);
      }
      return out;
    }

    CHAN.forEach(function (ch) {
      var ci = m[ch.k];
      if (ci == null || ch.text) return;
      var u = unitOf(L.head[ci]), conv = null;
      if ((ch.k === "ect" || ch.k === "iat" || ch.k === "aat" || ch.k === "oil") && u.fahrenheit) {
        conv = function (v) { return (v - 32) * 5 / 9; };
        warn.push(ch.nm + " was in °F and has been converted to °C.");
      }
      if (ch.k === "vss" && u.mph) {
        conv = function (v) { return v * 1.609344; };
        warn.push("Vehicle speed was in mph and has been converted to km/h.");
      }
      if (ch.k === "alt" && u.feet) {
        conv = function (v) { return v * 0.3048; };
        warn.push("Altitude was in feet and has been converted to metres.");
      }
      if (ch.k === "maf" && u.lbmin) {
        conv = function (v) { return v * 7.5598; };
        warn.push("Mass air flow was in lb/min and has been converted to g/s.");
      }
      if ((ch.k === "lam1" || ch.k === "lam2") && L.afrCols[ch.k]) {
        conv = function (v) { return v / STOICH; };
      }
      var arr = readNum(ci, conv);

      /* A requested PID the ECU does not support comes back as a constant zero
         rather than as an error. For channels where zero is not a physically
         possible steady reading, that means "unsupported", not "measured" —
         and treating it as measured produces confident nonsense (a charging
         fault at 0.00 V). Drop the channel and say so. Channels where zero is
         legitimate (road speed, throttle, trims, spark, purge) are left alone. */
      if (ZERO_MEANS_ABSENT[ch.k]) {
        var seen = 0, nz = 0;
        for (var zi = 0; zi < n; zi++) {
          if (arr[zi] == null) continue;
          seen++;
          if (arr[zi] !== 0) { nz++; break; }
        }
        if (seen > 4 && nz === 0) {
          warn.push("“" + L.head[ci] + "” answered a constant zero for the whole log — the ECU does not support that PID, so the channel was dropped rather than analysed.");
          delete m[ch.k];
          return;
        }
      }
      C[ch.k] = arr;
    });

    /* ---- time base ---- */
    var tWarn = null;
    if (C.t) {
      var t0 = null;
      for (var i = 0; i < n; i++) if (C.t[i] != null) { t0 = C.t[i]; break; }
      /* millisecond or epoch-second columns get rescaled to elapsed seconds */
      var last = null;
      for (var j = n - 1; j >= 0; j--) if (C.t[j] != null) { last = C.t[j]; break; }
      var span = (last != null && t0 != null) ? last - t0 : 0;
      var scale = 1;
      if (span > 86400 * 3) { scale = 0.001; tWarn = "Time column looked like milliseconds and was divided by 1000."; }
      for (var k2 = 0; k2 < n; k2++) C.t[k2] = C.t[k2] == null ? null : (C.t[k2] - t0) * scale;
    } else if (m.stamp != null) {
      var stampCol = L.raw[m.stamp], base = null, ok = 0;
      C.t = new Array(n);
      for (var s = 0; s < n; s++) {
        var ms = Date.parse(stampCol[s].replace(/(\d)\.(\d{3})$/, "$1.$2"));
        if (isNaN(ms)) { C.t[s] = null; continue; }
        if (base == null) base = ms;
        C.t[s] = (ms - base) / 1000; ok++;
      }
      if (ok < n * 0.8) { C.t = null; }
      else tWarn = "No elapsed-time column; time was derived from the “" + L.head[m.stamp] + "” timestamp.";
    }
    if (!C.t) {
      C.t = new Array(n);
      for (var z = 0; z < n; z++) C.t[z] = z;
      tWarn = "No usable time column was found, so frames are numbered 0,1,2… and the time axis counts frames, not seconds.";
      L.noTime = true;
    } else {
      L.noTime = false;
      /* forward-fill any holes so the axis stays monotonic */
      var prev = 0;
      for (var f = 0; f < n; f++) { if (C.t[f] == null) C.t[f] = prev; else prev = C.t[f]; }
    }
    if (tWarn) warn.push(tWarn);

    /* ---- single-bank logs: treat the unbanked trim pair as bank 1 ---- */
    L.banks = (C.stft2 || C.ltft2) ? 2 : 1;

    /* ---- derived channels ---- */
    var tt1 = null, tt2 = null, lean = null;
    if (C.stft1 && C.ltft1) {
      tt1 = new Array(n);
      for (var a = 0; a < n; a++) tt1[a] = (C.stft1[a] == null || C.ltft1[a] == null) ? null : C.stft1[a] + C.ltft1[a];
    } else if (C.ltft1) { tt1 = C.ltft1.slice(); }
    else if (C.stft1) { tt1 = C.stft1.slice(); }
    if (C.stft2 && C.ltft2) {
      tt2 = new Array(n);
      for (var b = 0; b < n; b++) tt2[b] = (C.stft2[b] == null || C.ltft2[b] == null) ? null : C.stft2[b] + C.ltft2[b];
    } else if (C.ltft2) { tt2 = C.ltft2.slice(); }
    if (tt1) {
      lean = new Array(n);
      for (var c2 = 0; c2 < n; c2++) {
        var x = tt1[c2], y = tt2 ? tt2[c2] : null;
        lean[c2] = (x == null && y == null) ? null : Math.max(x == null ? -Infinity : x, y == null ? -Infinity : y);
      }
    }
    if (tt1) C.tt1 = tt1;
    if (tt2) C.tt2 = tt2;
    if (lean) C.lean = lean;

    var dt = new Array(n);
    dt[0] = null;
    for (var e = 1; e < n; e++) dt[e] = C.t[e] - C.t[e - 1];
    C.dt = dt;

    /* ---- operating state, using whatever channels exist ---- */
    var st = new Array(n);
    var hasEct = !!C.ect, hasVss = !!C.vss, hasRpm = !!C.rpm, hasTps = !!C.tps;
    for (var g = 0; g < n; g++) {
      var warmv = hasEct ? (C.ect[g] > 70) : true;
      var moving = hasVss ? (C.vss[g] > 5) : (hasRpm ? C.rpm[g] > 1600 : false);
      var stopped = hasVss ? (C.vss[g] === 0) : (hasRpm ? C.rpm[g] > 0 && C.rpm[g] < 1200 : false);
      var running = hasRpm ? C.rpm[g] > 300 : true;
      if (hasEct && !warmv && running) st[g] = "warmup";
      else if (warmv && stopped && running && (!hasTps || C.tps[g] < 15)) st[g] = "idle";
      else if (warmv && moving) st[g] = "driving";
      else st[g] = "other";
    }

    L.cols = C;
    L.state = st;
    L.have = {};
    CHAN.forEach(function (ch) { if (C[ch.k]) L.have[ch.k] = true; });
    ["tt1", "tt2", "lean", "dt"].forEach(function (k3) { if (C[k3]) L.have[k3] = true; });
    L.unitWarnings = warn;

    /* closed-loop frame set, if the log says anything about it */
    L.closedLoop = null;
    if (C.fs1) {
      L.closedLoop = [];
      for (var h = 0; h < n; h++) if (C.fs1[h] === 2 || C.fs1[h] === 16) L.closedLoop.push(h);
      if (!L.closedLoop.length) L.closedLoop = null;
    }
    return L;
  }
