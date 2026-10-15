import { App } from "../app.js";
import { presentOptions } from "../ui/common.js";
import { emptyAnswers } from "./sheet.js";

// A mock in progress is kept in this browser, in its own key, so a reload or a
// discarded tab does not lose a 90 minute sitting. It is not part of the study
// document: that one is shared with the server and must stay small. The clock
// is wall time (endsAt), so a restored mock simply finds how much is left.
const KEY = "dysp.mock";
const KEEP_RESULT_MS = 24 * 3600e3;   // a finished result stays on screen across reloads for a day
let last = null;                       // what was last written, so an unchanged mock writes nothing

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const write = (s) => { try { s == null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, s); } catch {} };

function pack(m) {
  return {
    v: 1, format: m.format, minutes: m.minutes, startedAt: m.startedAt, endsAt: m.endsAt, idx: m.idx,
    screen: App.screen === "mock-review" ? "mock-review" : "mock-run",
    answers: m.answers, flagged: [...m.flagged], result: m.result,
    // Items by id, with the option order the learner saw, so letters stay put.
    items: m.items.map((e) => e.kind === "pbq" ? { id: e.pbq.id } : { id: e.item.id, order: e.item.options.map((o) => o.id) }),
    sheets: Object.fromEntries(m.items.filter((e) => e.kind === "pbq").map((e) => [e.pbq.id, App.answers[e.pbq.id] || {}])),
  };
}

/** Write the mock now in memory, or clear the saved one when there is none. */
export function stash() {
  const s = App.mock ? JSON.stringify(pack(App.mock)) : null;
  if (s === last) return;
  last = s;
  write(s);
}

/**
 * The saved mock, rebuilt against the loaded content, or null. A mock whose
 * items are no longer in the bank cannot be rebuilt faithfully and is dropped.
 */
export function revive() {
  const s = read();
  if (!s) return null;
  const drop = () => { write(null); return null; };
  if (s.v !== 1 || !Array.isArray(s.items) || (s.result && Date.now() - s.result.at > KEEP_RESULT_MS)) return drop();

  const items = [];
  for (const it of s.items) {
    if (it.order) {
      const item = App.content.itemsById[it.id];
      if (!item) return drop();
      items.push({ kind: "item", item, order: it.order });
    } else {
      const pbq = App.content.pbqsById[it.id];
      if (!pbq) return drop();
      items.push({ kind: "pbq", pbq });
    }
  }
  for (const e of items) {
    if (e.kind !== "item") continue;
    presentOptions(e);   // marks it presented, so the view keeps the order restored below
    const byId = new Map(e.item.options.map((o) => [o.id, o]));
    if (e.order.length === byId.size && e.order.every((id) => byId.has(id))) e.item.options.splice(0, byId.size, ...e.order.map((id) => byId.get(id)));
    delete e.order;
  }
  for (const e of items) if (e.kind === "pbq") App.answers[e.pbq.id] = { ...emptyAnswers(e.pbq), ...(s.sheets?.[e.pbq.id] || {}) };

  last = null;
  return {
    screen: s.screen,
    mock: {
      format: s.format, minutes: s.minutes, items, idx: Math.min(Math.max(0, s.idx | 0), items.length - 1),
      answers: s.answers || {}, flagged: new Set(s.flagged || []),
      startedAt: s.startedAt, endsAt: s.endsAt, result: s.result || null,
    },
  };
}
