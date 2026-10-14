// Nothing is drilled on top of an open prerequisite.
import { buildQueue } from "../app/scheduler.js";
import { DEFAULT_STATE } from "../app/state.js";
import * as mentor from "../app/mentor.js";
import { say, check, content } from "./harness.js";

say("");
say("<b>Nothing is drilled on top of an open prerequisite</b>");
{
  const now = new Date(2026, 9, 12, 12, 0, 0).getTime();
  const fresh = () => { const s = structuredClone(DEFAULT_STATE); s.profile.examDate = "2026-12-01"; return s; };
  const due = (s, id) => mentor.bank(s, id, "exposed-" + id, now - 30 * 60000);
  const drilledAlone = (q, ids) => q.filter((e) => ids.includes(e.targetMisconception) && !e.prereqRepair).length;

  // Two corrections on one open prerequisite: one repair, neither drilled alone.
  const s1 = fresh();
  for (const id of ["acl-direction-and-ports", "acl-overbroad-any", "screened-subnet-direction", "stateful-return-traffic"]) due(s1, id);
  const q1 = buildQueue(s1, content, { mode: "weak", size: 15, now });
  const repairs = q1.filter((e) => e.prereqRepair && e.targetMisconception === "acl-direction-and-ports").length;
  check(repairs === 1 && drilledAlone(q1, ["acl-overbroad-any", "screened-subnet-direction", "stateful-return-traffic"]) === 0,
        `three corrections sharing one open prerequisite: ${repairs} repair, none drilled on top of it`);

  // A prerequisite with no unused question left: its correction is served as the repair.
  const s2 = fresh();
  due(s2, "acl-direction-and-ports");
  due(s2, "acl-overbroad-any");
  const pre = s2.misconceptions["acl-direction-and-ports"];
  pre.cleanPasses = mentor.itemsFor("acl-direction-and-ports", content, fresh()).mcqs.map((i) => i.id)
    .concat(mentor.itemsFor("acl-direction-and-ports", content, fresh()).pbqs.map((p) => p.id));   // every question used
  pre.retired = false;
  const q2 = buildQueue(s2, content, { mode: "weak", size: 15, now });
  const r2 = q2.find((e) => e.prereqRepair);
  check(r2 && r2.kind === "mentor" && r2.targetMisconception === "acl-direction-and-ports" && drilledAlone(q2, ["acl-overbroad-any"]) === 0,
        `a prerequisite with no question left is repaired with its correction, and the symptom still waits`);
}
