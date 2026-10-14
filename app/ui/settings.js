import { esc } from "./common.js";

// --- settings --------------------------------------------------------------
export function settingsView(App) {
  const p = App.state.profile;
  const c = App.content;
  const h = App.health;

  return `<h1>Settings</h1>

  <h2 class="eyebrow">Exam and pacing</h2>
  <div class="card">
    <div class="field-row"><label for="f-date">Exam date</label>
      <input id="f-date" type="date" data-setting="examDate" value="${esc(p.examDate || "")}"></div>
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
        </tbody></table>
        <p class="note">The browser keeps a fast copy and mirrors it to that file a second or two behind. Clearing site data does not lose your history.</p>`
      : `<p class="muted m0">The study server is not reachable, so progress is only in this browser right now. Start it with <span class="mono">python3 serve.py</span> and reload.</p>`}
    ${c.referenceSources?.length
      ? `<p class="note">Page references in corrections come from: ${c.referenceSources.map(esc).join("; ")}</p>`
      : ""}
    <div class="row mt4">
      <button class="btn ghost" data-action="export">Export a copy</button>
      <button class="btn ghost" data-action="import">Import</button>
      <button class="btn danger" data-action="reset">Reset everything</button>
    </div>
  </div>`;
}
