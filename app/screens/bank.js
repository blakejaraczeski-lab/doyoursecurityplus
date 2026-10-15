import { App } from "../app.js";
import * as mentor from "../mentor.js";
import { startSession } from "./drill.js";
import { openPbq } from "./sheet.js";

/** Four unused questions that test one correction, as the weak-spot queue would retarget them. */
function queueFor(id) {
  const { mcqs, pbqs } = mentor.itemsFor(id, App.content, App.state, App.state.misconceptions[id]?.lastItem);
  const pool = [...mcqs, ...pbqs];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 4).map((pick) => ({
    kind: pick.subtasks ? "pbq" : "item",
    item: pick.subtasks ? undefined : pick,
    pbq: pick.subtasks ? pick : undefined,
    targetMisconception: id,
    reason: `Retargeting: ${App.content.misconceptions[id].label}`,
  }));
}

export const actions = {
  "bank-all": () => { App.bankAll = !App.bankAll; },
  "bank-all-cleared": () => { App.bankAllCleared = !App.bankAllCleared; },
  "expand-mc": (el) => { App.expanded = App.expanded === el.dataset.id ? null : el.dataset.id; },
  "open-cleared": (el) => { App.expanded = App.expanded === el.dataset.id ? null : el.dataset.id; },
  "bank-filter": (el) => {
    const f = { status: "all", domain: null, ...App.bankFilter };
    const { kind, value } = el.dataset;
    f[kind] = kind === "domain" && f.domain === value ? null : value;
    App.bankFilter = f;
    App.bankAll = false;
  },
  // A session on just this correction. startSession does the shared reset; the queue is swapped for ours.
  "start-mc": (el) => {
    const queue = queueFor(el.dataset.id);
    if (!queue.length) return;
    startSession("weak");
    App.queue = queue;
    App.screen = "drill-run";
    if (queue[0].pbq) openPbq(queue[0].pbq);
  },
};
