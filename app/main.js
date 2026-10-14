import { loadContent } from "./content.js";
import * as store from "./state.js";
import * as sync from "./sync.js";
import * as reviews from "./reviews.js";
import { App, renderApp, save, tickTimer, tickSync } from "./app.js";
import { esc, setGlossary } from "./ui/common.js";
import * as drill from "./screens/drill.js";
import * as pbq from "./screens/pbq.js";
import * as lab from "./screens/lab.js";
import * as mock from "./screens/mock.js";
import * as bank from "./screens/bank.js";
import * as settings from "./screens/settings.js";

/** Where a section's nav button lands: back into whatever is in progress there. */
function sectionScreen(s) {
  if (s === "drill") return !App.queue.length ? "drill-home" : App.idx < App.queue.length ? "drill-run" : "drill-done";
  if (s === "lab") return App.lab ? "lab-run" : "lab-list";
  if (s === "mock") return !App.mock ? "mock-home" : App.mock.result ? "mock-result" : "mock-run";
  return s;
}

// `?` shows every acronym's expansion in place. A per-browser convenience, so
// it lives in localStorage and the page works without it.
let glossOpen = false;
try { glossOpen = localStorage.getItem("dysp.gloss") === "1"; } catch {}
function toggleGloss() {
  glossOpen = !glossOpen;
  try { localStorage.setItem("dysp.gloss", glossOpen ? "1" : "0"); } catch {}
  document.body.classList.toggle("gloss-open", glossOpen);
}

// The one-second tick: the PBQ clock, the mock clock and the sync dot.
setInterval(() => { tickTimer(); mock.tickMock(); tickSync(); }, 1000);

// --- actions --------------------------------------------------------------
// Each screen owns the handlers for its own buttons (app/screens/<screen>.js);
// only the two that belong to no screen live here.
const ACTIONS = {
  nav: (el) => { App.screen = sectionScreen(el.dataset.section); App.expanded = null; },
  reload: () => location.reload(),
  ...drill.actions,
  ...pbq.actions,
  ...lab.actions,
  ...mock.actions,
  ...bank.actions,
  ...settings.actions,
};

document.addEventListener("click", (e) => {
  const node = e.target.closest("[data-node]");
  if (node) { pbq.inspectNode(node.dataset.node); return; }
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  const r = fn(el);
  if (r instanceof Promise) r.then(renderApp); else renderApp();
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (pbq.change(t)) return;
  settings.change(t);
});

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const active = document.activeElement;
  const tag = active?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

  if (e.key === "?") { e.preventDefault(); toggleGloss(); return; }

  // A focused diagram host opens on Enter or Space, as it would on a click.
  const node = active?.closest?.("[data-node]");
  if (node && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pbq.inspectNode(node.dataset.node); return; }

  // A PBQ in front of you takes every key; otherwise the drill's item keys.
  if (pbq.keys(e, tag)) return;
  drill.keys(e);
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
  reviews.flush();
});

window.addEventListener("pagehide", () => {
  store.flush(App.state);
  sync.flushBeacon(App.state);
  reviews.flush();
});

// --- boot -----------------------------------------------------------------
(async () => {
  try {
    App.content = await loadContent();
    setGlossary(App.content.glossary);
    document.body.classList.toggle("gloss-open", glossOpen);

    // Reconcile the fast local copy with the durable one. Newest wins, and the
    // loser is never silently discarded: the server keeps snapshots either way.
    const remote = await sync.pull();
    if (remote && (remote.updatedAt || 0) > (App.state.updatedAt || 0)) {
      App.state = store.migrate(remote);
      store.flush(App.state);
      console.info("Restored newer progress from the study server.");
    } else if (App.state.updatedAt) {
      sync.push(App.state);
    }

    await reviews.load();
    const absorbed = reviews.absorb(App.state);
    const moved = store.migrateIds(App.state, App.content);
    const pruned = store.pruneOrphans(App.state, App.content);
    if (absorbed) console.info(`Moved ${absorbed} review row(s) out of the state document into the log.`);
    if (moved) console.info(`Moved ${moved} progress record(s) to renamed items.`);
    if (pruned) console.info(`Dropped ${pruned} progress record(s) for items no longer in the bank.`);
    if (absorbed || moved || pruned) save();
    sync.health().then((h) => { App.health = h; if (App.screen === "settings") renderApp(); });

    drill.startSession("drill");
    renderApp();
    performance.mark("dysp-interactive");   // the self test times boot against this
  } catch (err) {
    // There is no app to render: one sentence on which stage failed, and the
    // one thing that can be done about it from here. A page opened as a file
    // never reaches this, because the browser refuses the module script
    // itself; index.html's placeholder covers that case.
    const noContent = !App.content;
    document.getElementById("app").innerHTML =
      `<main><h1>Could not start</h1><div class="card">
       <p>${noContent
         ? `The study server at ${esc(location.host)} is not answering, so no content can load.`
         : "The content loaded, but the saved progress broke the start. Nothing has been written; the snapshots on disk are intact."}</p>
       <p class="faint">${noContent
         ? `Start it with <span class="mono">python3 serve.py</span> or <span class="mono">./scripts/service.sh restart</span>, then reload.`
         : `Reload once; if it happens again, restore a backup with <span class="mono">scripts/backup.py restore</span>.`}
       <span class="mono">${esc(err.message)}</span></p>
       <button class="btn" data-action="reload">Reload</button></div></main>`;
    console.warn("Could not start:", err);
  }
})();
