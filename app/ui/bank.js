import { esc, objectiveLabel, mentorCardHtml, emptyState } from "./common.js";
import * as mentor from "../mentor.js";
import { SESSION_SIZE } from "../scheduler.js";

const humanise = (ms) => {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min`;
  if (mins < 60 * 36) return `${Math.round(mins / 60)} h`;
  return `${Math.round(mins / 1440)} d`;
};

const BANK_SHOWN = 12;
const CLEARED_SHOWN = 3;          // per domain, until the learner asks for all
const FILTER_FROM = 6;            // chips appear once the list is longer than a glance
const STATUS_CHIPS = [["all", "All"], ["due", "Due now"], ["high", "High impact"], ["sure", "Sure and wrong"]];

const day = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The toggle for a correction. Cleared ones use their own action, so the open list stays countable. Same element in both states, so focus survives the render. */
const toggleHtml = (id, open, label, cls = "btn ghost small", cleared = false) =>
  `<button class="${cls}" ${cleared ? 'data-action="open-cleared"' : 'data-action="expand-mc"'} data-id="${esc(id)}" aria-expanded="${open}" aria-controls="mc-${esc(id)}">${label}</button>`;

/** What can still clear this correction, and the one button that drills it. */
function drillHtml(App, x) {
  const need = Math.max(1, (x.def.retireAfter ?? 2) - x.rec.cleanPasses.length);
  const { mcqs, pbqs } = mentor.itemsFor(x.id, App.content, App.state, x.rec.lastItem);
  const left = mcqs.length + pbqs.length;
  if (!left) {
    return `<p class="faint mt3">No other question tests this yet. The correction comes back on its own schedule.</p>`;
  }
  return `<div class="row mt3">
    <button class="btn" data-action="start-mc" data-id="${esc(x.id)}">Drill this one</button>
    <span class="faint">${plural(need, "more clean pass", "more clean passes")} on different questions clears it. ${plural(left, "unused question tests", "unused questions test")} it.</span>
  </div>`;
}

function openPanel(App, x, now, overdue) {
  const slipped = x.rec.retiredAt;
  return `<div class="bank-open ${overdue ? "due" : ""}" id="mc-${esc(x.id)}">
    <div class="spread">
      <div class="row">
        <span class="tag ${overdue ? "warn" : ""}">${overdue ? "due now" : `due in ${humanise(x.due - now)}`}</span>
        ${slipped ? `<span class="tag warn">came back after clearing</span>` : ""}
      </div>
      ${toggleHtml(x.id, true, "Hide")}
    </div>
    ${mentorCardHtml(mentor.card(x.id, App.content, App.state))}
    ${drillHtml(App, x)}
  </div>`;
}

function openRow(App, x, now) {
  const overdue = now >= x.due;
  const needed = x.def.retireAfter ?? 2;
  if (App.expanded === x.id) return openPanel(App, x, now, overdue);
  const sure = x.rec.confidentMisses || 0;
  return `<div class="card tight flag ${overdue ? "bad" : "quiet"}">
    <div class="spread">
      <div>
        <b>${esc(x.def.label)}</b>
        <div class="faint">${esc(objectiveLabel(App.content, x.def.objective))}</div>
        <div class="row mt2">
          <span class="tag ${x.def.severity === "high" ? "warn" : ""}">${esc(x.def.severity)} impact</span>
          <span class="tag">missed ${x.rec.hits}&times;</span>
          ${sure ? `<span class="tag warn">sure and wrong ${sure}&times;</span>` : ""}
          ${x.rec.retiredAt ? `<span class="tag warn">came back after clearing</span>` : ""}
          <span class="tag">${x.rec.cleanPasses.length}/${needed} clean</span>
          <span class="tag ${overdue ? "warn" : ""}">${overdue ? "due now" : `due in ${humanise(x.due - now)}`}</span>
        </div>
      </div>
      ${toggleHtml(x.id, false, "Read the correction")}
    </div>
  </div>`;
}

const chip = (kind, value, label, on) =>
  `<button class="btn ghost small bank-chip" data-action="bank-filter" data-kind="${kind}" data-value="${esc(value)}" aria-pressed="${on}">${on ? "&check; " : ""}${esc(label)}</button>`;

function filterHtml(App, f, domains) {
  return `<div class="bank-filters" role="group" aria-label="Filter open corrections">
    <div class="row">${STATUS_CHIPS.map(([v, l]) => chip("status", v, l, f.status === v)).join("")}</div>
    ${domains.length > 1
      ? `<div class="row">${domains.map((d) => chip("domain", d, `Domain ${d}`, f.domain === d)).join("")}</div>`
      : ""}
  </div>`;
}

/** Cleared corrections are the proof: grouped by domain, each one a button that rereads it. */
function clearedHtml(App, retired, openList) {
  if (!retired.length) return "";
  const domainOf = (id) => App.content.domainOf[App.content.misconceptions[id]?.objective] || "?";
  const groups = new Map();
  for (const [id, rec] of retired) (groups.get(domainOf(id)) || groups.set(domainOf(id), []).get(domainOf(id))).push([id, rec]);
  const openIn = (d) => openList.filter((x) => domainOf(x.id) === d).length;
  const body = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, list]) => {
    list.sort((a, b) => (b[1].retiredAt || 0) - (a[1].retiredAt || 0));
    const shown = App.bankAllCleared ? list : list.filter(([id], i) => i < CLEARED_SHOWN || id === App.expanded);
    const buttons = shown.map(([id]) =>
      toggleHtml(id, App.expanded === id, esc(App.content.misconceptions[id]?.label || id), "btn ghost small bank-chip", true)).join("");
    const open = shown.find(([id]) => id === App.expanded);
    const panel = open ? clearedPanel(App, open) : "";
    return `<div class="bank-group">
      <h3>Domain ${esc(d)}: ${list.length} cleared, ${openIn(d)} open</h3>
      <div class="row">${buttons}</div>
      ${panel}
    </div>`;
  }).join("");
  const more = retired.length > CLEARED_SHOWN
    ? `<div class="row mt3"><button class="btn ghost" data-action="bank-all-cleared">${App.bankAllCleared ? "Show fewer cleared" : `Show all ${retired.length} cleared`}</button></div>`
    : "";
  return `<section class="bank-cleared"><h2>Cleared</h2>${body}${more}</section>`;
}

function clearedPanel(App, [id, rec]) {
  const when = rec.retiredAt ? `Cleared ${day(rec.retiredAt)} on ${plural(rec.cleanPasses.length, "different question", "different questions")}.` : "Cleared.";
  return `<div class="bank-open" id="mc-${esc(id)}">
    <div class="spread"><span class="faint">${esc(when)}</span>${toggleHtml(id, true, "Hide", "btn ghost small", true)}</div>
    ${mentorCardHtml(mentor.card(id, App.content, App.state))}
  </div>`;
}

// --- mentor bank -----------------------------------------------------------
export function mentorView(App) {
  const openList = mentor.open(App.state, App.content);
  const retired = Object.entries(App.state.misconceptions).filter(([, r]) => r.retired);
  const now = Date.now();

  if (!openList.length && !retired.length) {
    return `<h1>Mentor bank</h1>
      ${emptyState({
        glyph: "&#9873;",
        title: "Nothing banked yet",
        body: "Every question or PBQ you miss puts a targeted correction here and schedules it to come back on a different question.",
        actions: `<button class="btn" data-action="start-drill">Start drilling</button>`,
      })}`;
  }

  // The drill's own order: the due ones by urgency, then the rest by when they come due.
  const byId = new Map(openList.map((x) => [x.id, x]));
  const urgent = mentor.due(App.state, App.content, now).map((d) => byId.get(d.id)).filter(Boolean);
  const queued = new Set(urgent.map((x) => x.id));
  const rest = openList.filter((x) => !queued.has(x.id));
  const sorted = [...urgent, ...rest.sort((a, b) => (a.rec.due || a.rec.fsrs.due) - (b.rec.due || b.rec.fsrs.due))]
    .map((x) => ({ ...x, due: x.rec.due || x.rec.fsrs.due }));
  const dueNow = urgent.length;

  // Chips only once there is a list worth narrowing; below that a stale filter is ignored.
  const chips = openList.length >= FILTER_FROM;
  const f = chips ? { status: "all", domain: null, ...App.bankFilter } : { status: "all", domain: null };
  const domainOf = (x) => App.content.domainOf[x.def.objective];
  const keep = {
    all: () => true,
    due: (x) => now >= x.due,
    high: (x) => x.def.severity === "high",
    sure: (x) => (x.rec.confidentMisses || 0) > 0,
  }[f.status] || (() => true);
  const matched = sorted.filter((x) => keep(x) && (!f.domain || domainOf(x) === f.domain));
  const filtered = f.status !== "all" || f.domain;
  const domains = [...new Set(sorted.map(domainOf).filter(Boolean))].sort();

  const shown = App.bankAll ? matched : matched.slice(0, BANK_SHOWN);
  const cards = shown.map((x) => openRow(App, x, now)).join("");

  return `<h1>Mentor bank</h1>
    <p class="sub">${openList.length} open, ${dueNow} due now, ${retired.length} cleared. A correction is only cleared after clean passes on <b>different</b> questions, so you cannot clear it by memorizing the one you failed.</p>
    ${dueNow ? `<div class="row mb2"><button class="btn" data-action="start-weak">${dueNow > SESSION_SIZE.weak ? `Drill the most urgent ${SESSION_SIZE.weak} of ${dueNow} due` : `Drill the ${dueNow} due now`}</button></div>
      <p class="faint mb4">The list below is in the order the drill uses, most urgent first.</p>` : ""}
    ${chips ? filterHtml(App, f, domains) : ""}
    ${filtered ? `<p class="faint">Showing ${matched.length} of ${openList.length} open.</p>` : ""}
    ${chips && !matched.length ? `<p class="faint mb4">Nothing open matches this filter.</p>` : ""}
    ${cards}
    ${matched.length > BANK_SHOWN
      ? `<div class="row mb4"><button class="btn ghost" data-action="bank-all">${App.bankAll ? `Show the most urgent ${BANK_SHOWN}` : `Show all ${matched.length} open`}</button></div>`
      : ""}
    ${clearedHtml(App, retired, openList)}`;
}
