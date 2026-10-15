// One grader per PBQ kind, one file each (grade-acl, grade-wireless,
// grade-diagram, grade-order); this file only dispatches. Each returns
// per-subtask results with the misconception every miss maps to, which is what
// the mentor engine consumes, and partial credit is real: a subtask scores on
// its own.

import { gradeAcl } from "./grade-acl.js";
import { gradeWireless } from "./grade-wireless.js";
import { gradeDiagram } from "./grade-diagram.js";
import { gradeOrder } from "./grade-order.js";

// --- any PBQ ------------------------------------------------------------------
const GRADERS = {
  "acl-table": gradeAcl,
  "wireless-config": gradeWireless,
  "network-diagram": gradeDiagram,
  "drag-order": gradeOrder,
};

/** Can this PBQ be worked and scored in this build? A kind with no engine is listed, never served. */
export const hasGrader = (pbq) => Object.prototype.hasOwnProperty.call(GRADERS, pbq.kind);

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
