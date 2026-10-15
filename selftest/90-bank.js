// The mentor bank screen: its order is the drill's order, an open correction is one card with
// a drill of its own, the list can be filtered, cleared corrections are proof, sure-and-wrong shows.
import { DEFAULT_STATE } from "../app/state.js";
import * as mentor from "../app/mentor.js";
import { mentorView } from "../app/ui/bank.js";
import { say, check, content } from "./harness.js";

const DAY = 86400e3;
const NOW = Date.now();
const fresh = () => ({ ...structuredClone(DEFAULT_STATE), misconceptions: {} });
const view = (state, extra = {}) => {
  const App = { state, content, expanded: null, bankAll: false, ...extra };
  const doc = new DOMParser().parseFromString(`<div id="r">${mentorView(App)}</div>`, "text/html");
  return { html: doc.getElementById("r").innerHTML, root: doc.getElementById("r"), doc };
};
const ids = (root) => [...root.querySelectorAll("[data-action=expand-mc]")].map((b) => b.dataset.id);

say("");
say("<b>The mentor bank</b>");
const guarded = (name, fn) => { try { fn(); } catch (e) { check(false, `${name} ran without throwing`, String(e)); } };

guarded("order", () => {
  // older and low severity vs newer and high severity: the drill serves the second first
  const s = fresh();
  mentor.bank(s, "ups-vs-generator", "x1", NOW - 5 * DAY);
  mentor.bank(s, "ids-vs-ips-placement", "x2", NOW - 1 * DAY);
  mentor.bank(s, "salting-purpose", "x3", NOW - 2 * DAY);
  mentor.bank(s, "crl-vs-ocsp", "x4", NOW);   // not due yet
  const due = mentor.due(s, content, NOW + 1000).map((d) => d.id);
  const shown = ids(view(s).root);
  check(JSON.stringify(shown.slice(0, due.length)) === JSON.stringify(due) && due.length === 3,
        `the list opens in the order the drill serves it, most urgent first (${shown.join(", ")})`);
  check(shown[shown.length - 1] === "crl-vs-ocsp", "a correction not yet due follows the due ones");
});

guarded("sure", () => {
  const s = fresh();
  mentor.bank(s, "ups-vs-generator", "x1", NOW - 2 * DAY, null, true);
  mentor.bank(s, "salting-purpose", "x2", NOW - 2 * DAY, null, false);
  const { root } = view(s);
  const text = (id) => root.querySelector(`[data-action=expand-mc][data-id="${id}"]`).closest(".card").textContent;
  check(/sure and wrong 1/.test(text("ups-vs-generator")) && !/sure and wrong/.test(text("salting-purpose")),
        "a correction you were sure about carries a sure-and-wrong tag; a flagged guess does not");
});

guarded("open card", () => {
  const s = fresh();
  mentor.bank(s, "hashing-vs-encryption", "x1", NOW - DAY);
  mentor.bank(s, "salting-purpose", "x2", NOW - DAY);
  const closed = view(s);
  const t = closed.root.querySelector("[data-action=expand-mc][data-id=hashing-vs-encryption]");
  check(t.getAttribute("aria-expanded") === "false" && t.getAttribute("aria-controls") === "mc-hashing-vs-encryption",
        "the toggle says it is collapsed and names the card it controls");
  check(/Read the correction/.test(t.textContent), `the toggle says what it opens ("${t.textContent.trim()}")`);
  const open = view(s, { expanded: "hashing-vs-encryption" });
  const label = content.misconceptions["hashing-vs-encryption"].label;
  const o = open.root.querySelector("[data-action=expand-mc][data-id=hashing-vs-encryption]");
  check(o.getAttribute("aria-expanded") === "true" && open.root.querySelector("#mc-hashing-vs-encryption"),
        "an open row reports expanded and the controlled card exists");
  check(open.html.split(label).length - 1 === 1, "an open correction is one card: its label and objective are not repeated above it");
  const drill = open.root.querySelector("[data-action=start-mc][data-id=hashing-vs-encryption]");
  check(drill && /Drill this one/.test(drill.textContent), "an open correction offers a drill on just that one");
  check(/different questions/.test(open.root.querySelector("#mc-hashing-vs-encryption").textContent),
        "and says how many different questions can clear it");
  const none = view(s, { expanded: "salting-purpose" });
  check(!!none.root.querySelector("[data-action=start-mc]"), "salting has questions left, so it also offers the drill");
  const used = fresh();
  mentor.bank(used, "wps-convenience-risk", "x1", NOW - DAY);
  const all = mentor.itemsFor("wps-convenience-risk", content, used);
  used.misconceptions["wps-convenience-risk"].cleanPasses = [...all.mcqs, ...all.pbqs].map((i) => i.id);
  const gone = view(used, { expanded: "wps-convenience-risk" });
  check(!gone.root.querySelector("[data-action=start-mc]") && /no other question/i.test(gone.root.textContent),
        "with no unused question left, there is no drill button and the screen says why");
});

guarded("filters", () => {
  const s = fresh();
  const pick = [["ups-vs-generator", 1], ["ids-vs-ips-placement", 1], ["salting-purpose", 1], ["crl-vs-ocsp", 1],
                ["hashing-vs-encryption", 1], ["wpa3-sae-vs-enterprise", 1], ["phishing-variants", 1], ["acl-rule-order", 1]];
  for (const [id] of pick) mentor.bank(s, id, "x-" + id, NOW - DAY);
  const all = view(s);
  check(all.root.querySelectorAll("[data-action=bank-filter]").length >= 5, "with more than five open, the filter chips show");
  const high = view(s, { bankFilter: { status: "high", domain: null } });
  const cards = [...high.root.querySelectorAll("[data-action=expand-mc]")].map((b) => b.closest(".card"));
  const wantHigh = pick.filter(([id]) => content.misconceptions[id].severity === "high").length;
  check(cards.length === wantHigh && cards.every((c) => /high impact/.test(c.textContent)),
        `the high impact chip shows only high impact corrections (${cards.length} of ${pick.length})`);
  check(new RegExp(`Showing ${wantHigh} of ${pick.length}`).test(high.root.textContent), "and the count line says how many of how many");
  const pressed = [...high.root.querySelectorAll("[data-action=bank-filter]")].filter((b) => b.getAttribute("aria-pressed") === "true");
  check(pressed.length === 1 && /High impact/.test(pressed[0].textContent), "the chip in force is pressed, by attribute and by word");
  const dom3 = view(s, { bankFilter: { status: "all", domain: "3" } });
  check(ids(dom3.root).every((id) => content.domainOf[content.misconceptions[id].objective] === "3") && ids(dom3.root).length === 2,
        "a domain chip narrows to that domain");
  const none = view(s, { bankFilter: { status: "sure", domain: "5" } });
  check(/Nothing open matches/.test(none.root.textContent) && none.root.querySelector("[data-action=bank-filter][data-kind=status][data-value=all]"),
        "a filter that matches nothing says so and offers All");
  const few = fresh();
  mentor.bank(few, "ups-vs-generator", "x", NOW - DAY);
  mentor.bank(few, "crl-vs-ocsp", "y", NOW - DAY);
  check(!view(few, { bankFilter: { status: "high", domain: null } }).root.querySelector("[data-action=bank-filter]") &&
        ids(view(few, { bankFilter: { status: "high", domain: null } }).root).length === 2,
        "with five or fewer open there are no chips, and a stale filter does not hide anything");
});

guarded("cleared", () => {
  const s = fresh();
  const t0 = new Date(2026, 9, 12, 12).getTime();
  mentor.bank(s, "ups-vs-generator", "x1", t0 - 5 * DAY);
  const a = mentor.itemsFor("ups-vs-generator", content, s).mcqs;
  mentor.pass(s, "ups-vs-generator", a[0].id, content, t0 - 2 * DAY);
  mentor.pass(s, "ups-vs-generator", a[1].id, content, t0);
  mentor.bank(s, "ids-vs-ips-placement", "x2", NOW - DAY);
  check(s.misconceptions["ups-vs-generator"].retired, "setup: the correction retired on two different questions");
  const v = view(s);
  const sec = v.root.querySelector(".bank-cleared");
  check(sec && /Domain 3/.test(sec.textContent) && /1 cleared, 1 open/.test(sec.textContent),
        "cleared corrections are grouped by domain with the open count beside them");
  const btn = sec.querySelector("[data-action=open-cleared][data-id=ups-vs-generator]");
  check(btn && btn.tagName === "BUTTON", "a cleared correction is a button, not a dead tag");
  const open = view(s, { expanded: "ups-vs-generator" });
  check(/Cleared Oct 12/.test(open.root.textContent) && open.root.querySelector("#mc-ups-vs-generator article"),
        "opening it rereads the correction and shows the day it cleared");
  check(!open.root.querySelector("[data-action=start-mc]"), "a cleared correction has no drill button");
  // a later miss reopens it, and the screen says so
  mentor.bank(s, "ups-vs-generator", "x9", NOW - DAY);
  const back = view(s);
  const row = back.root.querySelector("[data-action=expand-mc][data-id=ups-vs-generator]").closest(".card");
  check(/came back after clearing/.test(row.textContent), "a cleared correction that you missed again is marked as having come back");
});

guarded("copy", () => {
  const s = fresh();
  const e = view(s);
  check(/question or PBQ you miss/.test(e.html), "the empty state names PBQs as well as questions");
  mentor.bank(s, "ups-vs-generator", "x", NOW - DAY);
  const v = view(s).html;
  check(!/memoris/i.test(v) && /memoriz/.test(v), "American spelling: memorizing");
  check(/in the order the drill uses/i.test(v), "the screen says its order is the drill's");
});
