import { esc, gloss, pct, emptyState, optionButton, presentOptions, pbqAnswered, KEYS } from "./common.js";
import { pbqHtml } from "./pbq.js";
import { countsWord } from "./mock-result.js";
import { blockFit, examForecast, FORMATS } from "../scheduler.js";
import { isGraded } from "../content.js";
import * as reviews from "../reviews.js";

export { mockResultView } from "./mock-result.js";

// --- mock exam -------------------------------------------------------------
// The exam is 90 questions in 90 minutes with PBQs front loaded, scored 100-900
// with 750 to pass. A mock is only useful if it is faithful about the things
// that actually catch people: no feedback until the end, a clock you cannot
// pause, and PBQs eating your time before you have banked any easy marks.

// --- answers ---------------------------------------------------------------
// A single-select answer is one option id; a choose-N answer is a list of ids.
// A choose-N counts as answered once anything is picked, and as complete only
// at N, because the exam scores it all or nothing.
export const needOf = (item) => item.type === "mcq-multi" ? (item.selectCount || 2) : 1;

/** The option ids picked for an item, in the order they were picked. */
export const pickedOf = (m, item) => {
  const a = m.answers[item.id];
  return Array.isArray(a) ? a : a ? [a] : [];
};

/** "answered", "partial" (a choose-N with fewer than N picked) or "blank". */
export function answerState(App, e) {
  if (e.kind === "pbq") return pbqAnswered(App.answers[e.pbq.id]) ? "answered" : "blank";
  const n = pickedOf(App.mock, e.item).length;
  return !n ? "blank" : n < needOf(e.item) ? "partial" : "answered";
}

/** The clock's words: the urgency is a phrase as well as a hue. */
export function clockText(left) {
  const mm = Math.floor(left / 60000), ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  return `${mm}:${ss} left${left < 5 * 60000 ? ", last 5 min" : left < 15 * 60000 ? ", last 15 min" : ""}`;
}
export const clockClass = (left) => `mono ${left < 5 * 60000 ? "c-bad" : left < 15 * 60000 ? "c-warn" : ""}`;

const timerHtml = (m) => {
  const left = Math.max(0, m.endsAt - Date.now());
  return `<span id="mock-timer" data-ends="${m.endsAt}" class="${clockClass(left)}">${clockText(left)}</span>`;
};

// --- home ------------------------------------------------------------------
// The booking rule's sentence comes from the forecast, so it reads the same
// here as on Readiness. It depends on the mocks and the day only.
let ruleMemo = { key: "", text: "" };
function bookingRule(App, mocks) {
  const key = `${mocks.length}:${mocks.at(-1)?.at}:${new Date().toDateString()}`;
  if (ruleMemo.key !== key) ruleMemo = { key, text: examForecast(App.state, App.content, Date.now(), mocks).stop.rules[1].text };
  return ruleMemo.text;
}

/** The date to plan a first full mock for: three weeks before the exam, until one has been taken. */
function firstMockLine(App, mocks) {
  const exam = App.state.profile.examDate;
  if (!exam || mocks.some((m) => m.format === "full" && !m.abandoned)) return "";
  const [y, mo, d] = exam.split("-").map(Number);
  if (!y || !mo || !d) return "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (new Date(y, mo - 1, d) < today) return "";
  const when = new Date(y, mo - 1, d - 21);
  const day = when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return when >= today
    ? `Plan your first full mock for ${day}, about three weeks before your exam.`
    : `Your first full mock is due. Three weeks before your exam was ${day}.`;
}

export function mockStartView(App) {
  const mocks = reviews.rows("mock");
  const history = mocks.slice(-5).reverse();
  const fits = Object.entries(FORMATS).map(([k, f]) => [k, f, blockFit(App.content, f)]);
  const graded = App.content.items.filter(isGraded).length;
  const short = fits.some(([, , fit]) => fit.short);

  // A bank that cannot fill a block says so on the button, with the count a
  // block will actually run, and a bank with nothing graded has no button.
  const blocks = graded + App.content.pbqs.length === 0
    ? emptyState({
        glyph: "&#9634;",
        title: "Nothing to run a mock on",
        body: "No graded items or PBQs are loaded, so there is nothing to put on the clock. Add JSON under content/items or content/pbq and reload.",
        actions: `<button class="btn" data-action="reload">Reload</button>`,
      })
    : `<div class="card">
    <h2 class="eyebrow">Choose a block</h2>
    <div class="row" role="radiogroup" aria-label="Mock exam block">
      ${fits.map(([k, f, fit]) => `
        <button class="opt block-pick ${App.mockPick === k ? "chosen" : ""}" data-action="mock-select" data-format="${k}"
                role="radio" aria-checked="${App.mockPick === k}">
          <span>${esc(f.label)} <span class="faint">${fit.total}q / ${fit.minutes}m</span></span>
          <span class="verdict" aria-hidden="true">${App.mockPick === k ? "&#9679;" : ""}</span>
        </button>`).join("")}
    </div>
    ${(() => {
      const pick = fits.find(([k]) => k === App.mockPick);
      if (!pick) return `<p class="note">Choose a block to see what it runs. Nothing starts until you press Start.</p>`;
      const [k, f, fit] = pick;
      return `<p class="m0 mt3"><b>${esc(f.label)}:</b> ${fit.total} questions, ${fit.pbqs} of them performance-based and first, on a ${fit.minutes} minute clock that does not stop.
        You can end early: submit to score what you have, with blanks counted wrong as on the real exam, or abandon without a score.
        ${k === "full" ? "It counts toward the booking rule." : "It moves your forecast, not the booking rule."}</p>
        <div class="row mt3"><button class="btn" data-action="mock-start" data-format="${k}">Start the ${esc(f.label.toLowerCase())}</button>
          <span class="faint">Starts the clock now. Set aside ${fit.minutes} minutes.</span></div>`;
    })()}
    ${short ? `<p class="note">The bank holds ${graded} graded item${graded === 1 ? "" : "s"} and ${App.content.pbqs.length} PBQ${App.content.pbqs.length === 1 ? "" : "s"}, fewer than a full block wants, so a block runs with what exists and keeps the exam's minute per question.</p>` : ""}
    <p class="note">Every question you answer and miss is banked as a correction afterwards, exactly as it would be in a drill.</p>
  </div>`;

  return `<h1>Mock exam</h1>
  <p class="sub">Take the full exam to measure readiness. Performance-based questions first, no feedback until you submit, and a clock that does not stop.</p>
  <p class="note mb4">Booking rule: ${esc(bookingRule(App, mocks))}.${(() => { const l = firstMockLine(App, mocks); return l ? ` ${esc(l)}` : ""; })()}</p>
  ${blocks}

  ${history.length ? `<h2>Previous attempts</h2>
    <div class="card"><div class="scroll-x"><table class="grid">
      <thead><tr><th>When</th><th>Block</th><th>Raw</th><th>Scaled</th><th>Verdict</th><th>Time used</th><th>Counts</th></tr></thead>
      <tbody>${history.map((m) => `<tr>
        <td class="faint">${new Date(m.at).toLocaleDateString()}</td>
        <td>${esc(FORMATS[m.format]?.label || m.format)}</td>
        ${m.abandoned
          ? `<td class="faint" colspan="2">not scored</td><td>abandoned, ${m.answered} of ${m.of} answered</td>`
          : `<td class="mono">${pct(m.raw)}</td>
        <td class="mono ${m.scaled >= 750 ? "c-good" : "c-bad"}">${m.scaled}</td>
        <td>${m.scaled >= 750 ? "pass" : "below"}</td>`}
        <td class="mono">${Math.round(m.seconds / 60)}m</td>
        <td class="faint">${countsWord(m).text}</td>
      </tr>`).join("")}</tbody></table></div>

    </div>` : ""}`;
}

/**
 * The review screen the real exam ends with.
 *
 * Without it, "submit" is a leap: you cannot see which of 90 items you left
 * blank or flagged, so people either submit with blanks or burn minutes paging
 * back through everything. Blank matters because there is no penalty for a
 * wrong guess, so an unanswered item is a thrown-away mark and nothing else.
 */
export function mockReviewView(App) {
  const m = App.mock;

  const cells = m.items.map((e, i) => {
    const id = e.item?.id || e.pbq?.id;
    const state = answerState(App, e);
    const flagged = m.flagged.has(id);
    const part = state === "partial" ? `${pickedOf(m, e.item).length}/${needOf(e.item)}` : "";
    return `<button class="rv ${state === "blank" ? "blank" : "answered"} ${flagged ? "flagged" : ""} ${i === m.idx ? "here" : ""}"
      data-action="mock-goto" data-i="${i}" ${i === m.idx ? 'aria-current="true"' : ""}
      aria-label="Question ${i + 1}${e.kind === "pbq" ? ", performance based" : ""}, ${state === "partial" ? `partly answered, ${pickedOf(m, e.item).length} of ${needOf(e.item)}` : state}${flagged ? ", flagged" : ""}"
      title="${e.kind === "pbq" ? esc(e.pbq.title) : "Question " + (i + 1)}${flagged ? " (flagged)" : ""}">
      <span class="n">${i + 1}</span>${e.kind === "pbq" ? `<span class="pb">PBQ</span>` : part ? `<span class="pb">${part}</span>` : ""}
    </button>`;
  }).join("");

  const blanks = m.items.filter((e) => answerState(App, e) === "blank").length;
  const flagged = m.flagged.size;

  return `
  <div class="session-bar">
    <div class="meta">
      <span><b>Review</b> &middot; ${m.items.length} questions</span>
      ${timerHtml(m)}
    </div>
    <div class="track"><i style="--w:100%"></i></div>
  </div>
  <h1>Review before submitting</h1>
  <p class="sub">Click any question to go back to it. ${blanks
      ? `<b>${blanks} unanswered.</b> There is no penalty for a wrong guess on the real exam, so a blank is a mark you have thrown away.`
      : "Nothing left blank."}${flagged ? ` ${flagged} flagged for another look.` : ""}</p>

  <div class="card">
    <div class="rv-legend">
      <span><i class="sw answered"></i> answered</span>
      <span><i class="sw blank"></i> blank</span>
      <span><i class="sw flagged"></i> flagged</span>
    </div>
    <div class="review-grid">${cells}</div>
  </div>

  <div class="row">
    <button class="btn ghost" data-action="mock-resume">Back to question ${m.idx + 1}</button>
    ${blanks ? `<button class="btn ghost" data-action="mock-first-blank">Go to first blank</button>` : ""}
    <button class="btn danger" data-action="mock-submit">Submit exam</button>
    <button class="btn ghost" data-action="mock-end">End early</button>
  </div>
  ${mockEndHtml(App)}`;
}

/** Ending a mock early: two exits, said plainly, and a way back. */
function mockEndHtml(App) {
  const m = App.mock;
  if (!m?.ending) return "";
  const answered = m.items.filter((e) => answerState(App, e) !== "blank").length;
  const blanks = m.items.length - answered;
  return `<div class="card flag mt4" role="dialog" aria-labelledby="end-title">
    <h2 class="eyebrow" id="end-title">End this mock now</h2>
    <p class="m0">${answered} of ${m.items.length} answered.</p>
    <dl class="end-choices">
      <dt><button class="btn" data-action="mock-submit-now">Submit and score</button></dt>
      <dd>The ${blanks} unanswered count as wrong, as they would if the real exam's clock ran out. Blanks are scored wrong but not banked as corrections; the questions you answered wrong are banked. The score counts toward Readiness and the booking rule.</dd>
      <dt><button class="btn ghost" data-action="mock-abandon">Abandon without a score</button></dt>
      <dd>Nothing is scored and nothing is banked. The attempt and the time spent are kept in the history, and Readiness ignores it.</dd>
    </dl>
    <div class="row mt3"><button class="btn ghost small" data-action="mock-end-cancel">Keep going</button></div>
  </div>`;
}

export function mockRunnerView(App) {
  const m = App.mock;
  const entry = m.items[m.idx];
  const id = entry.item?.id || entry.pbq?.id;
  const flagged = m.flagged.has(id);
  const answered = m.items.filter((e) => answerState(App, e) !== "blank").length;

  const body = entry.kind === "pbq"
    ? `${flagged ? `<div class="row mb3"><span class="tag warn">flagged</span></div>` : ""}${
        pbqHtml(entry.pbq, App.answers[entry.pbq.id] || {}, { locked: false, graded: null, inExam: true })}`
    : mockMcqHtml(presentOptions(entry), pickedOf(m, entry.item), flagged);

  return `
  <div class="session-bar">
    <div class="meta">
      <span>Question <b>${m.idx + 1}</b> of ${m.items.length} &middot; ${answered} answered${m.flagged.size ? ` &middot; ${m.flagged.size} flagged` : ""}</span>
      ${timerHtml(m)}
    </div>
    <div class="track"><i style="--w:${((m.idx + 1) / m.items.length) * 100}%"></i></div>
  </div>
  ${mockEndHtml(App)}
  ${body}
  <div class="mock-actions">
    <div class="row">
      <button class="btn ghost" data-action="mock-prev" ${m.idx === 0 ? "disabled" : ""}>Back</button>
      <button class="btn" data-action="mock-next" ${m.idx === m.items.length - 1 ? "disabled" : ""}>Next</button>
      <button class="btn ghost small" data-action="mock-flag">${flagged ? "Unflag" : "Flag for review"}</button>
    </div>
    <div class="row">
      <button class="btn ghost" data-action="mock-review">Review all ${m.items.length}</button>
      <button class="btn ghost small" data-action="mock-end">End early</button>
    </div>
  </div>`;
}

function mockMcqHtml(item, picked, flagged) {
  const multi = item.type === "mcq-multi";
  const need = needOf(item);
  return `
  <div class="row mb3">
    <span class="tag">objective ${esc(item.objective || "")}</span>
    ${multi ? `<span class="tag warn">choose ${need}</span>` : ""}
    ${flagged ? `<span class="tag warn">flagged</span>` : ""}
  </div>
  <div class="card">
    <p class="stem">${gloss(item.stem)}</p>
    <div class="opts" ${multi ? `role="group" aria-label="Select ${need}"` : ""}>
      ${item.options.map((o, i) => {
        const on = picked.includes(o.id);
        return optionButton({
          key: KEYS[i], text: o.text, action: "mock-answer", data: { opt: o.id },
          cls: on ? "chosen" : "", verdict: on ? (multi ? "&check;" : "&#9679;") : "",
          checked: multi ? on : null, pressed: multi ? null : on,
        });
      }).join("")}
    </div>
    ${multi ? `<p class="note">${picked.length} of ${need} selected${picked.length === need ? ". Press a pick again to take it back." : ""}</p>` : ""}
  </div>`;
}
