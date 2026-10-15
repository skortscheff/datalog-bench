  /* ==========================================================
     ANALYSIS
     Every rule declares the channels it needs and is skipped
     when they are absent. A rule that passes still reports, so
     a healthy log says so rather than going quiet.
     ========================================================== */
  var RULESET_VERSION = "1.1.0";
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
  function corr(a, b) {
    var xs = [], ys = [], i;
    for (i = 0; i < a.length && i < b.length; i++) if (a[i] != null && b[i] != null && isFinite(a[i]) && isFinite(b[i])) { xs.push(a[i]); ys.push(b[i]); }
    if (xs.length < 5) return null;
    var mx = 0, my = 0; for (i = 0; i < xs.length; i++) { mx += xs[i]; my += ys[i]; }
    mx /= xs.length; my /= ys.length;
    var cov = 0, sx = 0, sy = 0;
    for (i = 0; i < xs.length; i++) { var dx = xs[i] - mx, dy = ys[i] - my; cov += dx * dy; sx += dx * dx; sy += dy * dy; }
    return (sx && sy) ? cov / Math.sqrt(sx * sy) : null;
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
            : " The two banks differ by " + n1(Math.abs(m1 - m2)) + " %, so part of this is bank-specific — see the bank balance check.";
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
        if (d > 0) {
          var idleIat = x.have.iat && idle.length > 8 ? med(at(x.C.iat, idle)) : null;
          var iatTrimR = x.have.iat ? corr(at(x.C.iat, idle), at(x.C.tt1, idle)) : null;
          var heatSoak = idleIat != null && idleIat >= 55 && iatTrimR != null && iatTrimR >= 0.3;
          if (heatSoak) {
            ev = ev.concat([["idle IAT median", n1(idleIat, 0) + " °C"], ["IAT-vs-trim r", n1(iatTrimR, 2)]]);
            return { sev: "neutral", tag: "Load dependence",
              h: "Lean at idle tracks intake air heat, not just load",
              p: "Trim runs " + sg(mi) + " % at idle against " + sg(md) + " % while driving — " + n1(d) +
                 " % worse at low airflow, which usually reads as a fixed unmetered-air leak. But idle intake air here runs hot (median " +
                 n1(idleIat, 0) + " °C) and trim rises with it within the idle frames themselves (r=" + n1(iatTrimR, 2) +
                 "), so heat soak is at least as likely a cause as a leak: hot, less-dense air read at idle can look like a metering shortfall without any leak at all. Check whether this trend holds at lower idle IAT (e.g. right after startup) before smoke-testing the intake.",
              ev: ev };
          }
          return { sev: "warning", tag: "Load dependence",
            h: "Lean gets worse the less air the engine is moving",
            p: "Trim runs " + sg(mi) + " % at idle against " + sg(md) + " % while driving — " + n1(d) +
               " % worse at low airflow. A fixed leak of unmetered air produces this pattern, because it is a large share of total flow at idle and is diluted under load. A temperature-dependent intake-air or airflow reading can produce it too, so check trim against intake air temperature (see the Compare table) before smoke-testing the intake tract.",
            ev: ev };
        }
        var idleIat2 = x.have.iat && idle.length > 8 ? med(at(x.C.iat, idle)) : null;
        var iatTrimR2 = x.have.iat ? corr(at(x.C.iat, idle), at(x.C.tt1, idle)) : null;
        var heatSoak2 = idleIat2 != null && idleIat2 >= 55 && iatTrimR2 != null && iatTrimR2 >= 0.3;
        if (heatSoak2) {
          ev = ev.concat([["idle IAT median", n1(idleIat2, 0) + " °C"], ["IAT-vs-trim r", n1(iatTrimR2, 2)]]);
          return { sev: "neutral", tag: "Load dependence",
            h: "Rich at idle tracks intake air heat, not a load-capacity problem",
            p: "Trim runs " + sg(mi) + " % at idle against " + sg(md) + " % while driving — " + n1(-d) +
               " % richer at low airflow, which can look like injector leakage or fuel pressure running high. But idle intake air here runs hot (median " +
               n1(idleIat2, 0) + " °C) and trim rises toward zero with it within the idle frames themselves (r=" + n1(iatTrimR2, 2) +
               "), the same heat-soak signature seen on lean-idle logs, just starting from a rich baseline. That's consistent with a transient (cold start, EVAP purge) decaying over the drive rather than a fixed delivery fault — check whether this eases within the first 20-30 minutes and is gone on a later same-day drive before chasing injectors or fuel pressure.",
            ev: ev };
        }
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
        var sev = mx >= x.P.iatWarn ? "warning" : mx >= x.P.iatNeutral ? "neutral" : "good";
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
        /* general-purpose limits taken from the engine profile, not sourced from
           manufacturer documentation: a healthy M54 runs well above 100 °C under
           load, so the old 105 °C line was too low */
        var sev = mx >= x.P.ectCrit ? "critical" : mx >= x.P.ectWarn ? "warning" : "good";
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

    /* ---------------- log quality ---------------- */
    { id: "gaps", need: ["t"],
      run: function (x) {
        if (x.noTime) return { sev: "warning", tag: "Log quality",
          h: "No time column, so every rate in this log is unverified",
          p: "The parser found no elapsed-time or timestamp column, so the x axis counts frames rather than seconds. Everything shaped by time — sample interval, warm-up duration, how quickly a trim recovers — cannot be judged from this file. Re-export with a time column if you need those.",
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

    /* ---------------- worst rich excursion ---------------- */
    { id: "rich-excursion", need: ["tt1"],
      run: function (x) {
        var idx = x.trimFrames;
        if (idx.length < 12) return null;
        function bankMin(i) {
          var v1 = x.C.tt1[i], v2 = x.have.tt2 ? x.C.tt2[i] : null;
          if (v1 == null && v2 == null) return null;
          if (v1 == null) return v2;
          if (v2 == null) return v1;
          return Math.min(v1, v2);
        }
        var worstVal = null, worstPos = -1, k, v;
        for (k = 0; k < idx.length; k++) {
          v = bankMin(idx[k]);
          if (v != null && isFinite(v) && (worstVal == null || v < worstVal)) { worstVal = v; worstPos = k; }
        }
        if (worstVal == null || worstVal > -8) return { sev: "good", tag: "Fuel trim",
          h: "No rich excursion of note",
          p: "The most negative moment across " + idx.length + " " + x.trimLabel + " frames is " + sg(worstVal, 1) +
             " %, not worth flagging on its own.",
          ev: [["worst", sg(worstVal, 1) + " %"]] };

        /* how long the correction stayed at least half this deep, as a rough
           excursion window rather than a single noisy frame */
        var thr = Math.min(-8, worstVal / 2), lo = worstPos, hi = worstPos, vv;
        while (lo > 0) { vv = bankMin(idx[lo - 1]); if (vv != null && vv <= thr) lo--; else break; }
        while (hi < idx.length - 1) { vv = bankMin(idx[hi + 1]); if (vv != null && vv <= thr) hi++; else break; }
        var peakI = idx[worstPos], startI = idx[lo], endI = idx[hi];
        var dur = (!x.noTime) ? (x.C.t[endI] - x.C.t[startI]) : null;

        var ev = [["worst", sg(worstVal, 1) + " %"], ["frames in excursion", String(hi - lo + 1)]];
        if (dur != null) ev.push(["duration", n1(Math.max(dur, 0), 0) + " s"]);
        if (!x.noTime) ev.push(["at", Math.round(x.C.t[peakI]) + " s"]);
        if (x.have.rpm) ev.push(["rpm then", n1(x.C.rpm[peakI], 0)]);
        if (x.have.iat) ev.push(["IAT then", n1(x.C.iat[peakI], 0) + " °C"]);

        /* capped at "warning", never "critical" — this is a single worst-moment
           snapshot, not a session verdict, and the narrative below explicitly
           says so; a "critical" severity here would contradict that. */
        var mag = Math.abs(worstVal);
        var sev = mag >= 20 ? "warning" : "neutral";
        return { sev: sev, tag: "Fuel trim",
          h: "Worst rich excursion: " + sg(worstVal, 1) + " %" + (dur != null && dur >= 5 ? ", sustained " + n1(dur, 0) + " s" : ""),
          p: "The deepest rich correction in this log is " + sg(worstVal, 1) + " %" +
             (!x.noTime ? ", at " + Math.round(x.C.t[peakI]) + " s in" : "") +
             (x.have.rpm ? " (" + n1(x.C.rpm[peakI], 0) + " rpm)" : "") +
             (dur != null && dur >= 5 ? ". Trim stayed at least half this deep for " + n1(dur, 0) + " s (" + (hi - lo + 1) + " frames) around that point" : "") +
             ". A single deep frame like this is usually a transient — an acceleration enrichment spike, a decel-fuel-cutoff re-entry, a cold-start or EVAP-purge event settling out — rather than a fixed fault; the trim-level and load-dependence checks are the ones to trust for a sustained problem.",
          ev: ev };
      } },

    /* ======================================================
       Rules below carry `extra: true`: they run only when the
       active engine profile enables them (the L59 profile). They
       are written against standard OBD-II PIDs, so each one says
       what it can and cannot conclude.
       ====================================================== */

    /* ---------------- throttle ---------------- */
    { id: "throttle", need: ["tps"], extra: true,
      run: function (x) {
        var v = [], i;
        for (i = 0; i < x.n; i++) if (x.C.tps[i] != null && isFinite(x.C.tps[i])) v.push(x.C.tps[i]);
        if (v.length < 12) return null;
        var lo = pct(v, 0.05), pk = pct(v, 1), wot = 0;
        for (i = 0; i < v.length; i++) if (v[i] >= 85) wot++;
        var wotShare = wot / v.length * 100;
        var ev = [["closed-throttle level", n1(lo, 1) + " %"], ["peak", n1(pk, 1) + " %"],
                  ["frames at 85 % or more", String(wot)]];
        var rv = x.have.rpm ? at(x.C.rpm, x.all).filter(function (q) { return q != null; }) : [];
        var rpmSpan = rv.length ? pct(rv, 1) - pct(rv, 0.05) : 0;
        if (pk - lo < 2 && rpmSpan > 800) return { sev: "warning", tag: "Throttle",
          h: "Throttle position does not move while engine speed does",
          p: "Throttle position stays within " + n1(pk - lo, 1) + " % for the whole log while engine speed spans about " + n1(rpmSpan, 0) +
             " rpm. A throttle sensor or its PID that is stuck, or a column that is not what its name says, would look like this. Every check that relies on throttle position was weakened by it.",
          ev: ev };
        var r = (x.have.load && pk - lo > 20) ? corr(x.C.tps, x.C.load) : null;
        if (r != null) ev.push(["throttle vs load r", n1(r, 2)]);
        if (r != null && r < 0.3) return { sev: "warning", tag: "Throttle",
          h: "Throttle position and calculated load do not track each other",
          p: "Across this log throttle position moves " + n1(pk - lo, 0) + " % but its correlation with calculated load is only r=" + n1(r, 2) +
             ". On a drive-by-wire engine the two normally rise together. Look at the throttle position sensor, the electronic throttle body, or whether the logger is reading throttle and load at very different times.",
          ev: ev };
        return { sev: "good", tag: "Throttle",
          h: "Throttle position moves with the driver",
          p: "Throttle sits at about " + n1(lo, 1) + " % closed (absolute throttle position does not read 0 % at idle) and reaches " + n1(pk, 1) + " %" +
             (wot ? ", with " + wot + " frame" + (wot > 1 ? "s" : "") + " (" + n1(wotShare, 1) + " %) at or above 85 %" : "") +
             (r != null ? ". It tracks calculated load (r=" + n1(r, 2) + ")" : "") + ".",
          ev: ev };
      } },

    /* ---------------- idle manifold pressure ---------------- */
    { id: "map-idle", need: ["map"], extra: true,
      run: function (x) {
        var idle = x.byState.idle;
        if (idle.length < 10) return null;
        var vals = at(x.C.map, idle), m = med(vals), p95 = pct(vals, 0.95);
        if (m == null) return null;
        var lim = x.P.idleMapHigh;
        var ev = [["idle median", n1(m, 0) + " kPa"], ["idle p95", n1(p95, 0) + " kPa"], ["idle frames", String(idle.length)]];
        if (x.have.rpm) ev.push(["idle rpm", n1(med(at(x.C.rpm, idle)), 0)]);
        if (m > lim) return { sev: m > lim + 12 ? "serious" : "warning", tag: "Manifold pressure",
          h: "Idle manifold vacuum is weak (" + n1(m, 0) + " kPa absolute)",
          p: "At warm idle the manifold sits at a median of " + n1(m, 0) + " kPa absolute, above the " + lim +
             " kPa this profile treats as a healthy upper bound (a healthy V8 idles with strong vacuum, around 30-45 kPa absolute at sea level; altitude raises every reading). Weak idle vacuum points at a vacuum or intake leak, a leaking brake booster or PCV line, valve or cam timing problems, or an engine idling above its design speed.",
          ev: ev };
        return { sev: "good", tag: "Manifold pressure",
          h: "Idle manifold vacuum looks healthy",
          p: "Warm idle holds a median of " + n1(m, 0) + " kPa absolute (p95 " + n1(p95, 0) + " kPa), at or below the " + lim +
             " kPa limit, so there is no sign of a large intake leak. Altitude raises these numbers, so compare at your own baseline.",
          ev: ev };
      } },

    /* ---------------- airflow vs manifold pressure ---------------- */
    { id: "map-airflow", need: ["map", "maf", "rpm"], extra: true,
      run: function (x) {
        var a = [], b = [], i;
        for (i = 0; i < x.n; i++) {
          var mp = x.C.map[i], mf = x.C.maf[i], rp = x.C.rpm[i];
          if (mp == null || mf == null || rp == null || rp < 500) continue;
          a.push(mf); b.push(mp * rp / 1000);
        }
        if (a.length < 40) return null;
        var r = corr(a, b);
        if (r == null) return null;
        var ev = [["MAF vs MAP×rpm r", n1(r, 2)], ["frames", String(a.length)]];
        if (r < 0.6) return { sev: "warning", tag: "Airflow",
          h: "Measured airflow does not follow manifold pressure and engine speed",
          p: "On a speed-density basis, air mass flow should scale with manifold pressure times engine speed. Here the two correlate at only r=" + n1(r, 2) +
             " over " + a.length + " running frames. A contaminated or failing MAF, a MAP sensor that is off, or a leak between the MAF and the throttle (unmetered air that MAP sees but the MAF does not) would each break the relationship. Check the MAF element, the air filter and intake duct, then the MAP reading at key-on, engine off (should be near barometric).",
          ev: ev };
        return { sev: r < 0.85 ? "neutral" : "good", tag: "Airflow",
          h: r < 0.85 ? "Airflow follows manifold pressure loosely" : "Airflow and manifold pressure agree",
          p: "Mass airflow correlates with manifold pressure times engine speed at r=" + n1(r, 2) + " over " + a.length +
             " running frames" + (r < 0.85 ? ", acceptable but looser than a clean log usually shows; slow channel refresh and transients lower it" : ", as expected when both sensors are healthy") + ".",
          ev: ev };
      } },

    /* ---------------- oxygen sensor activity ---------------- */
    { id: "o2-switching", need: ["o2b1s1"], extra: true,
      run: function (x) {
        var banks = [["B1", "o2b1s1"]];
        if (x.have.o2b2s1) banks.push(["B2", "o2b2s1"]);
        var frames = [], i;
        for (i = 0; i < x.n; i++) {
          if (x.C.rpm && (x.C.rpm[i] == null || x.C.rpm[i] < 500)) continue;
          if (x.C.ect && (x.C.ect[i] == null || x.C.ect[i] <= 70)) continue;
          if (x.have.fuelsys && x.C.fuelsys[i] != null) { var fs = Math.round(x.C.fuelsys[i]); if (!((fs & 2) || (fs & 16))) continue; }
          frames.push(i);
        }
        if (frames.length < 20) return null;
        var res = [], bad = [], ev = [];
        banks.forEach(function (bk) {
          var col = x.C[bk[1]], v = at(col, frames).filter(function (q) { return q != null; });
          if (v.length < 20) return;
          var lo = pct(v, 0.05), hi = pct(v, 0.95), m = med(v), mean = 0;
          for (var vi = 0; vi < v.length; vi++) mean += v[vi];
          mean /= v.length;
          /* crossings of the 0.45 V midline, with hysteresis, over runs of consecutive frames only */
          var side = null, cross = 0, secs = 0, prev = -2;
          for (var q = 0; q < frames.length; q++) {
            var ix = frames[q], val = col[ix];
            if (val == null) { prev = -2; continue; }
            if (prev === ix - 1 && !x.noTime) secs += x.C.t[ix] - x.C.t[prev];
            var s2 = val > 0.55 ? 1 : val < 0.35 ? -1 : side;
            if (side != null && s2 !== side) cross++;
            side = s2; prev = ix;
          }
          var rate = (!x.noTime && secs > 5) ? cross / secs * 60 : null;
          var st = (hi - lo) >= 0.3 ? "ok" : m < 0.2 ? "stuck low (lean)" : m > 0.7 ? "stuck high (rich)" : "lazy";
          res.push({ b: bk[0], lo: lo, hi: hi, m: m, mean: mean, rate: rate, st: st, n: v.length });
          ev.push([bk[0] + " range", n1(lo, 2) + "–" + n1(hi, 2) + " V"]);
          if (rate != null) ev.push([bk[0] + " crossings", n1(rate, 0) + " /min"]);
          if (st !== "ok") bad.push(bk[0] + " " + st);
        });
        if (!res.length) return null;
        var imb = null;
        /* means, not medians: the median of a signal that flips between two levels jumps between them */
        if (res.length === 2) { imb = Math.abs(res[0].mean - res[1].mean); ev.push(["bank mean gap", n1(imb, 2) + " V"]); }
        if (bad.length) return { sev: bad.length > 1 ? "serious" : "warning", tag: "Oxygen sensors",
          h: "Front oxygen sensor not switching: " + bad.join(", "),
          p: "A healthy narrow-band sensor swings between roughly 0.1 V and 0.9 V as the ECU trims fuel. Over " + frames.length +
             " warm, running, closed-loop frames " + bad.join(" and ") + " " + (bad.length > 1 ? "stay" : "stays") +
             " in a narrow band, so the ECU is correcting against a sensor that is not reporting. A stuck-low reading usually means a lean exhaust or an unplugged/old sensor, stuck-high a rich exhaust, and a small swing about the middle a lazy, contaminated sensor. Fuel trim from that bank should not be trusted until the sensor is ruled out.",
          ev: ev };
        if (imb != null && imb > 0.15) return { sev: "neutral", tag: "Oxygen sensors",
          h: "Front oxygen sensors sit at different average voltages",
          p: "Both front sensors switch, but their average voltages differ by " + n1(imb, 2) + " V (" + n1(res[0].mean, 2) + " V on bank 1, " + n1(res[1].mean, 2) +
             " V on bank 2). That fits the banks running at different mixtures; compare with the bank balance check.",
          ev: ev };
        return { sev: "good", tag: "Oxygen sensors",
          h: "Front oxygen sensors are switching",
          p: "Over " + frames.length + " warm, running, closed-loop frames each front sensor swings across its range" +
             (res[0].rate != null ? ", about " + n1(res[0].rate, 0) + " crossings a minute on bank 1" : "") +
             ". Crossing counts depend on how fast the logger samples, so treat them as a floor.",
          ev: ev };
      } },

    /* ---------------- closed loop ---------------- */
    { id: "closed-loop", need: ["fuelsys"], extra: true,
      run: function (x) {
        var closed = 0, loadOpen = 0, badOpen = 0, tot = 0, i;
        for (i = 0; i < x.n; i++) {
          if (x.C.fuelsys[i] == null) continue;
          if (x.C.ect && (x.C.ect[i] == null || x.C.ect[i] <= 70)) continue;
          if (x.C.rpm && (x.C.rpm[i] == null || x.C.rpm[i] < 500)) continue;
          var v = Math.round(x.C.fuelsys[i]); tot++;
          if ((v & 2) || (v & 16)) closed++;
          else if (v & 4) loadOpen++;
          else badOpen++;      /* 1 = open for low temperature, 8 = open for a fault */
        }
        if (tot < 20) return null;
        var pc = function (q) { return q / tot * 100; };
        var ev = [["closed loop", n1(pc(closed), 0) + " %"], ["open (load / decel)", n1(pc(loadOpen), 0) + " %"],
                  ["open (cold / fault)", n1(pc(badOpen), 0) + " %"], ["warm frames", String(tot)]];
        if (pc(badOpen) >= 25) return { sev: pc(badOpen) >= 50 ? "serious" : "warning", tag: "Closed loop",
          h: "ECU stays in open loop while warm (" + n1(pc(badOpen), 0) + " % of warm frames)",
          p: "Once the engine is warm the ECU should run closed loop, using the oxygen sensors. In " + n1(pc(badOpen), 0) +
             " % of warm running frames fuel system status says open loop for temperature or for a fault (status 1 or 8). Typical causes are a slow or dead front oxygen sensor, a thermostat that keeps the engine below the closed-loop threshold, or a stored sensor fault. Fuel trims are not being corrected live during those frames.",
          ev: ev };
        return { sev: "good", tag: "Closed loop",
          h: "ECU runs closed loop when warm",
          p: "Of " + tot + " warm running frames, " + n1(pc(closed), 0) + " % are closed loop and " + n1(pc(loadOpen), 0) +
             " % are open loop for load or deceleration, which is normal. Only " + n1(pc(badOpen), 0) + " % are open for temperature or a fault.",
          ev: ev };
      } },

    /* ---------------- knock retard (real PID) ---------------- */
    { id: "knock", need: ["knock"], extra: true,
      run: function (x) {
        var ev0 = [], cur = null, i, worst = 0, worstI = -1;
        for (i = 0; i < x.n; i++) {
          var k = x.C.knock[i];
          if (k != null && k > 0.5) {
            if (cur == null) { cur = { start: i, peak: k, pi: i }; ev0.push(cur); }
            if (k > cur.peak) { cur.peak = k; cur.pi = i; }
            if (k > worst) { worst = k; worstI = i; }
          } else cur = null;
        }
        var ev = [["knock events", String(ev0.length)], ["worst retard", n1(worst, 1) + " °"]];
        if (worstI >= 0) {
          if (x.have.rpm) ev.push(["rpm at worst", n1(x.C.rpm[worstI], 0)]);
          if (x.have.load) ev.push(["load at worst", n1(x.C.load[worstI], 0) + " %"]);
          if (x.have.map) ev.push(["MAP at worst", n1(x.C.map[worstI], 0) + " kPa"]);
        }
        if (!ev0.length) return { sev: "good", tag: "Knock",
          h: "No knock retard recorded",
          p: "The knock retard channel stays at zero across all " + x.n + " frames, so the ECU did not pull timing for knock in this log.",
          ev: ev };
        var sev = worst >= 8 ? "serious" : (worst >= 4 || ev0.length >= 10) ? "warning" : "neutral";
        return { sev: sev, tag: "Knock",
          h: ev0.length + " knock event" + (ev0.length > 1 ? "s" : "") + ", worst " + n1(worst, 1) + " ° of retard",
          p: "The ECU pulled up to " + n1(worst, 1) + " ° of timing in " + ev0.length + " event" + (ev0.length > 1 ? "s" : "") +
             (worstI >= 0 && !x.noTime ? ", the worst at " + Math.round(x.C.t[worstI]) + " s" : "") + (worstI >= 0 && x.have.rpm ? " (" + n1(x.C.rpm[worstI], 0) + " rpm)" : "") +
             ". Occasional single-degree events are normal. Repeated or deep retard points at low-octane fuel, heat soak, carbon deposits, a lean condition, or a failing knock sensor — check intake temperature and fuel trim in the same frames.",
          ev: ev };
      } },

    /* ---------------- knock, inferred from timing ---------------- */
    { id: "knock-inferred", need: ["spark", "rpm"], extra: true,
      run: function (x) {
        if (x.have.knock) return null;
        var steady = x.have.load ? x.C.load : (x.have.tps ? x.C.tps : null);
        if (!steady || x.n < 60) return null;
        var hits = [], i;
        for (i = 1; i < x.n; i++) {
          var s0 = x.C.spark[i - 1], s1 = x.C.spark[i], r0 = x.C.rpm[i - 1], r1 = x.C.rpm[i], a0 = steady[i - 1], a1 = steady[i];
          if (s0 == null || s1 == null || r0 == null || r1 == null || a0 == null || a1 == null) continue;
          if (r1 < 1200) continue;
          if (Math.abs(r1 - r0) < 150 && Math.abs(a1 - a0) < 6 && s0 - s1 >= 5) hits.push(i);
        }
        var ev = [["sudden timing drops", String(hits.length)]];
        if (!hits.length) return { sev: "good", tag: "Knock (inferred)",
          h: "No sudden timing pulls at steady speed and load",
          p: "This log has no knock retard channel, so knock is inferred from timing advance: a drop of 5° or more in a single frame while engine speed and " +
             (x.have.load ? "load" : "throttle") + " barely changed. None were found. That is weaker evidence than a real knock channel, since small retards fall below what this check sees.",
          ev: ev };
        return { sev: hits.length >= 8 ? "warning" : "neutral", tag: "Knock (inferred)",
          h: hits.length + " sudden timing pull" + (hits.length > 1 ? "s" : "") + " at steady speed and load (inferred)",
          p: "There is no knock retard channel in this log, so this is inferred from timing advance: " + hits.length +
             " frame" + (hits.length > 1 ? "s" : "") + " where advance fell by 5° or more while engine speed and " + (x.have.load ? "load" : "throttle") +
             " barely moved. Knock retard looks exactly like this, but so do torque management and shift events, so treat it as a lead. Add a GM knock retard PID to your logger to confirm.",
          ev: ev };
      } },

    /* ---------------- channel coverage ---------------- */
    { id: "coverage", need: [],
      run: function (x) {
        var want = [["rpm", "engine speed"], ["vss", "vehicle speed"], ["ect", "coolant temperature"],
                    ["iat", "intake air temperature"], ["maf", "mass air flow"], ["stft1", "short-term fuel trim"],
                    ["ltft1", "long-term fuel trim"]];
        want = want.concat(x.P.extraWant || []);
        var miss = [];
        for (var i = 0; i < want.length; i++) if (!x.have[want[i][0]]) miss.push(want[i][1]);
        if (!miss.length) return null;
        return { sev: "neutral", tag: "Coverage",
          h: miss.length + " diagnostic channel" + (miss.length > 1 ? "s" : "") + " missing from this log",
          p: "This file has no " + miss.slice(0, 4).join(", ") + (miss.length > 4 ? " and " + (miss.length - 4) + " more" : "") +
             ", so the checks that depend on them were skipped rather than guessed at. Add those PIDs to your logger's list and the corresponding checks will run. If a channel is present under a name the parser did not recognise, map it by hand in the Channels panel above.",
          ev: [["mapped", String(Object.keys(x.have).length)], ["columns", String(x.L.head.length)]] };
      } }
  ];

  /* ---------------- per-session metrics (shown in Compare) ---------------- */

  /* least-squares slope of ys on xs, with Pearson r; null under 5 usable pairs */
  function fit(xs, ys) {
    var px = [], py = [], i;
    for (i = 0; i < xs.length; i++) if (xs[i] != null && ys[i] != null && isFinite(xs[i]) && isFinite(ys[i])) { px.push(xs[i]); py.push(ys[i]); }
    if (px.length < 5) return null;
    var mx = 0, my = 0; for (i = 0; i < px.length; i++) { mx += px[i]; my += py[i]; }
    mx /= px.length; my /= py.length;
    var cov = 0, sx = 0, sy = 0;
    for (i = 0; i < px.length; i++) { var dx = px[i] - mx, dy = py[i] - my; cov += dx * dy; sx += dx * dx; sy += dy * dy; }
    return sx ? { slope: cov / sx, r: sy ? cov / Math.sqrt(sx * sy) : null, n: px.length } : null;
  }

  /* most common length of a run of identical consecutive values */
  function modalRun(col) {
    var counts = {}, run = 0, prev, i, v, best = null, bestN = 0, k;
    for (i = 0; i <= col.length; i++) {
      v = i < col.length ? col[i] : undefined;
      if (i < col.length && v != null && v === prev) { run++; continue; }
      if (run > 0) counts[run] = (counts[run] || 0) + 1;
      run = v == null ? 0 : 1; prev = v;
    }
    for (k in counts) if (counts[k] > bestN) { bestN = counts[k]; best = +k; }
    return best;
  }

  /* engine-speed stability over a set of frame indexes. A dip is a stretch of
     frames under RPM_DIP_BELOW that begins after the engine was first seen
     running; a stall is a dip that reaches RPM_STALL_BELOW. Cranking at the start
     and the key-off tail (a dip that runs to the last frame of the log) are not
     counted. Channels refresh slowly, so a dip shorter than one refresh can be
     missed: these are minimum counts. */
  function rpmStability(L, idx) {
    var P = profileOf(L), RPM_RAN_ABOVE = P.rpmRanAbove, RPM_DIP_BELOW = P.rpmDipBelow, RPM_STALL_BELOW = P.rpmStallBelow;
    var rpm = L.cols.rpm, last = L.n - 1, first = -1, i;
    for (i = 0; i <= last; i++) if (rpm[i] != null && rpm[i] >= RPM_RAN_ABOVE) { first = i; break; }
    var dips = 0, stalls = 0, lowest = null, cur = null, k, v;
    function close(endsLog) {
      if (cur == null) return;
      if (!endsLog) { dips++; if (cur < RPM_STALL_BELOW) stalls++; if (lowest == null || cur < lowest) lowest = cur; }
      cur = null;
    }
    for (k = 0; k < idx.length; k++) {
      i = idx[k]; v = rpm[i];
      if (v == null || first < 0 || i < first) continue;
      if (v < RPM_DIP_BELOW) cur = cur == null ? v : Math.min(cur, v);
      else close(false);
    }
    close(idx.length > 0 && idx[idx.length - 1] === last);
    return { dips: dips, stalls: stalls, lowest: lowest };
  }

  var IAT_SLOPE_MIN_FRAMES = 30, IAT_SLOPE_MIN_RANGE = 8;

  function computeMetrics(L, ctx, skipped) {
    var C = L.cols, i;

    /* total trim against intake air temperature across warm idle frames. A
       cold-rich/hot-lean slope here is the temperature dependence documented
       for this car; the fit says nothing about which part causes it. */
    var iatSlope = null, iatReason = null;
    if (!L.have.iat || !L.have.tt1) iatReason = "needs intake air temperature and fuel trim";
    else {
      var idle = ctx.byState.idle.filter(function (j) { return !L.have.ect || C.ect[j] > 70; });
      var xs = [], ys = [];
      for (i = 0; i < idle.length; i++) {
        var a = C.tt1[idle[i]], b = L.have.tt2 ? C.tt2[idle[i]] : a;
        if (a == null || b == null) continue;
        xs.push(C.iat[idle[i]]); ys.push((a + b) / 2);
      }
      var lo = Infinity, hi = -Infinity;
      for (i = 0; i < xs.length; i++) if (xs[i] != null) { if (xs[i] < lo) lo = xs[i]; if (xs[i] > hi) hi = xs[i]; }
      if (xs.length < IAT_SLOPE_MIN_FRAMES) iatReason = "under " + IAT_SLOPE_MIN_FRAMES + " warm idle frames";
      else if (hi - lo < IAT_SLOPE_MIN_RANGE) iatReason = "intake air varied under " + IAT_SLOPE_MIN_RANGE + " °C at idle";
      else {
        var f = fit(xs, ys);
        if (f) iatSlope = { slope: f.slope, r: f.r, n: f.n, iatLo: lo, iatHi: hi };
        else iatReason = "no usable idle frames";
      }
    }

    /* logging cadence: row spacing, and how many rows a value typically repeats
       for — tells a faster adapter from a slower one, which row timing alone does not */
    var runs = [];
    ["rpm", "maf", "stft1"].forEach(function (k) { if (L.have[k]) { var m = modalRun(C[k]); if (m != null) runs.push(m); } });
    var cadence = {
      dt: L.noTime ? null : med(C.dt || []),
      repeatRun: runs.length ? med(runs) : null
    };

    /* idle speed and stalls, over warm idle frames and the whole log respectively */
    var rpmInfo = null;
    if (L.have.rpm) {
      var idleR = ctx.byState.idle.filter(function (j) { return !L.have.ect || C.ect[j] > 70; });
      var rv = []; for (i = 0; i < idleR.length; i++) if (C.rpm[idleR[i]] != null) rv.push(C.rpm[idleR[i]]);
      var st = rpmStability(L, ctx.all);
      rpmInfo = { idleMedian: med(rv), idleSd: rv.length > 1 ? sd(rv) : null, idleN: rv.length,
                  dips: st.dips, stalls: st.stalls, lowest: st.lowest };
    }

    var converted = (L.unitWarnings || []).some(function (w) { return /has been converted/.test(w); });
    return { iatSlope: iatSlope, iatSlopeReason: iatReason, cadence: cadence, rpmInfo: rpmInfo,
             unitsConverted: converted, skippedRules: skipped };
  }

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
    if (trimFrames.length < 12) { trimFrames = all; trimLabel = "logged"; }

    var ctx = { L: L, C: C, n: n, all: all, byState: byState, have: L.have, P: profileOf(L),
                trimFrames: trimFrames, trimLabel: trimLabel, noTime: L.noTime };

    var out = [], skipped = [];
    RULES.forEach(function (rule) {
      /* profile-gated rules are not "skipped for missing channels": they simply
         do not apply to this engine, so they leave no trace in the skipped list */
      if (rule.extra && !ctx.P.extraRules) return;
      for (var k = 0; k < rule.need.length; k++) if (!L.have[rule.need[k]]) { skipped.push({ id: rule.id, missing: rule.need[k] }); return; }
      var f;
      try { f = rule.run(ctx); } catch (e) { f = null; }
      if (f) { f.id = rule.id; out.push(f); }
    });
    out.sort(function (a, b) { return SEV_RANK[a.sev] - SEV_RANK[b.sev]; });
    L.findings = out;
    L.metrics = computeMetrics(L, ctx, skipped);
    L.ctx = ctx;
    L.rulesetVersion = RULESET_VERSION;
    return out;
  }
