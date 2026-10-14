import { esc, objectiveLabel, mentorCardHtml, emptyState } from "./common.js";
import * as mentor from "../mentor.js";
import { SESSION_SIZE } from "../scheduler.js";

const humanise = (ms) => {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min`;
  if (mins < 60 * 36) return `${Math.round(mins / 60)} h`;
  return `${Math.round(mins / 1440)} d`;
};

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
        body: "Every question you miss puts a targeted correction here and schedules it to come back on a different question.",
        actions: `<button class="btn" data-action="start-drill">Start drilling</button>`,
      })}`;
  }

  const sorted = openList
    .map((x) => ({ ...x, due: x.rec.due || x.rec.fsrs.due }))
    .sort((a, b) => a.due - b.due);
  const dueNow = sorted.filter((x) => now >= x.due).length;

  const BANK_SHOWN = 12;
  const shown = App.bankAll ? sorted : sorted.slice(0, BANK_SHOWN);
  const cards = shown
    .map((x) => {
      const overdue = now >= x.due;
      const needed = x.def.retireAfter ?? 2;
      return `<div class="card tight flag ${overdue ? "bad" : "quiet"}">
        <div class="spread">
          <div>
            <b>${esc(x.def.label)}</b>
            <div class="faint">${esc(objectiveLabel(App.content, x.def.objective))}</div>
            <div class="row mt2">
              <span class="tag ${x.def.severity === "high" ? "warn" : ""}">${esc(x.def.severity)} impact</span>
              <span class="tag">missed ${x.rec.hits}&times;</span>
              <span class="tag">${x.rec.cleanPasses.length}/${needed} clean</span>
              <span class="tag ${overdue ? "warn" : ""}">${overdue ? "due now" : `due in ${humanise(x.due - now)}`}</span>
            </div>
          </div>
          <button class="btn ghost small" data-action="expand-mc" data-id="${esc(x.id)}">${App.expanded === x.id ? "Hide" : "Open"}</button>
        </div>
        ${App.expanded === x.id ? mentorCardHtml(mentor.card(x.id, App.content, App.state)) : ""}
      </div>`;
    })
    .join("");

  return `<h1>Mentor bank</h1>
    <p class="sub">${openList.length} open, ${dueNow} due now, ${retired.length} cleared. A correction is only cleared after clean passes on <b>different</b> questions, so you cannot clear it by memorising the one you failed.</p>
    ${dueNow ? `<div class="row mb4"><button class="btn" data-action="start-weak">${dueNow > SESSION_SIZE.weak ? `Drill the most urgent ${SESSION_SIZE.weak} of ${dueNow} due` : `Drill the ${dueNow} due now`}</button></div>` : ""}
    ${cards}
    ${sorted.length > BANK_SHOWN
      ? `<div class="row mb4"><button class="btn ghost" data-action="bank-all">${App.bankAll ? `Show the most urgent ${BANK_SHOWN}` : `Show all ${sorted.length} open`}</button></div>`
      : ""}
    ${retired.length
      ? `<h2>Cleared</h2><div class="card tight"><div class="row">${retired
          .map(([id]) => `<span class="tag">${esc(App.content.misconceptions[id]?.label || id)}</span>`)
          .join("")}</div></div>`
      : ""}`;
}
