import { esc, gloss, pct, objectiveLabel, mentorCardHtml, sessionBarHtml, emptyState, optionButton, KEYS } from "./common.js";

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
function presentOptions(entry) {
  const it = entry?.item;
  if (!it || !Array.isArray(it.options) || presented.has(entry)) return it;
  presented.add(entry);
  for (let i = it.options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [it.options[i], it.options[j]] = [it.options[j], it.options[i]];
  }
  return it;
}
import { pbqHtml } from "./pbq.js";
import * as mentor from "../mentor.js";
import { readiness, coverageDeficit, blockFit, studyPlan, hoursToReady, FORMATS, PBQ_WEIGHT, SESSION_SIZE } from "../scheduler.js";
import { streakStatus, today } from "../state.js";
import { isGraded } from "../content.js";
import * as reviews from "../reviews.js";

const humanise = (ms) => {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min`;
  if (mins < 60 * 36) return `${Math.round(mins / 60)} h`;
  return `${Math.round(mins / 1440)} d`;
};

const mentorCards = (App, ids) =>
  (ids || []).map((id) => mentorCardHtml(mentor.card(id, App.content, App.state))).join("");

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

// --- PBQ lab ---------------------------------------------------------------
const KIND_LABEL = {
  "acl-table": "Firewall and ACL",
  "wireless-config": "Wireless configuration",
  "network-diagram": "Network diagram analysis",
  "drag-order": "Order and classify",
};

export function labRunView(App) {
  return pbqHtml(App.lab, App.answers[App.lab.id] || {}, { locked: !!App.graded, graded: App.graded });
}

export function labListView(App) {
  const byKind = {};
  for (const p of App.content.pbqs) (byKind[p.kind] ||= []).push(p);

  // Weakest first inside each kind: never attempted, then lowest best score.
  const standing = (p) => (App.state.pbq[p.id]?.attempts ? App.state.pbq[p.id].best : -1);
  const groups = Object.entries(byKind)
    .map(([kind, list]) => {
      const cards = [...list].sort((a, b) => standing(a) - standing(b))
        .map((p) => {
          const done = App.state.pbq[p.id];
          const att = done?.attempts || 0;
          const best = att ? done.best : null;
          const badge =
            best === null ? `<span class="tag">not attempted</span>`
            : `<span class="tag ${best >= 90 ? "good" : best >= 70 ? "warn" : "bad"}">best ${best}%</span>`;
          return `<div class="card tight"><div class="spread">
            <div>
              <b>${esc(p.title)}</b>
              <div class="faint">objective ${esc(p.objective)} &middot; ${Math.round(p.targetSeconds / 60)} min target &middot; difficulty ${p.difficulty}/5</div>
              <div class="row mt2">${badge}${
                att ? `<span class="faint">${att} attempt${att === 1 ? "" : "s"}</span>` : ""
              }</div>
            </div>
            <button class="btn ${best === null ? "" : "ghost"} small" data-action="open-pbq" data-id="${esc(p.id)}">${att ? "Retry" : "Start"}</button>
          </div></div>`;
        })
        .join("");
      return `<h2>${esc(KIND_LABEL[kind] || kind)}</h2>${cards}`;
    })
    .join("");

  // Listed so the file is not silently missing, never served anywhere.
  const orphans = (App.content.pbqsWithoutEngine || []).map((p) => `<div class="card tight flag"><div class="spread">
      <div><b>${esc(p.title || p.id)}</b>
        <div class="faint">${esc(p.id)} &middot; kind <span class="mono">${esc(String(p.kind))}</span> has no engine in this build, so it cannot be worked or scored. It is not in the queue or in any mock.</div>
      </div>
      <span class="tag bad">no engine</span>
    </div></div>`).join("");

  return `<h1>PBQ lab</h1>
    <p class="sub">Performance-based questions, graded per subtask with partial credit. Four to five of these open the real exam, and they are worth more than a multiple choice item, so the eight minute target matters.</p>
    ${groups || emptyState({ title: "No PBQs loaded", body: "Add JSON files under content/pbq and reload." })}
    ${orphans ? `<h2>Without an engine</h2>${orphans}` : ""}`;
}

// --- mentor bank -----------------------------------------------------------
export function mentorView(App) {
  const openList = mentor.open(App.state, App.content);
  const retired = Object.entries(App.state.misconceptions).filter(([, r]) => r.retired);
  const now = Date.now();

  if (!openList.length && !retired.length) {
    return `<h1>Mentor bank</h1>
      ${emptyState({
        glyph: "&#9873;",
        title: "Nothing banked yet",
        body: "Every question you miss puts a targeted correction here and schedules it to come back on a different question.",
        actions: `<button class="btn" data-action="start-drill">Start drilling</button>`,
      })}`;
  }

  const sorted = openList
    .map((x) => ({ ...x, due: x.rec.due || x.rec.fsrs.due }))
    .sort((a, b) => a.due - b.due);
  const dueNow = sorted.filter((x) => now >= x.due).length;

  const BANK_SHOWN = 12;
  const shown = App.bankAll ? sorted : sorted.slice(0, BANK_SHOWN);
  const cards = shown
    .map((x) => {
      const overdue = now >= x.due;
      const needed = x.def.retireAfter ?? 2;
      return `<div class="card tight flag ${overdue ? "bad" : "quiet"}">
        <div class="spread">
          <div>
            <b>${esc(x.def.label)}</b>
            <div class="faint">${esc(objectiveLabel(App.content, x.def.objective))}</div>
            <div class="row mt2">
              <span class="tag ${x.def.severity === "high" ? "warn" : ""}">${esc(x.def.severity)} impact</span>
              <span class="tag">missed ${x.rec.hits}&times;</span>
              <span class="tag">${x.rec.cleanPasses.length}/${needed} clean</span>
              <span class="tag ${overdue ? "warn" : ""}">${overdue ? "due now" : `due in ${humanise(x.due - now)}`}</span>
            </div>
          </div>
          <button class="btn ghost small" data-action="expand-mc" data-id="${esc(x.id)}">${App.expanded === x.id ? "Hide" : "Open"}</button>
        </div>
        ${App.expanded === x.id ? mentorCardHtml(mentor.card(x.id, App.content, App.state)) : ""}
      </div>`;
    })
    .join("");

  return `<h1>Mentor bank</h1>
    <p class="sub">${openList.length} open, ${dueNow} due now, ${retired.length} cleared. A correction is only cleared after clean passes on <b>different</b> questions, so you cannot clear it by memorising the one you failed.</p>
    ${dueNow ? `<div class="row mb4"><button class="btn" data-action="start-weak">${dueNow > SESSION_SIZE.weak ? `Drill the most urgent ${SESSION_SIZE.weak} of ${dueNow} due` : `Drill the ${dueNow} due now`}</button></div>` : ""}
    ${cards}
    ${sorted.length > BANK_SHOWN
      ? `<div class="row mb4"><button class="btn ghost" data-action="bank-all">${App.bankAll ? `Show the most urgent ${BANK_SHOWN}` : `Show all ${sorted.length} open`}</button></div>`
      : ""}
    ${retired.length
      ? `<h2>Cleared</h2><div class="card tight"><div class="row">${retired
          .map(([id]) => `<span class="tag">${esc(App.content.misconceptions[id]?.label || id)}</span>`)
          .join("")}</div></div>`
      : ""}`;
}

// --- readiness -------------------------------------------------------------
/** The one number everything is judged by: hours of study left to the booking rule. */
let hoursMemo = { key: null, h: null };
function hoursHtml(App) {
  const key = `${App.state.updatedAt}|${today()}|${App.state.profile.examDate}|${reviews.rows("mock").length}`;
  if (hoursMemo.key !== key) hoursMemo = { key, h: hoursToReady(App.state, App.content, Date.now(), reviews.rows("mock")) };
  const h = hoursMemo.h;
  return h.reachable
    ? `${Math.max(1, Math.round(h.low))}<small> to </small>${Math.round(h.high)}<span class="u">h</span>`
    : `<span title="The bank can add ${h.available} of the ${h.gap} points needed">beyond the bank</span>`;
}
export function readinessView(App) {
  const r = readiness(App.state, App.content, Date.now(), reviews.count(), reviews.rows("mock"));
  const cov = coverageDeficit(App.state, App.content);
  const posOf = (score) => ((score - 100) / 800) * 100;

  const cells = Object.values(r.perObjective)
    .sort((a, b) => a.mastery - b.mastery)
    .map(
      (o) => `<div class="cell s-${o.status}${o.thin ? " is-thin" : ""}">
        <div class="spread"><b>${esc(o.objective)}</b><small>${o.status === "no-items" ? "&mdash;" : pct(o.mastery)}</small></div>
        <div class="bar"><span style="--w:${Math.round(o.mastery * 100)}%"></span></div>
        <small>${o.status === "no-items" ? "no items in the bank" : o.status}${
          o.itemsSeen ? ` &middot; ${o.itemsSeen}/${o.itemsAvailable} seen` : ""}${
          o.openMisconceptions ? ` &middot; ${o.openMisconceptions} open` : ""}</small>
        ${o.thin
          ? `<span class="thin-flag" title="${o.topicsCovered} of ${o.topics} blueprint topics have a graded item">bank thin &middot; ${pct(o.bankDepth)} of topics</span>`
          : ""}
        <div class="title">${esc(o.title)}</div>
      </div>`
    )
    .join("");

  const domains = App.content.objectives.domains
    .map((d) => {
      const c = cov[d.id];
      const dir = c.exhausted ? "bank empty"
        : c.deficit > 0.02 ? "under"
        : c.deficit < -0.02 ? "over" : "on target";
      return `<tr><td>${d.id}.0 ${esc(d.title)}</td><td class="mono">${pct(d.weight)}</td>
        <td class="mono">${pct(c.share || 0)}</td>
        <td class="faint">${dir}</td><td class="mono">${c.seen}/${c.available}</td></tr>`;
    })
    .join("");

  // Only suggest objectives you can actually act on. An objective with nothing
  // unseen left in the bank is a gap in the content, and sending you there is
  // sending you to re-read what you have already answered.
  const weakest = Object.values(r.perObjective)
    .filter((o) => o.itemsSeen > 0 && o.itemsSeen < o.itemsAvailable)
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 3);

  const c = reviews.calibration();
  const tone = c.overconfidence > 0.3 ? "bad" : c.overconfidence > 0.15 ? "warn" : "good";
  const roots = mentor.sharedRootCauses(App.state, App.content);

  // Order: the decision first (the forecast, the hours to book, the rule),
  // then where to spend the next session, then the per-objective picture.
  return `<h1>Readiness</h1>
  <p class="sub">The evidence so far: ${r.reviewCount} answer${r.reviewCount === 1 ? "" : "s"} in the last 30 days across ${r.objectivesSampled} of 28 objectives, and ${r.forecast.mocks || "no"} mock${r.forecast.mocks === 1 ? "" : "s"}.</p>

  ${r.bankDepth < 0.8 ? `<div class="card tight flag">
    <h2 class="eyebrow">What this score can and cannot see</h2>
    <p class="m0">Graded items reach <b>${r.topicsCovered} of ${r.topicsTotal}</b> blueprint topics (${pct(r.bankDepth)}).${
      r.emptyObjectives ? ` ${r.emptyObjectives} objective${r.emptyObjectives === 1 ? " has" : "s have"} no items at all.` : ""
    } ${r.thinObjectives} of 28 objectives are marked thin below. The estimate is an honest read of how you did on what exists, and the band is widened to carry the rest. A thin objective reading "strong" means you answered its items correctly, not that the topic is covered.</p>
  </div>` : ""}

  <div class="card">
    <div class="spread top">
      <div>
        <div class="score-big">${r.low}<small> to </small>${r.high}</div>
        <div class="faint">expected on exam day, 80% band &middot; pass line 750</div>
      </div>
      <dl class="side-stats inline">
        <div class="stat"><dt>Expected right</dt><dd class="${r.scaled >= 750 ? "good" : "warn"}">${pct(r.forecast.raw)}</dd></div>
        <div class="stat"><dt>Study hours to book</dt><dd>${hoursHtml(App)}</dd></div>
      </dl>
    </div>
    <div class="gauge">
      <div class="band" style="--l:${posOf(r.low)}%;--w:${Math.max(1.5, posOf(r.high) - posOf(r.low))}%"></div>
      <div class="pass" style="--l:${posOf(750)}%"></div>
    </div>
    <div class="gauge-scale"><span>100</span><span>750 pass</span><span>900</span></div>
    <p class="note">What you are likely to get right on the day: each graded item's chance from your accuracy on its objective and your memory of it decayed to the exam date, weighted by the exam's questions per objective and dragged by open corrections. ${r.forecast.mocks
       ? `${r.forecast.mocks} mock${r.forecast.mocks === 1 ? "" : "s"} in the last 30 days pull it toward their result.`
       : "No mock yet, so the band carries the model's own error; a full mock is the measurement that narrows it."}</p>
  </div>

  <div class="card tight">
    <h2 class="eyebrow">Book the exam when all three hold</h2>
    <ul class="stop-rule">${r.forecast.stop.rules.map((x) => `<li>
      <span class="mark sm ${x.met ? "ok" : "no"}" role="img" aria-label="${x.met ? "met" : "not met"}">${x.met ? "&check;" : "&times;"}</span>
      <span>${esc(x.text)}</span></li>`).join("")}</ul>
    <p class="note">Under the model, the first rule alone books an exam you would fail about one time in ten. The two mocks are what check the model; until they agree with it, treat the band as the model's opinion.</p>
  </div>

  ${r.objectivesSampled < 3
    ? `<p class="note">Where to spend the next session, and the picture per objective, appear once three objectives have answers; ${r.objectivesSampled} so far.</p>`
    : `${weakest.length
    ? `<div class="card tight"><h2 class="eyebrow">Spend your next session here</h2>
       <ol class="next-up">${weakest
         .map((o) => `<li>
            <span class="code">${esc(o.objective)}</span>
            <span class="what">${esc(o.title)}</span>
            <span class="mastery s-${o.status}">${pct(o.mastery)} ${o.status}</span>
          </li>`)
         .join("")}</ol></div>`
    : ""}

  <h2>Per objective</h2>
  <div class="heat">${cells}</div>`}

  ${c.answered >= 8 ? `<div class="card">
      <h2 class="eyebrow">Confidence calibration</h2>
      <div class="cal-grid">
        <div class="quad q-good"><b>${c.sureRight}</b><span>Sure and right</span><small>Secure</small></div>
        <div class="quad q-bad"><b>${c.sureWrong}</b><span>Sure and wrong</span><small>Dangerous: you will not look these up</small></div>
        <div class="quad q-warn"><b>${c.guessRight}</b><span>Guessed and right</span><small>Fragile: the score flatters you</small></div>
        <div class="quad"><b>${c.guessWrong}</b><span>Guessed and wrong</span><small>Honest gap, cheapest to fix</small></div>
      </div>
      <p class="note">When you say you are sure you are wrong <b class="c-${tone}">${pct(c.overconfidence)}</b> of the time (${{ bad: "high", warn: "watch", good: "low" }[tone]}), and ${pct(c.fragile)} of your guesses land. Both numbers should fall as you get ready; the first one matters more.</p>
    </div>` : ""}
  ${roots.length ? `<div class="card tight flag">
      <h2 class="eyebrow">One cause under several misses</h2>
      ${roots.slice(0, 3).map((r) => `<div class="root-cause">
        <b>${esc(r.def.label)}</b>
        <span>is still open and sits underneath ${r.blocks.length} other correction${r.blocks.length === 1 ? "" : "s"} you are carrying:
        ${r.blocks.slice(0, 4).map((b) => esc(App.content.misconceptions[b]?.label || b)).join("; ")}.</span>
      </div>`).join("")}
      <p class="note">Repairing the one underneath is worth more than drilling the ${roots[0].blocks.length} on top of it, and the queue will route you there first.</p>
    </div>` : ""}

  <h2>Domain balance</h2>
  <div class="card">
    <div class="scroll-x"><table class="grid">
      <thead><tr><th>Domain</th><th>Exam weight</th><th>Your share</th><th></th><th>Graded items seen</th></tr></thead>
      <tbody>${domains}</tbody></table></div>
    <p class="note">The drill queue biases new items toward whichever domain is furthest under its exam weight. Only graded practice counts here: a revealed vocabulary card does not cover a domain, because the exam never asks you to reveal anything.</p>
  </div>`;
}

// --- settings --------------------------------------------------------------
export function settingsView(App) {
  const p = App.state.profile;
  const c = App.content;
  const h = App.health;

  return `<h1>Settings</h1>

  <h2 class="eyebrow">Exam and pacing</h2>
  <div class="card">
    <div class="field-row"><label for="f-date">Exam date</label>
      <input id="f-date" type="date" data-setting="examDate" value="${esc(p.examDate || "")}"></div>
    <div class="field-row"><label for="f-pace">Pace</label>
      <select id="f-pace" data-setting="pace">
        ${[["bootcamp", "Bootcamp (short steps, high intake)"],
           ["balanced", "Balanced"],
           ["longhaul", "Long haul (wide intervals)"]]
          .map(([v, l]) => `<option value="${v}" ${p.pace === v ? "selected" : ""}>${l}</option>`).join("")}
      </select></div>
    <div class="field-row"><label for="f-ret">Target retention</label>
      <select id="f-ret" data-setting="desiredRetention">
        ${[0.85, 0.88, 0.9, 0.92, 0.95].map((v) =>
          `<option value="${v}" ${p.desiredRetention === v ? "selected" : ""}>${Math.round(v * 100)}%</option>`).join("")}
      </select></div>
    <div class="field-row"><label for="f-goal">Daily review goal</label>
      <select id="f-goal" data-setting="dailyReviewGoal">
        ${[20, 30, 40, 60, 80, 120].map((v) =>
          `<option value="${v}" ${p.dailyReviewGoal === v ? "selected" : ""}>${v} reviews</option>`).join("")}
      </select></div>
    <p class="note">Corrections are always retested before your exam date. An item whose next review would fall after it is left alone: it is still above your target retention on the day.</p>
  </div>

  <h2 class="eyebrow">Where your progress lives</h2>
  <div class="card">
    ${h
      ? `<table class="grid"><tbody>
          <tr><td>Durable copy</td><td class="mono">${esc(h.stateFile || "")}</td></tr>
          <tr><td>Snapshots kept</td><td class="mono">${h.snapshots ?? 0}${h.newestSnapshot ? ` &middot; newest ${esc(h.newestSnapshot)}` : ""}</td></tr>
          <tr><td>Answers and corrections saved</td><td class="mono">${h.reviews ?? 0}</td></tr>
          <tr><td>Open / cleared</td><td class="mono">${h.misconceptionsOpen ?? 0} / ${h.misconceptionsRetired ?? 0}</td></tr>
        </tbody></table>
        <p class="note">The browser keeps a fast copy and mirrors it to that file a second or two behind. Clearing site data does not lose your history.</p>`
      : `<p class="muted m0">The study server is not reachable, so progress is only in this browser right now. Start it with <span class="mono">python3 serve.py</span> and reload.</p>`}
    ${c.referenceSources?.length
      ? `<p class="note">Page references in corrections come from: ${c.referenceSources.map(esc).join("; ")}</p>`
      : ""}
    <div class="row mt4">
      <button class="btn ghost" data-action="export">Export a copy</button>
      <button class="btn ghost" data-action="import">Import</button>
      <button class="btn danger" data-action="reset">Reset everything</button>
    </div>
  </div>`;
}

// --- mock exam -------------------------------------------------------------
// The exam is 90 questions in 90 minutes with PBQs front loaded, scored 100-900
// with 750 to pass. A mock is only useful if it is faithful about the things
// that actually catch people: no feedback until the end, a clock you cannot
// pause, and PBQs eating your time before you have banked any easy marks.

/** Has this PBQ answer sheet been touched? Inspection state is not an answer. */
export const pbqAnswered = (a) =>
  Object.entries(a || {}).some(([k, v]) =>
    !["seenNodes", "inspected", "held"].includes(k) &&
    (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : !!v));

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
