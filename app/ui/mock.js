import { esc, gloss, pct, mentorCardHtml } from "./common.js";
import { pbqHtml } from "./pbq.js";
import * as mentor from "../mentor.js";

// The exam is 90 questions in 90 minutes with PBQs front loaded, scored 100-900
// with 750 to pass. A mock is only useful if it is faithful about the things
// that actually catch people: no feedback until the end, a clock you cannot
// pause, and PBQs eating your time before you have banked any easy marks.
export const FORMATS = {
  full:  { label: "Full exam",   total: 90, pbqCount: 5, minutes: 90 },
  half:  { label: "Half block",  total: 45, pbqCount: 3, minutes: 45 },
  short: { label: "Short block", total: 20, pbqCount: 1, minutes: 20 },
};

const PBQ_WEIGHT = 3; // a PBQ is worth roughly three multiple choice items

/**
 * Item weight for scoring.
 *
 * CompTIA scales 100-900 and states that items carry different weights by
 * difficulty. The exact model is confidential, so this is an approximation and
 * not a reconstruction: weight rises with the item's authored difficulty, and a
 * hard item is worth about twice an easy one rather than ten times.
 *
 * Why it matters for YOUR score and not just realism: a flat count rewards
 * farming easy items. Weighted, a run of difficulty-1 recognition items does
 * not move the number the way a difficulty-5 PBQ subtask does, which is the
 * honest signal about readiness.
 */
const itemWeight = (it) => 0.6 + 0.2 * Math.max(1, Math.min(5, it.difficulty || 2));

export function startView(App) {
  const best = App.state.mockHistory?.length
    ? Math.max(...App.state.mockHistory.map((m) => m.scaled))
    : null;
  const history = (App.state.mockHistory || []).slice(-5).reverse();

  return `<h1>Mock exam</h1>
  <p class="sub">Format faithful: performance-based questions first, no feedback until you submit, and a clock that does not stop. The point is not the score, it is finding out what falls apart under time pressure.</p>

  <div class="card">
    <h2 class="eyebrow">Choose a block</h2>
    <div class="row">
      ${Object.entries(FORMATS).map(([k, f]) => `
        <button class="btn ${k === "full" ? "" : "ghost"}" data-action="mock-start" data-format="${k}">
          ${esc(f.label)} <span class="faint">${f.total}q / ${f.minutes}m</span>
        </button>`).join("")}
    </div>
    <p class="faint" style="margin:var(--s3) 0 0">Everything you miss is banked as a correction afterwards, exactly as it would be in a drill. A mock that does not feed the rest of the system is just a number.</p>
  </div>

  ${history.length ? `<h2>Previous attempts</h2>
    <div class="card"><div class="scroll-x"><table class="grid">
      <thead><tr><th>When</th><th>Block</th><th>Raw</th><th>Scaled</th><th>Verdict</th><th>Time used</th></tr></thead>
      <tbody>${history.map((m) => `<tr>
        <td class="faint">${new Date(m.at).toLocaleDateString()}</td>
        <td>${esc(FORMATS[m.format]?.label || m.format)}</td>
        <td class="mono">${pct(m.raw)}</td>
        <td class="mono" style="color:var(--${m.scaled >= 750 ? "good" : "bad"})">${m.scaled}</td>
        <td>${m.scaled >= 750 ? "pass" : "below"}</td>
        <td class="mono">${Math.round(m.seconds / 60)}m</td>
      </tr>`).join("")}</tbody></table></div>
      ${best ? `<p class="faint" style="margin:var(--s3) 0 0">Best so far ${best}. One mock above 750 is not readiness; a margin above it across independent blocks is.</p>` : ""}
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
export function reviewView(App) {
  const m = App.mock;
  const answeredOf = (e) => {
    if (e.kind === "pbq") {
      const a = m.pbqAnswers[e.pbq.id] || {};
      const touched = Object.keys(a).some((k) => {
        const v = a[k];
        return Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : !!v;
      });
      return touched ? "answered" : "blank";
    }
    return m.answers[e.item.id] ? "answered" : "blank";
  };

  const cells = m.items.map((e, i) => {
    const id = e.item?.id || e.pbq?.id;
    const state = answeredOf(e);
    const flagged = m.flagged.has(id);
    return `<button class="rv ${state} ${flagged ? "flagged" : ""} ${i === m.idx ? "here" : ""}"
      data-action="mock-goto" data-i="${i}"
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
    <div class="track"><i style="width:100%"></i></div>
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
  </div>`;
}

export function runnerView(App) {
  const m = App.mock;
  const entry = m.items[m.idx];
  const remaining = Math.max(0, m.endsAt - Date.now());
  const answered = Object.keys(m.answers).filter((k) => m.answers[k] != null).length;

  const body = entry.kind === "pbq"
    ? pbqHtml(entry.pbq, m.pbqAnswers[entry.pbq.id] || {}, { locked: false, graded: null, inExam: true })
    : mcqHtml(entry.item, m.answers[entry.item.id], m.flagged.has(entry.item.id));

  return `
  <div class="session-bar">
    <div class="meta">
      <span>Question <b>${m.idx + 1}</b> of ${m.items.length} &middot; ${answered} answered</span>
      <span id="mock-timer" data-ends="${m.endsAt}" class="mono">--:--</span>
    </div>
    <div class="track"><i style="width:${((m.idx + 1) / m.items.length) * 100}%"></i></div>
  </div>
  ${body}
  <div class="row" style="margin-top:var(--s5);justify-content:space-between">
    <div class="row">
      <button class="btn ghost" data-action="mock-prev" ${m.idx === 0 ? "disabled" : ""}>Back</button>
      <button class="btn" data-action="mock-next" ${m.idx === m.items.length - 1 ? "disabled" : ""}>Next</button>
      <button class="btn ghost small" data-action="mock-flag">${m.flagged.has(entry.item?.id || entry.pbq?.id) ? "Unflag" : "Flag for review"}</button>
    </div>
    <button class="btn ghost" data-action="mock-review">Review all ${m.items.length}</button>
  </div>`;
}

function mcqHtml(item, chosen, flagged) {
  return `
  <div class="row" style="margin-bottom:var(--s3)">
    <span class="tag">objective ${esc(item.objective || "")}</span>
    ${flagged ? `<span class="tag warn">flagged</span>` : ""}
  </div>
  <div class="card">
    <p class="stem">${gloss(item.stem)}</p>
    <div class="opts">
      ${item.options.map((o, i) => `
        <button class="opt ${chosen === o.id ? "chosen" : ""}" data-action="mock-answer" data-opt="${esc(o.id)}">
          <span class="key" aria-hidden="true">${"ABCDEF"[i]}</span>
          <span>${gloss(o.text)}</span><span class="verdict"></span>
        </button>`).join("")}
    </div>
  </div>`;
}

export function resultView(App) {
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
    <div class="spread" style="align-items:flex-start">
      <div>
        <div class="score-big" style="color:var(--${tone})">${r.scaled}</div>
        <div class="faint">estimated scaled score &middot; pass line 750 &middot; ${pct(r.raw)} raw</div>
      </div>
      <dl class="side-stats" style="margin:0;min-width:230px">
        <div class="stat"><dt>Time used</dt><dd>${Math.round(r.seconds / 60)}m of ${r.minutes}m</dd></div>
        <div class="stat"><dt>Unanswered</dt><dd class="${r.unanswered ? "warn" : ""}">${r.unanswered}</dd></div>
        <div class="stat"><dt>Banked</dt><dd class="${r.banked ? "warn" : ""}">${r.banked}</dd></div>
      </dl>
    </div>
    <p class="faint" style="margin:var(--s3) 0 0">An estimate on CompTIA's 100-900 scale, weighting each PBQ as roughly ${PBQ_WEIGHT} multiple choice items. One result above 750 is not readiness. A margin above it, across separate blocks, on different days, is.</p>
  </div>

  ${notes ? `<div class="card tight"><h2 class="eyebrow">What this exposed</h2><ul class="req" style="margin:0">${notes}</ul></div>` : ""}

  <h2>By domain</h2>
  <div class="card"><div class="scroll-x"><table class="grid">
    <thead><tr><th>Domain</th><th>Correct</th><th>Score</th><th>Exam weight</th><th></th></tr></thead>
    <tbody>${domains}</tbody></table></div></div>

  ${r.mentorHtml ? `<h2>Corrections banked</h2>
    <p class="sub">These are now in your schedule and will come back on different questions.</p>${r.mentorHtml}` : ""}

  <div class="row"><button class="btn" data-action="mock-done">Back to the lab</button></div>`;
}

/** Score a finished mock and turn every miss into a scheduled correction. */
export function grade(App, gradePbq) {
  const m = App.mock;
  const now = Date.now();
  let mcqCorrect = 0, mcqTotal = 0, unanswered = 0;
  let pbqEarned = 0, pbqMax = 0, pbqCount = 0;
  let wCorrect = 0, wTotal = 0;          // difficulty weighted
  const byDomain = {};
  const banked = [];
  const missedObjectives = {};

  for (const d of App.content.objectives.domains) {
    byDomain[d.id] = { id: d.id, title: d.title, weight: d.weight, correct: 0, total: 0 };
  }

  for (const entry of m.items) {
    if (entry.kind === "pbq") {
      const g = gradePbq(entry.pbq, m.pbqAnswers[entry.pbq.id] || {});
      pbqEarned += g.earned; pbqMax += g.max; pbqCount += 1;
      const pw = PBQ_WEIGHT * itemWeight(entry.pbq);
      wTotal += pw;
      wCorrect += pw * (g.max ? g.earned / g.max : 0);
      const dom = App.content.domainOf[entry.pbq.objective];
      if (byDomain[dom]) {
        byDomain[dom].total += PBQ_WEIGHT;
        byDomain[dom].correct += Math.round(PBQ_WEIGHT * (g.max ? g.earned / g.max : 0));
      }
      const rec = (App.state.pbq[entry.pbq.id] ||= { attempts: [] });
      rec.attempts.push({ at: now, earned: g.earned, max: g.max, percent: g.percent, mock: true });
      for (const res of g.results) {
        if (!res.misconception) continue;
        if (res.pass) mentor.pass(App.state, res.misconception, entry.pbq.id, App.content, now);
        else {
          mentor.bank(App.state, res.misconception, entry.pbq.id, now, null, true);
          if (!banked.includes(res.misconception)) banked.push(res.misconception);
        }
      }
      continue;
    }

    const item = entry.item;
    const chosen = m.answers[item.id];
    const correct = chosen && item.options.find((o) => o.id === chosen)?.correct;
    const dom = App.content.domainOf[item.objective];
    mcqTotal += 1;
    const w = itemWeight(item);
    wTotal += w;
    if (byDomain[dom]) byDomain[dom].total += 1;
    if (!chosen) unanswered += 1;
    if (correct) {
      wCorrect += w;
      mcqCorrect += 1;
      if (byDomain[dom]) byDomain[dom].correct += 1;
      for (const o of item.options) {
        if (o.misconception) mentor.pass(App.state, o.misconception, item.id, App.content, now);
      }
    } else {
      missedObjectives[item.objective] = (missedObjectives[item.objective] || 0) + 1;
      const opt = item.options.find((o) => o.id === chosen);
      if (opt?.misconception) {
        const right = item.options.find((o) => o.correct);
        const detail = opt.definition && right?.definition
          ? { picked: opt.text, pickedDef: opt.definition, answer: right.text, answerDef: right.definition }
          : null;
        // Everything in a mock is answered under exam conditions, so a miss here
        // counts as confidently wrong: you committed to it with the clock running.
        mentor.bank(App.state, opt.misconception, item.id, now, detail, true);
        if (!banked.includes(opt.misconception)) banked.push(opt.misconception);
      }
    }
    App.state.reviews.push({
      at: now, kind: "item", id: item.id, grade: correct ? 3 : 1, mock: true,
    });
  }

  const pbqFrac = pbqMax ? pbqEarned / pbqMax : 0;
  const raw = wTotal ? wCorrect / wTotal : 0;
  const flatRaw = (mcqTotal + pbqCount * PBQ_WEIGHT)
    ? (mcqCorrect + pbqFrac * pbqCount * PBQ_WEIGHT) / (mcqTotal + pbqCount * PBQ_WEIGHT)
    : 0;
  const scaled = raw <= 0.75
    ? Math.round(100 + (650 / 0.75) * raw)
    : Math.round(750 + (150 / 0.25) * (raw - 0.75));

  const seconds = Math.round((now - m.startedAt) / 1000);
  const notes = [];
  if (unanswered) notes.push(`${unanswered} question${unanswered === 1 ? "" : "s"} left unanswered. On the real exam there is no penalty for a wrong guess, so never leave one blank.`);
  if (pbqCount && pbqFrac < 0.6) notes.push(`You scored ${pct(pbqFrac)} across the performance-based questions. They are worth roughly ${PBQ_WEIGHT} items each, so this is where the scaled score is leaking.`);
  const worst = Object.entries(missedObjectives).sort((a, b) => b[1] - a[1])[0];
  if (worst && worst[1] >= 2) {
    notes.push(`${worst[1]} misses landed in objective ${worst[0]}, ${App.content.objectiveById[worst[0]]?.title || ""}. That is the single highest-value thing to repair before the next block.`);
  }
  if (seconds > m.minutes * 60 * 0.95) notes.push(`You used almost the whole window. Pace is a scoring factor in its own right: practise flagging and moving on rather than finishing a hard item.`);
  if (scaled >= 750) notes.push(`Above the line on this block. Repeat on a different block before treating that as readiness, because a single form can flatter you.`);

  const mentorHtml = banked.slice(0, 6)
    .map((id) => mentorCardHtml(mentor.card(id, App.content, App.state)))
    .join("");

  if (Math.abs(raw - flatRaw) >= 0.03) {
    notes.push(`Weighted for item difficulty your raw score is ${pct(raw)}; counted flat it would be ${pct(flatRaw)}. ${
      raw < flatRaw
        ? "You are doing better on the easy items than the hard ones, which is the pattern that passes practice tests and fails the exam."
        : "You are holding up on the harder items, which is the right way round."}`);
  }

  const result = {
    at: now, format: m.format, raw, flatRaw, scaled, seconds, minutes: m.minutes,
    unanswered, banked: banked.length,
    byDomain: Object.values(byDomain), notes, mentorHtml,
  };
  (App.state.mockHistory ||= []).push({
    at: now, format: m.format, raw, scaled, seconds, unanswered, banked: banked.length,
  });
  return result;
}
