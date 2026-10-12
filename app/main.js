import { loadContent } from "./content.js";
import { aclReadoutHtml } from "./ui/pbq.js";
import * as store from "./state.js";
import * as sync from "./sync.js";
import * as fsrs from "./fsrs.js";
import * as mentor from "./mentor.js";
import { buildQueue, buildMock, FORMATS, PBQ_WEIGHT, weightOf, toScaled } from "./scheduler.js";
import { gradePbq } from "./grade/index.js";
import {
  drillView, pbqLabView, mentorView, readinessView, settingsView,
  mockStartView, mockRunnerView, mockReviewView, mockResultView, pbqAnswered,
} from "./ui/views.js";
import { esc, pct, mentorCardHtml, setGlossary } from "./ui/common.js";

const App = {
  state: store.load(),
  content: null,
  health: null,
  view: "drill",
  mode: "drill",
  queue: [],
  idx: 0,
  answer: null,
  pbqAnswers: {},
  pbqGraded: null,
  pbqStartedAt: null,
  expanded: null,
  questionShownAt: null,
  markedGuess: false,
  multiPicked: new Set(),
  sessionStats: { answered: 0, correct: 0, banked: 0, retired: 0, rushed: 0, missesByObjective: {} },
};
window.App = App;

// Under this, on a question of real difficulty, you did not read the stem. The
// exam punishes exactly this: the options are written to be pattern matched.
const RUSHED_MS = 6000;

const NAV = [
  ["drill", "Drill"],
  ["pbq", "PBQ lab"],
  ["mock", "Mock exam"],
  ["mentor", "Mentor bank"],
  ["readiness", "Readiness"],
  ["settings", "Settings"],
];

/** Both tiers: the fast local copy now, the durable server copy a moment later. */
function save() {
  store.save(App.state);
  sync.push(App.state);
}

const mentorCards = (ids) =>
  ids.map((id) => mentorCardHtml(mentor.card(id, App.content, App.state))).join("");

// --- chrome ---------------------------------------------------------------
function goalRing(done, goal) {
  const r = 22, c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, goal ? done / goal : 0));
  const tone = frac >= 1 ? "var(--good)" : frac >= 0.5 ? "var(--accent)" : "var(--warn)";
  return `<div class="goal-ring">
    <svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
      <circle cx="27" cy="27" r="${r}" fill="none" stroke="var(--panel-3)" stroke-width="5"/>
      <circle cx="27" cy="27" r="${r}" fill="none" stroke="${tone}" stroke-width="5"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}"
        transform="rotate(-90 27 27)"/>
    </svg>
    <div class="lbl"><b>${done}<span>/${goal}</span></b>reviews<br>today</div>
  </div>`;
}

function sidebarHtml() {
  const due = mentor.due(App.state, App.content).length;
  const st = store.streakStatus(App.state);
  const done = store.reviewsToday(App.state);
  const goal = App.state.profile.dailyReviewGoal || 40;
  const days = App.state.profile.examDate ? mentor.daysUntilExam(App.state) : null;

  const scratch = store.SCRATCH
    ? `<div class="scratch-flag">scratch session &middot; nothing here is saved to your real progress</div>`
    : "";
  const nav = NAV.map(([id, label]) => {
    const badge = id === "mentor" && due
      ? `<span class="badge ${due > 8 ? "hot" : ""}">${due}</span>` : "";
    return `<button class="nav" ${App.view === id ? 'aria-current="page"' : ""}
      data-action="nav" data-view="${id}">${label}${badge}</button>`;
  }).join("");

  const stat = (label, value, tone = "") =>
    `<div class="stat"><dt>${label}</dt><dd class="${tone}">${value}</dd></div>`;

  return `<aside class="sidebar">
    <div class="brand">
      <span class="mark" aria-hidden="true">S+</span>
      <span class="name">doyoursecurityplus<small>SY0-701</small></span>
    </div>
    ${scratch}
    <nav aria-label="Sections">${nav}</nav>
    <div class="side-stats">
      ${goalRing(done, goal)}
      <dl class="stat-rows">
        ${stat("Streak", `${st.current}<span class="u">d</span>`,
               st.studiedToday ? "good" : st.alive ? "" : "warn")}
        ${days != null
          ? stat("To exam", `${days}<span class="u">d</span>`, days <= 14 ? "warn" : "")
          : stat("Exam date", "not set", "warn")}
        ${stat("Due now", due, due ? "warn" : "good")}
      </dl>
    </div>
    <div class="sidebar-foot" id="sync-foot">${syncFootHtml()}</div>
  </aside>`;
}

const SYNC_TEXT = {
  saved: ["saved", "Progress saved to disk"],
  saving: ["saving", "Saving"],
  offline: ["offline", "Browser only, server unreachable"],
  conflict: ["conflict", "Another session saved newer work"],
  unknown: ["", "Connecting"],
};

function syncFootHtml() {
  const [cls, text] = SYNC_TEXT[sync.getStatus()] || SYNC_TEXT.unknown;
  return `<span class="dot ${cls}"></span><span>${esc(text)}</span>`;
}

// The status dot follows the sync module on the same one second tick as the
// timers, so nothing has to subscribe to anything.
let shownSync = null;
function tickSync() {
  const s = sync.getStatus();
  if (s === shownSync) return;
  shownSync = s;
  const el = document.getElementById("sync-foot");
  if (el) el.innerHTML = syncFootHtml();
}

/** Keep the readable policy in step with the grid without re-rendering it. */
function refreshAclReadout() {
  const el = document.getElementById("acl-readout");
  if (!el) return;
  const examPbq = App.view === "mock" && App.mock?.active && App.mock.items[App.mock.idx]?.pbq;
  const pbq = examPbq || App.queue[App.idx]?.pbq;
  if (pbq?.kind !== "acl-table") return;
  el.outerHTML = aclReadoutHtml(pbq.config, examPbqStore().rules || []);
}

function render() {
  const body =
    App.view === "drill" ? drillView(App)
    : App.view === "pbq" ? pbqLabView(App)
    : App.view === "mock"
      ? (App.mock?.result ? mockResultView(App)
         : App.mock?.active && App.mock.reviewing ? mockReviewView(App)
         : App.mock?.active ? mockRunnerView(App)
         : mockStartView(App))
    : App.view === "mentor" ? mentorView(App)
    : App.view === "readiness" ? readinessView(App)
    : settingsView(App);

  const root = document.getElementById("app");
  root.className = "";

  // Focus mode: chrome recedes while a question is actually in front of you,
  // and comes back for the lab, the bank and the summary screens.
  const drilling =
    (App.view === "drill" && App.queue.length && App.idx < App.queue.length) ||
    (App.view === "mock" && App.mock?.active);
  document.body.classList.toggle("drilling", !!drilling);

  root.innerHTML = sidebarHtml() + `<main id="main">${body}</main>`;
  shownSync = sync.getStatus();

  // Announce the result to assistive tech without moving focus away from the
  // option the user just activated.
  const banner = root.querySelector(".verdict-banner");
  if (banner) { banner.setAttribute("role", "status"); banner.setAttribute("aria-live", "polite"); }
  if (drilling) root.querySelector("main > .card")?.classList.add("q-enter");

  tickTimer();
}

// --- timers ---------------------------------------------------------------
// Updated in place rather than through render(), so they never steal focus
// from a field you are typing in.
function tickTimer() {
  const el = document.getElementById("pbq-timer");
  if (!el) return;
  if (!App.pbqStartedAt) { App.pbqStartedAt = Date.now(); }
  const target = Number(el.dataset.target || 480);
  const elapsed = Math.floor((Date.now() - App.pbqStartedAt) / 1000);
  const mm = Math.floor(elapsed / 60), ss = String(elapsed % 60).padStart(2, "0");
  el.textContent = `${mm}:${ss} / ${Math.round(target / 60)}:00`;
  el.classList.toggle("warn", elapsed > target);
}
function tickMock() {
  const el = document.getElementById("mock-timer");
  if (!el || !App.mock?.active) return;
  const left = Math.max(0, Number(el.dataset.ends) - Date.now());
  const mm = Math.floor(left / 60000), ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  el.textContent = `${mm}:${ss} left`;
  el.className = `mono ${left < 5 * 60000 ? "c-bad" : left < 15 * 60000 ? "c-warn" : ""}`;
  if (left === 0) { finishMock(); render(); }
}
setInterval(() => { tickTimer(); tickMock(); tickSync(); }, 1000);

// --- recording ------------------------------------------------------------
function recordItem(item, grade, now = Date.now(), { responseMs = null, conf = null, mock = false } = {}) {
  const rec = (App.state.items[item.id] ||= {
    seen: 0, correct: 0, wrong: 0, lastSeen: 0, fsrs: fsrs.newCard(),
  });
  rec.seen += 1;
  rec.lastSeen = now;
  if (grade >= fsrs.RATING.HARD) rec.correct += 1; else rec.wrong += 1;
  rec.fsrs = fsrs.review(rec.fsrs, grade, {
    now,
    desiredRetention: App.state.profile.desiredRetention,
    maxIntervalDays: mentor.daysUntilExam(App.state, now),
  });
  App.state.reviews.push({ at: now, kind: "item", id: item.id, grade,
                           ...(responseMs != null ? { ms: responseMs } : {}),
                           ...(conf != null ? { conf: conf ? "sure" : "guess" } : {}),
                           ...(mock ? { mock: true } : {}) });
  store.touchStreak(App.state);
}

/**
 * Record one answered multiple choice item, single or multiple select, in a
 * drill or a mock: FSRS on the item, bank or pass on every misconception it
 * tests, one review row. Multiple select is all or nothing, the way the exam
 * scores it: the picked set must equal the correct set exactly, and every
 * wrongly picked option still banks its own misconception, so a near miss
 * teaches as much as a clean miss. Returns what the caller shows or tallies.
 */
function recordOutcome(entry, picked, { confident = true, responseMs = null, mock = false, now = Date.now() } = {}) {
  const item = entry.item;
  const correctIds = new Set(item.options.filter((o) => o.correct).map((o) => o.id));
  const correct = picked.size === correctIds.size && [...picked].every((id) => correctIds.has(id));
  const rushed = !correct && responseMs != null && responseMs < RUSHED_MS && (item.difficulty || 2) >= 3;

  // A confident right answer earns a longer interval than a lucky one, and a
  // guess that happened to land earns a short one. A mock answer is committed
  // under exam conditions, so it is treated as confident for the mentor but
  // not counted in calibration, which only you can declare.
  const grade = correct ? (confident ? fsrs.RATING.GOOD : fsrs.RATING.HARD) : fsrs.RATING.AGAIN;
  recordItem(item, grade, now, { responseMs, conf: mock ? null : confident, mock });

  const banked = [];
  const retired = [];
  const bank = (mc, detail = null) => {
    mentor.bank(App.state, mc, item.id, now, detail, confident);
    if (!banked.includes(mc)) banked.push(mc);
  };

  if (correct) {
    const tested = new Set(item.options.filter((o) => o.misconception).map((o) => o.misconception));
    if (entry.targetMisconception) tested.add(entry.targetMisconception);
    for (const mc of tested) {
      const res = mentor.pass(App.state, mc, item.id, App.content, now, confident);
      if (res?.retired) retired.push({ id: mc, have: res.have });
    }
  } else {
    const right = item.options.find((o) => o.correct);
    for (const o of item.options) {
      if (picked.has(o.id) && !o.correct && o.misconception) {
        // For terminology items the useful correction is the exact pair you
        // confused, so both definitions travel with the bank.
        bank(o.misconception, o.definition && right?.definition
          ? { picked: o.text, pickedDef: o.definition, answer: right.text, answerDef: right.definition }
          : null);
      }
      // Missing a required option is its own error.
      if (o.correct && !picked.has(o.id) && o.missedMisconception) bank(o.missedMisconception);
    }
    if (entry.targetMisconception && !banked.includes(entry.targetMisconception)) bank(entry.targetMisconception);
  }

  return {
    correct, rushed, confident, responseMs, banked,
    retired: retired.length,
    retiredNote: retired.length
      ? `"${App.content.misconceptions[retired[0].id].label}" cleared after ${retired[0].have} correct answers on different questions.`
      : null,
    overconfident: confident && !correct,
    lucky: !confident && correct,
  };
}

/** Fold one outcome into the running session figures. */
function tally(out, item) {
  const s = App.sessionStats;
  s.answered += 1;
  if (out.correct) s.correct += 1;
  if (out.rushed) s.rushed += 1;
  s.banked += out.banked.length;
  s.retired += out.retired;
  if (!out.correct && item.objective) {
    s.missesByObjective[item.objective] = (s.missesByObjective[item.objective] || 0) + 1;
  }
}

function answerMcq(optId) {
  const entry = App.queue[App.idx];
  const out = recordOutcome(entry, new Set([optId]), {
    confident: !App.markedGuess,
    responseMs: App.questionShownAt ? Date.now() - App.questionShownAt : null,
  });
  tally(out, entry.item);
  App.answer = { chosen: optId, ...out };
  App.markedGuess = false;
  save();
}

function answerMcqMulti() {
  const entry = App.queue[App.idx];
  const out = recordOutcome(entry, App.multiPicked, {
    confident: !App.markedGuess,
    responseMs: App.questionShownAt ? Date.now() - App.questionShownAt : null,
  });
  tally(out, entry.item);
  App.answer = out;
  App.markedGuess = false;
  save();
}

/** Record a graded PBQ attempt and bank or pass every subtask. Returns the banked ids. */
function recordPbq(pbq, g, now, { seconds = null, mock = false } = {}) {
  const rec = (App.state.pbq[pbq.id] ||= { attempts: [] });
  rec.attempts.push({ at: now, earned: g.earned, max: g.max, percent: g.percent,
                      ...(seconds != null ? { seconds } : {}), ...(mock ? { mock: true } : {}) });
  const banked = [];
  for (const r of g.results) {
    if (!r.misconception) continue;
    if (r.pass) mentor.pass(App.state, r.misconception, pbq.id, App.content, now);
    else {
      mentor.bank(App.state, r.misconception, pbq.id, now);
      if (!banked.includes(r.misconception)) banked.push(r.misconception);
    }
  }
  store.touchStreak(App.state);
  return banked;
}

function submitPbq() {
  const pbq = App.queue[App.idx].pbq;
  const now = Date.now();
  const g = gradePbq(pbq, App.pbqAnswers);
  const banked = recordPbq(pbq, g, now, {
    seconds: App.pbqStartedAt ? Math.round((now - App.pbqStartedAt) / 1000) : null,
  });
  App.sessionStats.banked += banked.length;
  App.sessionStats.answered += 1;
  if (g.percent >= 80) App.sessionStats.correct += 1;
  g.mentorHtml = mentorCards(banked);
  App.pbqGraded = g;
  save();
}

/** Score a finished mock and turn every miss into a scheduled correction. */
function gradeMock() {
  const m = App.mock;
  const now = Date.now();
  let mcqCorrect = 0, mcqTotal = 0, unanswered = 0;
  let pbqEarned = 0, pbqMax = 0, pbqCount = 0;
  let wCorrect = 0, wTotal = 0;          // difficulty weighted
  const byDomain = {};
  const banked = [];
  const missedObjectives = {};
  const note = (ids) => { for (const id of ids) if (!banked.includes(id)) banked.push(id); };

  for (const d of App.content.objectives.domains) {
    byDomain[d.id] = { id: d.id, title: d.title, weight: d.weight, correct: 0, total: 0 };
  }

  for (const entry of m.items) {
    if (entry.kind === "pbq") {
      const g = gradePbq(entry.pbq, m.pbqAnswers[entry.pbq.id] || {});
      pbqEarned += g.earned; pbqMax += g.max; pbqCount += 1;
      const pw = PBQ_WEIGHT * weightOf(entry.pbq);
      wTotal += pw;
      wCorrect += pw * (g.max ? g.earned / g.max : 0);
      const dom = App.content.domainOf[entry.pbq.objective];
      if (byDomain[dom]) {
        byDomain[dom].total += PBQ_WEIGHT;
        byDomain[dom].correct += Math.round(PBQ_WEIGHT * (g.max ? g.earned / g.max : 0));
      }
      note(recordPbq(entry.pbq, g, now, { mock: true }));
      continue;
    }

    const item = entry.item;
    const chosen = m.answers[item.id];
    const dom = App.content.domainOf[item.objective];
    const w = weightOf(item);
    mcqTotal += 1;
    wTotal += w;
    if (byDomain[dom]) byDomain[dom].total += 1;
    if (!chosen) unanswered += 1;
    // Everything in a mock is answered under exam conditions, so a miss counts
    // as confidently wrong: you committed to it with the clock running.
    const out = recordOutcome(entry, new Set(chosen ? [chosen] : []), { now, mock: true });
    if (out.correct) {
      wCorrect += w;
      mcqCorrect += 1;
      if (byDomain[dom]) byDomain[dom].correct += 1;
    } else {
      missedObjectives[item.objective] = (missedObjectives[item.objective] || 0) + 1;
    }
    note(out.banked);
  }

  const pbqFrac = pbqMax ? pbqEarned / pbqMax : 0;
  const raw = wTotal ? wCorrect / wTotal : 0;
  const flatRaw = (mcqTotal + pbqCount * PBQ_WEIGHT)
    ? (mcqCorrect + pbqFrac * pbqCount * PBQ_WEIGHT) / (mcqTotal + pbqCount * PBQ_WEIGHT)
    : 0;
  const scaled = toScaled(raw);

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
  if (Math.abs(raw - flatRaw) >= 0.03) {
    notes.push(`Weighted for item difficulty your raw score is ${pct(raw)}; counted flat it would be ${pct(flatRaw)}. ${
      raw < flatRaw
        ? "You are doing better on the easy items than the hard ones, which is the pattern that passes practice tests and fails the exam."
        : "You are holding up on the harder items, which is the right way round."}`);
  }

  (App.state.mockHistory ||= []).push({
    at: now, format: m.format, raw, scaled, seconds, unanswered, banked: banked.length,
  });
  return {
    at: now, format: m.format, raw, flatRaw, scaled, seconds, minutes: m.minutes,
    unanswered, banked: banked.length,
    byDomain: Object.values(byDomain), notes, mentorHtml: mentorCards(banked.slice(0, 6)),
  };
}

function finishMock() {
  if (!App.mock?.active) return;
  App.mock.active = false;
  App.mock.result = gradeMock();
  save();
}

// --- session control ------------------------------------------------------
/** The blank answer sheet for a PBQ, shaped for its kind. */
const emptyAnswers = (pbq) =>
  pbq.kind === "acl-table" ? { rules: [] }
  : pbq.kind === "network-diagram" ? { seenNodes: [] }
  : pbq.kind === "drag-order"
    ? (pbq.config.mode === "sequence" ? { order: [] } : { placements: {}, held: null })
  : {};

function startSession(mode) {
  App.mode = mode;
  App.queue = buildQueue(App.state, App.content, { mode, size: mode === "weak" ? 15 : 25 });
  App.idx = 0;
  App.answer = null;
  App.pbqAnswers = {};
  App.pbqGraded = null;
  App.pbqStartedAt = null;
  App.multiPicked = new Set();
  App.sessionStats = { answered: 0, correct: 0, banked: 0, retired: 0, rushed: 0, missesByObjective: {} };
  App.questionShownAt = Date.now();
  App.view = "drill";
  if (App.queue[0]?.kind === "pbq") seedPbq(App.queue[0].pbq);
}

function next() {
  App.idx += 1;
  App.answer = null;
  App.markedGuess = false;
  App.multiPicked = new Set();
  App.questionShownAt = Date.now();
  App.pbqAnswers = {};
  App.pbqGraded = null;
  App.pbqStartedAt = null;
  if (App.queue[App.idx]?.kind === "pbq") seedPbq(App.queue[App.idx].pbq);
}

function seedPbq(pbq) {
  App.pbqAnswers = emptyAnswers(pbq);
  App.pbqStartedAt = Date.now();
}

/** PBQ answers live in the mock's own store while an exam is running. */
function examPbqStore() {
  if (App.view === "mock" && App.mock?.active) {
    const e = App.mock.items[App.mock.idx];
    return (App.mock.pbqAnswers[e.pbq.id] ||= emptyAnswers(e.pbq));
  }
  return App.pbqAnswers;
}

// --- actions --------------------------------------------------------------
const ACTIONS = {
  nav: (el) => { App.view = el.dataset.view; App.expanded = null; },
  "start-drill": () => startSession("drill"),
  "start-weak": () => startSession("weak"),
  "go-readiness": () => { App.view = "readiness"; },
  answer: (el) => answerMcq(el.dataset.opt),
  next,
  reveal: () => { App.answer = { revealed: true }; },
  grade: (el) => {
    recordItem(App.queue[App.idx].item, Number(el.dataset.g));
    App.sessionStats.answered += 1;
    if (Number(el.dataset.g) >= 3) App.sessionStats.correct += 1;
    save();
    next();
  },
  "mentor-ack": () => {
    mentor.pass(App.state, App.queue[App.idx].targetMisconception, `mentor:${Date.now()}`, App.content);
    store.touchStreak(App.state);
    save();
    next();
  },
  "pbq-submit": submitPbq,
  "pbq-continue": () => {
    if (App.mode === "pbq") { App.view = "pbq"; App.queue = []; App.idx = 0; App.pbqGraded = null; }
    else next();
  },
  "open-pbq": (el) => {
    const pbq = App.content.pbqsById[el.dataset.id];
    App.mode = "pbq";
    App.queue = [{ kind: "pbq", pbq }];
    App.idx = 0;
    App.pbqGraded = null;
    seedPbq(pbq);
  },
  "acl-add": () => {
    const a = examPbqStore();
    a.rules ||= [];
    a.rules.push({ action: "permit", protocol: "tcp", src: "any", srcPort: "any", dst: "any", dstPort: "any" });
  },
  "acl-del": (el) => examPbqStore().rules.splice(Number(el.dataset.i), 1),
  "acl-up": (el) => {
    const i = Number(el.dataset.i), r = examPbqStore().rules;
    [r[i - 1], r[i]] = [r[i], r[i - 1]];
  },
  "acl-down": (el) => {
    const i = Number(el.dataset.i), r = examPbqStore().rules;
    [r[i + 1], r[i]] = [r[i], r[i + 1]];
  },
  "diagram-choice": (el) => { examPbqStore()[el.dataset.task] = el.dataset.value; },
  // data-host, not data-node: the diagram's own click handler claims anything
  // carrying data-node before action dispatch ever runs.
  "node-toggle": (el) => {
    const a = examPbqStore();
    const list = (a[el.dataset.task] ||= []);
    const at = list.indexOf(el.dataset.host);
    if (at >= 0) list.splice(at, 1); else list.push(el.dataset.host);
  },

  // Click to place, rather than HTML5 drag: keyboard reachable, touch friendly,
  // and it does not lose the item when a drag wobbles. Positions fill in any
  // order, so the step you are sure is last can be committed first.
  "order-place-at": (el) => {
    const a = examPbqStore();
    const i = Number(el.dataset.i);
    const order = [...(a.order || [])];
    while (order.length <= i) order.push(undefined);
    order[i] = a.held;
    a.order = order;
    a.held = null;
  },
  "order-unplace": (el) => {
    const a = examPbqStore();
    // Clear the position, do not splice it out: with positional placement,
    // splicing would silently shift every later step up by one.
    const order = [...(a.order || [])];
    order[Number(el.dataset.i)] = undefined;
    while (order.length && order[order.length - 1] === undefined) order.pop();
    a.order = order;
  },
  "order-hold": (el) => {
    const a = examPbqStore();
    a.held = a.held === el.dataset.item ? null : el.dataset.item;
  },
  "order-drop": (el) => {
    const a = examPbqStore();
    if (!a.held) return;
    (a.placements ||= {})[a.held] = el.dataset.bucket;
    a.held = null;
  },
  "order-remove": (el) => {
    const a = examPbqStore();
    delete (a.placements ||= {})[el.dataset.item];
  },
  "toggle-guess": () => { App.markedGuess = !App.markedGuess; },
  "multi-toggle": (el) => {
    const id = el.dataset.opt;
    App.multiPicked.has(id) ? App.multiPicked.delete(id) : App.multiPicked.add(id);
  },
  "multi-submit": answerMcqMulti,
  "mock-start": (el) => {
    const fmt = el.dataset.format;
    const f = FORMATS[fmt];
    const items = buildMock(App.content, { pbqCount: f.pbqCount, total: f.total });
    App.mock = {
      active: true, format: fmt, minutes: f.minutes, items, idx: 0,
      answers: {}, pbqAnswers: {}, flagged: new Set(),
      startedAt: Date.now(), endsAt: Date.now() + f.minutes * 60000, result: null, reviewing: false,
    };
    for (const e of items) if (e.kind === "pbq") App.mock.pbqAnswers[e.pbq.id] = emptyAnswers(e.pbq);
    App.view = "mock";
  },
  "mock-answer": (el) => {
    const entry = App.mock.items[App.mock.idx];
    App.mock.answers[entry.item.id] = el.dataset.opt;
  },
  "mock-next": () => { App.mock.idx = Math.min(App.mock.idx + 1, App.mock.items.length - 1); },
  "mock-prev": () => { App.mock.idx = Math.max(0, App.mock.idx - 1); },
  "mock-flag": () => {
    const e = App.mock.items[App.mock.idx];
    const id = e.item?.id || e.pbq?.id;
    App.mock.flagged.has(id) ? App.mock.flagged.delete(id) : App.mock.flagged.add(id);
  },
  "mock-review": () => { App.mock.reviewing = true; },
  "mock-resume": () => { App.mock.reviewing = false; },
  "mock-goto": (el) => { App.mock.idx = Number(el.dataset.i); App.mock.reviewing = false; },
  "mock-first-blank": () => {
    const m = App.mock;
    const blank = m.items.findIndex((e) =>
      e.kind === "pbq" ? !pbqAnswered(m.pbqAnswers[e.pbq.id]) : !m.answers[e.item.id]);
    if (blank >= 0) { m.idx = blank; m.reviewing = false; }
  },
  "mock-submit": () => {
    const left = App.mock.items.length - Object.keys(App.mock.answers).length;
    if (left > 0 && !confirm(`${left} question${left === 1 ? " is" : "s are"} unanswered. There is no penalty for a wrong guess on the real exam. Submit anyway?`)) return;
    finishMock();
  },
  "mock-done": () => { App.mock = null; App.view = "mock"; },
  "expand-mc": (el) => { App.expanded = App.expanded === el.dataset.id ? null : el.dataset.id; },
  export: () => {
    const blob = new Blob([store.exportState(App.state)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `doyoursecurityplus-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  import: () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      try {
        App.state = store.importState(await input.files[0].text());
        store.save(App.state);
        await sync.forcePush(App.state);
        render();
      } catch (e) { alert(`Could not import: ${e.message}`); }
    };
    input.click();
  },
  reset: async () => {
    if (!confirm("Erase all progress, banked corrections and review history?\n\nA snapshot stays on disk, so this is recoverable from the data directory.")) return;
    App.state = store.resetState();
    await sync.forcePush(App.state);
    startSession("drill");
  },
};

document.addEventListener("click", (e) => {
  const node = e.target.closest("[data-node]");
  const examPbq = App.view === "mock" && App.mock?.active && App.mock.items[App.mock.idx]?.pbq;
  if (node && (examPbq || (App.queue[App.idx]?.kind === "pbq" && !App.pbqGraded))) {
    const pbq = examPbq || App.queue[App.idx].pbq;
    const def = pbq.config.nodes.find((n) => n.id === node.dataset.node);
    if (def && def.selectable !== false) {
      // Inspecting a host is not accusing it. Clicking inspects; naming it
      // compromised is a separate, explicit act, because gathering evidence
      // before committing to a verdict is the skill this question trains.
      const a = examPbqStore();
      a.inspected = def.id;
      a.seenNodes = [...new Set([...(a.seenNodes || []), def.id])];
      render();
    }
    return;
  }
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  const r = fn(el);
  if (r instanceof Promise) r.then(render); else render();
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.pbqField) {
    examPbqStore()[t.dataset.pbqField] = t.value;
    render();
  } else if (t.dataset.acl) {
    examPbqStore().rules[Number(t.dataset.acl)][t.dataset.k] = t.value;
    // A full render would rebuild the select you are still interacting with and
    // take the focus with it, so the plain-text policy is refreshed on its own.
    refreshAclReadout();
  } else if (t.dataset.setting) {
    const k = t.dataset.setting;
    App.state.profile[k] =
      k === "desiredRetention" ? Number(t.value)
      : k === "dailyReviewGoal" ? Number(t.value)
      : t.value || null;
    if (k === "pace") {
      const r = { bootcamp: 0.92, balanced: 0.9, longhaul: 0.88 }[t.value];
      if (r) App.state.profile.desiredRetention = r;
    }
    save();
    render();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if (App.view !== "drill" || !App.queue.length) return;
  const entry = App.queue[App.idx];
  if (!entry || entry.kind !== "item") return;

  if (entry.item.type === "mcq-multi") {
    if (App.answer && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); next(); return render(); }
    if (App.answer) return;
    const need = entry.item.selectCount || 2;
    if (e.key === "Enter" && App.multiPicked.size === need) { e.preventDefault(); answerMcqMulti(); return render(); }
    const i = "abcdef".indexOf(e.key.toLowerCase());
    if (i >= 0 && entry.item.options[i]) {
      e.preventDefault();
      const id = entry.item.options[i].id;
      App.multiPicked.has(id) ? App.multiPicked.delete(id) : App.multiPicked.add(id);
      render();
    }
    return;
  }

  if (entry.item.type === "mcq") {
    if (App.answer && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); next(); return render(); }
    if (!App.answer && e.key.toLowerCase() === "g") {
      e.preventDefault();
      App.markedGuess = !App.markedGuess;
      return render();
    }
    const i = "abcdef".indexOf(e.key.toLowerCase());
    if (!App.answer && i >= 0 && entry.item.options[i]) {
      e.preventDefault();
      answerMcq(entry.item.options[i].id);
      render();
    }
    return;
  }

  if (entry.item.type === "recall") {
    if (!App.answer?.revealed && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      App.answer = { revealed: true };
      return render();
    }
    if (App.answer?.revealed && ["1", "2", "3", "4"].includes(e.key)) {
      e.preventDefault();
      ACTIONS.grade({ dataset: { g: e.key } });
      render();
    }
  }
});

// Save when the tab goes to the background, not when it is being torn down.
// By beforeunload the only transport left is a keepalive fetch, which caps the
// body at 64 KB; this state is past that. visibilitychange fires while a normal
// request still works, and it also covers the cases beforeunload misses, such
// as closing the lid or the tab being discarded on mobile.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  store.flush(App.state);
  sync.flushNow(App.state);
});

window.addEventListener("pagehide", () => {
  store.flush(App.state);
  sync.flushBeacon(App.state);
});

// --- boot -----------------------------------------------------------------
(async () => {
  try {
    App.content = await loadContent();
    setGlossary(App.content.glossary);

    // Reconcile the fast local copy with the durable one. Newest wins, and the
    // loser is never silently discarded: the server keeps snapshots either way.
    const remote = await sync.pull();
    if (remote && (remote.updatedAt || 0) > (App.state.updatedAt || 0)) {
      App.state = { ...remote };
      store.flush(App.state);
      console.info("Restored newer progress from the study server.");
    } else if (App.state.updatedAt) {
      sync.push(App.state);
    }

    const pruned = store.pruneOrphans(App.state, App.content);
    if (pruned) {
      console.info(`Dropped ${pruned} progress record(s) for items no longer in the bank.`);
      save();
    }
    sync.health().then((h) => { App.health = h; if (App.view === "settings") render(); });

    startSession("drill");
    render();
  } catch (err) {
    document.getElementById("app").innerHTML =
      `<main><h1>Could not start</h1><div class="card"><p>${esc(err.message)}</p>
       <p class="faint">This app must be served over http, not opened as a file.
       Run <span class="mono">python3 serve.py</span> and open the address it prints.</p></div></main>`;
    console.error(err);
  }
})();
