  /* Bump by hand when CHAN or RULES changes shape in a way that would
     invalidate old golden files or historical results. */
  var PARSER_VERSION = "1.1.0";

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
    { k: "maf",    nm: "Air mass flow",       unit: "g/s",  grp: "core",
      pats: [/mass ?air ?flow/, /^maf$/, /air flow rate/] },
    { k: "spark",  nm: "Ignition advance",    unit: "deg",  grp: "core",
      pats: [/ignition timing/, /timing advance/, /spark advance/] },

    { k: "ect",    nm: "Coolant temperature", unit: "°C", grp: "therm",
      pats: [/engine coolant/, /coolant temp/, /^ect$/, /water temp/] },
    { k: "iat",    nm: "Intake air temp",     unit: "°C", grp: "therm",
      pats: [/intake air temp/, /^iat$/, /air intake temp/, /charge air temp/] },

    /* the trailing "ft" patterns catch GM-style names such as "Long Term FT B1" */
    { k: "stft1",  nm: "STFT bank 1",         unit: "%",    grp: "trim",
      pats: [/short.*term.*trim.*bank ?1/, /bank ?1.*short.*term/, /^stft ?1/, /short.*term.*trim(?!.*bank ?2)/,
             /short.*term.*ft.*b(ank)? ?1\b/, /short.*term.*ft(?!.*b(ank)? ?2)/] },
    { k: "ltft1",  nm: "LTFT bank 1",         unit: "%",    grp: "trim",
      pats: [/long.*term.*trim.*bank ?1/, /bank ?1.*long.*term/, /^ltft ?1/, /long.*term.*trim(?!.*bank ?2)/,
             /long.*term.*ft.*b(ank)? ?1\b/, /long.*term.*ft(?!.*b(ank)? ?2)/] },
    { k: "stft2",  nm: "STFT bank 2",         unit: "%",    grp: "trim",
      pats: [/short.*term.*trim.*bank ?2/, /bank ?2.*short.*term/, /^stft ?2/, /short.*term.*ft.*b(ank)? ?2\b/] },
    { k: "ltft2",  nm: "LTFT bank 2",         unit: "%",    grp: "trim",
      pats: [/long.*term.*trim.*bank ?2/, /bank ?2.*long.*term/, /^ltft ?2/, /long.*term.*ft.*b(ank)? ?2\b/] },

    { k: "lam1",   nm: "Lambda bank 1",       unit: "λ", grp: "mix",
      pats: [/lambda.*bank ?1/, /wide ?range.*bank ?1/, /equivalence ratio/, /^lambda$/, /^lam1/] },
    { k: "lam2",   nm: "Lambda bank 2",       unit: "λ", grp: "mix",
      pats: [/lambda.*bank ?2/, /wide ?range.*bank ?2/, /^lam2/] },

    /* Channels below were added for the Chevrolet L59 profile. They sit last so
       they can never claim a column an earlier channel would have taken. Header
       texts are the OBD Fusion / ELM327 PID names; "knock" is not a standard
       OBD-II PID, so it appears only when the user has added a GM enhanced PID. */
    { k: "tps",    nm: "Throttle position",   unit: "%",    grp: "core",
      pats: [/^absolute throttle position/, /^throttle position/, /throttle (position|pos)/, /^tps$/, /^throttle$/] },
    { k: "map",    nm: "Manifold pressure",   unit: "kPa",  grp: "core",
      pats: [/intake manifold/, /manifold (absolute )?pressure/, /^map$/] },
    { k: "fuelsys", nm: "Fuel system status", unit: "",     grp: "mix",
      pats: [/^fuel system 1 status/, /^fuel system status/, /^fuel system 1$/] },
    { k: "o2b1s1", nm: "O2 voltage B1 S1",    unit: "V",    grp: "mix",
      pats: [/volt.*bank ?1.*sensor ?1\b/, /bank ?1.*sensor ?1.*volt/, /^o2 ?b1 ?s1\b/] },
    { k: "o2b2s1", nm: "O2 voltage B2 S1",    unit: "V",    grp: "mix",
      pats: [/volt.*bank ?2.*sensor ?1\b/, /bank ?2.*sensor ?1.*volt/, /^o2 ?b2 ?s1\b/] },
    { k: "o2b1s2", nm: "O2 voltage B1 S2 (post-cat)", unit: "V", grp: "mix",
      pats: [/volt.*bank ?1.*sensor ?2\b/, /bank ?1.*sensor ?2.*volt/, /^o2 ?b1 ?s2\b/] },
    { k: "o2b2s2", nm: "O2 voltage B2 S2 (post-cat)", unit: "V", grp: "mix",
      pats: [/volt.*bank ?2.*sensor ?2\b/, /bank ?2.*sensor ?2.*volt/, /^o2 ?b2 ?s2\b/] },
    { k: "knock",  nm: "Knock retard",        unit: "deg",  grp: "core",
      pats: [/knock.*retard/, /retard.*knock/, /knock (correction|count)/, /^kr$/, /^knock$/] },

    /* Channels below were added for the Mitsubishi Evo profile. EvoScan reads
       the ECU over MUT, not OBD-II, so these have only `evo` patterns, which
       are tried only on an EvoScan file: generic names such as "Air Flow" or
       "Battery" mean something else in other loggers. */
    { k: "knocksum", nm: "Knock sum",          unit: "count", grp: "core", pats: [],
      evo: [/^knocksum$/] },
    { k: "mafhz",  nm: "Airflow (MAF frequency)", unit: "Hz", grp: "core", pats: [],
      evo: [/^airflow$/] },
    { k: "injdc",  nm: "Injector duty cycle",  unit: "%",   grp: "mix",  pats: [],
      evo: [/^injdutycycle$/] },
    { k: "batt",   nm: "Battery voltage",      unit: "V",   grp: "core", pats: [],
      evo: [/^battery$/] },
    { k: "octane", nm: "Octane flag",          unit: "%",   grp: "core", pats: [],
      evo: [/^octaneflag$/] }
  ];

  /* EvoScan names its columns in CamelCase with no units ("CoolantTemp",
     "LogEntrySeconds"), which normHead turns into single words the generic
     patterns cannot match. These are tried first on an EvoScan file only. */
  var EVO_PATS = {
    t: [/^logentryseconds$/],
    load: [/^load1b$/, /^loadmut2byte$/, /^load ?calc$/, /^ecu ?load$/],
    spark: [/^timingadv$/],
    ect: [/^coolanttemp$/],
    iat: [/^airtemp$/],
    stft1: [/^o2feedbacktrim$/],
    ltft1: [/^fueltrim inuse$/],
    o2b1s1: [/^o2sensor$/],
    o2b1s2: [/^o2sensor2$/]
  };
  CHAN.forEach(function (c) { if (EVO_PATS[c.k]) c.evo = EVO_PATS[c.k]; });

  /* An EvoScan CSV starts with these bookkeeping columns, whatever items the
     user chose to log. */
  function detectSource(normed) {
    var s = {}; normed.forEach(function (h) { s[h] = 1; });
    return (s.logid && s.logentrydate && s.logentryseconds) ? "evoscan" : "generic";
  }

  /* Derived rather than hand-listed, so it can never drift from CHAN. */
  var PID_PROFILE = CHAN.map(function (c) { return c.k; });

  /* AFR columns are read into lambda; the M54 is gasoline, so 14.7 is exact. */
  var AFR_PATS = [/air ?[\/ ]?fuel ratio/, /^afr/, /^wide ?band ?af$/];
  var STOICH = 14.7;

  /* Channels where a constant-zero column means the PID is unsupported (or the
     sensor is unplugged) rather than measured. Deliberately excludes vss, load,
     trims and spark, where a steady zero can be a real reading. */
  var ZERO_MEANS_ABSENT = {
    ect: 1, iat: 1, maf: 1, lam1: 1, lam2: 1, rpm: 1,
    /* a narrow-band O2 sensor never sits at exactly 0 V for a whole log, and a
       wideband car reports 0 here because it has no narrow-band sensor 1 */
    o2b1s1: 1, o2b2s1: 1, o2b1s2: 1, o2b2s2: 1, map: 1,
    /* EvoScan writes 0 for an item the ECU does not answer */
    mafhz: 1, injdc: 1, batt: 1
  };

  /* Short-term trim on a closed-loop engine moves all the time, so a short-term
     trim that is exactly zero in every one of this many frames is either not
     really being read, or the ECU never entered closed loop (on Mitsubishi MUT
     ECUs 0 % is the neutral raw value). The log cannot tell which, so the
     channel is not analysed as a trim, and L.deadTrims feeds the trim-flat
     finding that says so. A long-term trim stuck at zero beside it goes too. */
  var DEAD_TRIM_FRAMES = 100;

  /* ==========================================================
     ENGINE PROFILES
     Every threshold that depends on which engine the log came from lives here,
     so the rules and KPI tiles read one table instead of hard-coded constants.
     m54 reproduces the constants the app shipped with. l59 values are starting
     estimates for a 5.3 L Vortec V8 and should be tuned against real logs.
       idleLo/idleHi    expected warm idle band (rpm), informational
       rpmRanAbove      engine counts as "running" once it has been seen above this
       rpmDipBelow      a dip is a stretch under this, after the engine ran
       rpmStallBelow    a dip that reaches this is a stall
       idleHuntSd       warm idle rpm spread above which idle is "hunting"
       ectWarn/ectCrit  coolant limits (°C)
       iatNeutral/iatWarn/iatKpiWarn/iatKpiCrit  intake air limits (°C)
       trimKpiWarn/trimKpiCrit  KPI trim chip limits (%)
       idleMapHigh      idle MAP (kPa) above which a vacuum problem is suspected
       want             channels the coverage check asks for, [key, label]
       logger           what the coverage check tells the user to add PIDs in
       short/blurb/loggerNote  labels for the vehicle picker
     Rules marked `only` in 03-analyze.js run for the profiles they list.
     evo values are starting estimates for a stock 4G63T Evo IV-IX and should be
     tuned against more real logs.
     ========================================================== */
  var BASE_WANT = [["rpm", "engine speed"], ["vss", "vehicle speed"], ["ect", "coolant temperature"],
                   ["iat", "intake air temperature"], ["maf", "mass air flow"], ["stft1", "short-term fuel trim"],
                   ["ltft1", "long-term fuel trim"]];
  var PROFILES = {
    m54: { id: "m54", name: "BMW M54 (inline-6)", short: "BMW M54",
           blurb: "2.2–3.0 L inline-6: E39, E46, E60, E83, Z4",
           loggerNote: "OBD-II app CSV (OBD Fusion, Torque, Car Scanner)",
           idleLo: 650, idleHi: 900,
           rpmRanAbove: 600, rpmDipBelow: 450, rpmStallBelow: 100, idleHuntSd: 250,
           ectWarn: 112, ectCrit: 120, iatNeutral: 70, iatWarn: 85, iatKpiWarn: 70, iatKpiCrit: 95,
           trimKpiWarn: 10, trimKpiCrit: 18, idleMapHigh: 50,
           want: BASE_WANT, logger: "your logger's PID list" },
    l59: { id: "l59", name: "Chevrolet L59 (5.3 L V8)", short: "Chevy L59",
           blurb: "5.3 L Vortec flex-fuel V8: Silverado, Tahoe, Suburban",
           loggerNote: "OBD-II app CSV; GM knock retard as an enhanced PID",
           idleLo: 550, idleHi: 750,
           rpmRanAbove: 500, rpmDipBelow: 400, rpmStallBelow: 100, idleHuntSd: 200,
           ectWarn: 110, ectCrit: 120, iatNeutral: 70, iatWarn: 85, iatKpiWarn: 70, iatKpiCrit: 95,
           trimKpiWarn: 10, trimKpiCrit: 18, idleMapHigh: 50,
           want: BASE_WANT.concat([["tps", "throttle position"], ["map", "manifold pressure"]]),
           logger: "your logger's PID list" },
    evo: { id: "evo", name: "Mitsubishi Lancer Evolution I–IX (4G63T)", short: "Mitsubishi Evo",
           blurb: "2.0 L turbo inline-4, Evo I–IX, MUT-protocol ECU",
           loggerNote: "EvoScan CSV",
           idleLo: 750, idleHi: 950,
           rpmRanAbove: 600, rpmDipBelow: 500, rpmStallBelow: 100, idleHuntSd: 200,
           ectWarn: 105, ectCrit: 112, iatNeutral: 50, iatWarn: 65, iatKpiWarn: 55, iatKpiCrit: 70,
           trimKpiWarn: 10, trimKpiCrit: 18, idleMapHigh: 50,
           want: [["rpm", "engine speed (RPM)"], ["vss", "vehicle speed (Speed)"], ["ect", "coolant temperature (CoolantTemp)"],
                  ["iat", "intake air temperature (AirTemp)"], ["mafhz", "airflow (AirFlow)"],
                  ["stft1", "short-term fuel trim (O2FeedbackTrim)"], ["ltft1", "long-term fuel trim (FuelTrim_InUse)"],
                  ["tps", "throttle position (TPS)"], ["knocksum", "knock sum (KnockSum)"],
                  ["o2b1s1", "front oxygen sensor (O2Sensor)"], ["octane", "octane flag (OctaneFlag)"]],
           logger: "the EvoScan logging list" }
  };
  var PROFILE_IDS = ["m54", "l59", "evo"];

  function profileOf(L) { return PROFILES[L && L.profileId] || PROFILES.m54; }

  /* Pick a default engine profile from what the log contains. The logs carry no
     engine identifier, so this scores channels that only one of the cars
     reports: the BMW has wideband lambda and no MAP PID, a GM V8 reports MAP and
     narrow-band O2 voltage, and knock retard exists only as a GM enhanced PID.
     An EvoScan file can only come from a Mitsubishi, so the format decides it.
     It is only a default — the vehicle selector overrides it. */
  function detectProfile(L) {
    if (L.source === "evoscan") return { id: "evo", score: 0, why: ["EvoScan log format"] };
    var m = L.mapping, C = L.cols, score = 0, why = [];
    if (C.map) { score += 2; why.push("manifold pressure present"); }
    if (C.knock) { score += 2; why.push("knock retard present"); }
    if (C.o2b1s1 || C.o2b2s1) { score += 2; why.push("narrow-band O2 voltage on sensor 1"); }
    if (C.lam1 || C.lam2) { score -= 3; why.push("wideband lambda present"); }
    if (/l59|vortec|silverado|tahoe|suburban|sierra|yukon|chev|gmc|\bgm\b/i.test(L.name || "")) { score += 2; why.push("file name"); }
    return { id: score >= 2 ? "l59" : "m54", score: score, why: why };
  }

  /* resolve L.profileId from the override, else from detection */
  function applyProfile(L) {
    var d = detectProfile(L);
    L.profileAuto = d.id;
    L.profileWhy = d.why;
    L.profileId = (L.profileOverride && PROFILES[L.profileOverride]) ? L.profileOverride : d.id;
    return L.profileId;
  }

  /* A parenthesised group is dropped only when it looks like a bare unit
     ("°C", "V", "km/h", "g/s" ...). Loggers such as OBD Fusion also use
     parentheses to carry channel-distinguishing text ("Bank 1  Sensor 2"),
     and blanket-stripping every "(...)" group destroyed that text, silently
     un-mapping every multi-bank O2 and wideband lambda channel. */
  var UNIT_GROUP = /^(deg\.?\s?[cf]?|°\s?[cf]?|[cf]|rpm|km\/h|km|mph|mi\/h|miles per hour|%|g\/s|lb\/?min|kpa|psi|inhg|v|volts?|ft|feet|m|sec|s|λ|lambda)$/i;

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
      inhg: /\bin ?hg\b|inhg/.test(s),
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
    if (decComma) v = v.replace(/\./g, "").replace(",", ".");
    else if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(v)) v = v.replace(/,/g, "");   /* 1,234.5 */
    else if (/^[+-]?\d+,\d+$/.test(v)) v = v.replace(",", ".");                      /* 1,5 outside a decimal-comma file */
    else v = v.replace(/,/g, "");
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

    /* A comma can only be a decimal mark when it is not the delimiter. Scan up to
       40 data rows: some cells with digits,digits and none with a dot decimal. */
    var decComma = false;
    if (delim !== ",") {
      var commaCells = 0, dotCells = 0, seen = 0;
      for (var r = hIdx + 1; r < lines.length && seen < 40; r++) {
        if (!lines[r] || !lines[r].trim() || /^\s*#/.test(lines[r])) continue;
        seen++;
        splitLine(lines[r], delim).forEach(function (c) {
          c = c.trim();
          if (/^[+-]?\d+,\d+$/.test(c)) commaCells++;
          else if (/^[+-]?\d*\.\d+$/.test(c)) dotCells++;
        });
      }
      decComma = commaCells > 0 && dotCells === 0;
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
    var source = detectSource(normed);
    var claimed = {}, mapping = {}, autoMap = {};
    function claim(ch, idx) { claimed[idx] = ch.k; mapping[ch.k] = idx; autoMap[ch.k] = idx; }

    CHAN.forEach(function (ch) {
      var pats = (source === "evoscan" && ch.evo) ? ch.evo.concat(ch.pats) : ch.pats;
      for (var pi = 0; pi < pats.length; pi++) {
        for (var ci = 0; ci < nCol; ci++) {
          if (claimed[ci] != null) continue;
          if (!ch.text && !numeric[ci]) continue;
          if (ch.text && numeric[ci]) continue;
          if (pats[pi].test(normed[ci])) { claim(ch, ci); return; }
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
    }

    /* a single-bank log: mirror nothing, just note it */
    var L = {
      name: name, isSample: !!isSample, source: source,
      head: head, normed: normed, raw: raw, numeric: numeric, n: n,
      mapping: mapping, autoMap: autoMap, afrCols: afrCols,
      parserVersion: PARSER_VERSION, pidProfile: PID_PROFILE,
      report: {
        delim: delim === "\t" ? "tab" : delim, headerLine: hIdx + 1, columns: nCol,
        rows: n, skipped: skipped, ragged: ragged, decComma: decComma,
        preamble: preamble.slice(0, 4), warnings: warnings
      }
    };
    if (source === "evoscan") L.report.format = "EvoScan";
    buildChannels(L);
    return L;
  }

  /* true when a column has at least `min` readings and every one is zero */
  function allZero(arr, min) {
    var seen = 0;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] == null) continue;
      if (arr[i] !== 0) return false;
      seen++;
    }
    return seen >= min;
  }

  /* EvoScan headers carry no units: temperature and speed follow the metric or
     imperial setting in the user's EvoScan install. Both are read off the data.
     Coolant in °C cannot sit above 135 for a tenth of a log, while a warm engine
     in °F always does. The ECU reports speed in steps of 2 km/h, so a speed
     column whose readings are all multiples of 2 km/h expressed in mph
     (1.2427 mph) was converted to mph by EvoScan. */
  var MPH_STEP = 2 / 1.609344;
  function evoUnits(L, readNum) {
    var m = L.mapping, out = { fahrenheit: false, mph: false, tempWhy: "", speedWhy: "" };
    function vals(k) {
      return m[k] == null ? [] : readNum(m[k], null).filter(function (v) { return v != null; }).sort(function (a, b) { return a - b; });
    }
    function p90(v) { return v.length ? v[Math.floor((v.length - 1) * 0.9)] : null; }
    var ect = vals("ect"), iat = vals("iat");
    if (ect.length > 10) {
      out.fahrenheit = p90(ect) > 135;
      out.tempWhy = "EvoScan does not label units; the coolant readings are only possible in °F, and EvoScan uses one unit for every temperature.";
    } else if (iat.length > 10) {
      out.fahrenheit = p90(iat) > 80;
      out.tempWhy = "EvoScan does not label units; intake air readings this high are only plausible in °F.";
    }
    var spd = vals("vss").filter(function (v) { return v > 0; });
    if (spd.length >= 10) {
      var onStep = spd.filter(function (v) { var q = v / MPH_STEP; return Math.abs(q - Math.round(q)) < 0.01; }).length;
      if (onStep / spd.length >= 0.9) {
        out.mph = true;
        out.speedWhy = "EvoScan does not label units; every reading is a whole number of 2 km/h steps expressed in mph.";
      }
    }
    /* readings in whole 2 km/h steps are km/h; anything else follows the temperature unit */
    var kmhSteps = spd.every(function (v) { return Math.abs(v / 2 - Math.round(v / 2)) < 0.01; });
    if (!out.mph && out.fahrenheit && spd.length && !kmhSteps) {
      out.mph = true;
      out.speedWhy = "EvoScan does not label units; temperatures were in °F, so speed is assumed to be in mph as well.";
    }
    return out;
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

    var evoU = L.source === "evoscan" ? evoUnits(L, readNum) : null;

    CHAN.forEach(function (ch) {
      var ci = m[ch.k];
      if (ci == null || ch.text) return;
      var u = unitOf(L.head[ci]), conv = null;
      if ((ch.k === "ect" || ch.k === "iat") && (u.fahrenheit || (evoU && evoU.fahrenheit))) {
        conv = function (v) { return (v - 32) * 5 / 9; };
        warn.push(ch.nm + " was in °F and has been converted to °C." + (u.fahrenheit ? "" : " " + evoU.tempWhy));
      }
      if (ch.k === "vss" && (u.mph || (evoU && evoU.mph))) {
        conv = function (v) { return v * 1.609344; };
        warn.push("Vehicle speed was in mph and has been converted to km/h." + (u.mph ? "" : " " + evoU.speedWhy));
      }
      if (ch.k === "maf" && u.lbmin) {
        conv = function (v) { return v * 7.5598; };
        warn.push("Mass air flow was in lb/min and has been converted to g/s.");
      }
      if (ch.k === "map" && u.psi) {
        conv = function (v) { return v * 6.894757; };
        warn.push("Manifold pressure was in psi and has been converted to kPa.");
      } else if (ch.k === "map" && u.inhg) {
        conv = function (v) { return v * 3.386389; };
        warn.push("Manifold pressure was in inHg and has been converted to kPa.");
      }
      if ((ch.k === "lam1" || ch.k === "lam2") && L.afrCols[ch.k] && L.autoMap[ch.k] === ci) {
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
          warn.push("“" + L.head[ci] + "” read zero for the whole log — the ECU does not support that PID, or the sensor is unplugged — so the channel was dropped rather than analysed.");
          delete m[ch.k];
          return;
        }
      }
      C[ch.k] = arr;
    });

    /* said only once the converted channel has survived the zero check above */
    if (C.lam1 && L.afrCols.lam1 && L.autoMap.lam1 === m.lam1)
      warn.push("No lambda column found, so air/fuel ratio was converted to lambda by dividing by " + STOICH + " (gasoline).");

    var dead = [], deadKeys = [];
    [["stft1", "ltft1"], ["stft2", "ltft2"]].forEach(function (pair) {
      if (!C[pair[0]] || !allZero(C[pair[0]], DEAD_TRIM_FRAMES)) return;
      pair.forEach(function (k) {
        if (k !== pair[0] && (!C[k] || !allZero(C[k], DEAD_TRIM_FRAMES))) return;
        warn.push("“" + L.head[m[k]] + "” read exactly zero in every frame, so it was not analysed as a fuel trim. See the fuel trim finding for what that can mean.");
        dead.push(L.head[m[k]]); deadKeys.push(k);
        delete C[k]; delete m[k];
      });
    });
    L.deadTrims = dead;
    L.deadTrimKeys = deadKeys;

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
      if (m.t != null && /\(\s*ms\s*\)|\bmillisec/i.test(L.head[m.t])) { scale = 0.001; tWarn = "Time column was in milliseconds and was divided by 1000."; }
      else if (span > 86400 * 3) { scale = 0.001; tWarn = "Time column looked like milliseconds and was divided by 1000."; }
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

    /* ---- operating state, using whatever channels exist ----
     * "idle" is road speed 0 when the log has road speed, otherwise a running
     * engine under 1200 rpm; "driving" is road speed over 5 km/h, otherwise over
     * 1600 rpm. Frames between are "other". Without road speed but with a
     * throttle channel, throttle position decides closed vs open (see below). */
    var st = new Array(n);
    var hasEct = !!C.ect, hasVss = !!C.vss, hasRpm = !!C.rpm;
    /* Throttle position refines the road-speed-less fallback only. "Absolute
       throttle position" does not read 0 % at idle (about 10 % on the BMW), so
       the closed-throttle level is taken from the log itself: the 10th
       percentile of the throttle channel, plus a small margin. With road speed
       present, throttle only removes free revs at standstill from idle, and only
     on EvoScan logs. */
    var tpsIdleMax = null, tpsOpenMin = null;
    if (C.tps) {
      var tv = [];
      for (var tq = 0; tq < n; tq++) if (C.tps[tq] != null && isFinite(C.tps[tq])) tv.push(C.tps[tq]);
      if (tv.length > 10) {
        tv.sort(function (p, q) { return p - q; });
        var tlo = tv[Math.floor(tv.length * 0.1)];
        tpsIdleMax = tlo + 4; tpsOpenMin = tlo + 12;
      }
    }
    for (var g = 0; g < n; g++) {
      /* a missing value is unknown, never "closed" or "cold": null compares as 0 */
      if (hasEct && C.ect[g] == null) { st[g] = "other"; continue; }
      var warmv = hasEct ? (C.ect[g] > 70) : true;
      var running = hasRpm ? C.rpm[g] > 300 : true;
      var closedThrottle = hasVss ? C.vss[g] === 0 : (hasRpm ? C.rpm[g] > 0 && C.rpm[g] < 1200 : false);
      var openThrottle = hasVss ? C.vss[g] > 5 : (hasRpm ? C.rpm[g] > 1600 : false);
      /* standing still with the throttle open is a free rev, not idle. Limited
         to EvoScan logs for now: on the OBD logs it would move existing results */
      if (hasVss && tpsIdleMax != null && C.tps[g] != null) {
        if (L.source === "evoscan") closedThrottle = closedThrottle && C.tps[g] <= tpsIdleMax;
      }
      else if (tpsIdleMax != null && C.tps[g] != null) {
        closedThrottle = hasRpm ? (C.rpm[g] > 0 && C.rpm[g] < 1500 && C.tps[g] <= tpsIdleMax) : C.tps[g] <= tpsIdleMax;
        openThrottle = C.tps[g] >= tpsOpenMin || (hasRpm && C.rpm[g] > 1600);
      }
      if (hasEct && !warmv && running) st[g] = "warmup";
      else if (warmv && running && closedThrottle) st[g] = "idle";
      else if (warmv && running && openThrottle) st[g] = "driving";
      else st[g] = "other";
    }

    L.cols = C;
    L.state = st;
    L.have = {};
    CHAN.forEach(function (ch) { if (C[ch.k]) L.have[ch.k] = true; });
    ["tt1", "tt2", "lean", "dt"].forEach(function (k3) { if (C[k3]) L.have[k3] = true; });
    L.unitWarnings = warn;
    applyProfile(L);
    return L;
  }
