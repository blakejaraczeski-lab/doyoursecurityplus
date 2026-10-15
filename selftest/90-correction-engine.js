// The correction engine: a read is not a pass, retiring passes are spaced, the tier
// follows the count of misses, the contrast pair never re-serves the missed item and
// turns with every miss, and the terminology card names the pair you confused.
import { DEFAULT_STATE } from "../app/state.js";
import * as mentor from "../app/mentor.js";
import { say, check, content } from "./harness.js";

const fresh = () => structuredClone(DEFAULT_STATE);
const MIN = 60000;
const DAY = 86400000;
const t0 = new Date(2026, 9, 12, 12, 0, 0).getTime();
const ids = Object.keys(content.misconceptions).filter((id) => !id.startsWith("terminology-"));
const withItems = (n) => ids.find((id) => mentor.itemsFor(id, content, fresh()).mcqs.length >= n);

say("");
say("<b>Reading a correction is never a clean pass</b>");
{
  const mc = withItems(2);
  const [a, b] = mentor.itemsFor(mc, content, fresh()).mcqs;
  const s = fresh();
  mentor.bank(s, mc, a.id, t0);
  const r1 = mentor.pass(s, mc, `mentor:${t0 + 1}`, content, t0 + 1, true);
  const r2 = mentor.pass(s, mc, `mentor:${t0 + 2}`, content, t0 + 2, true);
  const rec = s.misconceptions[mc];
  check(!rec.retired && rec.cleanPasses.length === 0 && r1?.read && r2?.read,
        `two reads leave "${mc}" open with no clean pass`, `(retired ${rec.retired}, passes ${rec.cleanPasses.length})`);
  check(rec.reads === 2, `each read is recorded (${rec.reads})`);
  check(rec.due > t0 + 2, `a read reschedules the belief instead of leaving it due at once`);
  const first = mentor.pass(s, mc, b.id, content, t0 + 10 * MIN, true);
  const second = mentor.pass(s, mc, a.id, content, rec.countAfter, true);
  check(first?.have === 1 && second?.retired, `answered questions, spaced, still retire it after reads`);
}

say("");
say("<b>The passes that retire a belief are at least one relearn step apart</b>");
{
  const mc = withItems(3);
  const [a, b, c] = mentor.itemsFor(mc, content, fresh()).mcqs;
  const s = fresh();
  mentor.bank(s, mc, a.id, t0);
  const p1 = mentor.pass(s, mc, b.id, content, t0 + MIN, true);
  const rec = s.misconceptions[mc];
  const gap = rec.countAfter - (t0 + MIN);
  const p2 = mentor.pass(s, mc, c.id, content, t0 + 2 * MIN, true);
  check(p1?.distinct && p1?.have === 1, `the first pass counts, in the same session`);
  check(gap >= 20 * 3600e3 || gap >= 8 * MIN, `the next counted pass is one relearn step out (${Math.round(gap / MIN)} min)`);
  check(!p2?.distinct && !p2?.retired && rec.cleanPasses.length === 1,
        `a distinct item one minute later does not count and does not retire`, `(have ${rec.cleanPasses.length})`);
  const dueBefore = rec.due;
  mentor.pass(s, mc, c.id, content, t0 + 3 * MIN, true);
  check(rec.due === dueBefore, `a too-early pass leaves the schedule where it was`);
  const p3 = mentor.pass(s, mc, c.id, content, rec.countAfter, true);
  check(p3?.retired && rec.cleanPasses.length === 2, `the same item counts once a step has passed, and retires it`);

  // A contrast pair is two answers a minute apart: one pass.
  const pairMc = ids.find((id) => mentor.contrastPair(id, content, fresh()));
  const ps = fresh();
  const pair = mentor.contrastPair(pairMc, content, ps);
  mentor.bank(ps, pairMc, "x", t0);
  mentor.pass(ps, pairMc, pair.items[0].id, content, t0 + MIN, true);
  mentor.pass(ps, pairMc, pair.items[1].id, content, t0 + 2 * MIN, true);
  check(ps.misconceptions[pairMc].cleanPasses.length === 1 && !ps.misconceptions[pairMc].retired,
        `a contrast pair answered back to back counts as one pass`);

  // A miss starts the spacing clock over.
  mentor.bank(s, mc, a.id, t0 + 5 * DAY);
  check(s.misconceptions[mc].countAfter === 0 && s.misconceptions[mc].cleanPasses.length === 0, `a fresh miss resets the clock and the passes`);
}

say("");
say("<b>The tier follows the count of misses</b>");
{
  const mc = withItems(2);
  const tiers = (confident, n, retiredAt) => {
    const s = fresh();
    const out = [];
    for (let k = 0; k < n; k++) {
      mentor.bank(s, mc, "x", t0 + k * MIN, null, confident);
      out.push(mentor.tierFor(s.misconceptions[mc]));
    }
    return out;
  };
  check(tiers(true, 3).join() === "1,2,3", `confident misses climb 1, 2, 3 (${tiers(true, 3)})`);
  check(tiers(false, 3).join() === "1,2,3", `guessed misses climb 1, 2, 3 (${tiers(false, 3)})`);
  const s = fresh();
  mentor.bank(s, mc, "x", t0);
  s.misconceptions[mc].retired = true;
  s.misconceptions[mc].retiredAt = t0 + DAY;
  mentor.bank(s, mc, "y", t0 + 2 * DAY);
  check(mentor.tierFor(s.misconceptions[mc]) === 3, `a miss after clearing goes to tier 3`);
  const card = mentor.card(mc, content, s);
  check(card.banner?.kind === "third" && /Back after clearing/.test(card.banner.title), `and its banner says it came back`);
}

say("");
say("<b>Tier 3 arrives when promised and says so when it cannot</b>");
{
  const mc = ids.find((id) => mentor.contrastPair(id, content, fresh()));
  const s = fresh();
  for (let k = 0; k < 3; k++) mentor.bank(s, mc, "x", t0);
  check(s.misconceptions[mc].due <= t0, `a third miss is due at once, not one step out`);
  const c = mentor.card(mc, content, s);
  check(c.tier === 3 && /two paired questions/.test(c.banner?.text), `the banner promises a pair only when one exists`);
  const s2 = fresh();
  const lone = ids.find((id) => !mentor.contrastPair(id, content, fresh()));
  if (lone) {
    for (let k = 0; k < 3; k++) mentor.bank(s2, lone, "x", t0);
    const lc = mentor.card(lone, content, s2);
    check(/No paired questions/.test(lc.banner?.text), `"${lone}" has no pair, and the banner says it comes back as single questions`);
  }
  const tier2 = fresh();
  mentor.bank(tier2, mc, "x", t0);
  mentor.bank(tier2, mc, "x", t0);
  const b2 = mentor.card(mc, content, tier2).banner;
  check(b2?.kind === "again" && !/contrast drill/.test(b2.text), `tier 2 banner makes no promise about a drill or a layout`);
}

say("");
say("<b>The contrast pair never re-serves the missed item and turns with each miss</b>");
{
  let withPair = 0, reused = 0, sameAnswer = 0, turned = 0;
  for (const id of ids) {
    const s = fresh();
    const pool = mentor.itemsFor(id, content, s).mcqs;
    if (pool.length < 3) continue;
    for (let k = 0; k < 3; k++) mentor.bank(s, id, pool[0].id, t0);
    const p3 = mentor.contrastPair(id, content, s);
    if (!p3) continue;
    withPair++;
    if (p3.items.some((it) => it.id === pool[0].id)) reused++;
    const ans = p3.items.map((it) => it.options.find((o) => o.correct).text.trim().toLowerCase());
    if (ans[0] === ans[1]) sameAnswer++;
    mentor.bank(s, id, pool[0].id, t0);
    const p4 = mentor.contrastPair(id, content, s);
    if (p4 && p4.items.map((i) => i.id).join() !== p3.items.map((i) => i.id).join()) turned++;
  }
  check(withPair > 100 && reused === 0, `${withPair} third strikes: the missed item is never in the pair`, `(${reused} reused)`);
  check(sameAnswer === 0, `the two answers always differ`);
  check(turned > withPair / 2, `the pair changes on the next miss for most beliefs (${turned} of ${withPair})`);
}

say("");
say("<b>The terminology card names the pair you confused</b>");
{
  const tm = "terminology-1-2";
  const s = fresh();
  mentor.bank(s, tm, "x", t0, { picked: "Lighting", pickedDef: "Illumination at an entrance.", answer: "Access badge", answerDef: "A credential you present to a reader." });
  const c = mentor.card(tm, content, s);
  check(c.label.includes("Lighting") && c.label.includes("Access badge"), `the title is the pair ("${c.label}")`);
  check(c.mentor.contrast.length === 3 && c.mentor.contrast[1][1].includes("Illumination"), `both definitions are in the table, in full`);
  check(!/neighbour/.test(JSON.stringify(c.mentor)) && !c.mentor.trap, `no generic diagnosis and no flashcard lecture`);
  const empty = mentor.card(tm, content, fresh());
  check(/Easily confused/.test(empty.label) && !/neighbou?r(ing)? terms in/.test(empty.label), `with no pair recorded it still reads plainly, in American`);
}

say("");
say("<b>An authored table is never replaced</b>");
{
  const authored = ids.find((id) => content.misconceptions[id].mentor.contrast?.length > 1);
  const s = fresh();
  mentor.bank(s, authored, "x", t0, { picked: "A", pickedDef: "a", answer: "B", answerDef: "b" });
  const c = mentor.card(authored, content, s);
  check(JSON.stringify(c.mentor.contrast) === JSON.stringify(content.misconceptions[authored].mentor.contrast),
        `"${authored}" keeps its authored contrast table after a recorded pair`);
}
