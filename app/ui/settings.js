import { esc } from "./common.js";
import { today } from "../state.js";

// --- settings --------------------------------------------------------------
export function settingsView(App) {
  const p = App.state.profile;
  const c = App.content;
  const h = App.health;

  return `<h1>Settings</h1>

  <h2 class="eyebrow">Exam and pacing</h2>
  <div class="card">
    <div class="field-row"><label for="f-date">Exam date</label>
      <input id="f-date" type="date" data-setting="examDate" min="${today()}" value="${esc(p.examDate || "")}"${App.dateNote ? ' aria-invalid="true" aria-describedby="f-date-note"' : ""}></div>
    ${App.dateNote ? `<p class="note" id="f-date-note" role="alert"><b>Not saved.</b> ${esc(App.dateNote)}</p>` : ""}
    <div class="field-row"><label for="f-pace">Pace</label>
      <select id="f-pace" data-setting="pace">
        ${[["bootcamp", "Bootcamp (short steps, high intake)"],
           ["balanced", "Balanced"],
           ["longhaul", "Long haul (wide intervals)"]]
          .map(([v, l]) => `<option value="${v}" ${p.pace === v ? "selected" : ""}>${l}</option>`).join("")}
      </select></div>
    <div class="field-row"><label for="f-ret">Target retention</label>
      <select id="f-ret" data-setting="desiredRetention">
        ${[0.85, 0.88, 0.9, 0.92, 0.95].map((v) =>
          `<option value="${v}" ${p.desiredRetention === v ? "selected" : ""}>${Math.round(v * 100)}%</option>`).join("")}
      </select></div>
    <div class="field-row"><label for="f-goal">Daily review goal</label>
      <select id="f-goal" data-setting="dailyReviewGoal">
        ${[20, 30, 40, 60, 80, 120].map((v) =>
          `<option value="${v}" ${p.dailyReviewGoal === v ? "selected" : ""}>${v} reviews</option>`).join("")}
      </select></div>
    <p class="note">Corrections are always retested before your exam date. An item whose next review would fall after it is left alone: it is still above your target retention on the day.</p>
  </div>

  <h2 class="eyebrow">Where your progress lives</h2>
  <div class="card">
    ${h
      ? `<table class="grid"><tbody>
          <tr><td>Durable copy</td><td class="mono">${esc(h.stateFile || "")}</td></tr>
          <tr><td>Snapshots kept</td><td class="mono">${h.snapshots ?? 0}${h.newestSnapshot ? ` &middot; newest ${esc(h.newestSnapshot)}` : ""}</td></tr>
          <tr><td>Answers and corrections saved</td><td class="mono">${h.reviews ?? 0}</td></tr>
          <tr><td>Open / cleared</td><td class="mono">${h.misconceptionsOpen ?? 0} / ${h.misconceptionsRetired ?? 0}</td></tr>
          <tr><td>Last backup</td><td class="mono">${h.lastBackupAt ? esc(new Date(h.lastBackupAt).toLocaleString()) : "none yet"}</td></tr>
        </tbody></table>
        <p class="note">The browser keeps a fast copy and mirrors it to that file a second or two behind. Clearing site data does not lose your history.</p>`
      : `<p class="muted m0">The study server is not reachable, so progress is only in this browser right now. Start it with <span class="mono">python3 serve.py</span> and reload.</p>`}
    <div class="row mt4">
      <button class="btn ghost" data-action="export">Export backup</button>
      <button class="btn ghost" data-action="import">Import</button>
      <button class="btn danger" data-action="reset">Reset everything</button>
    </div>
    ${dataFeedbackHtml(App)}
    <p class="note">An export holds your progress and your whole answer history in one file. For a backup copy of everything on disk, run <span class="mono">python3 scripts/backup.py backup</span>${h?.backupsDir ? `; copies are kept in <span class="mono">${esc(h.backupsDir)}</span>` : ""}.</p>
  </div>
  ${c.referenceSources?.length
    ? `<p class="note">Page references in corrections come from: ${c.referenceSources.map(esc).join("; ")}</p>`
    : ""}`;
}

const when = (ms) => (ms ? new Date(ms).toLocaleString() : "never");
const openOf = (st) => Object.values(st.misconceptions || {}).filter((m) => !m.retired).length;

/** The confirmation waiting on an answer, or what the last data action did. */
function dataFeedbackHtml(App) {
  const panel = App.dataPanel;
  const dir = App.health?.backupsDir;
  if (panel?.kind === "import") {
    const h = App.health;
    return `<div class="card flag mt4" role="group" aria-label="Confirm import" data-panel>
      <p class="m0"><b>Replace your progress with ${esc(panel.name)}?</b></p>
      <table class="grid"><tbody>
        <tr><td>This file</td><td>saved ${esc(when(panel.state.updatedAt))}, ${Object.keys(panel.state.items).length} items, ${openOf(panel.state)} open corrections, ${panel.rows.length} logged answers</td></tr>
        <tr><td>Now</td><td>saved ${esc(when(App.state.updatedAt))}, ${Object.keys(App.state.items).length} items, ${openOf(App.state)} open corrections${h ? `, ${h.reviews} logged answers` : ""}</td></tr>
      </tbody></table>
      <p class="note">Your items and corrections are replaced. Your answer history is kept, and the file's answers are added to it. What is on disk now is copied to a safety backup first${dir ? ` in ${esc(dir)}` : ""}.${panel.skipped ? ` ${panel.skipped} lines in the file were not answers and are left out.` : ""}</p>
      <div class="row mt4">
        <button class="btn danger" data-action="import-confirm">Replace my progress</button>
        <button class="btn ghost" data-action="import-cancel">Cancel</button>
      </div>
    </div>`;
  }
  if (panel?.kind === "reset") {
    return `<div class="card flag bad mt4" role="group" aria-label="Confirm reset" data-panel>
      <p class="m0"><b>Erase everything?</b></p>
      <p class="note">This erases your items, corrections, mock scores and your whole answer history, so Readiness starts from nothing. A safety backup of what is on disk is saved first${dir ? ` in ${esc(dir)}` : ""}, and if it cannot be saved nothing is erased.</p>
      <div class="row mt4">
        <button class="btn danger" data-action="reset-confirm">Erase everything</button>
        <button class="btn ghost" data-action="reset-cancel">Cancel</button>
      </div>
    </div>`;
  }
  if (App.dataNote) {
    return `<div class="card flag mt4 ${App.dataNote.bad ? "bad" : "quiet"}" role="status"><p class="m0">${App.dataNote.bad ? "<b>Not done.</b> " : ""}${esc(App.dataNote.text)}</p></div>`;
  }
  return "";
}
