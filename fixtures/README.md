# Fixtures

OBD-II captures from OBD Fusion, used as regression inputs for the test suite in
`../test/` and, for `sample-session.csv`, as the sample bundled into the build.

The GPS and altitude columns were removed from the captures before publication.
`sample-session.csv` keeps position columns so the map can be demonstrated, but its
route is synthetic: it does not correspond to anywhere the vehicle drove.

Do not commit your own logs here. They can contain GPS positions, and the test suite
reads every `*.csv` in this directory.

`synthetic/` (git-ignored, regenerate with `python3 ../make-test-fixtures.py`) holds
generated edge-case logs in shapes unlike the real captures: semicolon-delimited,
decimal commas, °F/mph units, AFR instead of lambda, and a minimal no-time-column log.
