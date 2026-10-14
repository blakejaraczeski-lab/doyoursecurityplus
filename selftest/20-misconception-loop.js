// The misconception loop: retirable, re-served on a different item, retired only by distinct clean passes.
import { buildQueue } from "../app/scheduler.js";
import { DEFAULT_STATE } from "../app/state.js";
import * as mentor from "../app/mentor.js";
import { say, check, content } from "./harness.js";

say("");
say("<b>Every misconception can actually be retired</b>");
say(`  <span class="dim">needs at least retireAfter distinct items testing it</span>`);
const unreachable = [];
for (const [id, def] of Object.entries(content.misconceptions)) {
  const { mcqs, pbqs } = mentor.itemsFor(id, content, { misconceptions: {} });
  const n = mcqs.length + pbqs.length;
  if (n < (def.retireAfter ?? 2)) unreachable.push(`${id} (${n})`);
}
check(unreachable.length === 0,
      `${Object.keys(content.misconceptions).length} misconceptions reachable`,
      unreachable.join(", "));

say("");
say("<b>The retargeting loop: a miss is re-served on a DIFFERENT item</b>");
const state = structuredClone(DEFAULT_STATE);
let retargeted = 0, sameItem = 0, noAlternative = 0;
for (const [id] of Object.entries(content.misconceptions)) {
  const { mcqs } = mentor.itemsFor(id, content, { misconceptions: {} });
  if (!mcqs.length) continue;
  const failedOn = mcqs[0].id;
  mentor.bank(state, id, failedOn);
  const later = Date.now() + 60 * 60 * 1000;
  const q = buildQueue(state, content, { mode: "weak", size: 200, now: later })
    .filter((e) => e.targetMisconception === id);
  if (!q.length) continue;
  const served = q[0].item?.id || q[0].pbq?.id;
  if (!served) noAlternative++;
  else if (served === failedOn) sameItem++;
  else retargeted++;
}
check(sameItem === 0,
      `${retargeted} misconceptions re-served on a different item, ${sameItem} repeated the failed item`);

say("");
say("<b>Retirement requires clean passes on DISTINCT items</b>");
const s2 = structuredClone(DEFAULT_STATE);
const probe = Object.keys(content.misconceptions).find((id) => {
  const { mcqs } = mentor.itemsFor(id, content, { misconceptions: {} });
  return mcqs.length >= 2;
});
const items = mentor.itemsFor(probe, content, { misconceptions: {} }).mcqs;
mentor.bank(s2, probe, items[0].id);
mentor.pass(s2, probe, items[1].id, content);
const afterOne = s2.misconceptions[probe].retired;
mentor.pass(s2, probe, items[1].id, content); // same item again, must not count
const afterRepeat = s2.misconceptions[probe].retired;
mentor.pass(s2, probe, items[0].id, content); // a genuinely different item
const afterTwo = s2.misconceptions[probe].retired;
check(!afterOne, `one clean pass does not retire "${probe}"`);
check(!afterRepeat, `repeating the same item does not count toward retirement`);
check(afterTwo, `two clean passes on distinct items retires it`);
