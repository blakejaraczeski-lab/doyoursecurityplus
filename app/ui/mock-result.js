import { esc, gloss, pct, mentorCards } from "./common.js";
import { PBQ_WEIGHT } from "../scheduler.js";
import { DAY_MS } from "../fsrs.js";

// A mock that is answered this far counts as a sitting (the scheduler's MIN_ANSWERED).
const COUNTS_AT = 0.8;

/** m:ss for a number of seconds. */
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

/**
 * What a logged mock does for the booking rule, in a key and a sentence. The
 * same words on the history and on the result, so they cannot disagree.
 */
export function countsWord(row, now = Date.now()) {
  if (row.abandoned) return { key: "ignored", text: "ignored" };
  if (row.of && row.answered / row.of < COUNTS_AT) return { key: "under", text: "not counted, under 80% answered" };
  if (row.format !== "full") return { key: "forecast", text: "forecast only" };
  if (row.at < now - 14 * DAY_MS) return { key: "old", text: "older than 14 days" };
  return { key: "counts", text: "counts" };
}

const COUNTS_SENTENCE = {
  counts: "This full mock counts toward the booking rule.",
  forecast: "This block moves your forecast. Only full mocks count toward the booking rule.",
  under: "Fewer than 80% of the questions were answered, so this sitting is not counted.",
};

const STATE_WORD = { blank: "left blank", miss: "missed", ok: "correct" };
const STATE_GLYPH = { blank: "&ndash;", miss: "&times;", ok: "&check;" };

const stateOf = (x) => x.pbq
  ? (!x.touched ? "blank" : x.earned >= x.max ? "ok" : "miss")
  : !x.picked.length ? "blank" : x.correct ? "ok" : "miss";

/** One option in the review: your pick and the right answer marked in words and glyphs, every option's why beneath it. */
function revOption(o, picked) {
  const on = picked.includes(o.id);
  const cls = o.correct ? "correct" : on ? "picked-wrong" : "";
  const glyph = o.correct ? "&check;" : on ? "&times;" : "";
  const label = o.correct ? (on ? "Your pick, correct" : "Correct answer") : on ? "Your pick" : "";
  return `<div class="rev-opt ${cls}">
    <span class="rev-glyph" aria-hidden="true">${glyph}</span>
    <div>
      <div>${gloss(o.text)}${label ? ` <span class="rev-label">${label}</span>` : ""}</div>
      ${o.why ? `<p class="rev-why">${esc(o.why)}</p>` : ""}
    </div>
  </div>`;
}

function revRow(App, x) {
  const state = stateOf(x);
  const flag = x.flagged ? `<span class="tag warn">flagged</span>` : "";
  const head = (title) => `<summary>
      <span class="rev-state"><span aria-hidden="true">${STATE_GLYPH[state]}</span> ${STATE_WORD[state]}</span>
      <span class="rev-q">Q${x.n}</span><span class="rev-title">${title}</span>${flag}
    </summary>`;

  if (x.pbq) {
    const p = App.content.pbqsById[x.id];
    return `<details class="rev-item" data-state="${state}" data-q="${x.n}">${head(esc(p?.title || x.id))}
      <div class="rev-body"><p class="rev-why">${state === "blank"
        ? "Not attempted, so it counted as zero."
        : `Scored ${x.earned} of ${x.max} points. Open it in the Lab to work it again.`}</p></div>
    </details>`;
  }

  const it = App.content.itemsById[x.id];
  if (!it) return "";
  const stem = String(it.stem || "").replace(/\s+/g, " ");
  const short = stem.length > 90 ? `${stem.slice(0, 88)}...` : stem;
  const why = it.options.some((o) => o.why) ? "" : `<p class="rev-why">No explanation is written for this one yet.</p>`;
  return `<details class="rev-item" data-state="${state}" data-q="${x.n}">${head(esc(short))}
    <div class="rev-body">
      <p class="stem">${gloss(it.stem)}</p>
      ${it.options.map((o) => revOption(o, x.picked)).join("")}${why}
    </div>
  </details>`;
}

/** Misses and blanks first, in exam order; what you got right folded below. */
function reviewHtml(App, r) {
  const todo = r.review.filter((x) => stateOf(x) !== "ok");
  const done = r.review.filter((x) => stateOf(x) === "ok");
  return `<h2>Review every question</h2>
  <p class="sub">${todo.length
    ? `${todo.length} to look at: what you missed or left blank, with the reason for every option.`
    : "Every question was correct."}</p>
  ${todo.length ? `<div class="card tight rev-list">${todo.map((x) => revRow(App, x)).join("")}</div>` : ""}
  ${done.length ? `<details class="card tight rev-group"><summary>Answered correctly (${done.length})</summary>
    <div class="rev-list">${done.map((x) => revRow(App, x)).join("")}</div></details>` : ""}`;
}

export function mockResultView(App) {
  const r = App.mock.result;
  const tone = r.scaled >= 750 ? "good" : r.scaled >= 680 ? "warn" : "bad";

  const domains = r.byDomain.map((d) => `<tr>
      <td>${d.id}.0 ${esc(d.title)}</td>
      <td class="mono">${d.correct}/${d.total}</td>
      <td class="mono">${d.total ? pct(d.correct / d.total) : "&mdash;"}</td>
      <td class="mono">${pct(d.weight)}</td>
      <td class="faint">${d.total < 3 ? "too few to judge" : d.correct / d.total < 0.7 ? "below the line" : "holding"}</td>
    </tr>`).join("");

  const notes = r.notes.map((n) => `<li>${esc(n)}</li>`).join("");
  const weakest = r.byDomain.filter((d) => d.total >= 3).sort((a, b) => a.correct / a.total - b.correct / b.total)[0];
  const next = [
    COUNTS_SENTENCE[r.counts],
    r.rule ? `Booking rule: ${r.rule}.` : "",
    weakest && weakest.correct < weakest.total ? `Weakest domain: ${weakest.id}.0 ${weakest.title}, ${weakest.correct} of ${weakest.total}.` : "",
  ].filter(Boolean).map((t) => `<li>${esc(t)}</li>`).join("");

  const timeUp = r.endedBy === "time"
    ? `<div class="card flag" role="status"><b>Time ran out${r.away ? " while you were away" : ` at question ${r.endedAt}`}.</b>
        <p class="m0">Your answers up to then were scored. Questions you had not answered were scored wrong.</p></div>`
    : "";

  return `<h1>Mock exam result</h1>
  ${timeUp}
  <div class="card">
    <div class="spread top">
      <div>
        <div class="score-big c-${tone}">${r.scaled}</div>
        <div class="faint">${{ good: "above the line", warn: "near the line", bad: "below the line" }[tone]} &middot; estimated scaled score &middot; pass line 750 &middot; ${pct(r.raw)} raw</div>
      </div>
      <dl class="side-stats inline">
        <div class="stat"><dt>Time used</dt><dd>${fmtClock(r.seconds)} of ${fmtClock(r.minutes * 60)}</dd></div>
        <div class="stat"><dt>Unanswered</dt><dd class="${r.unanswered ? "warn" : ""}">${r.unanswered}</dd></div>
        <div class="stat"><dt>Banked</dt><dd class="${r.banked ? "warn" : ""}">${r.banked}</dd></div>
      </dl>
    </div>
    <p class="note">An estimate on CompTIA's 100-900 scale, weighting each PBQ as roughly ${PBQ_WEIGHT} multiple choice items. One result above 750 is not readiness. A margin above it, across separate blocks, on different days, is.</p>
  </div>

  <div class="card tight"><h2 class="eyebrow">What this did</h2>
    <ul class="req m0">${next}</ul>
    <div class="row mt3">
      ${r.banked ? `<button class="btn" data-action="start-weak">Drill your corrections</button>` : ""}
      <button class="btn ${r.banked ? "ghost" : ""}" data-action="nav" data-section="readiness">See Readiness</button>
    </div>
  </div>

  ${notes ? `<div class="card tight"><h2 class="eyebrow">What this exposed</h2><ul class="req m0">${notes}</ul></div>` : ""}

  <h2>By domain</h2>
  <div class="card"><div class="scroll-x"><table class="grid">
    <thead><tr><th>Domain</th><th>Correct</th><th>Score</th><th>Exam weight</th><th></th></tr></thead>
    <tbody>${domains}</tbody></table></div></div>

  ${reviewHtml(App, r)}

  ${r.bankedIds.length ? `<h2>Corrections banked</h2>
    <p class="sub">These are now in your schedule and will come back on different questions.${r.bankedIds.length > 6 ? ` The first 6 are below; all ${r.bankedIds.length} are in the Bank.` : ""}</p>${mentorCards(App, r.bankedIds.slice(0, 6))}` : ""}

  <div class="row mt5"><button class="btn" data-action="mock-done">Back to mock exams</button></div>`;
}
