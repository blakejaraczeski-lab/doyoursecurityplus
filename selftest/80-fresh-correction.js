// A fresh correction is not retested within the next answers.
import { isGraded } from "../app/content.js";
import { spaceAfterMiss, RESERVE_GAP } from "../app/scheduler.js";
import { say, check, content } from "./harness.js";

say("");
say("<b>A fresh correction is not retested within the next answers</b>");
{
  const mc = "salting-purpose";
  const testing = content.items.filter((i) => isGraded(i) && i.options.some((o) => o.misconception === mc));
  const other = content.items.filter((i) => isGraded(i) && !i.options.some((o) => o.misconception === mc)).slice(0, 6);
  const e = (item, extra = {}) => ({ kind: "item", item, reason: "", ...extra });
  const q = [e(testing[0]), e(testing[1]), e(testing[2]), e(other[0], { contrastDrill: { index: 0, of: 2 }, targetMisconception: mc }), e(other[1]), e(other[2]), e(other[3]), e(other[4])];
  const moved = spaceAfterMiss(q, 0, [mc]);
  const near = q.slice(1, 1 + RESERVE_GAP).filter((x) => !x.contrastDrill && x.item.options.some((o) => o.misconception === mc));
  check(moved === 2 && near.length === 0 && q.length === 8 && q.indexOf(q.find((x) => x.item === testing[1])) > RESERVE_GAP,
        `after a miss, the next ${RESERVE_GAP} answers hold no other question on the same belief; ${moved} moved later, none lost`);
  check(q.slice(1, 1 + RESERVE_GAP).some((x) => x.contrastDrill), `a contrast pair is left where it is`);
  const short = [e(testing[0]), e(testing[1])];
  check(spaceAfterMiss(short, 0, [mc]) === 1 && short.length === 1,
        `with no room left in the session, the question leaves it; its correction returns on its own schedule`);
}
