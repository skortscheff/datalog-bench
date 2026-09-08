  /* ==========================================================
     ANALYSIS
     Every rule declares the channels it needs and is skipped
     when they are absent. A rule that passes still reports, so
     a healthy log says so rather than going quiet.
     ========================================================== */
  var RULESET_VERSION = "1.0.0";
  var SEV_RANK = { critical: 0, serious: 1, warning: 2, neutral: 3, good: 4 };

  function med(a) {
    var v = [], i;
    for (i = 0; i < a.length; i++) if (a[i] != null && isFinite(a[i])) v.push(a[i]);
    if (!v.length) return null;
    v.sort(function (p, q) { return p - q; });
    var m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  function pct(a, f) {
    var v = [], i;
    for (i = 0; i < a.length; i++) if (a[i] != null && isFinite(a[i])) v.push(a[i]);
    if (!v.length) return null;
    v.sort(function (p, q) { return p - q; });
    return v[Math.min(v.length - 1, Math.max(0, Math.round(f * (v.length - 1))))];
  }
  function sd(a) {
    var v = [], i;
    for (i = 0; i < a.length; i++) if (a[i] != null && isFinite(a[i])) v.push(a[i]);
    if (v.length < 2) return null;
    var mu = 0; for (i = 0; i < v.length; i++) mu += v[i];
    mu /= v.length;
    var s = 0; for (i = 0; i < v.length; i++) s += (v[i] - mu) * (v[i] - mu);
    return Math.sqrt(s / v.length);
  }
  function at(col, idx) { var o = [], i; for (i = 0; i < idx.length; i++) o.push(col[idx[i]]); return o; }
  function maxOf(col, idx) {
    var b = null, i, v;
    for (i = 0; i < idx.length; i++) { v = col[idx[i]]; if (v != null && isFinite(v) && (b == null || v > b)) b = v; }
    return b;
  }
  function n1(v, d) { return v == null ? "—" : v.toFixed(d == null ? 1 : d); }
  function sg(v, d) { return v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(d == null ? 1 : d); }

  var RULES = [
    /* ---------------- fuel trim level ---------------- */
    { id: "trim-level", need: ["tt1"],
      run: function (x) {
        var idx = x.trimFrames;
        if (idx.length < 12) return null;
        var m1 = med(at(x.C.tt1, idx)), p95 = pct(at(x.C.tt1, idx), 0.95);
        var m2 = x.have.tt2 ? med(at(x.C.tt2, idx)) : null;
        var worst = m2 == null ? m1 : Math.max(m1, m2);
        var railed = 0, i, lim = 24;
        if (x.have.stft1) for (i = 0; i < x.n; i++) {
          if ((x.C.stft1[i] != null && Math.abs(x.C.stft1[i]) >= lim) ||
              (x.C.stft2 && x.C.stft2[i] != null && Math.abs(x.C.stft2[i]) >= lim)) railed++;
        }
        var lean = worst > 0;
        var mag = Math.abs(worst);
        var sev = mag >= 20 ? "critical" : mag >= 12 ? "warning" : mag >= 8 ? "neutral" : "good";
        var ev = [["median" + (m2 == null ? "" : " B1"), sg(m1) + " %"]];
        if (m2 != null) ev.push(["median B2", sg(m2) + " %"]);
        ev.push(["p95", sg(p95) + " %"]);
        if (railed) ev.push(["frames railed", String(railed)]);

        if (sev === "good") return { sev: "good", tag: "Fuel trim",
          h: "Fuel trims sit inside the ECU's comfortable range",
          p: "Total correction (short-term plus long-term) runs a median of " + sg(m1) + " %" +
             (m2 == null ? "" : " on bank 1 and " + sg(m2) + " % on bank 2") +
             " across " + idx.length + " " + x.trimLabel + " frames, well inside the ±10 % band. Nothing here points at a metering or delivery fault.",
          ev: ev };

        var sym = "";
        if (m2 != null) {
          sym = Math.abs(m1 - m2) < 5
            ? " Both banks move together within " + n1(Math.abs(m1 - m2)) + " %, which puts the cause upstream of the intake split or in the fuel supply rather than in one bank's injectors or sensors."
            : " The two banks differ by " + n1(Math.abs(m1 - m2)) + " %, so part of this is bank-specific — see the bank balance finding.";
        }
        return { sev: sev, tag: "Fuel trim",
          h: lean ? "Engine running lean, ECU adding fuel to compensate"
                  : "Engine running rich, ECU pulling fuel to compensate",
          p: "Total correction runs a median of " + sg(m1) + " %" +
             (m2 == null ? "" : " (B1) and " + sg(m2) + " % (B2)") + " over " + idx.length + " " + x.trimLabel +
             " frames, reaching " + sg(p95) + " % at the 95th percentile." +
             (railed ? " Short-term trim hits its clip in " + railed + " frames, meaning the fast corrector has run out of authority." : "") +
             sym + (lean
               ? " Lean of this size is usually unmetered air after the mass-air sensor, an under-reporting MAF, low fuel pressure, or an exhaust leak ahead of the front sensors."
               : " Rich of this size is usually leaking injectors, high fuel pressure, or a MAF over-reporting airflow."),
          ev: ev };
      } },

    /* ---------------- bank imbalance ---------------- */
    { id: "bank-balance", need: ["tt1", "tt2"],
      run: function (x) {
        var idx = x.trimFrames;
        if (idx.length < 12) return null;
        var m1 = med(at(x.C.tt1, idx)), m2 = med(at(x.C.tt2, idx));
        var d = m1 - m2, mag = Math.abs(d);
        var sev = mag >= 12 ? "serious" : mag >= 6 ? "warning" : "good";
        var ev = [["bank 1", sg(m1) + " %"], ["bank 2", sg(m2) + " %"], ["difference", sg(d) + " %"]];
        if (sev === "good") return { sev: "good", tag: "Bank balance",
          h: "Both banks are corrected by the same amount",
          p: "Median total trim differs by only " + n1(mag) + " % between banks. Whatever else the log shows, it is not a single-bank fault: a bad injector, one leaking intake runner, or one failed sensor would separate these two numbers.",
          ev: ev };
        return { sev: sev, tag: "Bank balance",
          h: "Bank " + (d > 0 ? "1" : "2") + " is corrected " + n1(mag) + " % harder than bank " + (d > 0 ? "2" : "1"),
          p: "Median total trim is " + sg(m1) + " % on bank 1 against " + sg(m2) + " % on bank 2. A split this wide is bank-specific: look at that bank's injectors, its intake runner and gasket, its pre-catalyst oxygen sensor, and that side of the exhaust for leaks. A shared cause such as fuel pressure would move both numbers together.",
          ev: ev };
      } },

    /* ---------------- load dependence ---------------- */
    { id: "load-dep", need: ["tt1"], needState: true,
      run: function (x) {
        var idle = x.byState.idle, drive = x.byState.driving;
        if (idle.length < 10 || drive.length < 10) return null;
        var mi = med(at(x.C.tt1, idle)), md = med(at(x.C.tt1, drive));
        if (mi == null || md == null) return null;
        var d = mi - md;
        var ev = [["idle median", sg(mi) + " %"], ["driving median", sg(md) + " %"],
                  ["idle frames", String(idle.length)], ["driving frames", String(drive.length)]];
        if (Math.abs(d) < 3) return { sev: "neutral", tag: "Load dependence",
          h: "Correction is flat across load",
          p: "Trim at idle (" + sg(mi) + " %) and while driving (" + sg(md) + " %) are within " + n1(Math.abs(d)) +
             " % of each other, so the error scales with airflow rather than being additive. That points away from a fixed-size vacuum leak and toward a sensor calibration or fuel-pressure offset.",
          ev: ev };
        if (d > 0) return { sev: "warning", tag: "Load dependence",
          h: "Lean gets worse the less air the engine is moving",
          p: "Trim runs " + sg(mi) + " % at idle against " + sg(md) + " % while driving — " + n1(d) +
             " % worse at low airflow. That is the signature of a fixed leak of unmetered air: at idle it is a large fraction of total flow, under load it is diluted. Smoke-test the intake tract after the mass-air sensor, the PCV system, and every vacuum line before touching the fuel side.",
          ev: ev };
        return { sev: "warning", tag: "Load dependence",
          h: "Lean gets worse as airflow rises",
          p: "Trim runs " + sg(md) + " % while driving against " + sg(mi) + " % at idle — " + n1(-d) +
             " % worse under load. A leak would trend the other way, so this points at delivery running out of capacity: fuel pump, filter, injector flow, or a MAF that under-reports at the top of its range.",
          ev: ev };
      } },

    /* ---------------- intake air temperature ---------------- */
    { id: "iat", need: ["iat"],
      run: function (x) {
        var mx = maxOf(x.C.iat, x.all), mdn = med(x.C.iat);
        if (mx == null) return null;
        var idleMed = x.byState.idle.length > 8 ? med(at(x.C.iat, x.byState.idle)) : null;
        var ev = [["peak", n1(mx, 0) + " °C"], ["median", n1(mdn, 0) + " °C"]];
        if (idleMed != null) ev.push(["idle median", n1(idleMed, 0) + " °C"]);
        var sev = mx >= 85 ? "warning" : mx >= 70 ? "neutral" : "good";
        if (sev === "good") return { sev: "good", tag: "Intake air",
          h: "Intake air stays cool",
          p: "Intake air peaks at " + n1(mx, 0) + " °C with a median of " + n1(mdn, 0) +
             " °C — no meaningful heat soak, so the ECU is not pulling timing for charge temperature.",
          ev: ev };
        return { sev: sev, tag: "Intake air",
          h: "Intake air reaches " + n1(mx, 0) + " °C",
          p: "Intake air peaks at " + n1(mx, 0) + " °C (median " + n1(mdn, 0) + " °C" +
             (idleMed != null ? ", " + n1(idleMed, 0) + " °C while idling" : "") +
             "). Air that hot is less dense and knock-prone, so the ECU trades away timing to keep it safe. Check the airbox seal and whether the intake is drawing from behind the radiator or off the exhaust side.",
          ev: ev };
      } },

    /* ---------------- coolant ---------------- */
    { id: "ect", need: ["ect"],
      run: function (x) {
        var mx = maxOf(x.C.ect, x.all);
        if (mx == null) return null;
        var warm = [], i;
        for (i = 0; i < x.n; i++) if (x.C.ect[i] != null && x.C.ect[i] > 70) warm.push(i);
        var mdn = warm.length ? med(at(x.C.ect, warm)) : null;
        var ev = [["peak", n1(mx, 0) + " °C"]];
        if (mdn != null) ev.push(["warm median", n1(mdn, 0) + " °C"]);
        /* time to reach operating temperature */
        var tWarm = null;
        for (i = 0; i < x.n; i++) if (x.C.ect[i] != null && x.C.ect[i] >= 80) { tWarm = x.C.t[i]; break; }
        if (tWarm != null && !x.noTime) ev.push(["to 80 °C", Math.round(tWarm) + " s"]);
        var sev = mx >= 112 ? "critical" : mx >= 105 ? "warning" : "good";
        if (sev === "good") return { sev: "good", tag: "Cooling",
          h: "Coolant temperature stayed normal",
          p: "Coolant peaks at " + n1(mx, 0) + " °C" + (mdn != null ? " and holds a median of " + n1(mdn, 0) + " °C once warm" : "") +
             ". No overheat event in this log" + (tWarm != null && !x.noTime ? "; it reached 80 °C " + Math.round(tWarm) + " seconds in" : "") + ".",
          ev: ev };
        return { sev: sev, tag: "Cooling",
          h: "Coolant reached " + n1(mx, 0) + " °C",
          p: "Peak coolant temperature is " + n1(mx, 0) + " °C, above the point where most ECUs start pulling timing and enriching to protect the engine. Check the thermostat, fan operation, coolant level and radiator airflow before reading anything else in this log too literally — heat changes every other number here.",
          ev: ev };
      } },

    /* ---------------- post-catalyst oxygen sensors ---------------- */
    { id: "cat", need: ["o2b1s2"],
      run: function (x) {
        var idx = x.trimFrames.length > 20 ? x.trimFrames : x.all;
        var v = at(x.C.o2b1s2, idx), s = sd(v);
        if (s == null) return null;
        var lo = 0, hi = 0, i;
        for (i = 0; i < v.length; i++) { if (v[i] == null) continue; if (v[i] < 0.2) lo++; if (v[i] > 0.7) hi++; }
        var ev = [["B1S2 σ", n1(s, 3) + " V"], ["under 0.2 V", String(lo)], ["over 0.7 V", String(hi)]];
        var s2 = null;
        if (x.have.o2b2s2) { s2 = sd(at(x.C.o2b2s2, idx)); if (s2 != null) ev.splice(1, 0, ["B2S2 σ", n1(s2, 3) + " V"]); }
        var worst = Math.max(s, s2 == null ? 0 : s2);
        var dtm = med(x.C.dt), coarse = dtm != null && dtm > 1.5;
        if (worst < 0.09) return { sev: "good", tag: "Catalyst",
          h: "Post-catalyst sensors are steady",
          p: "The rear oxygen sensor" + (s2 != null ? "s hold" : " holds") + " a standard deviation of " + n1(s, 3) + " V" +
             (s2 != null ? " and " + n1(s2, 3) + " V" : "") + " — flat, which is what a converter that is still doing its job looks like.",
          ev: ev };
        return { sev: worst >= 0.16 ? "serious" : "neutral", tag: "Catalyst",
          h: "Post-catalyst sensor" + (s2 != null ? "s are" : " is") + " swinging",
          p: "The rear sensor" + (s2 != null ? "s run" : " runs") + " σ ≈ " + n1(worst, 2) + " V, with " + lo +
             " frames below 0.2 V and " + hi + " above 0.7 V. A healthy converter buffers the front sensor's switching into a comparatively flat rear signal, so wide swings suggest reduced conversion efficiency." +
             (coarse ? " Treat this as a hint, not a verdict: at a " + n1(dtm, 1) + " s sample interval the log aliases the real switching rate. Re-log at 1 s or faster to judge it." : ""),
          ev: ev };
      } },

    /* ---------------- charging system ---------------- */
    { id: "volt", need: ["volt", "rpm"],
      run: function (x) {
        var run = [], i;
        for (i = 0; i < x.n; i++) if (x.C.rpm[i] > 400 && x.C.volt[i] != null) run.push(i);
        if (run.length < 15) return null;
        var mdn = med(at(x.C.volt, run)), lo = pct(at(x.C.volt, run), 0.02);
        var ev = [["running median", n1(mdn, 2) + " V"], ["2nd pct", n1(lo, 2) + " V"]];
        if (mdn < 12.9) return { sev: mdn < 12.4 ? "serious" : "warning", tag: "Charging",
          h: "Charging voltage is low at " + n1(mdn, 2) + " V",
          p: "With the engine turning, module voltage holds a median of " + n1(mdn, 2) +
             " V, below the 13.5–14.5 V a healthy alternator maintains. Low system voltage also slows injector and coil response, which can distort the fuel-trim numbers above. Test the alternator output and the battery's main grounds.",
          ev: ev };
        if (mdn > 15.1) return { sev: "warning", tag: "Charging",
          h: "Charging voltage is high at " + n1(mdn, 2) + " V",
          p: "Running voltage medians " + n1(mdn, 2) + " V, above the usual regulated ceiling. Overcharging cooks batteries and stresses electronics; check the voltage regulator.",
          ev: ev };
        return { sev: "good", tag: "Charging",
          h: "Charging system looks healthy",
          p: "Module voltage medians " + n1(mdn, 2) + " V with the engine running and never drops below " + n1(lo, 2) + " V — a normal regulated range.",
          ev: ev };
      } },

    /* ---------------- log quality ---------------- */
    { id: "gaps", need: ["t"],
      run: function (x) {
        if (x.noTime) return { sev: "warning", tag: "Log quality",
          h: "No time column, so every rate in this log is unverified",
          p: "The parser found no elapsed-time or timestamp column, so the x axis counts frames rather than seconds. Everything shaped by time — sample interval, warm-up duration, the rate the rear oxygen sensors switch — cannot be judged from this file. Re-export with a time column if you need those.",
          ev: [["frames", String(x.n)]] };
        var dtm = med(x.C.dt);
        if (dtm == null || dtm <= 0) return null;
        var thr = Math.max(dtm * 3, dtm + 1), gaps = [], i;
        for (i = 1; i < x.n; i++) if (x.C.dt[i] > thr) gaps.push(i);
        var worst = 0, firstT = null;
        for (i = 0; i < gaps.length; i++) {
          if (x.C.dt[gaps[i]] > worst) worst = x.C.dt[gaps[i]];
          if (firstT == null) firstT = x.C.t[gaps[i]];
        }
        var ev = [["median interval", n1(dtm, 2) + " s"], ["gaps", String(gaps.length)]];
        if (gaps.length) ev.push(["worst", n1(worst, 1) + " s"]);
        if (!gaps.length) return { sev: "good", tag: "Log quality",
          h: "Clean capture at " + n1(dtm, 2) + " s per frame",
          p: "All " + x.n + " frames arrived on a steady " + n1(dtm, 2) +
             " s cadence with no dropouts, so nothing in this analysis is resting on interpolated or missing data.",
          ev: ev };
        var late = 0;
        for (i = 0; i < gaps.length; i++) if (x.C.t[gaps[i]] > x.C.t[x.n - 1] * 0.5) late++;
        return { sev: gaps.length > x.n * 0.05 ? "serious" : "warning", tag: "Log quality",
          h: gaps.length + " sampling gap" + (gaps.length > 1 ? "s" : "") + " in the capture",
          p: "The median interval is " + n1(dtm, 2) + " s, but " + gaps.length + " interval" + (gaps.length > 1 ? "s" : "") +
             " ran past " + n1(thr, 1) + " s, the worst at " + n1(worst, 1) + " s" +
             (firstT != null ? ", first at " + Math.round(firstT) + " s in" : "") + ". " +
             (late > gaps.length * 0.7
               ? "They cluster in the back half of the session, which usually means a connection or adapter degrading as it warms up."
               : "Usually bus congestion, too many PIDs requested at once, or a loose adapter.") +
             " Anything read across a gap — a spike, a peak, a switching rate — may be an artefact.",
          ev: ev };
      } },

    /* ---------------- driveline plausibility ---------------- */
    { id: "ratio", need: ["rpm", "vss"],
      run: function (x) {
        var rs = [], i;
        for (i = 0; i < x.n; i++) {
          if (x.C.vss[i] == null || x.C.rpm[i] == null || x.C.vss[i] < 10) continue;
          rs.push({ r: x.C.rpm[i] / x.C.vss[i], i: i });
        }
        if (rs.length < 25) return null;
        rs.sort(function (a, b) { return a.r - b.r; });
        var p50 = rs[rs.length >> 1].r;
        var odd = [];
        for (i = 0; i < rs.length; i++) if (rs[i].r > p50 * 2.4) odd.push(rs[i]);
        if (!odd.length) return { sev: "good", tag: "Driveline",
          h: "Engine and road speed stay proportionate",
          p: "Across " + rs.length + " moving frames the engine-to-road-speed ratio never departs far from its median of " + n1(p50, 0) +
             ":1, so there is no sign of clutch or converter slip in this log.",
          ev: [["median ratio", n1(p50, 0) + ":1"], ["moving frames", String(rs.length)]] };
        var w = odd[odd.length - 1];
        var dtm = med(x.C.dt);
        return { sev: "neutral", tag: "Driveline",
          h: odd.length + " frame" + (odd.length > 1 ? "s" : "") + " where engine speed outruns road speed",
          p: "The worst is frame " + (w.i + 1) + (x.noTime ? "" : " at " + Math.round(x.C.t[w.i]) + " s") + ": " +
             n1(x.C.rpm[w.i], 0) + " rpm at " + n1(x.C.vss[w.i], 0) + " km/h, a ratio of " + n1(w.r, 0) +
             ":1 against a median of " + n1(p50, 0) + ":1. That can be real slip — a flaring clutch or torque converter — but " +
             (dtm != null && dtm > 1.5
               ? "at a " + n1(dtm, 1) + " s sample interval it is equally explainable as skew, since the PIDs are not read at the same instant. Re-log at 1 s or faster to tell the two apart."
               : "check whether it lines up with a gearshift before reading it as a fault."),
          ev: [["worst ratio", n1(w.r, 0) + ":1"], ["median", n1(p50, 0) + ":1"], ["frames", String(odd.length)]] };
      } },

    /* ---------------- channel coverage ---------------- */
    { id: "coverage", need: [],
      run: function (x) {
        var want = [["rpm", "engine speed"], ["vss", "vehicle speed"], ["ect", "coolant temperature"],
                    ["iat", "intake air temperature"], ["maf", "mass air flow"], ["stft1", "short-term fuel trim"],
                    ["ltft1", "long-term fuel trim"], ["o2b1s2", "post-catalyst oxygen"], ["volt", "module voltage"]];
        var miss = [];
        for (var i = 0; i < want.length; i++) if (!x.have[want[i][0]]) miss.push(want[i][1]);
        if (!miss.length) return null;
        return { sev: "neutral", tag: "Coverage",
          h: miss.length + " diagnostic channel" + (miss.length > 1 ? "s" : "") + " missing from this log",
          p: "This file has no " + miss.slice(0, 4).join(", ") + (miss.length > 4 ? " and " + (miss.length - 4) + " more" : "") +
             ", so the checks that depend on them were skipped rather than guessed at. Add those PIDs to your logger's list and the corresponding findings will appear. If a channel is present under a name the parser did not recognise, map it by hand in the Channels panel above.",
          ev: [["mapped", String(Object.keys(x.have).length)], ["columns", String(x.L.head.length)]] };
      } }
  ];

  function analyze(L) {
    var C = L.cols, n = L.n, i;
    var all = []; for (i = 0; i < n; i++) all.push(i);
    var byState = { idle: [], driving: [], warmup: [], other: [] };
    for (i = 0; i < n; i++) byState[L.state[i]].push(i);

    /* frames the trim numbers are read over: warm and in closed loop when the
       log says so, warm alone otherwise, everything as a last resort */
    var warm = [];
    for (i = 0; i < n; i++) if (!C.ect || C.ect[i] > 70) warm.push(i);
    var trimFrames = warm, trimLabel = C.ect ? "warm" : "logged";
    if (L.closedLoop) {
      var set = {}, j;
      for (j = 0; j < L.closedLoop.length; j++) set[L.closedLoop[j]] = 1;
      var cl = [];
      for (j = 0; j < warm.length; j++) if (set[warm[j]]) cl.push(warm[j]);
      if (cl.length > 12) { trimFrames = cl; trimLabel = C.ect ? "warm closed-loop" : "closed-loop"; }
    }
    if (trimFrames.length < 12) { trimFrames = all; trimLabel = "logged"; }

    var ctx = { L: L, C: C, n: n, all: all, byState: byState, have: L.have,
                trimFrames: trimFrames, trimLabel: trimLabel, noTime: L.noTime };

    var out = [];
    RULES.forEach(function (rule) {
      for (var k = 0; k < rule.need.length; k++) if (!L.have[rule.need[k]]) return;
      var f;
      try { f = rule.run(ctx); } catch (e) { f = null; }
      if (f) { f.id = rule.id; out.push(f); }
    });
    out.sort(function (a, b) { return SEV_RANK[a.sev] - SEV_RANK[b.sev]; });
    L.findings = out;
    L.ctx = ctx;
    L.rulesetVersion = RULESET_VERSION;
    return out;
  }
