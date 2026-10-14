import { App, announce, renderApp, save } from "../app.js";
import { gradePbq } from "../grade.js";
import { spaceAfterMiss } from "../scheduler.js";
import { aclReadoutHtml } from "../ui/pbq.js";
import { mentorCards, pbqAnswered } from "../ui/common.js";
import { recordPbq } from "../record.js";
import { currentPbq, answersFor } from "./sheet.js";
import { next } from "./drill.js";

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

/**
 * Keyboard for the click-to-place PBQs: a letter holds a chip from the pool, a
 * digit places it in that position or bucket. The letters and digits are drawn
 * on the controls. Returns true if the key did something.
 */
function orderKey(e, pbq) {
  if (pbq.kind !== "drag-order") return false;
  const a = answersFor(pbq);
  const cfg = pbq.config;
  const letter = "abcdefghij".indexOf(e.key.toLowerCase());
  const digit = "1234567890".indexOf(e.key);
  const hold = (item) => { a.held = a.held === item.id ? null : item.id; return true; };
  if (cfg.mode === "sequence") {
    const order = a.order || [];
    const pool = cfg.items.filter((i) => !order.includes(i.id));
    if (letter >= 0 && pool[letter]) return hold(pool[letter]);
    if (digit >= 0 && a.held && digit < cfg.items.length && order[digit] == null) {
      actions["order-place-at"]({ dataset: { i: String(digit) } });
      return true;
    }
    return false;
  }
  const pool = cfg.items.filter((i) => !(a.placements || {})[i.id]);
  if (letter >= 0 && pool[letter]) return hold(pool[letter]);
  if (digit >= 0 && a.held && cfg.buckets[digit]) {
    actions["order-drop"]({ dataset: { bucket: cfg.buckets[digit].id } });
    return true;
  }
  return false;
}

/** Keep the readable policy in step with the grid without re-rendering it. */
function refreshAclReadout(edited = -1) {
  const el = document.getElementById("acl-readout");
  const pbq = currentPbq();
  if (!el || pbq?.kind !== "acl-table") return;
  el.outerHTML = aclReadoutHtml(pbq.config, answersFor(pbq).rules || [], edited);
}

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
  "acl-add": () => {
    const a = answersFor(currentPbq());
    a.rules.push({ action: "permit", protocol: "tcp", src: "any", srcPort: "any", dst: "any", dstPort: "any" });
  },
  "acl-del": (el) => answersFor(currentPbq()).rules.splice(Number(el.dataset.i), 1),
  "acl-up": (el) => {
    const i = Number(el.dataset.i), r = answersFor(currentPbq()).rules;
    [r[i - 1], r[i]] = [r[i], r[i - 1]];
  },
  "acl-down": (el) => {
    const i = Number(el.dataset.i), r = answersFor(currentPbq()).rules;
    [r[i + 1], r[i]] = [r[i], r[i + 1]];
  },
  "diagram-choice": (el) => { answersFor(currentPbq())[el.dataset.task] = el.dataset.value; },
  // data-host, not data-node: the diagram's own click handler claims anything
  // carrying data-node before action dispatch ever runs.
  "node-toggle": (el) => {
    const a = answersFor(currentPbq());
    const list = (a[el.dataset.task] ||= []);
    const at = list.indexOf(el.dataset.host);
    if (at >= 0) list.splice(at, 1); else list.push(el.dataset.host);
  },

  // Click to place, rather than HTML5 drag: keyboard reachable, touch friendly,
  // and it does not lose the item when a drag wobbles. Positions fill in any
  // order, so the step you are sure is last can be committed first.
  "order-place-at": (el) => {
    const a = answersFor(currentPbq());
    const i = Number(el.dataset.i);
    const order = [...(a.order || [])];
    while (order.length <= i) order.push(undefined);
    order[i] = a.held;
    a.order = order;
    a.held = null;
    announce(`Placed in position ${i + 1}.`);
  },
  "order-unplace": (el) => {
    const a = answersFor(currentPbq());
    // Clear the position, do not splice it out: with positional placement,
    // splicing would silently shift every later step up by one.
    const order = [...(a.order || [])];
    order[Number(el.dataset.i)] = undefined;
    while (order.length && order[order.length - 1] === undefined) order.pop();
    a.order = order;
  },
  "order-hold": (el) => {
    const a = answersFor(currentPbq());
    a.held = a.held === el.dataset.item ? null : el.dataset.item;
    announce(a.held ? `Holding ${el.textContent.trim()}. Choose where it goes.` : "Released.");
  },
  "order-drop": (el) => {
    const a = answersFor(currentPbq());
    if (!a.held) return;
    (a.placements ||= {})[a.held] = el.dataset.bucket;
    a.held = null;
    announce(`Placed in ${currentPbq().config.buckets.find((b) => b.id === el.dataset.bucket)?.label || "the column"}.`);
  },
  "order-remove": (el) => {
    const a = answersFor(currentPbq());
    delete (a.placements ||= {})[el.dataset.item];
  },
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
  if (!App.graded && orderKey(e, pbq)) { e.preventDefault(); renderApp(); }
  return true;
}

/** A field changed inside a PBQ. Returns true if it was one of ours. */
export function change(t) {
  if (t.dataset.pbqField) {
    answersFor(currentPbq())[t.dataset.pbqField] = t.value;
    renderApp();
    return true;
  }
  if (t.dataset.acl) {
    answersFor(currentPbq()).rules[Number(t.dataset.acl)][t.dataset.k] = t.value;
    // A full render would rebuild the select you are still interacting with and
    // take the focus with it, so the plain-text policy is refreshed on its own.
    refreshAclReadout(Number(t.dataset.acl));
    return true;
  }
  return false;
}
