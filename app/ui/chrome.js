import * as store from "../state.js";
import * as sync from "../sync.js";
import * as reviews from "../reviews.js";
import * as mentor from "../mentor.js";
import { esc } from "./common.js";

const NAV = [
  ["drill", "Drill"],
  ["lab", "PBQ lab"],
  ["mock", "Mock exam"],
  ["bank", "Mentor bank"],
  ["readiness", "Readiness"],
  ["settings", "Settings"],
];

const section = (App) => App.screen.split("-")[0];

// --- chrome ---------------------------------------------------------------
function goalRing(done, goal) {
  const r = 22, c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, goal ? done / goal : 0));
  const tone = frac >= 1 ? "var(--good)" : frac >= 0.5 ? "var(--accent)" : "var(--warn)";
  return `<div class="goal-ring" role="img" aria-label="${done} of ${goal} reviews today">
    <svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
      <circle cx="27" cy="27" r="${r}" fill="none" stroke="var(--panel-3)" stroke-width="5"/>
      <circle cx="27" cy="27" r="${r}" fill="none" stroke="${tone}" stroke-width="5"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}"
        transform="rotate(-90 27 27)"/>
    </svg>
    <div class="lbl"><b>${done}<span>/${goal}</span></b>reviews<br>today</div>
  </div>`;
}


/**
 * The streak line. It is information, never an alarm: a lapsed streak shows the
 * best one rather than a warning on a zero, and a rest day (the streak intact
 * but not extended today) says so. `restDay` and `best` come from
 * store.streakStatus; a record without them still reads.
 */
export function streakStat(st) {
  const days = (n) => `${n}<span class="u">d</span>`;
  if (!st.current && st.best) return { label: "Best streak", value: days(st.best), tone: "" };
  if (st.restDay && !st.studiedToday) return { label: "Streak, rest day", value: days(st.current), tone: "" };
  return { label: "Streak", value: days(st.current || 0), tone: st.studiedToday ? "good" : "" };
}

export function sidebarHtml(App) {
  const due = mentor.due(App.state, App.content).length;
  const streak = streakStat(store.streakStatus(App.state));
  const done = reviews.today();
  const goal = App.state.profile.dailyReviewGoal || 40;
  const days = App.state.profile.examDate ? mentor.daysUntilExam(App.state) : null;
  const here = section(App);

  const scratch = store.SCRATCH
    ? `<div class="scratch-flag">scratch session &middot; nothing here is saved to your real progress</div>`
    : "";
  const nav = NAV.map(([id, label]) => {
    const badge = id === "bank" && due
      ? `<span class="badge ${due > 8 ? "hot" : ""}">${due}</span>` : "";
    return `<button class="nav" ${here === id ? 'aria-current="page"' : ""}
      data-action="nav" data-section="${id}">${label}${badge}</button>`;
  }).join("");

  const stat = (label, value, tone = "") =>
    `<div class="stat"><dt>${label}</dt><dd class="${tone}">${value}</dd></div>`;

  return `<aside class="sidebar">
    <div class="brand">
      <span class="mark" aria-hidden="true">S+</span>
      <span class="name">doyoursecurityplus<small>SY0-701</small></span>
    </div>
    ${scratch}
    <nav aria-label="Sections">${nav}</nav>
    <div class="side-stats">
      ${goalRing(done, goal)}
      <dl class="stat-rows">
        ${stat(streak.label, streak.value, streak.tone)}
        ${days != null
          ? stat("To exam", `${days}<span class="u">d</span>`, days <= 14 ? "warn" : "")
          : stat("Exam date", "not set")}
      </dl>
    </div>
    <div class="sidebar-foot">
      <span class="sync" id="sync-foot">${syncFootHtml()}</span>
      <button class="keys-open" data-action="keys-open" aria-label="Keyboard shortcuts"><span class="kbd">?</span></button>
    </div>
  </aside>`;
}

const SYNC_TEXT = {
  saved: ["saved", "Progress saved to disk"],
  saving: ["saving", "Saving"],
  offline: ["offline", "Browser only, server unreachable"],
  conflict: ["conflict", "Another session saved newer work"],
  unknown: ["", "Connecting"],
};

export function syncFootHtml() {
  const [cls, text] = SYNC_TEXT[sync.getStatus()] || SYNC_TEXT.unknown;
  return `<span class="dot ${cls}"></span><span>${esc(text)}</span>`;
}

// Every key the app answers to, by where it works. The sheet is the one list a
// learner can open (`?`), so a key added to a screen is added here too.
const SHORTCUTS = [
  ["Anywhere", [
    ["?", "Show or hide this sheet"],
    ["X", "Spell out every acronym in place; press again to put them back"],
    ["Esc", "Close this sheet"],
  ]],
  ["A question", [
    ["A to J", "Pick that option; on a choose-two, check or uncheck it"],
    ["Enter", "Submit a choose-two once you have picked them all, or move on after an answer"],
    ["G", "Mark your answer as a guess, before you answer"],
    ["S", "Skip; it comes back on its own schedule"],
  ]],
  ["A recall card", [
    ["Space", "Reveal the answer"],
    ["1 to 4", "Grade it: again, hard, good, easy"],
  ]],
  ["A lab", [
    ["Enter", "Submit your answer, then move on"],
    ["A to J", "Pick up a chip in the ordering and sorting labs"],
    ["1 to 9", "Put the chip you are holding in that position or column"],
  ]],
];

export function shortcutSheetHtml() {
  const groups = SHORTCUTS.map(([title, rows]) => `<h3 class="eyebrow">${esc(title)}</h3>
    <dl class="keys">${rows.map(([k, what]) => `<dt><span class="kbd">${esc(k)}</span></dt><dd>${esc(what)}</dd>`).join("")}</dl>`).join("");
  return `<div class="sheet-body"><h2 id="keys-title" tabindex="-1" autofocus>Keyboard shortcuts</h2>${groups}
    <form method="dialog"><button class="btn">Close</button></form></div>`;
}
