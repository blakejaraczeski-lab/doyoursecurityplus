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

export function labListView(App) {
  const byKind = {};
  for (const p of App.content.pbqs) (byKind[p.kind] ||= []).push(p);

  // Weakest first inside each kind: never attempted, then lowest best score.
  const standing = (p) => (App.state.pbq[p.id]?.attempts ? App.state.pbq[p.id].best : -1);
  const groups = Object.entries(byKind)
    .map(([kind, list]) => {
      const cards = [...list].sort((a, b) => standing(a) - standing(b))
        .map((p) => {
          const done = App.state.pbq[p.id];
          const att = done?.attempts || 0;
          const best = att ? done.best : null;
          const badge =
            best === null ? `<span class="tag">not attempted</span>`
            : `<span class="tag ${best >= 90 ? "good" : best >= 70 ? "warn" : "bad"}">best ${best}%</span>`;
          return `<div class="card tight"><div class="spread">
            <div>
              <b>${esc(p.title)}</b>
              <div class="faint">objective ${esc(p.objective)} &middot; ${Math.round(p.targetSeconds / 60)} min target &middot; difficulty ${p.difficulty}/5</div>
              <div class="row mt2">${badge}${
                att ? `<span class="faint">${att} attempt${att === 1 ? "" : "s"}</span>` : ""
              }</div>
            </div>
            <button class="btn ${best === null ? "" : "ghost"} small" data-action="open-pbq" data-id="${esc(p.id)}">${att ? "Retry" : "Start"}</button>
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
    <p class="sub">Performance-based questions, graded per subtask with partial credit. Four to five of these open the real exam, and they are worth more than a multiple choice item, so the eight minute target matters.</p>
    ${groups || emptyState({ title: "No PBQs loaded", body: "Add JSON files under content/pbq and reload." })}
    ${orphans ? `<h2>Without an engine</h2>${orphans}` : ""}`;
}
