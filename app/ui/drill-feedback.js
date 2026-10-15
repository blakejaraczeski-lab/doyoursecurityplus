import { esc, mentorCards } from "./common.js";

export function multiFeedbackHtml(App, it, chosenWrong, missed) {
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

export function feedbackHtml(App, chosen, correct) {
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
