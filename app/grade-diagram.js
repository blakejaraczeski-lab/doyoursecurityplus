// Network diagram grader. Two task shapes: pick the right set of hosts, and
// answer scenario questions about what to do with them. Host selection is
// scored with partial credit so identifying two of three compromised hosts is
// worth something, while selecting an uninvolved host costs you, because
// over-selecting is the error the exam is testing.

// Over-selecting is the error these tasks are built to catch, so a wrong host
// costs you. It costs HALF what a right host earns, though: identifying the real
// compromise and then over-reaching is a different mistake from identifying
// nothing, and collapsing both to zero hides that difference from the learner.
// A task can override with `extraPenalty`.
const DEFAULT_EXTRA_PENALTY = 0.5;

function gradeNodeSelection(expected, given, extraPenalty = DEFAULT_EXTRA_PENALTY) {
  const exp = new Set(expected);
  const got = new Set(given || []);
  const hits = [...exp].filter((id) => got.has(id));
  const misses = [...exp].filter((id) => !got.has(id));
  const extras = [...got].filter((id) => !exp.has(id));
  const raw = (hits.length - extras.length * extraPenalty) / exp.size;
  return { fraction: Math.max(0, Math.min(1, raw)), hits, misses, extras };
}

export function gradeDiagram(pbq, answers) {
  const tasks = Object.fromEntries(pbq.config.tasks.map((t) => [t.id, t]));
  const labelOf = (nodeId) =>
    pbq.config.nodes.find((n) => n.id === nodeId)?.label || nodeId;
  const results = [];
  let earned = 0;
  let max = 0;

  for (const st of pbq.subtasks) {
    const task = tasks[st.task];
    const expected = pbq.solution[st.task];
    const given = answers[st.task];
    max += st.points;

    if (task.type === "select-nodes") {
      const g = gradeNodeSelection(expected, given, task.extraPenalty);
      const pts = Math.round(st.points * g.fraction);
      earned += pts;
      const bits = [];
      if (g.hits.length) bits.push(`Correctly identified ${g.hits.map(labelOf).join(", ")}.`);
      if (g.misses.length) bits.push(`Missed ${g.misses.map(labelOf).join(", ")}.`);
      if (g.extras.length) bits.push(`Wrongly included ${g.extras.map(labelOf).join(", ")}. Those hosts show the attacker's activity but no evidence of being compromised themselves, and over-selecting costs half a mark each.`);
      results.push({
        id: st.id, kind: "nodes", label: st.label,
        pass: g.fraction === 1, partial: g.fraction > 0 && g.fraction < 1,
        points: st.points, earned: pts, misconception: st.misconception,
        detail: bits.join(" ") || "Nothing selected.",
        correctNote: st.correctNote,
      });
    } else {
      const pass = given === expected;
      if (pass) earned += st.points;
      const optLabel = (v) => task.options?.find((o) => o.value === v)?.label || v;
      results.push({
        id: st.id, kind: "choice", label: st.label, pass,
        points: st.points, earned: pass ? st.points : 0,
        misconception: st.misconception,
        detail: pass
          ? `Correct: ${optLabel(expected)}.`
          : given == null
          ? "Left unanswered."
          : `You chose "${optLabel(given)}". The correct action is "${optLabel(expected)}".`,
        correctNote: st.correctNote,
      });
    }
  }

  return { earned, max, results };
}
