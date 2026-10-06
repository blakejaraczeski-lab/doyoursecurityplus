import { gradeAcl } from "./acl.js";
import { gradeWireless } from "./wireless.js";
import { gradeDiagram } from "./diagram.js";
import { gradeOrder } from "./order.js";

const GRADERS = {
  "acl-table": gradeAcl,
  "wireless-config": gradeWireless,
  "network-diagram": gradeDiagram,
  "drag-order": gradeOrder,
};

/**
 * Grade any PBQ. Returns per-subtask results with the misconception each miss
 * maps to, which is what the mentor engine consumes.
 */
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

export { gradeAcl, gradeWireless, gradeDiagram, gradeOrder };
