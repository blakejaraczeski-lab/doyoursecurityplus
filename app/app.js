import * as store from "./state.js";
import * as sync from "./sync.js";
import { drillHomeView, drillRunView, drillDoneView } from "./ui/drill.js";
import { labListView, labRunView } from "./ui/lab.js";
import { mockStartView, mockRunnerView, mockReviewView, mockResultView } from "./ui/mock.js";
import { mentorView } from "./ui/bank.js";
import { readinessView } from "./ui/readiness.js";
import { settingsView } from "./ui/settings.js";
import { sidebarHtml, syncFootHtml } from "./ui/chrome.js";

// One routing variable. `screen` names exactly what is on screen; everything
// else here is session data that the screens read.
export const App = {
  state: store.load(),
  content: null,
  health: null,
  screen: "drill-home",
  // the drill session
  mode: "drill",            // drill | weak: which queue the scheduler built
  queue: [],
  idx: 0,
  answer: null,
  questionShownAt: null,
  markedGuess: false,
  multiPicked: new Set(),
  sessionStats: { answered: 0, correct: 0, banked: 0, retired: 0, rushed: 0, missesByObjective: {} },
  // PBQs, wherever they appear: one answer sheet per PBQ id
  answers: {},
  graded: null,             // the grade of the PBQ in front of you, in the drill or the lab
  pbqStartedAt: null,
  lab: null,                // the PBQ open in the lab
  mock: null,               // { format, minutes, items, idx, answers, flagged, startedAt, endsAt, result }
  expanded: null,
  bankAll: false,           // the mentor bank shows the most urgent dozen until asked for all
  introDismissed: false,    // the first-night line, per browser
};
try { App.introDismissed = localStorage.getItem("dysp.intro") === "1"; } catch {}
window.App = App;

// Under this, on a question of real difficulty, you did not read the stem. The
// exam punishes exactly this: the options are written to be pattern matched.
const RUSHED_MS = 6000;

const SCREENS = {
  "drill-home": drillHomeView,
  "drill-run": drillRunView,
  "drill-done": drillDoneView,
  "lab-list": labListView,
  "lab-run": labRunView,
  "mock-home": mockStartView,
  "mock-run": mockRunnerView,
  "mock-review": mockReviewView,
  "mock-result": mockResultView,
  bank: mentorView,
  readiness: readinessView,
  settings: settingsView,
};

/** Both tiers: the fast local copy now, the durable server copy a moment later. */
export function save() {
  store.save(App.state);
  sync.push(App.state);
}

/**
 * Every render replaces the DOM, which would drop keyboard focus to the body
 * and send the next Tab back to the top of the page. So the focused control
 * is remembered by what it is, not by identity, and focus goes back to the
 * same control after the render; if that control is gone or disabled (the
 * option you just answered), to the verdict, and failing that to main.
 */
// main only ever holds focus as the fallback, so it counts as nothing focused.
const focusKey = (el) =>
  el && el !== document.body && el.id !== "main" ? `${el.tagName}|${el.id || ""}|${JSON.stringify(el.dataset)}` : null;

function restoreFocus(key, fresh) {
  // A new question: the first option is where the next keystroke belongs. Only
  // an unanswered question has options to land on; a recall card or a PBQ
  // falls through to the usual rules below.
  if (fresh && !document.querySelector(".verdict-banner")) {
    const first = document.querySelector("#main .opt:not([disabled])");
    if (first) { first.focus({ preventScroll: true }); return; }
  }
  // Nothing had focus (a key pressed on the page itself): put it where the
  // next Tab makes sense, the verdict if one just landed, else the screen.
  if (!key) {
    const v = document.querySelector(".verdict-banner");
    (v || document.getElementById("main"))?.focus({ preventScroll: true });
    v?.scrollIntoView({ block: "nearest" });
    return;
  }
  const [tag, id, data] = key.split("|");
  const same = [...document.querySelectorAll(tag.toLowerCase())]
    .find((e) => (e.id || "") === id && JSON.stringify(e.dataset) === data);
  // A key with no id and no data (a verdict, say) matches any plain element,
  // which may not take focus at all: if it did not land, fall back.
  let target = same && !same.disabled ? same : null;
  target?.focus({ preventScroll: true });
  if (!target || document.activeElement !== target) {
    target = document.querySelector(".verdict-banner") || document.getElementById("main");
    target?.focus({ preventScroll: true });
  }
  // A verdict that took focus is the answer to what was just done: it is
  // brought into view, never left below the fold. Instant, so nothing animates.
  if (target?.classList.contains("verdict-banner")) target.scrollIntoView({ block: "nearest" });
}

/** Say something to a screen reader without moving focus. */
export function announce(text) {
  const el = document.getElementById("live");
  if (!el) return;
  el.textContent = "";
  setTimeout(() => { el.textContent = text; }, 30);
}

// What is in front of you, so a render can tell a new question or screen from
// the same one drawn again (a toggle, a tick, an answer).
let shownView = null;
function viewKey() {
  const at = App.screen === "drill-run" ? App.queue[App.idx]
    : App.screen === "mock-run" ? App.mock?.items[App.mock.idx]
    : App.screen === "lab-run" ? { pbq: App.lab } : null;
  return [App.screen, App.screen === "mock-run" ? App.mock?.idx : App.idx, at?.item?.id || at?.pbq?.id || at?.pbq || ""].join("|");
}

export function renderApp() {
  const root = document.getElementById("app");
  const had = focusKey(document.activeElement);
  root.className = "";

  // Focus mode: chrome recedes while a question is actually in front of you,
  // and comes back for the lab, the bank and the summary screens.
  const drilling = ["drill-run", "mock-run", "mock-review"].includes(App.screen);
  document.body.classList.toggle("drilling", drilling);

  root.innerHTML = sidebarHtml(App) + `<main id="main" tabindex="-1">${SCREENS[App.screen](App)}</main>`;
  shownSync = sync.getStatus();
  // A new question or screen starts at the top; the same one drawn again keeps
  // its scroll. The first render of the page is not a change of view.
  const view = viewKey();
  const fresh = shownView !== null && view !== shownView;
  shownView = view;
  if (fresh) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  restoreFocus(had, fresh);
  tickTimer();
}


// --- timers ---------------------------------------------------------------
// Updated in place rather than through renderApp(), so they never steal focus
// from a field you are typing in.
export function tickTimer() {
  const el = document.getElementById("pbq-timer");
  if (!el) return;
  if (!App.pbqStartedAt) { App.pbqStartedAt = Date.now(); }
  const target = Number(el.dataset.target || 480);
  const elapsed = Math.floor((Date.now() - App.pbqStartedAt) / 1000);
  const mm = Math.floor(elapsed / 60), ss = String(elapsed % 60).padStart(2, "0");
  el.textContent = `${mm}:${ss} / ${Math.round(target / 60)}:00`;
  el.classList.toggle("warn", elapsed > target);
}

// The status dot follows the sync module on the same one second tick as the
// timers, so nothing has to subscribe to anything.
let shownSync = null;
export function tickSync() {
  const s = sync.getStatus();
  if (s === shownSync) return;
  shownSync = s;
  const el = document.getElementById("sync-foot");
  if (el) el.innerHTML = syncFootHtml();
}
