import { esc, optionButton, KEYS } from "./common.js";

export function diagramHtml(pbq, answers, locked) {
  const cfg = pbq.config;
  const selected = new Set(answers["t-identify"] || []);
  const inspected = answers.inspected;
  const pos = Object.fromEntries(cfg.nodes.map((n) => [n.id, n]));
  const seen = new Set(answers.seenNodes || []);

  const links = cfg.links
    .map(([a, b]) => `<line class="link" x1="${pos[a].x}" y1="${pos[a].y}" x2="${pos[b].x}" y2="${pos[b].y}" />`)
    .join("");

  const nodes = cfg.nodes
    .map((n) => {
      const cls = [
        "node",
        selected.has(n.id) ? "selected" : "",
        inspected === n.id ? "inspected" : "",
      ].join(" ");
      const shape =
        n.type === "cloud" || n.type === "switch" || n.type === "firewall"
          ? `<ellipse cx="${n.x}" cy="${n.y}" rx="8.6" ry="4.4" />`
          : `<rect x="${n.x - 8.6}" y="${n.y - 4.4}" width="17.2" height="8.8" rx="1.6" />`;
      const dot = n.selectable !== false && seen.has(n.id) && inspected !== n.id
        ? `<circle cx="${n.x + 7.4}" cy="${n.y - 3.4}" r="0.9" fill="var(--accent)" />`
        : "";
      // A host is a button that opens its evidence; marking it compromised is
      // the roster below. So its spoken name carries the state and it claims
      // no pressed state of its own. A host with nothing to open is not a control.
      const state = selected.has(n.id) ? ", marked compromised" : seen.has(n.id) ? ", reviewed" : "";
      const control = n.selectable === false ? "" : ` tabindex="0" role="button"`;
      return `<g class="${cls}" data-node="${n.id}"${control}
                 aria-label="${esc(n.label)}${n.ip ? `, ${esc(n.ip)}` : ""}${state}">
        ${shape}${dot}
        <text x="${n.x}" y="${n.y + 0.9}">${esc(n.label)}</text>
        ${n.ip ? `<text class="ip" x="${n.x}" y="${n.y + 7.6}">${esc(n.ip)}</text>` : ""}
      </g>`;
    })
    .join("");

  const selectTask = cfg.tasks.find((t) => t.type === "select-nodes");
  const ev = inspected && cfg.evidence[inspected];
  const marked = selected.has(inspected);
  const evHtml = ev
    ? `<div class="card"><div class="spread mb3">
         <h2 class="eyebrow">${esc(pos[inspected].label)}: collected evidence</h2>
         <span class="tag">${esc(pos[inspected].ip || "")}</span></div>
       <p class="muted">${esc(ev.summary)}</p>
       <div class="evidence">${esc(ev.lines.join("\n"))}</div>
       ${selectTask ? `<div class="row mt4">
         <button class="btn ${marked ? "" : "ghost"}" data-action="node-toggle"
                 data-task="${esc(selectTask.id)}" data-host="${esc(inspected)}" ${locked ? "disabled" : ""}>
           ${marked ? "&check; Marked compromised" : "Mark this host compromised"}
         </button>
         <span class="hint">Reading the evidence does not mark anything. Decide after you have looked.</span>
       </div>` : ""}</div>`
    : `<div class="card tight"><p class="faint m0">Click a host to read the evidence collected from it. Hosts you have reviewed get a dot. Reading is safe: nothing is marked until you say so.</p></div>`;

  const tasks = cfg.tasks
    .map((t) => {
      if (t.type === "select-nodes") {
        const roster = cfg.nodes
          .filter((n) => n.selectable !== false)
          .map((n) => {
            const on = selected.has(n.id);
            return `<button class="host-pick ${on ? "on" : ""}" data-action="node-toggle"
                data-task="${esc(t.id)}" data-host="${esc(n.id)}" aria-pressed="${on}" ${locked ? "disabled" : ""}>
                <span class="box" aria-hidden="true">${on ? "&check;" : ""}</span>
                <span class="who">${esc(n.label)}${seen.has(n.id) ? "" : ` <span class="faint">not reviewed</span>`}</span>
              </button>`;
          })
          .join("");
        return `<div class="card"><b>${esc(t.prompt)}</b>
          <p class="faint m0 mt2 mb3">${selected.size} selected. Click a host in the diagram to read its evidence first.</p>
          <div class="host-picks">${roster}</div></div>`;
      }
      const val = answers[t.id];
      return `<div class="card"><b>${esc(t.prompt)}</b>
        <div class="opts mt4">
          ${t.options.map((o, i) => optionButton({
            key: KEYS[i], text: o.label, action: "diagram-choice",
            data: { task: t.id, value: o.value },
            cls: val === o.value ? "chosen" : "", disabled: locked, pressed: val === o.value,
          })).join("")}
        </div></div>`;
    })
    .join("");

  return `<svg class="diagram" viewBox="0 0 100 92" role="group" aria-label="Network diagram. Each host opens its evidence.">${links}${nodes}</svg>
    ${evHtml}${tasks}`;
}
