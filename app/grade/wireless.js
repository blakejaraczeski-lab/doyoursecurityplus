// Wireless configuration grader. Every field scores on its own, and dependent
// fields (EAP method, RADIUS address) only score when the mode you chose makes
// them meaningful, so one wrong mode does not cascade into losing everything.

function fieldVisible(field, answers) {
  if (!field?.dependsOn) return true;
  return field.dependsOn.in.includes(answers[field.dependsOn.field]);
}

function checkRule(rule, value) {
  const [kind, arg] = String(rule).split(":");
  const v = value == null ? "" : String(value);
  switch (kind) {
    case "minLength":
      return { pass: v.length >= Number(arg), detail: `${v.length} characters supplied, ${arg} required.` };
    case "equals":
      return { pass: v === arg, detail: `Expected ${arg}.` };
    default:
      return { pass: false, detail: `Unknown rule ${rule}` };
  }
}

export function gradeWireless(pbq, answers) {
  const fields = pbq.config.fields;
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  const spec = pbq.solution.fields || {};
  const results = [];
  let earned = 0;
  let max = 0;

  for (const st of pbq.subtasks) {
    const field = byId[st.field];
    const sol = spec[st.field] || {};
    const given = answers[st.field];
    max += st.points;

    // If the field is not reachable given the mode chosen, it cannot be scored
    // on its own terms. The mode subtask already took the points for that error.
    const reachable = fieldVisible(field, answers);
    let pass = false;
    let detail;

    if (!reachable) {
      pass = false;
      detail = `Not configurable with the mode you selected, so this requirement went unmet.`;
    } else if (sol.rule) {
      const r = checkRule(sol.rule, given);
      pass = r.pass;
      detail = r.detail;
    } else if (sol.accept) {
      pass = sol.accept.includes(String(given ?? "").trim());
      const label = (v) => byId[st.field]?.options?.find((o) => o.value === v)?.label || v;
      detail = pass
        ? `${label(given)} is correct.`
        : given == null || given === ""
        ? "Left blank."
        : `You selected ${label(given)}. The requirement calls for ${sol.accept.map(label).join(" or ")}.`;
    }

    if (pass) earned += st.points;
    results.push({
      id: st.id,
      kind: "field",
      label: st.label,
      pass,
      points: st.points,
      earned: pass ? st.points : 0,
      misconception: st.misconception,
      detail,
      correctNote: st.correctNote,
    });
  }

  return { earned, max, results };
}
