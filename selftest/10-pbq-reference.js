// Every PBQ reference answer scores full marks, and every subtask maps to a defined misconception.
import { gradePbq } from "../app/grade.js";
import { say, check, content } from "./harness.js";

/** Build the answer set that the content itself declares to be correct. */
function referenceAnswers(p) {
  if (p.kind === "acl-table") return { rules: p.solution.reference || [] };
  if (p.kind === "drag-order") {
    return p.config.mode === "sequence"
      ? { order: [...p.solution.order] }
      : { placements: { ...p.solution.placements } };
  }
  if (p.kind === "wireless-config") {
    const a = {};
    for (const [k, v] of Object.entries(p.solution.fields || {})) {
      if (v.accept) a[k] = v.accept[0];
      else if (v.rule) {
        const [kind, arg] = String(v.rule).split(":");
        if (kind === "minLength") a[k] = "x".repeat(Number(arg));
        if (kind === "equals") a[k] = arg;
      }
    }
    return a;
  }
  return { ...p.solution };
}

say(`<b>PBQ reference answers (${content.pbqs.length})</b>`);
for (const p of content.pbqs) {
  const g = gradePbq(p, referenceAnswers(p));
  check(
    g.percent === 100,
    `${p.id.padEnd(18)} ${String(g.earned).padStart(3)}/${String(g.max).padEnd(3)} ${p.kind}`,
    g.percent === 100 ? "" : `-> ${g.results.filter((r) => !r.pass).map((r) => r.label).join("; ")}`
  );
}

say("");
say("<b>Every PBQ subtask maps to a defined misconception</b>");
for (const p of content.pbqs) {
  const subs = [
    ...(p.subtasks || []),
    ...(p.solution.testCases || []),
    ...(p.solution.checks || []),
  ];
  const bad = subs.filter((s) => s.misconception && !content.misconceptions[s.misconception]);
  check(bad.length === 0, `${p.id.padEnd(18)} ${subs.length} scoreable units`,
        bad.map((s) => s.misconception).join(", "));
}
