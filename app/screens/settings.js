import { App, renderApp, save } from "../app.js";
import * as store from "../state.js";
import * as sync from "../sync.js";
import * as reviews from "../reviews.js";
import { startSession } from "./drill.js";

export const actions = {
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
        // A backup from before the log was its own resource carries its history
        // inside the document. Move it to the log first, or the server treats the
        // forced save as old code and refuses it, and the next boot undoes the restore.
        reviews.absorb(App.state);
        store.save(App.state);
        await sync.forcePush(App.state);
        renderApp();
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

/** A setting changed. Returns true if it was one. */
export function change(t) {
  if (!t.dataset.setting) return false;
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
  renderApp();
  return true;
}
