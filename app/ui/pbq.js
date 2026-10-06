import { esc, resultsHtml } from "./common.js";

const visible = (field, answers) =>
  !field.dependsOn || field.dependsOn.in.includes(answers[field.dependsOn.field]);

// --- wireless --------------------------------------------------------------
function wirelessHtml(pbq, answers, locked) {
  const fields = pbq.config.fields
    .map((f) => {
      const on = visible(f, answers);
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
      <td><div class="row" style="gap:var(--s1);flex-wrap:nowrap">
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
    <p class="faint" style="margin:var(--s3) 0 0">
      ${cfg.stateful
        ? "This firewall is <b>stateful</b>: return traffic for a permitted connection is handled for you."
        : "This is a <b>stateless</b> packet filter: it does not track connections, so each direction needs its own rule."}
      Evaluation is top to bottom, first match wins, and an implicit deny sits at the bottom.
    </p>
  </div>
  <div class="card">
    <div class="spread" style="margin-bottom:var(--s3)">
      <h2 class="eyebrow" style="margin:0">Access control list</h2>
      <button class="btn ghost small" data-action="acl-add" ${locked || rules.length >= cfg.maxRules ? "disabled" : ""}>
        + Add rule <span class="faint">${rules.length}/${cfg.maxRules}</span>
      </button>
    </div>
    <div class="scroll-x"><table class="grid">
      <thead><tr><th>#</th><th>Action</th><th>Proto</th><th>Source</th><th>Src port</th><th>Destination</th><th>Dst port</th><th></th></tr></thead>
      <tbody>${body || `<tr><td colspan="8" class="faint" style="padding:var(--s5);text-align:center">No rules yet. With an empty list, everything is denied.</td></tr>`}</tbody>
    </table></div>
  </div>`;
}

function aclTraceHtml(trace) {
  return `<div class="card"><h2 class="eyebrow">Traffic simulation</h2>
    <p class="faint" style="margin:0 0 var(--s3)">Your rule set was executed against each flow, the way the firewall would.</p>
    <div class="scroll-x"><table class="grid">
    <thead><tr><th></th><th>Flow</th><th>Required</th><th>Yours</th><th>Decided by</th></tr></thead>
    <tbody>${trace
      .map(
        (t) => `<tr>
        <td><span class="mark ${t.pass ? "ok" : "no"}" style="display:grid;width:1.2rem;height:1.2rem;border-radius:50%;place-items:center;color:#fff;font-size:var(--t-xs)">${t.pass ? "&check;" : "&times;"}</span></td>
        <td>${esc(t.label)}<div class="faint mono">${esc(t.packet.src)}:${esc(t.packet.srcPort)} &rarr; ${esc(t.packet.dst)}:${esc(t.packet.dstPort)} ${esc(t.packet.protocol)}</div></td>
        <td class="mono">${t.expect}</td>
        <td class="mono" style="color:${t.pass ? "inherit" : "var(--bad)"}">${t.got}</td>
        <td class="faint">${t.implicit ? "implicit deny" : `rule ${t.ruleIndex + 1}`}</td>
      </tr>`
      )
      .join("")}</tbody></table></div></div>`;
}

// --- network diagram -------------------------------------------------------
function diagramHtml(pbq, answers, locked) {
  const cfg = pbq.config;
  const selected = new Set(answers["t-identify"] || answers.selectedNodes || []);
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

  const ev = inspected && cfg.evidence[inspected];
  const evHtml = ev
    ? `<div class="card"><div class="spread" style="margin-bottom:var(--s3)">
         <h2 class="eyebrow" style="margin:0">${esc(pos[inspected].label)} &mdash; collected evidence</h2>
         <span class="tag">${esc(pos[inspected].ip || "")}</span></div>
       <p class="muted">${esc(ev.summary)}</p>
       <div class="evidence">${esc(ev.lines.join("\n"))}</div></div>`
    : `<div class="card tight"><p class="faint" style="margin:0">Click a host to read the evidence collected from it. Hosts you have reviewed get a dot.</p></div>`;

  const tasks = cfg.tasks
    .map((t) => {
      if (t.type === "select-nodes") {
        const chosen = [...selected].map((id) => pos[id]?.label).filter(Boolean);
        return `<div class="card"><b>${esc(t.prompt)}</b>
          <div class="row" style="margin-top:var(--s3)">
            ${chosen.length
              ? chosen.map((c) => `<span class="tag warn">${esc(c)}</span>`).join("")
              : `<span class="faint">Nothing selected. Click hosts in the diagram.</span>`}
          </div></div>`;
      }
      const val = answers[t.id];
      return `<div class="card"><b>${esc(t.prompt)}</b>
        <div class="opts" style="margin-top:var(--s4)">
          ${t.options
            .map((o, i) => `<button class="opt ${val === o.value ? "chosen" : ""}"
              data-action="diagram-choice" data-task="${t.id}" data-value="${esc(o.value)}" ${locked ? "disabled" : ""}>
              <span class="key" aria-hidden="true">${"ABCDEF"[i]}</span><span>${esc(o.label)}</span><span class="verdict"></span></button>`)
            .join("")}
        </div></div>`;
    })
    .join("");

  return `<svg class="diagram" viewBox="0 0 100 92" style="width:100%;height:auto;aspect-ratio:100/92"
            role="img" aria-label="Network topology">${links}${nodes}</svg>
    ${evHtml}${tasks}`;
}

// --- shell -----------------------------------------------------------------
export function pbqHtml(pbq, answers, { locked = false, graded = null, inExam = false } = {}) {
  const body =
    pbq.kind === "wireless-config" ? wirelessHtml(pbq, answers, locked)
    : pbq.kind === "acl-table" ? aclHtml(pbq, answers, locked)
    : diagramHtml(pbq, answers, locked);

  const reqs = (pbq.requirements || []).map((r) => `<li>${esc(r)}</li>`).join("");
  const target = Math.round((pbq.targetSeconds || 480) / 60);

  return `
  <div class="spread" style="margin-bottom:var(--s2)">
    <h1 style="margin:0">${esc(pbq.title)}</h1>
    <div class="row" style="flex-wrap:nowrap">
      <span class="tag">objective ${esc(pbq.objective)}</span>
      ${inExam ? "" : `<span class="tag" id="pbq-timer" data-target="${pbq.targetSeconds || 480}">0:00 / ${target}:00</span>`}
    </div>
  </div>
  <p class="sub">${esc(pbq.scenario)}</p>
  ${reqs ? `<div class="card"><h2 class="eyebrow">Requirements</h2><ol class="req">${reqs}</ol></div>` : ""}
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
        <div class="score-big" style="color:var(--${tone})">${g.earned}<span class="faint" style="font-size:var(--t-xl)">/${g.max}</span></div>
        <div class="faint">${g.percent}% &middot; partial credit applied per subtask</div>
      </div>
      <button class="btn" data-action="pbq-continue">Continue</button>
    </div>
  </div>
  ${g.trace ? aclTraceHtml(g.trace) : ""}
  <div class="card"><h2 class="eyebrow">Scoring detail</h2>${resultsHtml(g.results)}</div>
  ${g.mentorHtml || ""}`;
}
