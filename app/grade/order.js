// Grader for drag-and-order PBQs: the two shapes the exam uses most after
// configuration tasks.
//
//   sequence    put steps in the right order (incident response phases,
//               order of volatility)
//   categorize  drop items into the right buckets (control types, protocol
//               families)
//
// Both grade per item, not per attempt. Getting five of seven phases right is
// worth more than nothing, and the exam awards partial credit here too.

/**
 * Sequence credit. An item scores if it sits in its correct position.
 *
 * Deliberately NOT edit-distance: on an ordered-phases question the exam cares
 * that containment precedes eradication, and position is how that is checked.
 * Adjacent-pair credit is also reported, because getting the whole chain one
 * slot out is a different mistake from shuffling it, and the feedback should
 * say which one you made.
 */
function gradeSequence(expected, given) {
  const got = given || [];
  const placed = expected.map((id, i) => ({ id, ok: got[i] === id }));
  const correct = placed.filter((p) => p.ok).length;

  let pairsRight = 0;
  for (let i = 0; i < expected.length - 1; i++) {
    const a = got.indexOf(expected[i]);
    const b = got.indexOf(expected[i + 1]);
    if (a !== -1 && b !== -1 && a < b) pairsRight += 1;
  }
  return {
    fraction: expected.length ? correct / expected.length : 0,
    correct,
    total: expected.length,
    placed,
    pairsRight,
    pairsTotal: Math.max(0, expected.length - 1),
    allPlaced: got.length === expected.length,
  };
}

function gradeCategorize(expected, given) {
  const got = given || {};
  const ids = Object.keys(expected);
  const right = ids.filter((id) => got[id] === expected[id]);
  const wrong = ids.filter((id) => got[id] && got[id] !== expected[id]);
  const unplaced = ids.filter((id) => !got[id]);
  return {
    fraction: ids.length ? right.length / ids.length : 0,
    right, wrong, unplaced, total: ids.length,
  };
}

export function gradeOrder(pbq, answers) {
  const mode = pbq.config.mode;
  const label = (id) =>
    pbq.config.items.find((i) => i.id === id)?.label || id;
  const bucket = (id) =>
    pbq.config.buckets?.find((b) => b.id === id)?.label || id;

  const results = [];
  let earned = 0, max = 0;

  if (mode === "sequence") {
    const g = gradeSequence(pbq.solution.order, answers.order);
    for (const st of pbq.subtasks) {
      max += st.points;
      // A subtask names one step; it scores when that step is in position.
      const hit = g.placed.find((p) => p.id === st.item);
      const pass = !!hit?.ok;
      if (pass) earned += st.points;
      const at = (answers.order || []).indexOf(st.item);
      results.push({
        id: st.id, kind: "sequence", label: st.label, pass,
        points: st.points, earned: pass ? st.points : 0,
        misconception: st.misconception,
        detail: pass
          ? `In position ${pbq.solution.order.indexOf(st.item) + 1}, correct.`
          : at === -1
          ? "Never placed."
          : `You put it at position ${at + 1}; it belongs at ${pbq.solution.order.indexOf(st.item) + 1}.`,
        correctNote: st.correctNote,
      });
    }
    results.push({
      id: "seq-chain", kind: "sequence", label: "Relative order held",
      pass: g.pairsRight === g.pairsTotal,
      partial: g.pairsRight > 0 && g.pairsRight < g.pairsTotal,
      points: 0, earned: 0, misconception: null,
      detail: `${g.pairsRight} of ${g.pairsTotal} consecutive pairs are in the right relative order.` +
        (g.pairsRight === g.pairsTotal && g.fraction < 1
          ? " The chain is right but shifted, which is a different error from shuffling it."
          : ""),
    });
  } else {
    const g = gradeCategorize(pbq.solution.placements, answers.placements);
    for (const st of pbq.subtasks) {
      max += st.points;
      const got = (answers.placements || {})[st.item];
      const want = pbq.solution.placements[st.item];
      const pass = got === want;
      if (pass) earned += st.points;
      results.push({
        id: st.id, kind: "categorize", label: st.label || label(st.item),
        pass, points: st.points, earned: pass ? st.points : 0,
        misconception: st.misconception,
        detail: pass
          ? `Correctly placed in ${bucket(want)}.`
          : !got
          ? "Never placed."
          : `You put it in ${bucket(got)}; it belongs in ${bucket(want)}.`,
        correctNote: st.correctNote,
      });
    }
  }

  return { earned, max, results };
}
