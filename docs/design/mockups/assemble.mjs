#!/usr/bin/env -S nix develop --command node
// Replace the subject, takes-panel, knobs and checks sections of
// b-darkroom.html with the files in parts/. The takes panel is removed:
// takes now live on the canvas.
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, "b-darkroom.html");
let s = await readFile(page, "utf8");

const cut = (from, to) => {
  const a = s.indexOf(from); const b = s.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`marker missing: ${from} .. ${to}`);
  return [a, b];
};
const put = async (from, to, file) => {
  const [a, b] = cut(from, to);
  const body = file ? await readFile(join(here, "parts", file), "utf8") : "";
  s = s.slice(0, a) + body + s.slice(b);
};
// The old takes panel sits between subject and knobs on the first run only.
const next = s.includes("<!-- ===================== takes") ? "    <!-- ===================== takes" : "    <!-- ===================== knobs";
await put("    <!-- ===================== subject", next, "subject.html");
if (next.includes("takes")) await put("    <!-- ===================== takes", "    <!-- ===================== knobs", null);
await put("    <!-- ===================== knobs", "    <!-- ===================== code pane", "knobs.html");
await put("    <!-- ===================== checks window", "  </main>", "checks.html");
await writeFile(page, s);
console.log("assembled", page);
