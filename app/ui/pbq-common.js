import { esc, gloss, resultsHtml } from "./common.js";
import { wirelessHtml } from "./pbq-wireless.js";
import { aclHtml, aclTraceHtml } from "./pbq-acl.js";
import { diagramHtml } from "./pbq-diagram.js";
import { orderHtml } from "./pbq-order.js";

// The frame every PBQ shares: header, scenario, requirements, the engine's
// body, then the submit row or the graded card. Each engine owns its body.
export function pbqHtml(pbq, answers, { locked = false, graded = null, inExam = false } = {}) {
  const body =
    pbq.kind === "wireless-config" ? wirelessHtml(pbq, answers, locked)
    : pbq.kind === "acl-table" ? aclHtml(pbq, answers, locked)
    : pbq.kind === "drag-order" ? orderHtml(pbq, answers, locked)
    : diagramHtml(pbq, answers, locked);

  const reqs = (pbq.requirements || []).map((r) => `<li>${esc(r)}</li>`).join("");
  const target = Math.round((pbq.targetSeconds || 480) / 60);

  return `
  <div class="spread mb2">
    <h1>${esc(pbq.title)}</h1>
    <div class="row nowrap">
      <span class="tag">objective ${esc(pbq.objective)}</span>
      ${inExam ? "" : `<span class="tag" id="pbq-timer" data-target="${pbq.targetSeconds || 480}">0:00 / ${target}:00</span>`}
    </div>
  </div>
  <p class="sub">${gloss(pbq.scenario)}</p>
  ${reqs ? `<details class="card req-card" open>
      <summary><h2 class="eyebrow">Requirements</h2><span class="faint">${(pbq.requirements || []).length} to satisfy</span></summary>
      <ol class="req">${reqs}</ol>
    </details>` : ""}
  ${body}
  ${graded ? gradedHtml(pbq, graded)
    : inExam
      // No per-question submit inside a mock: the exam is scored at the end, and
      // getting used to leaving a PBQ unfinished and coming back is the skill.
      ? `<p class="faint">Answer what you can and move on. Nothing is scored until you submit the exam, and you can come back to this with Back.</p>`
      : `<div class="row">
         <button class="btn" data-action="pbq-submit">Submit</button>
         <span class="hint"><span class="kbd">&crarr;</span> to submit. Every subtask scores on its own, so answer all of them even where you are unsure.</span>
       </div>`}`;
}

function gradedHtml(pbq, g) {
  const tone = g.percent >= 90 ? "good" : g.percent >= 70 ? "warn" : "bad";
  return `
  <div class="card">
    <div class="spread">
      <div>
        <div class="score-big c-${tone}">${g.earned}<small>/${g.max}</small></div>
        <div class="faint">${{ good: "strong", warn: "partial", bad: "weak" }[tone]} &middot; ${g.percent}% &middot; partial credit applied per subtask</div>
      </div>
      <div class="row"><button class="btn" data-action="pbq-continue">Continue</button>
        <span class="hint"><span class="kbd">&crarr;</span></span></div>
    </div>
  </div>
  ${g.trace ? aclTraceHtml(g.trace) : ""}
  <div class="card"><h2 class="eyebrow">Scoring detail</h2>${resultsHtml(g.results)}</div>
  ${g.mentorHtml || ""}`;
}
