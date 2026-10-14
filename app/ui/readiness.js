import { esc, pct } from "./common.js";
import * as mentor from "../mentor.js";
import { readiness, coverageDeficit, hoursToReady } from "../scheduler.js";
import { today } from "../state.js";
import * as reviews from "../reviews.js";

// --- readiness -------------------------------------------------------------
/** The one number everything is judged by: hours of study left to the booking rule. */
let hoursMemo = { key: null, h: null };
function hoursHtml(App) {
  const key = `${App.state.updatedAt}|${today()}|${App.state.profile.examDate}|${reviews.rows("mock").length}`;
  if (hoursMemo.key !== key) hoursMemo = { key, h: hoursToReady(App.state, App.content, Date.now(), reviews.rows("mock")) };
  const h = hoursMemo.h;
  return h.reachable
    ? `${Math.max(1, Math.round(h.low))}<small> to </small>${Math.round(h.high)}<span class="u">h</span>`
    : `<span title="The bank can add ${h.available} of the ${h.gap} points needed">beyond the bank</span>`;
}
export function readinessView(App) {
  const r = readiness(App.state, App.content, Date.now(), reviews.count(), reviews.rows("mock"));
  const cov = coverageDeficit(App.state, App.content);
  const posOf = (score) => ((score - 100) / 800) * 100;

  const cells = Object.values(r.perObjective)
    .sort((a, b) => a.mastery - b.mastery)
    .map(
      (o) => `<div class="cell s-${o.status}${o.thin ? " is-thin" : ""}">
        <div class="spread"><b>${esc(o.objective)}</b><small>${o.status === "no-items" ? "&mdash;" : pct(o.mastery)}</small></div>
        <div class="bar"><span style="--w:${Math.round(o.mastery * 100)}%"></span></div>
        <small>${o.status === "no-items" ? "no items in the bank" : o.status}${
          o.itemsSeen ? ` &middot; ${o.itemsSeen}/${o.itemsAvailable} seen` : ""}${
          o.openMisconceptions ? ` &middot; ${o.openMisconceptions} open` : ""}</small>
        ${o.thin
          ? `<span class="thin-flag" title="${o.topicsCovered} of ${o.topics} blueprint topics have a graded item">bank thin &middot; ${pct(o.bankDepth)} of topics</span>`
          : ""}
        <div class="title">${esc(o.title)}</div>
      </div>`
    )
    .join("");

  const domains = App.content.objectives.domains
    .map((d) => {
      const c = cov[d.id];
      const dir = c.exhausted ? "bank empty"
        : c.deficit > 0.02 ? "under"
        : c.deficit < -0.02 ? "over" : "on target";
      return `<tr><td>${d.id}.0 ${esc(d.title)}</td><td class="mono">${pct(d.weight)}</td>
        <td class="mono">${pct(c.share || 0)}</td>
        <td class="faint">${dir}</td><td class="mono">${c.seen}/${c.available}</td></tr>`;
    })
    .join("");

  // Only suggest objectives you can actually act on. An objective with nothing
  // unseen left in the bank is a gap in the content, and sending you there is
  // sending you to re-read what you have already answered.
  const weakest = Object.values(r.perObjective)
    .filter((o) => o.itemsSeen > 0 && o.itemsSeen < o.itemsAvailable)
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 3);

  const c = reviews.calibration();
  const tone = c.overconfidence > 0.3 ? "bad" : c.overconfidence > 0.15 ? "warn" : "good";
  const roots = mentor.sharedRootCauses(App.state, App.content);

  // Order: the decision first (the forecast, the hours to book, the rule),
  // then where to spend the next session, then the per-objective picture.
  return `<h1>Readiness</h1>
  <p class="sub">The evidence so far: ${r.reviewCount} answer${r.reviewCount === 1 ? "" : "s"} in the last 30 days across ${r.objectivesSampled} of 28 objectives, and ${r.forecast.mocks || "no"} mock${r.forecast.mocks === 1 ? "" : "s"}.</p>

  ${r.bankDepth < 0.8 ? `<div class="card tight flag">
    <h2 class="eyebrow">What this score can and cannot see</h2>
    <p class="m0">Graded items reach <b>${r.topicsCovered} of ${r.topicsTotal}</b> blueprint topics (${pct(r.bankDepth)}).${
      r.emptyObjectives ? ` ${r.emptyObjectives} objective${r.emptyObjectives === 1 ? " has" : "s have"} no items at all.` : ""
    } ${r.thinObjectives} of 28 objectives are marked thin below. The estimate is an honest read of how you did on what exists, and the band is widened to carry the rest. A thin objective reading "strong" means you answered its items correctly, not that the topic is covered.</p>
  </div>` : ""}

  <div class="card">
    <div class="spread top">
      <div>
        <div class="score-big">${r.low}<small> to </small>${r.high}</div>
        <div class="faint">expected on exam day, 80% band &middot; pass line 750</div>
      </div>
      <dl class="side-stats inline">
        <div class="stat"><dt>Expected right</dt><dd class="${r.scaled >= 750 ? "good" : "warn"}">${pct(r.forecast.raw)}</dd></div>
        <div class="stat"><dt>Study hours to book</dt><dd>${hoursHtml(App)}</dd></div>
      </dl>
    </div>
    <div class="gauge">
      <div class="band" style="--l:${posOf(r.low)}%;--w:${Math.max(1.5, posOf(r.high) - posOf(r.low))}%"></div>
      <div class="pass" style="--l:${posOf(750)}%"></div>
    </div>
    <div class="gauge-scale"><span>100</span><span>750 pass</span><span>900</span></div>
    <p class="note">What you are likely to get right on the day: each graded item's chance from your accuracy on its objective and your memory of it decayed to the exam date, weighted by the exam's questions per objective and dragged by open corrections. ${r.forecast.mocks
       ? `${r.forecast.mocks} mock${r.forecast.mocks === 1 ? "" : "s"} in the last 30 days pull it toward their result.`
       : "No mock yet, so the band carries the model's own error; a full mock is the measurement that narrows it."}</p>
  </div>

  <div class="card tight">
    <h2 class="eyebrow">Book the exam when all three hold</h2>
    <ul class="stop-rule">${r.forecast.stop.rules.map((x) => `<li>
      <span class="mark sm ${x.met ? "ok" : "no"}" role="img" aria-label="${x.met ? "met" : "not met"}">${x.met ? "&check;" : "&times;"}</span>
      <span>${esc(x.text)}</span></li>`).join("")}</ul>
    <p class="note">Under the model, the first rule alone books an exam you would fail about one time in ten. The two mocks are what check the model; until they agree with it, treat the band as the model's opinion.</p>
  </div>

  ${r.objectivesSampled < 3
    ? `<p class="note">Where to spend the next session, and the picture per objective, appear once three objectives have answers; ${r.objectivesSampled} so far.</p>`
    : `${weakest.length
    ? `<div class="card tight"><h2 class="eyebrow">Spend your next session here</h2>
       <ol class="next-up">${weakest
         .map((o) => `<li>
            <span class="code">${esc(o.objective)}</span>
            <span class="what">${esc(o.title)}</span>
            <span class="mastery s-${o.status}">${pct(o.mastery)} ${o.status}</span>
          </li>`)
         .join("")}</ol></div>`
    : ""}

  <h2>Per objective</h2>
  <div class="heat">${cells}</div>`}

  ${c.answered >= 8 ? `<div class="card">
      <h2 class="eyebrow">Confidence calibration</h2>
      <div class="cal-grid">
        <div class="quad q-good"><b>${c.sureRight}</b><span>Sure and right</span><small>Secure</small></div>
        <div class="quad q-bad"><b>${c.sureWrong}</b><span>Sure and wrong</span><small>Dangerous: you will not look these up</small></div>
        <div class="quad q-warn"><b>${c.guessRight}</b><span>Guessed and right</span><small>Fragile: the score flatters you</small></div>
        <div class="quad"><b>${c.guessWrong}</b><span>Guessed and wrong</span><small>Honest gap, cheapest to fix</small></div>
      </div>
      <p class="note">When you say you are sure you are wrong <b class="c-${tone}">${pct(c.overconfidence)}</b> of the time (${{ bad: "high", warn: "watch", good: "low" }[tone]}), and ${pct(c.fragile)} of your guesses land. Both numbers should fall as you get ready; the first one matters more.</p>
    </div>` : ""}
  ${roots.length ? `<div class="card tight flag">
      <h2 class="eyebrow">One cause under several misses</h2>
      ${roots.slice(0, 3).map((r) => `<div class="root-cause">
        <b>${esc(r.def.label)}</b>
        <span>is still open and sits underneath ${r.blocks.length} other correction${r.blocks.length === 1 ? "" : "s"} you are carrying:
        ${r.blocks.slice(0, 4).map((b) => esc(App.content.misconceptions[b]?.label || b)).join("; ")}.</span>
      </div>`).join("")}
      <p class="note">Repairing the one underneath is worth more than drilling the ${roots[0].blocks.length} on top of it, and the queue will route you there first.</p>
    </div>` : ""}

  <h2>Domain balance</h2>
  <div class="card">
    <div class="scroll-x"><table class="grid">
      <thead><tr><th>Domain</th><th>Exam weight</th><th>Your share</th><th></th><th>Graded items seen</th></tr></thead>
      <tbody>${domains}</tbody></table></div>
    <p class="note">The drill queue biases new items toward whichever domain is furthest under its exam weight. Only graded practice counts here: a revealed vocabulary card does not cover a domain, because the exam never asks you to reveal anything.</p>
  </div>`;
}
