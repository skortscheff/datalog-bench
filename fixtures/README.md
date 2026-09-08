# Fixtures

Real BMW M54 OBD-II captures from OBD Fusion, used both as the bundled sample
(`sample-session.csv`, inlined into the build) and as regression inputs for the test
suite in `../test/`.

These files contain **real vehicle telemetry, including GPS coordinates**. Do not
push this repository to a public remote without considering that first.

`synthetic/` (git-ignored, regenerate with `python3 ../make-test-fixtures.py`) holds
generated edge-case logs in shapes unlike the real captures — semicolon-delimited,
decimal commas, °F/mph units, AFR instead of lambda, and a minimal no-time-column log.
