import { esc } from "./common.js";

export function aclHtml(pbq, answers, locked) {
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

  // A select in a grid takes its name from nothing: the column header does
  // not label it, so a screen reader would hear "PERMIT, pop up button" six
  // times a row. Each one says which rule and which column it is.
  const sel = (i, k, label, options) =>
    `<select data-acl="${i}" data-k="${k}" aria-label="Rule ${i + 1} ${label}" ${locked ? "disabled" : ""}>${options}</select>`;
  const body = rules
    .map(
      (r, i) => `<tr>
      <td class="mono">${i + 1}</td>
      <td>${sel(i, "action", "action", `
        <option value="permit" ${r.action === "permit" ? "selected" : ""}>PERMIT</option>
        <option value="deny" ${r.action === "deny" ? "selected" : ""}>DENY</option>`)}</td>
      <td>${sel(i, "protocol", "protocol", protoOpts(r.protocol))}</td>
      <td>${sel(i, "src", "source", addrOpts(r.src))}</td>
      <td>${sel(i, "srcPort", "source port", portOpts(r.srcPort))}</td>
      <td>${sel(i, "dst", "destination", addrOpts(r.dst))}</td>
      <td>${sel(i, "dstPort", "destination port", portOpts(r.dstPort))}</td>
      <td><div class="row tight">
        <button class="btn ghost small" data-action="acl-up" data-i="${i}" aria-label="Move rule ${i + 1} up" ${locked || i === 0 ? "disabled" : ""}>&uarr;</button>
        <button class="btn ghost small" data-action="acl-down" data-i="${i}" aria-label="Move rule ${i + 1} down" ${locked || i === rules.length - 1 ? "disabled" : ""}>&darr;</button>
        <button class="btn ghost small" data-action="acl-del" data-i="${i}" aria-label="Delete rule ${i + 1}" ${locked ? "disabled" : ""}>&times;</button>
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
export function aclReadoutHtml(cfg, rules, edited = -1) {
  const label = (list, v) => list.find((o) => o.value === v)?.label || v;
  const addr = (v) => (v === "any" ? "any" : label(cfg.networkObjects, v));
  const port = (v) => (v === "any" ? "any" : label(cfg.portOptions, v));
  if (!rules.length) {
    return `<div class="readout" id="acl-readout"></div>`;
  }
  const lines = rules
    .map((r, i) => {
      const verb = r.action === "permit" ? "permit" : "deny";
      return `<li class="${verb}${i === edited ? " edited" : ""}"><span class="n">${i + 1}</span>
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

export function aclTraceHtml(trace) {
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
