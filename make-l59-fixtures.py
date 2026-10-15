#!/usr/bin/env python3
"""Generate synthetic Chevrolet L59 (5.3 L V8) test logs in OBD Fusion / ELM327 format.

These are NOT recordings of a real engine. They exist so the L59 profile, the new
channel aliases and the L59 rules have deterministic regression coverage until a
real log is available. Replace or add to them with real logs when you have them.

    python make-l59-fixtures.py          # writes fixtures/L59_*.csv

Seeded, so re-running produces byte-identical files. The golden files in
test/golden/ are generated from these.
"""
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "fixtures")

BASE_HEAD = [
    "Time (sec)", "Fuel system 1 status", "Calculated load value (%)",
    "Engine coolant temperature (°C)",
    "Short term fuel % trim - Bank 1 (%)", "Long term fuel % trim - Bank 1 (%)",
    "Short term fuel % trim - Bank 2 (%)", "Long term fuel % trim - Bank 2 (%)",
    "Intake manifold absolute pressure (kPa)", "Engine RPM (RPM)", "Vehicle speed (km/h)",
    "Ignition timing advance for #1 cylinder (deg)", "Intake air temperature (°C)",
    "Mass air flow rate (g/s)", "Absolute throttle position (%)",
    "O2 voltage (Bank 1  Sensor 1) (V)", "O2 voltage (Bank 1  Sensor 2) (V)",
    "O2 voltage (Bank 2  Sensor 1) (V)", "O2 voltage (Bank 2  Sensor 2) (V)",
]
KNOCK_HEAD = "Knock retard (deg)"

# (start_s, end_s, target speed km/h, throttle %) — idle, pull-away, cruise, wide open, decel, idle
PLAN = [(0, 60, 0, 12.5), (60, 100, 45, 22), (100, 170, 80, 28), (170, 190, 80, 30),
        (190, 205, 125, 90), (205, 240, 70, 20), (240, 270, 0, 12.5), (270, 330, 0, 12.5)]


def phase(t):
    for a, b, v, th in PLAN:
        if a <= t < b:
            return a, b, v, th
    return PLAN[-1]


def make(name, seed, *, idle_rpm=650, idle_noise=8, map_idle=38, ect=91, iat=38, open_loop=0.0,
         b2_trim=0.0, b2_o2=None, knock_pid=False, knock_events=(), timing_pulls=(), n=330):
    rng = random.Random(seed)
    head = BASE_HEAD + ([KNOCK_HEAD] if knock_pid else [])
    rows = []
    speed = 0.0
    last_spark = 14.0
    for t in range(n):
        _, _, tgt, tps_t = phase(t)
        speed += (tgt - speed) * 0.25
        v = 0.0 if speed < 1.0 else speed
        moving = v > 0
        rpm = idle_rpm + rng.gauss(0, idle_noise) if not moving else 1100 + v * 24 + rng.gauss(0, 25)
        tps = tps_t + rng.gauss(0, 0.4)
        load = 18 + (tps - 12.5) * 0.85 + rng.gauss(0, 0.8) if tps > 13 else 17 + rng.gauss(0, 0.6)
        mp = map_idle + (load - 17) * 1.15 + rng.gauss(0, 0.8)
        maf = max(2.0, mp * rpm / 1000 * 0.118 + rng.gauss(0, 0.5))
        decel = 240 <= t < 270 and 8 < v < 60
        # fuel system status: 2 closed loop, 4 open (load / decel), 1 open (cold), 8 open (fault)
        if decel or (tps > 80):
            fs = 4
        elif rng.random() < open_loop:
            fs = 1
        else:
            fs = 2
        spark = 14.0 + (load - 17) * -0.1 + (rpm - 650) * 0.004 + rng.gauss(0, 0.3)
        spark = max(6.0, min(34.0, spark))
        knock = 0.0
        for a, b, deg in knock_events:
            if a <= t < b:
                knock = deg + rng.uniform(-0.5, 0.5)
        if knock_pid and knock > 0:
            spark -= knock
        for a, b, deg in timing_pulls:
            if a <= t < b:
                spark -= deg
        stft1 = rng.gauss(0.5, 1.8); ltft1 = 1.5 + rng.gauss(0, 0.1)
        stft2 = rng.gauss(0.5 + b2_trim * 0.4, 1.8); ltft2 = 1.5 + b2_trim * 0.6 + rng.gauss(0, 0.1)
        o2_1 = rng.choice([0.12, 0.17, 0.2, 0.7, 0.78, 0.84]) + rng.gauss(0, 0.02)
        o2_2 = (b2_o2 + rng.gauss(0, 0.01)) if b2_o2 is not None else \
            rng.choice([0.12, 0.17, 0.2, 0.7, 0.78, 0.84]) + rng.gauss(0, 0.02)
        rear = 0.66 + rng.gauss(0, 0.03)
        row = [t, fs, round(max(load, 0), 1), round(ect + min(t, 30) * 0.02 + rng.gauss(0, 0.2), 1),
               round(stft1, 1), round(ltft1, 1), round(stft2, 1), round(ltft2, 1),
               round(mp), round(rpm), round(v), round(spark, 1), round(iat + t * 0.01, 1),
               round(maf, 2), round(max(tps, 0), 1), round(max(o2_1, 0.0), 3), round(rear, 3),
               round(max(o2_2, 0.0), 3), round(rear + rng.gauss(0, 0.02), 3)]
        if knock_pid:
            row.append(round(max(knock, 0.0), 1))
        rows.append(row)
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write("# StartTime = synthetic L59 fixture (seed %d)\n" % seed)
        f.write(", ".join(head) + "\n")
        for r in rows:
            f.write(",".join(str(x) for x in r) + "\n")
    print("wrote", path, len(rows), "rows")


if __name__ == "__main__":
    make("L59_healthy.csv", 59001)
    make("L59_bank2_lean_stuck_o2.csv", 59002, b2_trim=22.0, b2_o2=0.09)
    make("L59_vacuum_leak_open_loop.csv", 59003, map_idle=64, idle_rpm=700, idle_noise=60, open_loop=0.45)
    make("L59_knock_pid.csv", 59004, iat=62, knock_pid=True,
         knock_events=[(110, 113, 4.0), (150, 152, 6.5), (192, 197, 9.0), (225, 226, 2.0)])
    make("L59_timing_pulls_no_knock_pid.csv", 59005, iat=60,
         timing_pulls=[(115, 116, 8), (130, 131, 7), (150, 151, 9), (165, 166, 6), (180, 181, 8),
                       (125, 126, 7), (145, 146, 8), (160, 161, 7), (175, 176, 6)])
