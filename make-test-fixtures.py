"""Synthesise two logs in shapes deliberately unlike the sample, to test the parser:

  A) Torque-style: semicolon delimited, decimal commas, °F, mph, AFR instead of
     lambda, a "Device Time" stamp instead of elapsed seconds, no GPS, one bank,
     and two metadata lines before the header.
  B) A minimal tab-delimited log with only three channels and no time column.
"""
import io, os, math, random

HERE = os.path.dirname(os.path.abspath(__file__))
out_dir = os.path.join(HERE, "fixtures", "synthetic")
os.makedirs(out_dir, exist_ok=True)
random.seed(7)

# ---------- A ----------
rows = []
n = 420
for i in range(n):
    t = i * 0.5
    rpm = 800 + 1400 * max(0.0, math.sin(t / 40)) + random.uniform(-40, 40)
    mph = max(0.0, 34 * max(0.0, math.sin(t / 40 - 0.4)) + random.uniform(-2, 2))
    ectF = 32 + (95 * min(1.0, t / 150) + random.uniform(-1, 1)) * 9 / 5
    iatF = 32 + (30 + 12 * min(1.0, t / 200)) * 9 / 5
    # a genuinely RICH engine, so the rule engine must report the opposite of the sample
    stft = -9 + random.uniform(-3, 3)
    ltft = -11 + random.uniform(-1.5, 1.5)
    afr = 14.7 * (1.0 + random.uniform(-0.01, 0.01))
    volt = 12.1 + random.uniform(-0.15, 0.15)          # deliberately low charging
    rows.append([
        "2026-09-08 08:%02d:%05.2f" % (10 + int(t) // 60, t % 60),
        rpm, mph, ectF, iatF, stft, ltft, afr, volt, 2
    ])

head = ["Device Time", "Engine RPM(rpm)", "Speed (OBD)(mph)", "Engine Coolant Temperature(°F)",
        "Intake Air Temperature(°F)", "Fuel Trim Bank 1 Short Term(%)", "Fuel Trim Bank 1 Long Term(%)",
        "Air Fuel Ratio(Measured)(:1)", "Control Module Voltage(V)", "Fuel System 1 Status"]

def dc(v):
    return ("%.3f" % v).replace(".", ",")

lines = ["# Logged with SyntheticLogger 1.0", "# Vehicle: test mule", ";".join(head)]
for r in rows:
    lines.append(";".join([r[0]] + [dc(x) if isinstance(x, float) else str(x) for x in r[1:]]))
pA = os.path.join(out_dir, "test-torque-style.csv")
io.open(pA, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
print("wrote", pA, os.path.getsize(pA), "bytes")

# ---------- B ----------
lines = ["RPM\tCoolant Temp\tMAF"]
for i in range(150):
    lines.append("%d\t%d\t%.2f" % (700 + i * 8, 60 + i // 4, 3 + i * 0.1))
pB = os.path.join(out_dir, "test-minimal.txt")
io.open(pB, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
print("wrote", pB, os.path.getsize(pB), "bytes")
