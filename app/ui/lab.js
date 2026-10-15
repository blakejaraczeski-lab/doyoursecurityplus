import { esc, emptyState } from "./common.js";
import { pbqHtml } from "./pbq.js";

// --- PBQ lab ---------------------------------------------------------------
const KIND_LABEL = {
  "acl-table": "Firewall and ACL",
  "wireless-config": "Wireless configuration",
  "network-diagram": "Network diagram analysis",
  "drag-order": "Order and classify",
};

export function labRunView(App) {
  return pbqHtml(App.lab, App.answers[App.lab.id] || {}, { locked: !!App.graded, graded: App.graded });
}

// The score a card stands on: the most recent attempt when the record has one,
// else the best (records written before the last score was kept).
const scoreOf = (rec) => (rec?.attempts ? (rec.last ?? rec.best) : -1);
const toneOf = (n) => (n >= 90 ? "good" : n >= 70 ? "warn" : "bad");

export function labListView(App) {
  const byKind = {};
  for (const p of App.content.pbqs) (byKind[p.kind] ||= []).push(p);

  // Weakest first inside each kind: never attempted, then lowest last score.
  const standing = (p) => scoreOf(App.state.pbq[p.id]);
  const all = App.content.pbqs;
  const scores = all.map(standing);
  const fresh = scores.filter((n) => n < 0).length;
  const low = scores.filter((n) => n >= 0 && n < 70).length;
  const strong = scores.filter((n) => n >= 90).length;
  const weakest = scores.some((n) => n < 90)
    ? all.reduce((w, p) => (standing(p) < standing(w) ? p : w))
    : null;
  const minutes = all.map((p) => Math.round(p.targetSeconds / 60));
  const range = !minutes.length ? "" : Math.min(...minutes) === Math.max(...minutes)
    ? `${minutes[0]}` : `${Math.min(...minutes)} to ${Math.max(...minutes)}`;
  const summary = all.length
    ? `<div class="card tight"><div class="spread">
        <div><b>${all.length} PBQs</b>
          <div class="faint">${fresh} not attempted &middot; ${low} below 70% &middot; ${strong} at 90% or above</div></div>
        ${weakest ? `<button class="btn small" data-action="open-pbq" data-id="${esc(weakest.id)}">Start the weakest</button>` : ""}
      </div></div>`
    : "";

  const groups = Object.entries(byKind)
    .map(([kind, list]) => {
      const cards = [...list].sort((a, b) => standing(a) - standing(b))
        .map((p) => {
          const done = App.state.pbq[p.id];
          const att = done?.attempts || 0;
          const now = scoreOf(done);
          const badge =
            !att ? `<span class="tag">not attempted</span>`
            : `<span class="tag ${toneOf(now)}">${done.last == null ? "best" : "last"} ${now}%</span>${
                done.last != null && done.best !== done.last ? `<span class="faint">best ${done.best}%</span>` : ""}`;
          return `<div class="card tight"><div class="spread">
            <div>
              <b>${esc(p.title)}</b>
              <div class="faint">objective ${esc(p.objective)} &middot; ${Math.round(p.targetSeconds / 60)} min target</div>
              <div class="row mt2">${badge}${
                att ? `<span class="faint">${att} attempt${att === 1 ? "" : "s"}</span>` : ""
              }</div>
            </div>
            <button class="btn ${att ? "ghost" : ""} small" data-action="open-pbq" data-id="${esc(p.id)}">${att ? "Retry" : "Start"}</button>
          </div></div>`;
        })
        .join("");
      return `<h2>${esc(KIND_LABEL[kind] || kind)}</h2>${cards}`;
    })
    .join("");

  // Listed so the file is not silently missing, never served anywhere.
  const orphans = (App.content.pbqsWithoutEngine || []).map((p) => `<div class="card tight flag"><div class="spread">
      <div><b>${esc(p.title || p.id)}</b>
        <div class="faint">${esc(p.id)} &middot; kind <span class="mono">${esc(String(p.kind))}</span> has no engine in this build, so it cannot be worked or scored. It is not in the queue or in any mock.</div>
      </div>
      <span class="tag bad">no engine</span>
    </div></div>`).join("");

  return `<h1>PBQ lab</h1>
    <p class="sub">Performance-based questions, graded per subtask with partial credit. A handful of these open the real exam, and each is worth more than a multiple choice item, so practice against the clock.${range ? ` Targets run ${range} minutes.` : ""}</p>
    ${summary}${groups || emptyState({ title: "No PBQs loaded", body: "Add JSON files under content/pbq and reload." })}
    ${orphans ? `<h2>Without an engine</h2>${orphans}` : ""}`;
}
