import { announce } from "../app.js";
import { currentPbq, answersFor } from "./sheet.js";

/**
 * Keyboard for the click-to-place PBQs: a letter holds a chip from the pool, a
 * digit places it in that position or bucket. The letters and digits are drawn
 * on the controls. Returns true if the key did something.
 */
export function keys(e, pbq) {
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

export const actions = {
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
