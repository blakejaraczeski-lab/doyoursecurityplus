// What the queue maximizes: expected exam points per minute.
import { buildQueue, currentPriority, expectedGain, gainContext, POINTS_PER_QUESTION } from "../app/scheduler.js";
import { DEFAULT_STATE } from "../app/state.js";
import * as fsrs from "../app/fsrs.js";
import { say, check, content } from "./harness.js";

say("");
say("<b>What the queue maximises: expected exam points per minute</b>");
{
  const withSeed = (seed, fn) => {
    const real = Math.random;
    let x = seed;
    Math.random = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    try { return fn(); } finally { Math.random = real; }
  };
  const now = new Date(2026, 9, 12, 12, 0, 0).getTime();
  const s = structuredClone(DEFAULT_STATE);
  s.profile.examDate = "2026-12-01";
  const ctx = gainContext(s, content, now);
  const mcq = content.items.find((i) => i.type === "mcq" && i.objective);
  const card = content.items.find((i) => i.type === "recall" && i.objective === mcq.objective) || content.items.find((i) => i.type === "recall");
  const g = expectedGain({ item: mcq }, s, content, ctx);
  check(g.points > 0 && g.points < POINTS_PER_QUESTION, `an unseen graded item is worth a fraction of one exam question (${g.points.toFixed(2)} points)`);
  check(expectedGain({ item: card }, s, content, ctx).points < g.points,
        `a recall card is worth less than a graded item in the same objective`);

  // Learned to the hilt: retrievability far above 0.95 at the exam date. Not worth a minute.
  const held = structuredClone(s);
  held.items[mcq.id] = { seen: 6, correct: 6, wrong: 0, lastSeen: now, fsrs: { stability: 4000, difficulty: 3, due: now, lastReview: now - 86400000, reps: 6, lapses: 0, state: "review" } };
  check(expectedGain({ item: mcq }, held, content, gainContext(held, content, now)).points < 0.01,
        `an item held at retrievability above 0.95 through the exam is worth nothing`);

  // The documented current policy: a prerequisite repair outranks any new item.
  check(currentPriority({ prereqRepair: {}, targetMisconception: "x" }, s, content, now) > currentPriority({ item: mcq }, s, content, now),
        `currentPriority writes down the old order: a prerequisite repair outranks new coverage`);

  // Interleaved and exam shaped, from a fresh state over eight seeds.
  const doms = {}, worst = [];
  for (let seed = 1; seed <= 8; seed++) {
    const q = withSeed(seed, () => buildQueue(s, content, { size: 25, now }));
    const byObj = {};
    for (const e of q) {
      const it = e.item || e.pbq;
      doms[content.domainOf[it.objective]] = (doms[content.domainOf[it.objective]] || 0) + 1;
      byObj[it.objective] = (byObj[it.objective] || 0) + 1;
    }
    worst.push(Math.max(...Object.values(byObj)));
  }
  const total = Object.values(doms).reduce((a, b) => a + b, 0);
  const off = content.objectives.domains.filter((d) => Math.abs((doms[d.id] || 0) / total - d.weight) > 0.06);
  check(Math.max(...worst) <= 5, `no objective takes more than 5 of 25 slots (most was ${Math.max(...worst)})`);
  check(off.length === 0,
        `domain mix within 6 points of the exam weights: ${content.objectives.domains.map((d) => `${d.id}:${Math.round(100 * (doms[d.id] || 0) / total)}%/${Math.round(d.weight * 100)}`).join(" ")}`);
}
