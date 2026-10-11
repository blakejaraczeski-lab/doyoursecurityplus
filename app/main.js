import { loadContent } from "./content.js";
import * as store from "./state.js";
import * as sync from "./sync.js";
import * as fsrs from "./fsrs.js";
import * as mentor from "./mentor.js";
import { buildQueue, buildMock } from "./scheduler.js";
import { gradePbq } from "./grade/index.js";
import { drillView, pbqLabView, mentorView, readinessView, settingsView } from "./ui/views.js";
import * as mock from "./ui/mock.js";
import { esc, mentorCardHtml } from "./ui/common.js";

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
  const s = sync.getStatus();
  const [cls, text] = SYNC_TEXT[s] || SYNC_TEXT.unknown;
  return `<span class="dot ${cls}"></span><span>${esc(text)}</span>`;
}

function updateSyncFoot() {
  const el = document.getElementById("sync-foot");
  if (el) el.innerHTML = syncFootHtml();
}

function render() {
  const body =
    App.view === "drill" ? drillView(App)
    : App.view === "pbq" ? pbqLabView(App)
    : App.view === "mock"
      ? (App.mock?.result ? mock.resultView(App)
         : App.mock?.active && App.mock.reviewing ? mock.reviewView(App)
         : App.mock?.active ? mock.runnerView(App)
         : mock.startView(App))
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

  // Announce the result to assistive tech without moving focus away from the
  // option the user just activated.
  const banner = root.querySelector(".verdict-banner");
  if (banner) { banner.setAttribute("role", "status"); banner.setAttribute("aria-live", "polite"); }
  if (drilling) root.querySelector("main > .card")?.classList.add("q-enter");

  tickTimer();
}

// --- PBQ pacing timer -----------------------------------------------------
// Updated in place rather than through render(), so it never steals focus from
// a field you are typing in.
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
  el.style.color = left < 5 * 60000 ? "var(--bad)" : left < 15 * 60000 ? "var(--warn)" : "";
  if (left === 0) { finishMock(); render(); }
}
setInterval(() => { tickTimer(); tickMock(); }, 1000);

function finishMock() {
  if (!App.mock?.active) return;
  App.mock.active = false;
  App.mock.result = mock.grade(App, gradePbq);
  store.touchStreak(App.state);
  store.save(App.state);
}

// --- recording ------------------------------------------------------------
function recordItem(item, grade, now = Date.now(), responseMs = null, confident = null) {
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
                           ...(confident != null ? { conf: confident ? "sure" : "guess" } : {}) });
  store.touchStreak(App.state);
}

function answerMcq(optId) {
  const entry = App.queue[App.idx];
  const item = entry.item;
  const opt = item.options.find((o) => o.id === optId);
  const correct = !!opt?.correct;
  const now = Date.now();
  const responseMs = App.questionShownAt ? now - App.questionShownAt : null;
  const rushed = !correct && responseMs != null && responseMs < RUSHED_MS && (item.difficulty || 2) >= 3;
  const confident = !App.markedGuess;

  // A confident right answer earns a longer interval than a lucky one, and a
  // guess that happened to land earns a short one.
  const grade = correct
    ? (confident ? fsrs.RATING.GOOD : fsrs.RATING.HARD)
    : fsrs.RATING.AGAIN;
  recordItem(item, grade, now, responseMs, confident);

  const mentorIds = [];
  let retiredNote = null;

  if (!correct) {
    if (opt?.misconception) {
      const right = item.options.find((o) => o.correct);
      const detail = opt.definition && right?.definition
        ? { picked: opt.text, pickedDef: opt.definition, answer: right.text, answerDef: right.definition }
        : null;
      mentor.bank(App.state, opt.misconception, item.id, now, detail, confident);
      mentorIds.push(opt.misconception);
      App.sessionStats.banked += 1;
    }
    if (entry.targetMisconception && entry.targetMisconception !== opt?.misconception) {
      mentor.bank(App.state, entry.targetMisconception, item.id, now, null, confident);
      mentorIds.push(entry.targetMisconception);
    }
  } else {
    const tested = new Set(item.options.filter((o) => o.misconception).map((o) => o.misconception));
    if (entry.targetMisconception) tested.add(entry.targetMisconception);
    for (const mc of tested) {
      const res = mentor.pass(App.state, mc, item.id, App.content, now, confident);
      if (res?.retired) {
        App.sessionStats.retired += 1;
        retiredNote = `"${App.content.misconceptions[mc].label}" cleared after ${res.have} correct answers on different questions.`;
      }
    }
  }

  App.sessionStats.answered += 1;
  if (correct) App.sessionStats.correct += 1;
  if (rushed) App.sessionStats.rushed += 1;
  if (!correct && item.objective) {
    App.sessionStats.missesByObjective[item.objective] =
      (App.sessionStats.missesByObjective[item.objective] || 0) + 1;
  }
  App.answer = { chosen: optId, correct, mentorIds, retiredNote, responseMs, rushed,
                 confident, overconfident: confident && !correct, lucky: !confident && correct };
  App.markedGuess = false;
  store.save(App.state);
}

/**
 * Grade a multiple-select item. All or nothing, the way the exam scores it:
 * the selected set must equal the correct set exactly. Every wrongly selected
 * option still banks its own misconception, so a near miss teaches as much as
 * a clean miss.
 */
function answerMcqMulti() {
  const entry = App.queue[App.idx];
  const item = entry.item;
  const picked = App.multiPicked;
  const now = Date.now();
  const responseMs = App.questionShownAt ? now - App.questionShownAt : null;
  const confident = !App.markedGuess;

  const correctIds = new Set(item.options.filter((o) => o.correct).map((o) => o.id));
  const exact = picked.size === correctIds.size && [...picked].every((id) => correctIds.has(id));

  recordItem(item, exact ? (confident ? fsrs.RATING.GOOD : fsrs.RATING.HARD) : fsrs.RATING.AGAIN,
             now, responseMs, confident);

  const mentorIds = [];
  let retiredNote = null;

  if (!exact) {
    for (const id of picked) {
      const opt = item.options.find((o) => o.id === id);
      if (opt && !opt.correct && opt.misconception) {
        mentor.bank(App.state, opt.misconception, item.id, now, null, confident);
        if (!mentorIds.includes(opt.misconception)) mentorIds.push(opt.misconception);
      }
    }
    // Missing a required option is its own error, so the option you failed to
    // pick banks its misconception too.
    for (const o of item.options) {
      if (o.correct && !picked.has(o.id) && o.missedMisconception) {
        mentor.bank(App.state, o.missedMisconception, item.id, now, null, confident);
        if (!mentorIds.includes(o.missedMisconception)) mentorIds.push(o.missedMisconception);
      }
    }
    App.sessionStats.banked += mentorIds.length;
    if (item.objective) {
      App.sessionStats.missesByObjective[item.objective] =
        (App.sessionStats.missesByObjective[item.objective] || 0) + 1;
    }
  } else {
    const tested = new Set(item.options.filter((o) => o.misconception).map((o) => o.misconception));
    for (const mc of tested) {
      const res = mentor.pass(App.state, mc, item.id, App.content, now, confident);
      if (res?.retired) {
        App.sessionStats.retired += 1;
        retiredNote = `"${App.content.misconceptions[mc].label}" cleared after ${res.have} correct answers on different questions.`;
      }
    }
  }

  App.sessionStats.answered += 1;
  if (exact) App.sessionStats.correct += 1;
  App.answer = { correct: exact, mentorIds, retiredNote, responseMs, confident,
                 overconfident: confident && !exact, lucky: !confident && exact };
  App.markedGuess = false;
  store.save(App.state);
}

function submitPbq() {
  const pbq = App.queue[App.idx].pbq;
  const now = Date.now();
  const g = gradePbq(pbq, App.pbqAnswers);
  const seconds = App.pbqStartedAt ? Math.round((now - App.pbqStartedAt) / 1000) : null;

  const rec = (App.state.pbq[pbq.id] ||= { attempts: [] });
  rec.attempts.push({ at: now, earned: g.earned, max: g.max, percent: g.percent, seconds });

  const banked = [];
  for (const r of g.results) {
    if (!r.misconception) continue;
    if (r.pass) mentor.pass(App.state, r.misconception, pbq.id, App.content, now);
    else {
      mentor.bank(App.state, r.misconception, pbq.id, now);
      if (!banked.includes(r.misconception)) banked.push(r.misconception);
    }
  }
  App.sessionStats.banked += banked.length;
  App.sessionStats.answered += 1;
  if (g.percent >= 80) App.sessionStats.correct += 1;
  store.touchStreak(App.state);

  g.mentorHtml = banked.map((id) => mentorCardHtml(mentor.card(id, App.content, App.state))).join("");
  App.pbqGraded = g;
  store.save(App.state);
}

// --- session control ------------------------------------------------------
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
  App.pbqAnswers = pbq.kind === "acl-table" ? { rules: [] }
    : pbq.kind === "drag-order" ? (pbq.config.mode === "sequence" ? { order: [] } : { placements: {}, held: null })
    : {};
  if (pbq.kind === "network-diagram") App.pbqAnswers.seenNodes = [];
  App.pbqStartedAt = Date.now();
}

/** PBQ answers live in the mock's own store while an exam is running. */
function examPbqStore() {
  if (App.view === "mock" && App.mock?.active) {
    const e = App.mock.items[App.mock.idx];
    return (App.mock.pbqAnswers[e.pbq.id] ||= e.pbq.kind === "acl-table" ? { rules: [] }
      : e.pbq.kind === "drag-order"
        ? (e.pbq.config.mode === "sequence" ? { order: [] } : { placements: {}, held: null })
        : {});
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
    store.save(App.state);
    next();
  },
  "mentor-ack": () => {
    mentor.pass(App.state, App.queue[App.idx].targetMisconception, `mentor:${Date.now()}`, App.content);
    store.touchStreak(App.state);
    store.save(App.state);
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
    const store_ = examPbqStore();
    store_.rules ||= [];
    store_.rules.push({ action: "permit", protocol: "tcp", src: "any", srcPort: "any", dst: "any", dstPort: "any" });
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

  // Click to place, rather than HTML5 drag: keyboard reachable, touch friendly,
  // and it does not lose the item when a drag wobbles.
  "order-place": (el) => {
    const st = examPbqStore();
    st.order = [...(st.order || []), el.dataset.item];
  },
  "order-unplace": (el) => {
    const st = examPbqStore();
    (st.order ||= []).splice(Number(el.dataset.i), 1);
  },
  "order-hold": (el) => {
    const st = examPbqStore();
    st.held = st.held === el.dataset.item ? null : el.dataset.item;
  },
  "order-drop": (el) => {
    const st = examPbqStore();
    if (!st.held) return;
    (st.placements ||= {})[st.held] = el.dataset.bucket;
    st.held = null;
  },
  "order-remove": (el) => {
    const st = examPbqStore();
    delete (st.placements ||= {})[el.dataset.item];
  },
  "toggle-guess": () => { App.markedGuess = !App.markedGuess; },
  "multi-toggle": (el) => {
    const id = el.dataset.opt;
    App.multiPicked.has(id) ? App.multiPicked.delete(id) : App.multiPicked.add(id);
  },
  "multi-submit": answerMcqMulti,
  "mock-start": (el) => {
    const fmt = el.dataset.format;
    const f = mock.FORMATS[fmt];
    const items = buildMock(App.content, { pbqCount: f.pbqCount, total: f.total });
    App.mock = {
      active: true, format: fmt, minutes: f.minutes, items, idx: 0,
      answers: {}, pbqAnswers: {}, flagged: new Set(),
      startedAt: Date.now(), endsAt: Date.now() + f.minutes * 60000, result: null, reviewing: false,
    };
    for (const e of items) if (e.kind === "pbq") {
      App.mock.pbqAnswers[e.pbq.id] = e.pbq.kind === "acl-table" ? { rules: [] }
        : e.pbq.kind === "drag-order"
          ? (e.pbq.config.mode === "sequence" ? { order: [] } : { placements: {}, held: null })
          : {};
    }
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
    const m2 = App.mock;
    const blank = m2.items.findIndex((e) =>
      e.kind === "pbq"
        ? !Object.keys(m2.pbqAnswers[e.pbq.id] || {}).some((k) => {
            const v = (m2.pbqAnswers[e.pbq.id] || {})[k];
            return Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : !!v;
          })
        : !m2.answers[e.item.id]);
    if (blank >= 0) { m2.idx = blank; m2.reviewing = false; }
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
      const store_ = examPbqStore();
      store_.inspected = def.id;
      store_.seenNodes = [...new Set([...(store_.seenNodes || []), def.id])];
      const task = pbq.config.tasks.find((t) => t.type === "select-nodes");
      if (task) {
        const list = (store_[task.id] ||= []);
        const at = list.indexOf(def.id);
        if (at >= 0) list.splice(at, 1); else list.push(def.id);
      }
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
  const inExam = App.view === "mock" && App.mock?.active;
  const pbqStore = inExam
    ? App.mock.pbqAnswers[App.mock.items[App.mock.idx].pbq?.id]
    : App.pbqAnswers;
  if (t.dataset.pbqField) {
    pbqStore[t.dataset.pbqField] = t.value;
    render();
  } else if (t.dataset.acl) {
    pbqStore.rules[Number(t.dataset.acl)][t.dataset.k] = t.value;
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
    store.save(App.state);
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

    store.onLocalSave((s) => sync.push(s));
    sync.onStatusChange(() => updateSyncFoot());
    sync.health().then((h) => { App.health = h; if (App.view === "settings") render(); });

    startSession("drill");
    render();
  } catch (err) {
    document.getElementById("app").innerHTML =
      `<main><h1>Could not start</h1><div class="card"><p>${esc(err.message)}</p>
       <p class="faint">This app must be served over http, not opened as a file.
       Run <span class="mono">./serve.sh</span> and open the address it prints.</p></div></main>`;
    console.error(err);
  }
})();
