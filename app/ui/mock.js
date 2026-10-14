import { esc, gloss, pct, emptyState, optionButton, presentOptions, pbqAnswered, KEYS } from "./common.js";
import { pbqHtml } from "./pbq.js";
import { blockFit, FORMATS, PBQ_WEIGHT } from "../scheduler.js";
import { isGraded } from "../content.js";
import * as reviews from "../reviews.js";

// --- mock exam -------------------------------------------------------------
// The exam is 90 questions in 90 minutes with PBQs front loaded, scored 100-900
// with 750 to pass. A mock is only useful if it is faithful about the things
// that actually catch people: no feedback until the end, a clock you cannot
// pause, and PBQs eating your time before you have banked any easy marks.


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
        You can end early: submit to score what you have, with blanks counted wrong as on the real exam, or abandon without a score.</p>
        <div class="row mt3"><button class="btn" data-action="mock-start" data-format="${k}">Start the ${esc(f.label.toLowerCase())}</button></div>`;
    })()}
    ${short ? `<p class="note">The bank holds ${graded} graded item${graded === 1 ? "" : "s"} and ${App.content.pbqs.length} PBQ${App.content.pbqs.length === 1 ? "" : "s"}, fewer than a full block wants, so a block runs with what exists and keeps the exam's minute per question.</p>` : ""}
    <p class="note">Every question you answer and miss is banked as a correction afterwards, exactly as it would be in a drill. A mock that does not feed the rest of the system is just a number.</p>
  </div>`;

  return `<h1>Mock exam</h1>
  <p class="sub">Format faithful: performance-based questions first, no feedback until you submit, and a clock that does not stop. The point is not the score, it is finding out what falls apart under time pressure.</p>
  ${blocks}

  ${history.length ? `<h2>Previous attempts</h2>
    <div class="card"><div class="scroll-x"><table class="grid">
      <thead><tr><th>When</th><th>Block</th><th>Raw</th><th>Scaled</th><th>Verdict</th><th>Time used</th></tr></thead>
      <tbody>${history.map((m) => `<tr>
        <td class="faint">${new Date(m.at).toLocaleDateString()}</td>
        <td>${esc(FORMATS[m.format]?.label || m.format)}</td>
        ${m.abandoned
          ? `<td class="faint" colspan="2">not scored</td><td>abandoned, ${m.answered} of ${m.of} answered</td>`
          : `<td class="mono">${pct(m.raw)}</td>
        <td class="mono ${m.scaled >= 750 ? "c-good" : "c-bad"}">${m.scaled}</td>
        <td>${m.scaled >= 750 ? "pass" : "below"}</td>`}
        <td class="mono">${Math.round(m.seconds / 60)}m</td>
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
  const answeredOf = (e) =>
    (e.kind === "pbq" ? pbqAnswered(App.answers[e.pbq.id]) : !!m.answers[e.item.id]) ? "answered" : "blank";

  const cells = m.items.map((e, i) => {
    const id = e.item?.id || e.pbq?.id;
    const state = answeredOf(e);
    const flagged = m.flagged.has(id);
    return `<button class="rv ${state} ${flagged ? "flagged" : ""} ${i === m.idx ? "here" : ""}"
      data-action="mock-goto" data-i="${i}" ${i === m.idx ? 'aria-current="true"' : ""}
      aria-label="Question ${i + 1}${e.kind === "pbq" ? ", performance based" : ""}, ${state}${flagged ? ", flagged" : ""}"
      title="${e.kind === "pbq" ? esc(e.pbq.title) : "Question " + (i + 1)}${flagged ? " (flagged)" : ""}">
      <span class="n">${i + 1}</span>${e.kind === "pbq" ? `<span class="pb">PBQ</span>` : ""}
    </button>`;
  }).join("");

  const blanks = m.items.filter((e) => answeredOf(e) === "blank").length;
  const flagged = m.flagged.size;

  return `
  <div class="session-bar">
    <div class="meta">
      <span><b>Review</b> &middot; ${m.items.length} questions</span>
      <span id="mock-timer" data-ends="${m.endsAt}" class="mono">--:--</span>
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
  const answered = m.items.filter((e) => e.kind === "pbq" ? pbqAnswered(App.answers[e.pbq.id]) : !!m.answers[e.item.id]).length;
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
  const answered = Object.keys(m.answers).filter((k) => m.answers[k] != null).length;

  const body = entry.kind === "pbq"
    ? pbqHtml(entry.pbq, App.answers[entry.pbq.id] || {}, { locked: false, graded: null, inExam: true })
    : mockMcqHtml(presentOptions(entry), m.answers[entry.item.id], m.flagged.has(entry.item.id));

  return `
  <div class="session-bar">
    <div class="meta">
      <span>Question <b>${m.idx + 1}</b> of ${m.items.length} &middot; ${answered} answered</span>
      <span id="mock-timer" data-ends="${m.endsAt}" class="mono">--:--</span>
    </div>
    <div class="track"><i style="--w:${((m.idx + 1) / m.items.length) * 100}%"></i></div>
  </div>
  ${body}
  <div class="row mt5 between">
    <div class="row">
      <button class="btn ghost" data-action="mock-prev" ${m.idx === 0 ? "disabled" : ""}>Back</button>
      <button class="btn" data-action="mock-next" ${m.idx === m.items.length - 1 ? "disabled" : ""}>Next</button>
      <button class="btn ghost small" data-action="mock-flag">${m.flagged.has(entry.item?.id || entry.pbq?.id) ? "Unflag" : "Flag for review"}</button>
    </div>
    <div class="row">
      <button class="btn ghost" data-action="mock-review">Review all ${m.items.length}</button>
      <button class="btn ghost small" data-action="mock-end">End early</button>
    </div>
  </div>
  ${mockEndHtml(App)}`;
}

function mockMcqHtml(item, chosen, flagged) {
  return `
  <div class="row mb3">
    <span class="tag">objective ${esc(item.objective || "")}</span>
    ${flagged ? `<span class="tag warn">flagged</span>` : ""}
  </div>
  <div class="card">
    <p class="stem">${gloss(item.stem)}</p>
    <div class="opts">
      ${item.options.map((o, i) => optionButton({
        key: KEYS[i], text: o.text, action: "mock-answer", data: { opt: o.id },
        cls: chosen === o.id ? "chosen" : "", verdict: chosen === o.id ? "&#9679;" : "",
        pressed: chosen === o.id,
      })).join("")}
    </div>
  </div>`;
}

export function mockResultView(App) {
  const r = App.mock.result;
  const tone = r.scaled >= 750 ? "good" : r.scaled >= 680 ? "warn" : "bad";

  const domains = r.byDomain.map((d) => `<tr>
      <td>${d.id}.0 ${esc(d.title)}</td>
      <td class="mono">${d.correct}/${d.total}</td>
      <td class="mono">${d.total ? pct(d.correct / d.total) : "&mdash;"}</td>
      <td class="mono">${pct(d.weight)}</td>
      <td class="faint">${d.total && d.correct / d.total < 0.7 ? "below the line" : "holding"}</td>
    </tr>`).join("");

  const notes = r.notes.map((n) => `<li>${esc(n)}</li>`).join("");

  return `<h1>Mock exam result</h1>
  <div class="card">
    <div class="spread top">
      <div>
        <div class="score-big c-${tone}">${r.scaled}</div>
        <div class="faint">${{ good: "above the line", warn: "near the line", bad: "below the line" }[tone]} &middot; estimated scaled score &middot; pass line 750 &middot; ${pct(r.raw)} raw</div>
      </div>
      <dl class="side-stats inline">
        <div class="stat"><dt>Time used</dt><dd>${Math.round(r.seconds / 60)}m of ${r.minutes}m</dd></div>
        <div class="stat"><dt>Unanswered</dt><dd class="${r.unanswered ? "warn" : ""}">${r.unanswered}</dd></div>
        <div class="stat"><dt>Banked</dt><dd class="${r.banked ? "warn" : ""}">${r.banked}</dd></div>
      </dl>
    </div>
    <p class="note">An estimate on CompTIA's 100-900 scale, weighting each PBQ as roughly ${PBQ_WEIGHT} multiple choice items. One result above 750 is not readiness. A margin above it, across separate blocks, on different days, is.</p>
  </div>

  ${notes ? `<div class="card tight"><h2 class="eyebrow">What this exposed</h2><ul class="req m0">${notes}</ul></div>` : ""}

  <h2>By domain</h2>
  <div class="card"><div class="scroll-x"><table class="grid">
    <thead><tr><th>Domain</th><th>Correct</th><th>Score</th><th>Exam weight</th><th></th></tr></thead>
    <tbody>${domains}</tbody></table></div></div>

  ${r.mentorHtml ? `<h2>Corrections banked</h2>
    <p class="sub">These are now in your schedule and will come back on different questions.</p>${r.mentorHtml}` : ""}

  <div class="row"><button class="btn" data-action="mock-done">Back to mock exams</button></div>`;
}
