import { esc, gloss, resultsHtml, optionButton, KEYS } from "./common.js";
import { fieldVisible } from "../grade/wireless.js";

// --- wireless --------------------------------------------------------------
function wirelessHtml(pbq, answers, locked) {
  const fields = pbq.config.fields
    .map((f) => {
      const on = fieldVisible(f, answers);
      const val = answers[f.id] ?? "";
      const dis = locked || !on ? "disabled" : "";
      const id = `pf-${f.id}`;
      const input =
        f.type === "select"
          ? `<select id="${id}" data-pbq-field="${f.id}" ${dis}>
               <option value="">&mdash; select &mdash;</option>
               ${f.options.map((o) => `<option value="${esc(o.value)}" ${val === o.value ? "selected" : ""}>${esc(o.label)}</option>`).join("")}
             </select>`
          : `<input id="${id}" type="text" data-pbq-field="${f.id}" value="${esc(val)}"
                placeholder="${esc(f.placeholder || "")}" ${dis}>`;
      return `<div class="field-row ${on ? "" : "disabled"}">
                <label for="${id}">${esc(f.label)}${on ? "" : ` <span class="faint">(not applicable)</span>`}</label>
                ${input}
              </div>`;
    })
    .join("");
  return `<div class="card"><h2 class="eyebrow">${esc(pbq.config.deviceName)}</h2>${fields}</div>`;
}

// --- acl -------------------------------------------------------------------
function aclHtml(pbq, answers, locked) {
  const cfg = pbq.config;
  const rules = answers.rules || [];
  const opt = (list, sel, fmt) =>
    list.map((o) => {
      const [v, l] = fmt(o);
      return `<option value="${esc(v)}" ${sel === v ? "selected" : ""}>${esc(l)}</option>`;
    }).join("");
  const addrOpts = (sel) => opt(cfg.networkObjects, sel, (o) => [o.value, o.label]);
  const portOpts = (sel) => opt(cfg.portOptions, sel, (o) => [o.value, o.label]);
  const protoOpts = (sel) => opt(cfg.protocols, sel, (p) => [p, p.toUpperCase()]);

  const body = rules
    .map(
      (r, i) => `<tr>
      <td class="mono">${i + 1}</td>
      <td><select data-acl="${i}" data-k="action" ${locked ? "disabled" : ""}>
        <option value="permit" ${r.action === "permit" ? "selected" : ""}>PERMIT</option>
        <option value="deny" ${r.action === "deny" ? "selected" : ""}>DENY</option>
      </select></td>
      <td><select data-acl="${i}" data-k="protocol" ${locked ? "disabled" : ""}>${protoOpts(r.protocol)}</select></td>
      <td><select data-acl="${i}" data-k="src" ${locked ? "disabled" : ""}>${addrOpts(r.src)}</select></td>
      <td><select data-acl="${i}" data-k="srcPort" ${locked ? "disabled" : ""}>${portOpts(r.srcPort)}</select></td>
      <td><select data-acl="${i}" data-k="dst" ${locked ? "disabled" : ""}>${addrOpts(r.dst)}</select></td>
      <td><select data-acl="${i}" data-k="dstPort" ${locked ? "disabled" : ""}>${portOpts(r.dstPort)}</select></td>
      <td><div class="row tight">
        <button class="btn ghost small" data-action="acl-up" data-i="${i}" title="Move up" ${locked || i === 0 ? "disabled" : ""}>&uarr;</button>
        <button class="btn ghost small" data-action="acl-down" data-i="${i}" title="Move down" ${locked || i === rules.length - 1 ? "disabled" : ""}>&darr;</button>
        <button class="btn ghost small" data-action="acl-del" data-i="${i}" title="Delete rule" ${locked ? "disabled" : ""}>&times;</button>
      </div></td>
    </tr>`
    )
    .join("");

  const objects = cfg.networkObjects
    .filter((o) => o.value !== "any")
    .map((o) => `<tr><td class="mono"><b>${esc(o.label)}</b></td><td class="mono">${esc(o.value)}</td><td class="faint">${esc(o.note || "")}</td></tr>`)
    .join("");

  return `
  <div class="card tight">
    <h2 class="eyebrow">Network objects</h2>
    <div class="scroll-x"><table class="grid"><tbody>${objects}</tbody></table></div>
    <p class="note">
      ${cfg.stateful
        ? "This firewall is <b>stateful</b>: return traffic for a permitted connection is handled for you."
        : "This is a <b>stateless</b> packet filter: it does not track connections, so each direction needs its own rule."}
      Evaluation is top to bottom, first match wins, and an implicit deny sits at the bottom.
    </p>
  </div>
  <div class="card">
    <div class="spread mb3">
      <h2 class="eyebrow">Access control list</h2>
      <button class="btn ghost small" data-action="acl-add" ${locked || rules.length >= cfg.maxRules ? "disabled" : ""}>
        + Add rule <span class="faint">${rules.length}/${cfg.maxRules}</span>
      </button>
    </div>
    <div class="scroll-x"><table class="grid acl-grid">
      <thead><tr><th>#</th><th>Action</th><th>Proto</th><th>Source</th><th>Src port</th><th>Destination</th><th>Dst port</th><th></th></tr></thead>
      <tbody>${body || `<tr><td colspan="8" class="faint empty-row">No rules yet. With an empty list, everything is denied.</td></tr>`}</tbody>
    </table></div>
    ${aclReadoutHtml(cfg, rules)}
  </div>`;
}

/**
 * The rule set as a firewall would print it.
 *
 * The editable grid is seven native selects wide, and a select truncates its
 * own text, so you cannot read a rule you just wrote, let alone scan eight of
 * them for order. Reading the policy top to bottom IS the task on this
 * question type, so it is also rendered as plain text.
 */
export function aclReadoutHtml(cfg, rules) {
  const label = (list, v) => list.find((o) => o.value === v)?.label || v;
  const addr = (v) => (v === "any" ? "any" : label(cfg.networkObjects, v));
  const port = (v) => (v === "any" ? "any" : label(cfg.portOptions, v));
  if (!rules.length) {
    return `<div class="readout" id="acl-readout"></div>`;
  }
  const lines = rules
    .map((r, i) => {
      const verb = r.action === "permit" ? "permit" : "deny";
      return `<li class="${verb}"><span class="n">${i + 1}</span>
        <code><b>${verb}</b> ${esc(r.protocol || "ip")} from <b>${esc(addr(r.src))}</b>${
          r.srcPort && r.srcPort !== "any" ? ` port ${esc(port(r.srcPort))}` : ""
        } to <b>${esc(addr(r.dst))}</b>${
          r.dstPort && r.dstPort !== "any" ? ` port ${esc(port(r.dstPort))}` : ""
        }</code></li>`;
    })
    .join("");
  return `<div class="readout" id="acl-readout">
    <h3 class="eyebrow">Your policy, in order</h3>
    <ol class="acl-readout">${lines}
      <li class="implicit"><span class="n">&mdash;</span><code><b>deny</b> everything else <span class="faint">(implicit)</span></code></li>
    </ol>
  </div>`;
}

function aclTraceHtml(trace) {
  return `<div class="card"><h2 class="eyebrow">Traffic simulation</h2>
    <p class="faint m0 mb3">Your rule set was executed against each flow, the way the firewall would.</p>
    <div class="scroll-x"><table class="grid">
    <thead><tr><th></th><th>Flow</th><th>Required</th><th>Yours</th><th>Decided by</th></tr></thead>
    <tbody>${trace
      .map(
        (t) => `<tr>
        <td><span class="mark sm ${t.pass ? "ok" : "no"}">${t.pass ? "&check;" : "&times;"}</span></td>
        <td>${esc(t.label)}<div class="faint mono">${esc(t.packet.src)}:${esc(t.packet.srcPort)} &rarr; ${esc(t.packet.dst)}:${esc(t.packet.dstPort)} ${esc(t.packet.protocol)}</div></td>
        <td class="mono">${t.expect}</td>
        <td class="mono ${t.pass ? "" : "c-bad"}">${t.got}</td>
        <td class="faint">${t.implicit ? "implicit deny" : `rule ${t.ruleIndex + 1}`}</td>
      </tr>`
      )
      .join("")}</tbody></table></div></div>`;
}

// --- network diagram -------------------------------------------------------
function diagramHtml(pbq, answers, locked) {
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
      return `<g class="${cls}" data-node="${n.id}" tabindex="0" role="button"
                 aria-pressed="${selected.has(n.id)}" aria-label="${esc(n.label)}">
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
            cls: val === o.value ? "chosen" : "", disabled: locked,
          })).join("")}
        </div></div>`;
    })
    .join("");

  return `<svg class="diagram" viewBox="0 0 100 92" role="img" aria-label="Network topology">${links}${nodes}</svg>
    ${evHtml}${tasks}`;
}

// --- drag and order --------------------------------------------------------
//
// The exam calls these drag and drop. This is click to place instead: click the
// item, click where it goes. Same cognitive task, and it works with a keyboard,
// on a touch screen, and for anyone who cannot hold a drag steady. HTML5 drag
// events do none of those things well.
function orderHtml(pbq, answers, locked) {
  const cfg = pbq.config;
  const held = answers.held || null;

  if (cfg.mode === "sequence") {
    const order = answers.order || [];
    const remaining = cfg.items.filter((i) => !order.includes(i.id));
    const heldItem = cfg.items.find((i) => i.id === held);
    return `
    <div class="card">
      <h2 class="eyebrow">Steps to place${heldItem ? ` &middot; pick a position for "${esc(heldItem.label)}"` : ""}</h2>
      ${remaining.length
        ? `<div class="chip-pool">${remaining.map((i) => `
            <button class="chip ${held === i.id ? "held" : ""}" data-action="order-hold" data-item="${esc(i.id)}" ${locked ? "disabled" : ""}>
              ${esc(i.label)}</button>`).join("")}</div>`
        : `<p class="faint m0">All steps placed. Click one in the sequence to take it back.</p>`}
      ${remaining.length && !held
        ? `<p class="note">Click a step, then click the position it belongs in. You can fill the positions in any order.</p>`
        : ""}
    </div>
    <div class="card">
      <h2 class="eyebrow">${esc(cfg.sequenceLabel || "In order")}</h2>
      <ol class="seq">
        ${cfg.items.map((_, i) => {
          const id = order[i];
          const item = cfg.items.find((x) => x.id === id);
          return `<li class="${item ? "filled" : "empty"}">
            <span class="pos">${i + 1}</span>
            ${item
              ? `<button class="chip placed" data-action="order-unplace" data-i="${i}" ${locked ? "disabled" : ""}>${esc(item.label)}</button>`
              : `<button class="slot" data-action="order-place-at" data-i="${i}" ${locked || !held ? "disabled" : ""}>
                   ${held ? "place here" : "empty"}</button>`}
          </li>`;
        }).join("")}
      </ol>
    </div>`;
  }

  // categorize
  const placements = answers.placements || {};
  const unplaced = cfg.items.filter((i) => !placements[i.id]);
  return `
  <div class="card">
    <h2 class="eyebrow">Items to classify${held ? ` &middot; pick a column for "${esc(cfg.items.find((i) => i.id === held)?.label || "")}"` : ""}</h2>
    ${unplaced.length
      ? `<div class="chip-pool">${unplaced.map((i) => `
          <button class="chip ${held === i.id ? "held" : ""}" data-action="order-hold" data-item="${esc(i.id)}" ${locked ? "disabled" : ""}>
            ${esc(i.label)}</button>`).join("")}</div>`
      : `<p class="faint m0">Everything placed. Click an item in a column to take it back.</p>`}
  </div>
  <div class="buckets">
    ${cfg.buckets.map((b) => `
      <div class="bucket">
        <button class="bucket-head" data-action="order-drop" data-bucket="${esc(b.id)}" ${locked || !held ? "disabled" : ""}>
          ${esc(b.label)}${held ? " &larr; place here" : ""}
        </button>
        <div class="bucket-body">
          ${cfg.items.filter((i) => placements[i.id] === b.id).map((i) => `
            <button class="chip placed" data-action="order-remove" data-item="${esc(i.id)}" ${locked ? "disabled" : ""}>
              ${esc(i.label)}</button>`).join("") || `<span class="faint">empty</span>`}
        </div>
      </div>`).join("")}
  </div>`;
}

// --- shell -----------------------------------------------------------------
export function pbqHtml(pbq, answers, { locked = false, graded = null, inExam = false } = {}) {
  const body =
    pbq.kind === "wireless-config" ? wirelessHtml(pbq, answers, locked)
    : pbq.kind === "acl-table" ? aclHtml(pbq, answers, locked)
    : pbq.kind === "drag-order" ? orderHtml(pbq, answers, locked)
    : diagramHtml(pbq, answers, locked);

  const reqs = (pbq.requirements || []).map((r) => `<li>${esc(r)}</li>`).join("");
  const target = Math.round((pbq.targetSeconds || 480) / 60);

  return `
  <div class="spread mb2">
    <h1>${esc(pbq.title)}</h1>
    <div class="row nowrap">
      <span class="tag">objective ${esc(pbq.objective)}</span>
      ${inExam ? "" : `<span class="tag" id="pbq-timer" data-target="${pbq.targetSeconds || 480}">0:00 / ${target}:00</span>`}
    </div>
  </div>
  <p class="sub">${gloss(pbq.scenario)}</p>
  ${reqs ? `<details class="card req-card" open>
      <summary><h2 class="eyebrow">Requirements</h2><span class="faint">${(pbq.requirements || []).length} to satisfy</span></summary>
      <ol class="req">${reqs}</ol>
    </details>` : ""}
  ${body}
  ${graded ? gradedHtml(pbq, graded)
    : inExam
      // No per-question submit inside a mock: the exam is scored at the end, and
      // getting used to leaving a PBQ unfinished and coming back is the skill.
      ? `<p class="faint">Answer what you can and move on. Nothing is scored until you submit the exam, and you can come back to this with Back.</p>`
      : `<div class="row">
         <button class="btn" data-action="pbq-submit">Submit</button>
         <span class="hint">Every subtask scores on its own, so answer all of them even where you are unsure.</span>
       </div>`}`;
}

function gradedHtml(pbq, g) {
  const tone = g.percent >= 90 ? "good" : g.percent >= 70 ? "warn" : "bad";
  return `
  <div class="card">
    <div class="spread">
      <div>
        <div class="score-big c-${tone}">${g.earned}<small>/${g.max}</small></div>
        <div class="faint">${g.percent}% &middot; partial credit applied per subtask</div>
      </div>
      <button class="btn" data-action="pbq-continue">Continue</button>
    </div>
  </div>
  ${g.trace ? aclTraceHtml(g.trace) : ""}
  <div class="card"><h2 class="eyebrow">Scoring detail</h2>${resultsHtml(g.results)}</div>
  ${g.mentorHtml || ""}`;
}
