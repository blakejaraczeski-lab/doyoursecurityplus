import { esc, pct, sessionBarHtml, emptyState } from "./common.js";
import { pbqHtml } from "./pbq.js";
import { mcqHtml, mcqMultiHtml, recallHtml, mentorOnlyHtml } from "./drill-question.js";
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