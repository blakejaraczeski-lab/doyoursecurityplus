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
export function gradeAcl(pbq, answers) {
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
