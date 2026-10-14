import { esc, gloss, pct, objectiveLabel, mentorCardHtml, mentorCards, sessionBarHtml, emptyState, optionButton, presentOptions, KEYS } from "./common.js";
import { pbqHtml } from "./pbq.js";
import * as mentor from "../mentor.js";
import { studyPlan } from "../scheduler.js";
import { streakStatus, today } from "../state.js";
import { isGraded } from "../content.js";
import * as reviews from "../reviews.js";

/**
 * The exam date is what the plan is measured against: corrections are
 * retested before it and the daily load is stated against it. Without it the
 * plan has no end, so it is asked for on the drill screen until it is set.
 */
function examBarHtml(App) {
  if (App.state.profile.examDate) return "";
  return `<div class="exam-bar">
    <label for="exam-date-inline" id="exam-date-why"><b>No exam date set.</b> Corrections are retested before it and the daily load is planned against it; without it the plan has no end.</label>
    <input id="exam-date-inline" type="date" data-setting="examDate" min="${today()}" aria-label="Exam date" aria-describedby="exam-date-why">
  </div>`;
}

/**
 * The plan to the exam date, against what this person actually does. Shown
 * only when it does not fit: a plan that needs more answers a day than the
 * last four weeks averaged will not happen, and the last week will not absorb
 * it. Said plainly, with what gives.
 */
let planMemo = { key: null, plan: null };
function planBarHtml(App) {
  const key = `${App.state.updatedAt}|${today()}|${App.state.profile.examDate}`;
  if (planMemo.key !== key) planMemo = { key, plan: studyPlan(App.state, App.content) };
  const p = planMemo.plan;
  if (!p) return "";
  const pace = reviews.count("item") / 30;                  // answers a day over the recent window
  const goal = App.state.profile.dailyReviewGoal || 40;
  if (p.perDay <= Math.max(pace, 1) * 1.1) return "";
  // Answers available at this pace, less the reviews the plan needs, is how many new items get seen.
  const missed = Math.max(0, p.unseen - Math.max(0, Math.round(pace * p.days) - p.reviews));
  return `<div class="exam-bar" role="note">
    <span><b>The plan does not fit your pace.</b> Seeing every graded item before the exam takes about
    ${p.perDay} answers a day, ${p.minutesPerDay} minutes. The last four weeks averaged ${pace.toFixed(1)} a day${
      goal < p.perDay ? `, and your goal is ${goal}` : ""}. At that pace about ${missed} items stay unseen; the queue serves the most valuable first, so those are the ones worth least.</span>
  </div>`;
}

/**
 * The first night: one line on what the whole tool does, because nothing else
 * says it before the first miss. Gone after ten items or when dismissed.
 */
function introHtml(App) {
  if (App.introDismissed || Object.keys(App.state.items).length >= 10) return "";
  return `<div class="card tight flag quiet" role="note">
    <p class="m0">A wrong answer here is not just marked wrong: the option you chose names the belief behind it, and that correction comes back on a <b>different</b> question until two clean passes clear it. Press <span class="kbd">G</span> before answering when you are guessing, <span class="kbd">S</span> to skip.</p>
    <div class="row mt2"><button class="btn ghost small" data-action="dismiss-intro">Got it</button></div>
  </div>`;
}

// --- drill ----------------------------------------------------------------
/**
 * Multiple-select. The exam calls it "choose two" and scores it all or nothing:
 * every required option and no extras. People lose these on format alone, by
 * answering the first correct option they see and moving on, so the UI makes the
 * count explicit and refuses to submit until it is met.
 */
function mcqMultiHtml(App, entry) {
  const it = presentOptions(entry);
  const ans = App.answer;
  const need = it.selectCount || 2;
  const picked = App.multiPicked || new Set();

  const opts = it.options.map((o, i) => {
    let cls = "";
    let verdict = picked.has(o.id) ? "&check;" : "";
    if (ans) {
      if (o.correct) { cls = "correct"; verdict = "&check;"; }
      else if (picked.has(o.id)) { cls = "wrong"; verdict = "&times;"; }
    } else if (picked.has(o.id)) cls = "chosen";
    return optionButton({ key: KEYS[i], text: o.text, action: "multi-toggle", data: { opt: o.id },
                          cls, verdict, disabled: !!ans, checked: picked.has(o.id) });
  }).join("");

  const chosenWrong = ans ? it.options.filter((o) => !o.correct && picked.has(o.id)) : [];
  const missed = ans ? it.options.filter((o) => o.correct && !picked.has(o.id)) : [];

  return `
  <div class="row mb3">
    <span class="tag">${esc(objectiveLabel(App.content, it.objective))}</span>
    <span class="tag warn">choose ${need}</span>
    ${entry.reason ? `<span class="tag reason">${esc(entry.reason)}</span>` : ""}
  </div>
  <div class="card">
    <p class="stem">${gloss(it.stem)}</p>
    <div class="opts" role="group" aria-label="Select ${need}">${opts}</div>
    ${ans ? "" : `<div class="row mt4 between">
      <span class="faint">${picked.size} of ${need} selected</span>
      <span class="row tight"><button class="btn ghost small" data-action="skip" title="Records nothing; it comes back on its own schedule">Skip <span class="kbd">S</span></button>
      <button class="btn" data-action="multi-submit" ${picked.size === need ? "" : "disabled"}>
        Submit ${need}
      </button></span></div>`}
  </div>
  ${ans ? multiFeedbackHtml(App, it, chosenWrong, missed) : ""}`;
}

function multiFeedbackHtml(App, it, chosenWrong, missed) {
  const good = App.answer.correct;
  return `
  <div class="verdict-banner ${good ? "yes" : "no"}" tabindex="-1">
    <div class="mark" aria-hidden="true">${good ? "&check;" : "&times;"}</div>
    <div>
      <b>${good ? "Correct" : chosenWrong.length && missed.length ? "Partly right, and the exam scores this as wrong"
          : missed.length ? "You found some but not all" : "Not correct"}</b>
      ${missed.length ? `<p><b>Missed:</b> ${missed.map((o) => esc(o.text)).join("; ")}</p>` : ""}
      ${chosenWrong.length ? `<p><b>Wrongly selected:</b> ${chosenWrong.map((o) => esc(o.text)).join("; ")}</p>` : ""}
      ${good ? `<p>${esc(it.options.find((o) => o.correct)?.why || "")}</p>` : ""}
      ${!good ? `<p class="faint">A choose-two is all or nothing. One right answer plus one wrong one scores the same as two wrong ones.</p>` : ""}
    </div>
  </div>
  ${mentorCards(App, App.answer.banked)}
  <div class="row"><button class="btn" data-action="next">Next</button>
    <span class="hint"><span class="kbd">&crarr;</span> to continue</span></div>`;
}

function mcqHtml(App, entry) {
  const it = presentOptions(entry);
  const ans = App.answer;
  const opts = it.options.map((o, i) => {
    let cls = ans?.chosen === o.id ? "chosen" : "";
    let verdict = "";
    if (ans) {
      if (o.correct) { cls = "correct"; verdict = "&check;"; }
      else if (o.id === ans.chosen) { cls = "wrong chosen"; verdict = "&times;"; }
    }
    return optionButton({ key: KEYS[i], text: o.text, action: "answer", data: { opt: o.id },
                          cls, verdict, disabled: !!ans });
  }).join("");

  const chosen = ans && it.options.find((o) => o.id === ans.chosen);
  const correct = it.options.find((o) => o.correct);

  const drill = entry.contrastDrill;
  const repair = entry.prereqRepair;
  return `
  ${repair ? `<div class="drill-banner repair">
      <b>Repairing the dependency underneath</b>
      <span>You keep missing <b>${esc(repair.blocked)}</b>, but <b>${esc(repair.blocker)}</b> is still open and sits beneath it. ${esc(repair.why)}</span>
    </div>` : ""}
  ${drill ? `<div class="drill-banner">
      <b>Contrast drill &middot; ${drill.index + 1} of ${drill.of}</b>
      <span>${esc(drill.label)}. These two questions look alike and the answers are not the same. Read what each one is actually asking for.</span>
    </div>` : ""}
  <div class="row mb3">
    <span class="tag">${esc(objectiveLabel(App.content, it.objective))}</span>
    ${entry.reason && !drill ? `<span class="tag reason">${esc(entry.reason)}</span>` : ""}
  </div>
  <div class="card">
    <p class="stem">${gloss(it.stem)}</p>
    <div class="opts">${opts}</div>
    ${ans ? "" : `<div class="row mt4 between">
       <div class="hint"><span class="kbd">?</span><span>expands every acronym</span></div>
       <div class="row tight">
         <button class="btn ghost small" data-action="skip" title="Records nothing; it comes back on its own schedule">Skip <span class="kbd">S</span></button>
         <button class="btn ghost small guess-toggle ${App.markedGuess ? "on" : ""}" data-action="toggle-guess">
           ${App.markedGuess ? "&check; Marked as a guess" : "I am guessing"} <span class="kbd">G</span>
         </button></div></div>`}
  </div>
  ${ans ? feedbackHtml(App, chosen, correct) : ""}`;
}

function feedbackHtml(App, chosen, correct) {
  const good = chosen?.correct;
  const a = App.answer;
  return `
  <div class="verdict-banner ${good ? "yes" : "no"}" tabindex="-1">
    <div class="mark" aria-hidden="true">${good ? "&check;" : "&times;"}</div>
    <div>
      <b>${good ? "Correct" : "Not correct"}</b>
      <p>${esc(good ? correct.why : chosen?.why || correct.why)}</p>
      ${!good ? `<p><b>The answer:</b> ${esc(correct.text)}</p>` : ""}
    </div>
  </div>
  ${a.overconfident
    ? `<div class="verdict-banner bad">
        <div class="mark" aria-hidden="true">!</div>
        <div><b>Wrong, and not marked as a guess</b>
        <p>An answer not marked as a guess counts as one you believed, and a belief that is wrong costs more on exam day than a gap you know about, so this correction comes back sooner. If you were guessing, press <span class="kbd">G</span> before answering next time.</p></div></div>`
    : ""}
  ${a.lucky
    ? `<div class="verdict-banner warn">
        <div class="mark" aria-hidden="true">~</div>
        <div><b>Right, but you called it a guess</b>
        <p>Scored as correct and not counted toward clearing anything. A lucky answer is not evidence, so this comes back on a shorter interval than a confident one would.</p></div></div>`
    : ""}
  ${a.rushed
    ? `<div class="verdict-banner warn">
        <div class="mark" aria-hidden="true">!</div>
        <div><b>That took ${(a.responseMs / 1000).toFixed(1)} seconds</b>
        <p>Too fast to have read the stem properly on a question at this difficulty. The constraint that decides these is usually in the second sentence, and pattern matching the options is exactly how the exam catches people.</p></div></div>`
    : ""}
  ${a.retiredNote
    ? `<div class="verdict-banner yes"><div class="mark" aria-hidden="true">&starf;</div>
       <div><b>Misconception cleared</b><p>${esc(a.retiredNote)}</p></div></div>`
    : ""}
  ${mentorCards(App, a.banked)}
  <div class="row">
    <button class="btn" data-action="next">Next</button>
    <span class="hint"><span class="kbd">&crarr;</span> to continue</span>
  </div>`;
}

function recallHtml(App, entry) {
  const it = entry.item;
  const shown = App.answer?.revealed;
  return `
  <div class="row mb3">
    <span class="tag">${esc(objectiveLabel(App.content, it.objective))}</span>
    <span class="tag">recall</span>
    ${entry.reason ? `<span class="tag reason">${esc(entry.reason)}</span>` : ""}
  </div>
  <div class="card">
    <p class="stem">${esc(it.term)}</p>
    ${shown
      ? `<p class="muted m0">${esc(it.definition)}</p>
         ${it.aka ? `<p class="faint">Also written: ${esc(it.aka)}</p>` : ""}`
      : `<button class="btn ghost" data-action="reveal">Show answer</button>
         <div class="hint mt3"><span class="kbd">Space</span><span>to reveal</span></div>`}
  </div>
  ${shown
    ? `<div class="row">
        <button class="btn ghost" data-action="grade" data-g="1">Again</button>
        <button class="btn ghost" data-action="grade" data-g="2">Hard</button>
        <button class="btn" data-action="grade" data-g="3">Good</button>
        <button class="btn ghost" data-action="grade" data-g="4">Easy</button>
        <span class="hint"><span class="kbd">1</span> to <span class="kbd">4</span></span>
      </div>`
    : ""}`;
}

function mentorOnlyHtml(App, entry) {
  const card = mentor.card(entry.targetMisconception, App.content, App.state);
  return `
  <h1 class="sr-only">Correction: ${esc(card?.label || "")}</h1>
  <div class="row mb3"><span class="tag reason">${esc(entry.reason)}</span></div>
  <p class="sub">No other question in the bank tests this distinction yet, so here is the correction itself. Read it and it goes back into the schedule.</p>
  ${mentorCardHtml(card)}
  <div class="row"><button class="btn" data-action="mentor-ack">Got it</button></div>`;
}

/**
 * The app boots straight into a session, so this screen is only ever reached
 * when a session could not be built: the bank is empty, or everything in it
 * has been seen and nothing is due yet. It says which.
 */
export function drillHomeView(App) {
  const loaded = App.content.items.filter(isGraded).length + App.content.pbqs.length;
  return `<h1>Drill</h1>
    ${examBarHtml(App)}
    ${loaded
      ? emptyState({
          glyph: "&#9678;",
          title: "Nothing to serve right now",
          body: "Everything in the bank has been seen and nothing is due yet. Reviews come due on their own schedule; a mock is the other way to spend the time.",
          actions: `<button class="btn" data-action="nav" data-section="mock">Run a mock</button>`,
        })
      : emptyState({
          glyph: "&#9634;",
          title: "No items are loaded",
          body: "The content directory holds no graded items, so there is nothing to drill. Add JSON under content/items and reload.",
          actions: `<button class="btn" data-action="reload">Reload</button>`,
        })}`;
}

export function drillRunView(App) {
  const entry = App.queue[App.idx];
  const s = App.sessionStats;
  const bar = sessionBarHtml({
    index: App.idx,
    total: App.queue.length,
    label: App.mode === "weak" ? "Weak spots" : "Drill",
    right: s.answered
      ? `<span class="faint">${s.correct}/${s.answered} correct${s.banked ? ` &middot; ${s.banked} banked` : ""}</span>`
      : "",
  });

  const body =
    entry.kind === "pbq"
      ? pbqHtml(entry.pbq, App.answers[entry.pbq.id] || {}, { locked: !!App.graded, graded: App.graded })
      : entry.kind === "mentor"
      ? mentorOnlyHtml(App, entry)
      : entry.item.type === "recall"
      ? recallHtml(App, entry)
      : entry.item.type === "mcq-multi"
      ? mcqMultiHtml(App, entry)
      : mcqHtml(App, entry);

  return bar + examBarHtml(App) + introHtml(App) + (App.idx === 0 && !App.answer ? planBarHtml(App) : "") + body;
}

function debriefHtml(App) {
  const s = App.sessionStats;
  const notes = [];
  const missObj = s.missesByObjective || {};
  const top = Object.entries(missObj).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2) {
    notes.push(`${top[1]} of your ${s.answered - s.correct} misses were in objective ${top[0]}, ${App.content.objectiveById[top[0]]?.title || ""}. That is a topic gap rather than bad luck.`);
  }
  if (s.rushed >= 2) {
    notes.push(`${s.rushed} answers came in under six seconds and were wrong. Slowing down on the stem is worth more marks right now than more questions.`);
  }
  if (s.banked > s.retired && s.banked >= 3) {
    notes.push(`You banked ${s.banked} corrections and cleared ${s.retired}. The bank is growing, which is normal early and is the thing to watch.`);
  }
  if (s.retired && s.retired >= s.banked) {
    notes.push(`You cleared ${s.retired} correction${s.retired === 1 ? "" : "s"} and banked ${s.banked}. Net, you are closing gaps faster than you are finding them.`);
  }
  if (!notes.length) return "";
  return `<div class="card tight"><h2 class="eyebrow">What this session showed</h2>
    <ul class="req m0">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`;
}

export function drillDoneView(App) {
  const s = App.sessionStats;
  const acc = s.answered ? s.correct / s.answered : 0;
  const st = streakStatus(App.state);
  return `<h1>Session complete</h1>
  <div class="card">
    <div class="spread">
      <div>
        <div class="score-big">${s.correct}<small>/${s.answered}</small></div>
        <div class="faint">${pct(acc)} correct</div>
      </div>
      <dl class="side-stats inline">
        <div class="stat"><dt>Banked</dt><dd class="${s.banked ? "warn" : ""}">${s.banked}</dd></div>
        <div class="stat"><dt>Cleared</dt><dd class="${s.retired ? "good" : ""}">${s.retired}</dd></div>
        <div class="stat"><dt>Streak</dt><dd>${st.current} day${st.current === 1 ? "" : "s"}</dd></div>
      </dl>
    </div>
  </div>
  ${debriefHtml(App)}
  <div class="row">
    <button class="btn" data-action="start-drill">Another session</button>
    <button class="btn ghost" data-action="start-weak">Work the weak spots</button>
  </div>`;
}
