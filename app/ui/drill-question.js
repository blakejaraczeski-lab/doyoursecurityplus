import { esc, gloss, objectiveLabel, mentorCardHtml, optionButton, presentOptions, KEYS } from "./common.js";
import { feedbackHtml, multiFeedbackHtml } from "./drill-feedback.js";
import * as mentor from "../mentor.js";

/**
 * Multiple-select. The exam calls it "choose two" and scores it all or nothing:
 * every required option and no extras. People lose these on format alone, by
 * answering the first correct option they see and moving on, so the UI makes the
 * count explicit and refuses to submit until it is met.
 */
export function mcqMultiHtml(App, entry) {
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


export function mcqHtml(App, entry) {
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


export function recallHtml(App, entry) {
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

export function mentorOnlyHtml(App, entry) {
  const card = mentor.card(entry.targetMisconception, App.content, App.state);
  return `
  <h1 class="sr-only">Correction: ${esc(card?.label || "")}</h1>
  <div class="row mb3"><span class="tag reason">${esc(entry.reason)}</span></div>
  <p class="sub">No other question in the bank tests this distinction yet, so here is the correction itself. Read it and it goes back into the schedule.</p>
  ${mentorCardHtml(card)}
  <div class="row"><button class="btn" data-action="mentor-ack">Got it</button></div>`;
}
