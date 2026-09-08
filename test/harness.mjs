// Loads 02-parse.js + 03-analyze.js in isolation for testing, without pulling in
// 04-render.js / 05-map.js / 06-shell.js, which touch DOM globals the parser and
// rules never need. Both source files are written as plain statements meant to run
// inside one shared IIFE (opened in 01-shell.html, closed in 06-shell.js) — wrapping
// them in our own IIFE and returning the functions/consts declared at that scope
// re-exposes exactly what parseLog/analyze need without modifying the source files.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

export function loadEngine(srcDir = SRC_DIR) {
  const src = ["02-parse.js", "03-analyze.js"]
    .map((f) => readFileSync(path.join(srcDir, f), "utf8"))
    .join("\n");
  const wrapped = `(function () {\n${src}\nreturn { parseLog, analyze };\n})()`;
  const ctx = vm.createContext({ console });
  return vm.runInContext(wrapped, ctx, { filename: "engine.js" });
}
