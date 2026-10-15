import { App, announce, renderApp } from "../app.js";
import { currentPbq, answersFor } from "./sheet.js";

/**
 * Open a diagram host's evidence. Inspecting a host is not accusing it: naming
 * it compromised is a separate, explicit act, because gathering evidence before
 * committing to a verdict is the skill this question trains.
 */
export function inspectNode(id) {
  const pbq = currentPbq();
  if (!pbq || App.graded) return;
  const def = pbq.config.nodes.find((n) => n.id === id);
  if (!def || def.selectable === false) return;
  const a = answersFor(pbq);
  a.inspected = def.id;
  a.seenNodes = [...new Set([...(a.seenNodes || []), def.id])];
  announce(`${def.label}: evidence shown below the diagram.`);
  renderApp();
}

export const actions = {
  "diagram-choice": (el) => { answersFor(currentPbq())[el.dataset.task] = el.dataset.value; },
  // data-host, not data-node: the diagram's own click handler claims anything
  // carrying data-node before action dispatch ever runs.
  "node-toggle": (el) => {
    const a = answersFor(currentPbq());
    const list = (a[el.dataset.task] ||= []);
    const at = list.indexOf(el.dataset.host);
    if (at >= 0) list.splice(at, 1); else list.push(el.dataset.host);
  },
};
