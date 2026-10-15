import { App, renderApp, save, announce } from "../app.js";
import * as store from "../state.js";
import * as sync from "../sync.js";
import * as reviews from "../reviews.js";
import { startSession } from "./drill.js";

// What the last data action did, and the one confirmation waiting on an answer.
// Both live on App for the settings view to read: App.dataNote is { text, bad },
// App.dataPanel is { kind: "import", ... } or { kind: "reset" }.
const say = (text, bad = false) => { App.dataNote = { text, bad }; announce(text); };
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${store.today(d)}-${p(d.getHours())}${p(d.getMinutes())}`;
};
const refreshHealth = async () => { App.health = await sync.health(); renderApp(); };
// Move keyboard focus into the confirmation once it is on screen.
const focusPanel = () => requestAnimationFrame(() => document.querySelector("[data-panel] button")?.focus());
const failure = (r) => r.unreachable
  ? "The study server is not reachable, so no safety backup could be written."
  : `The safety backup could not be written (${r.error}).`;

/** Give the unsent rows every chance to reach the server; true when none are left. */
async function settle() {
  for (let i = 0; i < 3 && reviews.unsent(); i++) await reviews.flush();
  return !reviews.unsent();
}

// Leaving Settings drops whatever was pending or reported there, so it is not
// still on screen when the learner comes back. This runs before the nav handler.
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-action=nav]")) { App.dataPanel = null; App.dataNote = null; App.dateNote = null; }
});

export const actions = {
  export: async () => {
    App.dataPanel = null;
    const { rows, complete } = await reviews.everything();
    const name = `doyoursecurityplus-${stamp()}.json`;
    const blob = new Blob([store.exportState(App.state, rows)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    say(complete
      ? `Exported your progress and ${rows.length} logged answers to ${name}.`
      : `Exported to ${name}, but the study server could not be reached, so it holds only the ${rows.length} answers from the last 30 days that this browser has.`, !complete);
  },
  import: () => {
    App.dataNote = null;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      try {
        const read = store.importState(await input.files[0].text());
        App.dataPanel = { kind: "import", ...read, name: input.files[0].name };
        App.dataNote = null;
      } catch (e) { say(`Could not import: ${e.message}.`, true); }
      renderApp();
      if (App.dataPanel) focusPanel();
    };
    input.click();
  },
  "import-cancel": () => { App.dataPanel = null; },
  "import-confirm": async () => {
    const { state, rows } = App.dataPanel;
    App.dataPanel = null;
    // What is on disk now is copied first. An unreachable server is not a reason
    // to refuse: the disk copy is then not touched either. A server that could
    // not write the copy is.
    let backup = null;
    if (!store.SCRATCH) {
      const r = await sync.takeBackup("before-import");
      if (!r.ok && !r.unreachable) { say(`Nothing was changed. ${failure(r)}`, true); return; }
      backup = r.backup;
    }
    App.state = state;
    // A backup from before the log was its own resource carries its history
    // inside the document. Move it to the log first, or the server treats the
    // forced save as old code and refuses it, and the next boot undoes the restore.
    reviews.absorb(App.state);
    store.save(App.state);
    const stored = store.SCRATCH ? false : await sync.forcePush(App.state);
    reviews.adopt(rows);
    const logged = store.SCRATCH ? false : await settle();
    const open = Object.values(App.state.misconceptions).filter((m) => !m.retired).length;
    const what = `Imported ${Object.keys(App.state.items).length} items, ${open} open corrections and ${rows.length} logged answers.`;
    say(stored && logged
      ? `${what} Saved to disk.${backup ? ` What was here is kept in ${backup}.` : ""}`
      : `${what} It is in this browser only: the study server is not reachable. Start it and reload to save it to disk.`, !(stored && logged));
    refreshHealth();
  },
  reset: () => { App.dataNote = null; App.dataPanel = { kind: "reset" }; focusPanel(); },
  "reset-cancel": () => { App.dataPanel = null; },
  "reset-confirm": async () => {
    App.dataPanel = null;
    let backup = null;
    if (!store.SCRATCH) {
      // Let a request already on its way land first, so it cannot put old rows
      // back after the erase. If the erase is refused nothing is lost: the
      // unsent rows are still held and go out again.
      await reviews.quiesce();
      const r = await sync.eraseAll();
      if (!r.ok) {
        say(`Nothing was erased. ${failure(r)}`, true);
        reviews.flush();
        return;
      }
      backup = r.backup;
    }
    reviews.clear();
    App.state = store.resetState();
    App.introDismissed = false;
    try { localStorage.removeItem("dysp.intro"); } catch {}
    if (!store.SCRATCH) await sync.forcePush(App.state);
    startSession("drill");
    App.screen = "settings";
    say(`Everything is erased and you are starting clean.${backup ? ` A safety backup of what was here is ${backup}.` : ""}`);
    refreshHealth();
  },
};

/** A setting changed. Returns true if it was one. */
export function change(t) {
  if (!t.dataset.setting) return false;
  const k = t.dataset.setting;
  if (k !== "examDate") App.dateNote = null;
  if (k === "examDate") {
    // A date that cannot be used is not saved; the field goes back to the saved
    // one and says why, beside it.
    const why = store.examDateProblem(t.value);
    App.dateNote = why;
    if (why) { renderApp(); return true; }
  }
  App.state.profile[k] =
    k === "desiredRetention" ? Number(t.value)
    : k === "dailyReviewGoal" ? Number(t.value)
    : t.value || null;
  if (k === "pace") {
    const r = { bootcamp: 0.92, balanced: 0.9, longhaul: 0.88 }[t.value];
    if (r) App.state.profile.desiredRetention = r;
  }
  save();
  renderApp();
  return true;
}
