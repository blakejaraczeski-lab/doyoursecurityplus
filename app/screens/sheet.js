import { App } from "../app.js";

// --- the PBQ in front of you ----------------------------------------------
/** The blank answer sheet for a PBQ, shaped for its kind. */
export const emptyAnswers = (pbq) =>
  pbq.kind === "acl-table" ? { rules: [] }
  : pbq.kind === "network-diagram" ? { seenNodes: [] }
  : pbq.kind === "drag-order"
    ? (pbq.config.mode === "sequence" ? { order: [] } : { placements: {}, held: null })
  : {};

export function currentPbq() {
  if (App.screen === "lab-run") return App.lab;
  if (App.screen === "mock-run") return App.mock.items[App.mock.idx].pbq || null;
  if (App.screen === "drill-run") return App.queue[App.idx]?.pbq || null;
  return null;
}

export const answersFor = (pbq) => (App.answers[pbq.id] ||= emptyAnswers(pbq));

/** A fresh sheet and a fresh clock for a PBQ about to be worked in the drill or the lab. */
export function openPbq(pbq) {
  App.answers[pbq.id] = emptyAnswers(pbq);
  App.graded = null;
  App.pbqStartedAt = Date.now();
}
