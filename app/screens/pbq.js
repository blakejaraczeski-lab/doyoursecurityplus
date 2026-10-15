import { App, announce, renderApp, save } from "../app.js";
import { gradePbq } from "../grade.js";
import { spaceAfterMiss } from "../scheduler.js";
import { mentorCards, pbqAnswered } from "../ui/common.js";
import { recordPbq } from "../record.js";
import { answersFor, currentPbq } from "./sheet.js";
import { next } from "./drill.js";
import * as acl from "./pbq-acl.js";
import * as diagram from "./pbq-diagram.js";
import * as order from "./pbq-order.js";
import * as wireless from "./pbq-wireless.js";

// Submit, continue and the keys for a PBQ in front of you; each engine owns
// its own actions, keys and change handler and this file merges them.
export { inspectNode } from "./pbq-diagram.js";

function submitPbq() {
  const pbq = currentPbq();
  const now = Date.now();
  const g = gradePbq(pbq, answersFor(pbq));
  const banked = recordPbq(pbq, g, now, {
    seconds: App.pbqStartedAt ? Math.round((now - App.pbqStartedAt) / 1000) : null,
  });
  if (App.screen === "drill-run") {
    spaceAfterMiss(App.queue, App.idx, banked);
    App.sessionStats.banked += banked.length;
    App.sessionStats.answered += 1;
    if (g.percent >= 80) App.sessionStats.correct += 1;
  }
  g.mentorHtml = mentorCards(App, banked);
  App.graded = g;
  announce(`Scored ${g.earned} of ${g.max}, ${g.percent} percent.`);
  save();
}

export const actions = {
  "pbq-submit": submitPbq,
  "pbq-continue": () => {
    if (App.screen === "lab-run") { App.lab = null; App.graded = null; App.screen = "lab-list"; }
    else next();
  },
  ...acl.actions,
  ...diagram.actions,
  ...order.actions,
};

/**
 * Keys for a PBQ in the drill or the lab. Enter on a focused button is the
 * button's; Enter anywhere else submits, and then continues. The ACL grid and
 * the wireless form are native controls reached by Tab and have no letter keys.
 * Returns true when a PBQ is in front of you, so the item keys stand aside.
 */
export function keys(e, tag) {
  const pbq = App.screen === "mock-run" ? null : currentPbq();
  if (!pbq) return false;
  if (tag === "BUTTON" && (e.key === "Enter" || e.key === " ")) return true;
  if (e.key === "Enter") {
    e.preventDefault();
    // A held or mashed Enter must not carry on into the next PBQ and score
    // it blank: repeats are ignored, and Enter submits only an answered sheet.
    if (e.repeat) return true;
    if (App.graded) actions["pbq-continue"]();
    else if (pbqAnswered(answersFor(pbq))) submitPbq();
    else return true;
    renderApp();
    return true;
  }
  if (!App.graded && order.keys(e, pbq)) { e.preventDefault(); renderApp(); }
  return true;
}

/** A field changed inside a PBQ. Returns true if it was one of ours. */
export function change(t) {
  return wireless.change(t) || acl.change(t);
}
