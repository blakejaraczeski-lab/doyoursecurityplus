// One grader per PBQ kind, one file. Each returns per-subtask results with the
// misconception every miss maps to, which is what the mentor engine consumes,
// and partial credit is real: a subtask scores on its own.

// --- ACL ------------------------------------------------------------------
// ACL grader. The rule set is not compared against a reference answer, it is
// EXECUTED: synthetic packets are pushed through the user's rules exactly as a
// firewall would evaluate them, top to bottom, first match wins, implicit deny
// at the end. That is what makes partial credit meaningful and what catches the
// rule set that works but is far too broad.

const ipToInt = (ip) =>
  ip.split(".").reduce((acc, o) => (acc << 8) + (parseInt(o, 10) & 255), 0) >>> 0;

function inCidr(cidr, ip) {
  const [net, bitsRaw] = cidr.split("/");
  const bits = parseInt(bitsRaw, 10);
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipToInt(net) & mask) === (ipToInt(ip) & mask);
}

const isCidr = (v) => typeof v === "string" && v.includes("/");

/** Does a rule field value cover a concrete packet value? */
function addrMatches(ruleAddr, packetIp) {
  if (!ruleAddr || ruleAddr === "any") return true;
  if (isCidr(ruleAddr)) return inCidr(ruleAddr, packetIp);
  return ruleAddr === packetIp;
}

const portMatches = (rulePort, packetPort) =>
  !rulePort || rulePort === "any" || String(rulePort) === String(packetPort);

const protoMatches = (ruleProto, packetProto) =>
  !ruleProto || ruleProto === "any" || ruleProto === packetProto;

function ruleMatches(rule, pkt) {
  return (
    protoMatches(rule.protocol, pkt.protocol) &&
    addrMatches(rule.src, pkt.src) &&
    portMatches(rule.srcPort, pkt.srcPort) &&
    addrMatches(rule.dst, pkt.dst) &&
    portMatches(rule.dstPort, pkt.dstPort)
  );
}

/** Run one packet through the rule list. Returns the verdict and which rule decided it. */
function evaluate(rules, pkt) {
  for (let i = 0; i < rules.length; i++) {
    if (isBlank(rules[i])) continue;
    if (ruleMatches(rules[i], pkt)) {
      return { action: rules[i].action, ruleIndex: i, implicit: false };
    }
  }
  return { action: "deny", ruleIndex: -1, implicit: true };
}

const isBlank = (r) => !r || (!r.src && !r.dst && !r.dstPort && !r.action);

// --- field-level "is a broader than b" tests, used for shadow detection ------
const addrCovers = (a, b) => {
  if (a === "any") return true;
  if (a === b) return true;
  if (isCidr(a) && !isCidr(b)) return inCidr(a, b);
  if (isCidr(a) && isCidr(b)) {
    const [an, ab] = a.split("/");
    const [bn, bb] = b.split("/");
    return parseInt(ab, 10) <= parseInt(bb, 10) && inCidr(a, bn);
  }
  return false;
};
const valCovers = (a, b) => a === "any" || String(a) === String(b);

const covers = (a, b) =>
  valCovers(a.protocol, b.protocol) &&
  addrCovers(a.src, b.src) &&
  valCovers(a.srcPort, b.srcPort) &&
  addrCovers(a.dst, b.dst) &&
  valCovers(a.dstPort, b.dstPort);

/** Rules that can never fire because a broader rule sits above them. */
function findShadowed(rules) {
  const out = [];
  const live = rules.map((r, i) => ({ r, i })).filter((x) => !isBlank(x.r));
  for (let a = 0; a < live.length; a++) {
    for (let b = 0; b < a; b++) {
      if (covers(live[b].r, live[a].r)) {
        out.push({
          index: live[a].i,
          shadowedBy: live[b].i,
          harmful: live[b].r.action !== live[a].r.action,
        });
        break;
      }
    }
  }
  return out;
}

function runCheck(check, rules) {
  const live = rules.filter((r) => !isBlank(r));
  switch (check.type) {
    case "no-permit-any-any": {
      const bad = live.findIndex(
        (r) => r.action === "permit" && r.src === "any" && r.dst === "any" &&
               (r.dstPort === "any" || !r.dstPort)
      );
      return bad === -1
        ? { pass: true, detail: "No rule permits all traffic." }
        : { pass: false, detail: `Rule ${bad + 1} permits any source to any destination on any port. That rule makes every other rule in the list irrelevant and permits everything the requirements forbid.` };
    }
    case "explicit-deny-last": {
      const last = live[live.length - 1];
      const ok = last && last.action === "deny" && last.src === "any" &&
                 last.dst === "any" && (last.dstPort === "any" || !last.dstPort);
      return ok
        ? { pass: true, detail: "The list ends with an explicit deny, so drops can be logged." }
        : { pass: false, detail: "The list does not end with an explicit deny any. Traffic is still denied by the implicit deny, but the firewall will not log it, so you lose the record of what was blocked." };
    }
    case "no-shadowed-rules": {
      const sh = findShadowed(rules).filter((s) => s.harmful);
      return sh.length === 0
        ? { pass: true, detail: "Every rule is reachable." }
        : { pass: false, detail: sh.map((s) => `Rule ${s.index + 1} can never fire: rule ${s.shadowedBy + 1} above it already matches that traffic with the opposite action.`).join(" ") };
    }
    case "source-not-broad": {
      const permits = live.filter(
        (r) => r.action === "permit" &&
               addrCovers(r.dst, check.match.dst) &&
               valCovers(r.dstPort, check.match.dstPort)
      );
      if (!permits.length) {
        return { pass: false, detail: "No rule permits this traffic at all, so the least privilege check cannot pass." };
      }
      const bad = permits.filter((r) => !check.allowedSources.includes(r.src));
      return bad.length === 0
        ? { pass: true, detail: "Access is limited to the named source." }
        : { pass: false, detail: `A rule permits this traffic from ${bad.map((r) => r.src).join(", ")}. The requirement names a specific host, so anything broader hands access to machines that should not have it.` };
    }
    default:
      return { pass: false, detail: `Unknown check type ${check.type}` };
  }
}

/**
 * Grade a submitted rule list.
 * @returns {{earned:number,max:number,results:Array,trace:Array}}
 */
function gradeAcl(pbq, answers) {
  // Called through the common grader interface with the whole answers object,
  // but also usable directly with a bare rule array.
  const rules = Array.isArray(answers) ? answers : answers?.rules || [];
  const { testCases = [], checks = [] } = pbq.solution;
  const results = [];
  const trace = [];
  let earned = 0;
  let max = 0;

  for (const tc of testCases) {
    const verdict = evaluate(rules, tc.packet);
    const pass = verdict.action === tc.expect;
    max += tc.points;
    if (pass) earned += tc.points;
    trace.push({ ...tc, got: verdict.action, ruleIndex: verdict.ruleIndex, implicit: verdict.implicit, pass });
    results.push({
      id: tc.id,
      kind: "traffic",
      label: tc.label,
      pass,
      points: tc.points,
      earned: pass ? tc.points : 0,
      misconception: tc.misconception,
      detail: pass
        ? `${tc.expect === "permit" ? "Permitted" : "Denied"} as required${verdict.implicit ? " by the implicit deny" : ` by rule ${verdict.ruleIndex + 1}`}.`
        : `Expected this traffic to be ${tc.expect}ed, but your rule set ${verdict.action === "permit" ? "permitted" : "denied"} it${verdict.implicit ? " via the implicit deny at the bottom" : ` at rule ${verdict.ruleIndex + 1}`}.`,
    });
  }

  for (const ck of checks) {
    const r = runCheck(ck, rules);
    max += ck.points;
    if (r.pass) earned += ck.points;
    results.push({
      id: ck.id,
      kind: "check",
      label: ck.label,
      pass: r.pass,
      points: ck.points,
      earned: r.pass ? ck.points : 0,
      misconception: ck.misconception,
      detail: r.detail,
    });
  }

  return { earned, max, results, trace };
}

// --- wireless configuration -----------------------------------------------
// Wireless configuration grader. Every field scores on its own, and dependent
// fields (EAP method, RADIUS address) only score when the mode you chose makes
// them meaningful, so one wrong mode does not cascade into losing everything.

/** Is this field reachable given the mode chosen? The renderer uses the same rule. */
export function fieldVisible(field, answers) {
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

function gradeWireless(pbq, answers) {
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

// --- network diagram ------------------------------------------------------
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

function gradeDiagram(pbq, answers) {
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

// --- drag and order -------------------------------------------------------
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
    // Positions can be filled in any order, so the array may hold gaps. Counting
    // length would call a sequence complete as soon as its LAST slot was used.
    allPlaced: expected.every((_, i) => got[i] != null),
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

function gradeOrder(pbq, answers) {
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

// --- any PBQ ------------------------------------------------------------------
const GRADERS = {
  "acl-table": gradeAcl,
  "wireless-config": gradeWireless,
  "network-diagram": gradeDiagram,
  "drag-order": gradeOrder,
};

export function gradePbq(pbq, answers) {
  const grader = GRADERS[pbq.kind];
  if (!grader) throw new Error(`No grader for PBQ kind "${pbq.kind}"`);
  const out = grader(pbq, answers);
  const missed = out.results.filter((r) => !r.pass && r.misconception);
  return {
    ...out,
    percent: out.max ? Math.round((out.earned / out.max) * 100) : 0,
    missedMisconceptions: [...new Set(missed.map((r) => r.misconception))],
  };
}
