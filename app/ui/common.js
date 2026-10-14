import * as mentor from "../mentor.js";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const pct = (n) => `${Math.round(n * 100)}%`;

// The exam uses acronyms inside stems without expanding them, so every
// acronym in CompTIA's own list is expanded inline where it appears, which is
// the moment the expansion is needed. Keys are matched after escaping, longest
// first, so "AES-256" wins over "AES" and "ATT&CK" survives the ampersand.
let glossary = {};
let glossRe = null;
export function setGlossary(g) {
  glossary = Object.fromEntries(Object.entries(g || {}).map(([k, v]) => [esc(k), v]));
  const keys = Object.keys(glossary).sort((a, b) => b.length - a.length);
  glossRe = keys.length
    ? new RegExp(`(?<![A-Za-z0-9])(${keys.map((k) => k.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})(?![A-Za-z0-9])`, "g")
    : null;
}
export const gloss = (s) => {
  const safe = esc(s);
  return glossRe ? safe.replace(glossRe, (m) => `<abbr title="${esc(glossary[m])}">${m}</abbr>`) : safe;
};

export function objectiveLabel(content, id) {
  const o = content.objectiveById[id];
  return o ? `${id} ${o.title}` : id || "untagged";
}

export const KEYS = [..."ABCDEFGHIJ"];

/**
 * One answer option. The same control everywhere an option is chosen: the
 * drill, multiple select, the mock, and the choice tasks inside a diagram PBQ.
 * Full width and 56px tall, because it is hit hundreds of times a session.
 */
export function optionButton({ key, text, action, data = {}, cls = "", verdict = "", disabled = false, checked = null, pressed = null }) {
  const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ");
  // A choose-N option is a checkbox; a chosen-but-not-yet-scored option (the
  // mock, a diagram task) is a pressed button. Either way the state is spoken.
  const role = checked != null ? ` role="checkbox" aria-checked="${checked}"`
    : pressed != null ? ` aria-pressed="${pressed}"` : "";
  return `<button class="opt ${cls}" data-action="${action}" ${attrs}${role} ${disabled ? "disabled" : ""}>
    <span class="key" aria-hidden="true">${key}</span>
    <span>${gloss(text)}</span>
    <span class="verdict" aria-hidden="true">${verdict}</span>
  </button>`;
}

/** Retirement progress as filled pips. Discrete progress reads faster than a bar. */
function pipsHtml(have, needed) {
  return `<span class="pips" role="img" aria-label="${have} of ${needed} clean passes">${
    Array.from({ length: needed }, (_, i) => `<i class="${i < have ? "on" : ""}"></i>`).join("")
  }</span>`;
}

/**
 * The mentor correction.
 *
 * Structure is deliberate: diagnosis (what you believed) comes first because it
 * has to land before the correction means anything; the contrast table does the
 * discriminating work; and the rule of thumb is isolated in its own block,
 * because that is the single sentence you need to retrieve under time pressure
 * and isolated items are remembered far better than items inside a paragraph.
 */
export function mentorCardHtml(card) {
  if (!card) return "";
  const m = card.mentor;
  const rows = m.contrast || [];
  const table = rows.length
    ? `<div class="scroll-x"><table>
         <thead><tr>${rows[0].map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
         <tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
       </table></div>`
    : "";

  const refs = (card.reviewIn || [])
    .map((s) => `<li>${esc(s.source || "Notes")}: ${esc(s.title)}, p.${s.page}</li>`)
    .join("");

  const p = card.progress;
  const badge = p
    ? p.retired
      ? `<span class="progress-pill">Retired</span>`
      : `<span class="progress-pill">${p.have}/${p.needed} clean${
          p.hits > 1 ? ` &middot; missed ${p.hits}&times;` : ""
        }${pipsHtml(p.have, p.needed)}</span>`
    : "";

  const TIER = {
    2: ["again", "You have read this correction once already",
        "Leading with the rule this time. If the rule is not sticking, the contrast table is the part to study, not the prose."],
    3: ["third", "Third time on this one",
        "Re-reading is not working, so the next questions are a contrast drill: two items that look alike with opposite answers."],
  };
  const tier = TIER[card.tier];

  return `
  <article class="card mentor${card.tier >= 3 ? " mentor-escalated" : ""}">
    ${tier ? `<div class="tier-banner t-${tier[0]}"><b>${esc(tier[1])}</b><span>${esc(tier[2])}</span></div>` : ""}
    <div class="spread mentor-head">
      <div>
        <h3>${esc(card.label)}</h3>
        <div class="faint">${esc(card.objectiveTitle || "")}</div>
      </div>
      ${badge}
    </div>
    <p class="diag">${esc(m.diagnosis)}</p>
    ${(card.blockers || []).length ? `<div class="blockers">
      <b>This sits on top of something still open</b>
      <ul>${card.blockers.map((b) => `<li><b>${esc(b.def.label)}</b>: ${esc(b.why)}</li>`).join("")}</ul>
      <span class="faint">Expect this one to keep slipping until that is solid. The queue will route you there first.</span>
    </div>` : ""}
    ${table}
    <div class="rule-of-thumb"><span class="lbl">Rule of thumb</span>${esc(m.rule)}</div>
    <div class="kv"><b>What to look for in the stem</b>${esc(m.tell)}</div>
    ${m.trap ? `<div class="kv"><b>Why the wrong answer looked right</b>${esc(m.trap)}</div>` : ""}
    ${refs
      ? `<details class="refs"><summary>Read more in your own materials</summary><ul>${refs}</ul></details>`
      : ""}
  </article>`;
}

export function resultsHtml(results) {
  return results
    .map((r) => {
      const cls = r.pass ? "ok" : r.partial ? "part" : "no";
      const glyph = r.pass ? "&check;" : r.partial ? "~" : "&times;";
      return `<div class="result">
        <div class="mark ${cls}" role="img" aria-label="${r.pass ? "correct" : r.partial ? "partial" : "incorrect"}">${glyph}</div>
        <div class="body">
          <b>${esc(r.label)}</b><span class="pts">${r.earned}/${r.points}</span>
          <p>${esc(r.detail)}</p>
          ${r.correctNote && !r.pass ? `<p><b>Why:</b> ${esc(r.correctNote)}</p>` : ""}
        </div>
      </div>`;
    })
    .join("");
}

/** Sticky progress header for a run of questions. */
export function sessionBarHtml({ index, total, label, right }) {
  const done = Math.min(index, total);
  // The drill screen deliberately strips chrome, so its heading is real but
  // not drawn: a screen reader still gets a page name and structure.
  return `<h1 class="sr-only">${esc(label)}, question ${done + 1} of ${total}</h1>
  <div class="session-bar">
    <div class="meta">
      <span>${esc(label)} &middot; <b>${done + 1}</b> of ${total}</span>
      <span>${right || ""}</span>
    </div>
    <div class="track" role="progressbar" aria-label="${esc(label)} progress" aria-valuenow="${done}" aria-valuemin="0" aria-valuemax="${total}">
      <i style="--w:${total ? (done / total) * 100 : 0}%"></i>
    </div>
  </div>`;
}

export function emptyState({ glyph = "&#9634;", title, body, actions = "" }) {
  return `<div class="empty">
    <div class="big">${glyph}</div>
    <b>${esc(title)}</b>
    <p>${esc(body)}</p>
    ${actions}
  </div>`;
}

/**
 * Options are shown in a random order, once per presentation. The stored
 * order put the correct option at "a" in most items, which taught position
 * instead of content. The shuffle reorders the item's own options array, so
 * the keyboard handler, which indexes it by letter, and the rendered letters
 * agree. Everything else addresses an option by its stored id, which never
 * changes, so grading, misconception attribution, the review log and the
 * saved state are unaffected. A letter on screen is a position, not an id.
 * Done once per queue or mock entry, so a re-render or a revisit in the mock
 * keeps the order the learner already saw.
 */
const presented = new WeakSet();
export function presentOptions(entry) {
  const it = entry?.item;
  if (!it || !Array.isArray(it.options) || presented.has(entry)) return it;
  presented.add(entry);
  for (let i = it.options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [it.options[i], it.options[j]] = [it.options[j], it.options[i]];
  }
  return it;
}

export const mentorCards = (App, ids) =>
  (ids || []).map((id) => mentorCardHtml(mentor.card(id, App.content, App.state))).join("");

/** Has this PBQ answer sheet been touched? Inspection state is not an answer. */
export const pbqAnswered = (a) =>
  Object.entries(a || {}).some(([k, v]) =>
    !["seenNodes", "inspected", "held"].includes(k) &&
    (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : !!v));
