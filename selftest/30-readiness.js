// Readiness, vocabulary cards and the review log.
import { isGraded } from "../app/content.js";
import { readiness, coverageDeficit } from "../app/scheduler.js";
import { DEFAULT_STATE, pruneOrphans } from "../app/state.js";
import { calibrationOf, todayOf } from "../app/reviews.js";
import * as fsrs from "../app/fsrs.js";
import { say, check, content } from "./harness.js";

say("");
say("<b>Readiness measures the learner, not the size of the bank</b>");
say('  <span class="dim">a small bank must not read as a weakness in the learner</span>');
{
  const perfect = structuredClone(DEFAULT_STATE);
  const graded = content.items.filter(isGraded);
  for (const it of graded) {
    perfect.items[it.id] = { seen: 3, correct: 3, wrong: 0, lastSeen: Date.now(), fsrs: null };
  }
  const r = readiness(perfect, content);
  const withItems = Object.values(r.perObjective).filter((o) => o.itemsAvailable > 0);
  // The harm being locked out: an objective used to read "shaky" or "weak" on a
  // flawless record purely because the bank held fewer than 12 items for it.
  // Residual smoothing is fine and intended: laplace() still holds a two-item
  // objective slightly short of "strong", because two items really are less
  // evidence than twelve. What must never come back is a small bank reading as
  // a weakness.
  const dragged = withItems.filter((o) => o.status === "shaky" || o.status === "weak");
  check(dragged.length === 0,
        `no stocked objective reads shaky or weak on a perfect record (${withItems.length} checked)`,
        dragged.length ? `(${dragged.map((o) => `${o.objective}:${o.status}@${o.itemsAvailable} items`).join(", ")})` : "");

  const floor = Math.min(...withItems.map((o) => o.mastery));
  const worst = withItems.find((o) => o.mastery === floor);
  say(`  <span class="dim">     weakest perfect objective: ${worst.objective} at ${floor.toFixed(2)} on ${worst.itemsAvailable} items (was 0.58 under the flat denominator)</span>`);

  const unreachable = withItems.filter((o) => o.coverage < 1);
  check(unreachable.length === 0,
        `every stocked objective can reach coverage 1`,
        unreachable.length ? `(${unreachable.map((o) => `${o.objective}:${o.coverage.toFixed(2)}`).join(", ")})` : "");

  // This is the one coverage calculation. It is asserted here, not mirrored.
  const thin = withItems.filter((o) => o.thin).map((o) => o.objective);
  check(r.topicsCovered === r.topicsTotal,
        `every blueprint topic has a graded item (${r.topicsCovered}/${r.topicsTotal})`,
        `(${r.topicsTotal - r.topicsCovered} topics have none)`);
  check(thin.length === 0, `no objective reads thin`, `(${thin.join(", ")})`);
  const units = withItems.map((o) => ({ id: o.objective, n: o.itemsAvailable + o.pbqAvailable }))
    .sort((a, b) => a.n - b.n).slice(0, 3);
  say(`  <span class="dim">     thinnest by graded units: ${units.map((u) => `${u.id} (${u.n})`).join(", ")}</span>`);

  const deficit = coverageDeficit(perfect, content);
  const stillPulling = Object.entries(deficit).filter(([, d]) => d.remaining === 0 && d.deficit !== 0);
  check(stillPulling.length === 0,
        `an exhausted domain stops reporting a deficit the queue cannot spend`,
        stillPulling.length ? `(${stillPulling.map(([k]) => k).join(", ")})` : "");
}

say("");
say("<b>A revealed vocabulary card does not cover a domain</b>");
{
  const vocabOnly = structuredClone(DEFAULT_STATE);
  const recall = content.items.filter((i) => i.type === "recall" && i.objective);
  for (const it of recall) {
    vocabOnly.items[it.id] = { seen: 1, correct: 1, wrong: 0, lastSeen: Date.now(), fsrs: null };
  }
  const d = coverageDeficit(vocabOnly, content);
  const counted = Object.values(d).reduce((a, b) => a + b.seen, 0);
  check(counted === 0,
        `${recall.length} revealed recall cards contribute 0 to domain coverage`,
        counted ? `(counted ${counted})` : "");
}

say("");
say("<b>The review log answers the questions the state document no longer can</b>");
{
  const d = new Date(2026, 9, 12, 15, 0, 0);
  const t0 = new Date(2026, 9, 12, 0, 0, 0).getTime();
  const rows = [
    { at: t0 - 1000, kind: "item", grade: 3, conf: "sure" },          // yesterday
    { at: t0 + 1000, kind: "item", grade: 3, conf: "sure" },
    { at: t0 + 2000, kind: "item", grade: 1, conf: "sure" },
    { at: t0 + 3000, kind: "item", grade: 3, conf: "guess" },
    { at: t0 + 4000, kind: "item", grade: 1, mock: true },             // no conf: not calibration
    { at: t0 + 5000, kind: "misconception", grade: 1 },               // not an answer
    { at: t0 + 6000, kind: "mock", scaled: 700 },
  ];
  check(todayOf(rows, d) === 4, `today counts answers only: 4 of ${rows.length} rows`, `(got ${todayOf(rows, d)})`);
  const c = calibrationOf(rows);
  check(c.sureRight === 2 && c.sureWrong === 1 && c.guessRight === 1 && c.answered === 4,
        `calibration counts declared confidence only: ${c.sureRight}/${c.sureWrong}/${c.guessRight}/${c.guessWrong}`);
  check(!("reviews" in DEFAULT_STATE), "the state document has no reviews array");
  const ghost = structuredClone(DEFAULT_STATE);
  ghost.misconceptions["no-such-misconception"] = { retired: false, cleanPasses: [] };
  check(pruneOrphans(ghost, content) === 1 && !ghost.misconceptions["no-such-misconception"],
        "an open misconception with no definition in the bank is pruned, not counted forever");
}
