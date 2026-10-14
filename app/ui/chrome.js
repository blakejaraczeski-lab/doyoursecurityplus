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


export function sidebarHtml(App) {
  const due = mentor.due(App.state, App.content).length;
  const st = store.streakStatus(App.state);
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
        ${stat("Streak", `${st.current}<span class="u">d</span>`,
               st.studiedToday ? "good" : st.alive ? "" : "warn")}
        ${days != null
          ? stat("To exam", `${days}<span class="u">d</span>`, days <= 14 ? "warn" : "")
          : stat("Exam date", "not set", "warn")}
      </dl>
    </div>
    <div class="sidebar-foot" id="sync-foot">${syncFootHtml()}</div>
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
