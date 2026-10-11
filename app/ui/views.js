import { esc, pct, objectiveLabel, mentorCardHtml, sessionBarHtml, emptyState } from "./common.js";
import { pbqHtml } from "./pbq.js";
import * as mentor from "../mentor.js";
import { readiness, coverageDeficit } from "../scheduler.js";
import * as fsrs from "../fsrs.js";
import { streakStatus, reviewsToday, calibration } from "../state.js";

const KEYS = ["A", "B", "C", "D", "E", "F"];

const humanise = (ms) => {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min`;
  if (mins < 60 * 36) return `${Math.round(mins / 60)} h`;
  return `${Math.round(mins / 1440)} d`;
};

// --- drill ----------------------------------------------------------------
/**
 * Multiple-select. The exam calls it "choose two" and scores it all or nothing:
 * every required option and no extras. People lose these on format alone, by
 * answering the first correct option they see and moving on, so the UI makes the
 * count explicit and refuses to submit until it is met.
 */
function mcqMultiHtml(App, entry) {
  const it = entry.item;
  const ans = App.answer;
  const need = it.selectCount || 2;
  const picked = App.multiPicked || new Set();

  const opts = it.options
    .map((o, i) => {
      let cls = "";
      let mark = picked.has(o.id) ? "&check;" : "";
      if (ans) {
        if (o.correct) { cls = "correct"; mark = "&check;"; }
        else if (picked.has(o.id)) { cls = "wrong"; mark = "&times;"; }
      } else if (picked.has(o.id)) cls = "chosen";
      return `<button class="opt ${cls}" data-action="multi-toggle" data-opt="${esc(o.id)}" ${ans ? "disabled" : ""}
        role="checkbox" aria-checked="${picked.has(o.id)}">
        <span class="key" aria-hidden="true">${KEYS[i]}</span>
        <span>${esc(o.text)}</span>
        <span class="verdict" aria-hidden="true">${mark}</span>
      </button>`;
    })
    .join("");

  const chosenWrong = ans ? it.options.filter((o) => !o.correct && picked.has(o.id)) : [];
  const missed = ans ? it.options.filter((o) => o.correct && !picked.has(o.id)) : [];

  return `
  <div class="row" style="margin-bottom:var(--s3)">
    <span class="tag">${esc(objectiveLabel(App.content, it.objective))}</span>
    <span class="tag warn">choose ${need}</span>
    ${entry.reason ? `<span class="tag reason">${esc(entry.reason)}</span>` : ""}
  </div>
  <div class="card">
    <p class="stem">${esc(it.stem)}</p>
    <div class="opts" role="group" aria-label="Select ${need}">${opts}</div>
    ${ans ? "" : `<div class="row" style="margin-top:var(--s4);justify-content:space-between">
      <span class="faint">${picked.size} of ${need} selected</span>
      <button class="btn" data-action="multi-submit" ${picked.size === need ? "" : "disabled"}>
        Submit ${need}
      </button></div>`}
  </div>
  ${ans ? multiFeedbackHtml(App, it, chosenWrong, missed) : ""}`;
}

function multiFeedbackHtml(App, it, chosenWrong, missed) {
  const good = App.answer.correct;
  const cards = (App.answer.mentorIds || [])
    .map((id) => mentorCardHtml(mentor.card(id, App.content, App.state)))
    .join("");
  return `
  <div class="verdict-banner ${good ? "yes" : "no"}">
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
  ${cards}
  <div class="row"><button class="btn" data-action="next">Next</button>
    <span class="hint"><span class="kbd">&crarr;</span> to continue</span></div>`;
}

function mcqHtml(App, entry) {
  const it = entry.item;
  const ans = App.answer;
  const opts = it.options
    .map((o, i) => {
      let cls = "";
      let verdict = "";
      if (ans) {
        if (o.correct) { cls = "correct"; verdict = "&check;"; }
        else if (o.id === ans.chosen) { cls = "wrong"; verdict = "&times;"; }
      }
      return `<button class="opt ${cls} ${ans?.chosen === o.id ? "chosen" : ""}"
        data-action="answer" data-opt="${esc(o.id)}" ${ans ? "disabled" : ""}>
        <span class="key" aria-hidden="true">${KEYS[i]}</span>
        <span>${esc(o.text)}</span>
        <span class="verdict" aria-hidden="true">${verdict}</span>
      </button>`;
    })
    .join("");

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
  <div class="row" style="margin-bottom:var(--s3)">
    <span class="tag">${esc(objectiveLabel(App.content, it.objective))}</span>
    ${entry.reason && !drill ? `<span class="tag reason">${esc(entry.reason)}</span>` : ""}
  </div>
  <div class="card">
    <p class="stem">${esc(it.stem)}</p>
    <div class="opts">${opts}</div>
    ${ans ? "" : `<div class="row" style="margin-top:var(--s4);justify-content:space-between">
       <div class="hint">
         <span class="kbd">A</span><span class="kbd">B</span><span class="kbd">C</span><span class="kbd">D</span>
         <span>to answer</span></div>
       <button class="btn ghost small guess-toggle ${App.markedGuess ? "on" : ""}" data-action="toggle-guess">
         ${App.markedGuess ? "&check; Marked as a guess" : "I am guessing"} <span class="kbd">G</span>
       </button></div>`}
  </div>
  ${ans ? feedbackHtml(App, chosen, correct) : ""}`;
}

function feedbackHtml(App, chosen, correct) {
  const good = chosen?.correct;
  const cards = (App.answer.mentorIds || [])
    .map((id) => mentorCardHtml(mentor.card(id, App.content, App.state)))
    .join("");

  return `
  <div class="verdict-banner ${good ? "yes" : "no"}">
    <div class="mark" aria-hidden="true">${good ? "&check;" : "&times;"}</div>
    <div>
      <b>${good ? "Correct" : "Not correct"}</b>
      <p>${esc(good ? correct.why : chosen?.why || correct.why)}</p>
      ${!good ? `<p><b>The answer:</b> ${esc(correct.text)}</p>` : ""}
    </div>
  </div>
  ${App.answer.overconfident
    ? `<div class="verdict-banner" style="border-color:var(--bad);background:var(--bad-soft)">
        <div class="mark" style="background:var(--bad)" aria-hidden="true">!</div>
        <div><b>You were sure, and you were wrong</b>
        <p>This is the quadrant that costs marks on exam day. A gap you know about gets looked up; a belief you hold confidently does not. This correction is escalated and will come back sooner.</p></div></div>`
    : ""}
  ${App.answer.lucky
    ? `<div class="verdict-banner" style="border-color:var(--warn);background:var(--warn-soft)">
        <div class="mark" style="background:var(--warn)" aria-hidden="true">~</div>
        <div><b>Right, but you called it a guess</b>
        <p>Scored as correct and not counted toward clearing anything. A lucky answer is not evidence, so this comes back on a shorter interval than a confident one would.</p></div></div>`
    : ""}
  ${App.answer.rushed
    ? `<div class="verdict-banner" style="border-color:var(--warn);background:var(--warn-soft)">
        <div class="mark" style="background:var(--warn)" aria-hidden="true">!</div>
        <div><b>That took ${(App.answer.responseMs / 1000).toFixed(1)} seconds</b>
        <p>Too fast to have read the stem properly on a question at this difficulty. The constraint that decides these is usually in the second sentence, and pattern matching the options is exactly how the exam catches people.</p></div></div>`
    : ""}
  ${App.answer.retiredNote
    ? `<div class="verdict-banner yes"><div class="mark" aria-hidden="true">&starf;</div>
       <div><b>Misconception cleared</b><p>${esc(App.answer.retiredNote)}</p></div></div>`
    : ""}
  ${cards}
  <div class="row">
    <button class="btn" data-action="next">Next</button>
    <span class="hint"><span class="kbd">&crarr;</span> to continue</span>
  </div>`;
}

function recallHtml(App, entry) {
  const it = entry.item;
  const shown = App.answer?.revealed;
  return `
  <div class="row" style="margin-bottom:var(--s3)">
    <span class="tag">${esc(objectiveLabel(App.content, it.objective))}</span>
    <span class="tag">recall</span>
    ${entry.reason ? `<span class="tag reason">${esc(entry.reason)}</span>` : ""}
  </div>
  <div class="card">
    <p class="stem">${esc(it.term)}</p>
    ${shown
      ? `<p class="muted" style="margin:0">${esc(it.definition)}</p>
         ${it.aka ? `<p class="faint">Also written: ${esc(it.aka)}</p>` : ""}`
      : `<button class="btn ghost" data-action="reveal">Show answer</button>
         <div class="hint" style="margin-top:var(--s3)"><span class="kbd">Space</span><span>to reveal</span></div>`}
  </div>
  ${shown
    ? `<div class="row">
        <button class="btn ghost" data-action="grade" data-g="1">Again</button>
        <button class="btn ghost" data-action="grade" data-g="2">Hard</button>
        <button class="btn" data-action="grade" data-g="3">Good</button>
        <button class="btn ghost" data-action="grade" data-g="4">Easy</button>
        <span class="hint"><span class="kbd">1</span>&ndash;<span class="kbd">4</span></span>
      </div>`
    : ""}`;
}

function mentorOnlyHtml(App, entry) {
  const card = mentor.card(entry.targetMisconception, App.content, App.state);
  return `
  <h1 class="sr-only">Correction: ${esc(card?.label || "")}</h1>
  <div class="row" style="margin-bottom:var(--s3)"><span class="tag reason">${esc(entry.reason)}</span></div>
  <p class="sub">No other question in the bank tests this distinction yet, so here is the correction itself. Read it and it goes back into the schedule.</p>
  ${mentorCardHtml(card)}
  <div class="row"><button class="btn" data-action="mentor-ack">Got it</button></div>`;
}

export function drillView(App) {
  if (!App.queue.length) {
    const due = mentor.due(App.state, App.content).length;
    return `<h1>Drill</h1>
      ${emptyState({
        glyph: "&#9678;",
        title: due ? `${due} correction${due === 1 ? "" : "s"} are due` : "Ready when you are",
        body: due
          ? "Each one comes back on a different question from the one you missed, so you cannot pass by remembering the question."
          : "A session mixes due corrections, items coming up for review, and new coverage weighted toward the heaviest exam domains.",
        actions: `<div class="row" style="justify-content:center">
          <button class="btn" data-action="start-drill">Start a session</button>
          <button class="btn ghost" data-action="start-weak">Weak spots only</button></div>`,
      })}`;
  }
  if (App.idx >= App.queue.length) return sessionSummary(App);

  const entry = App.queue[App.idx];
  const s = App.sessionStats;
  const bar = sessionBarHtml({
    index: App.idx,
    total: App.queue.length,
    label: App.mode === "weak" ? "Weak spots" : "Drill",
    right: s.answered
      ? `<span class="faint">${s.correct}/${s.answered} correct${s.banked ? ` &middot; ${s.banked} banked` : ""}</span>`
      : "",
  });

  const body =
    entry.kind === "pbq"
      ? pbqHtml(entry.pbq, App.pbqAnswers, { locked: !!App.pbqGraded, graded: App.pbqGraded })
      : entry.kind === "mentor"
      ? mentorOnlyHtml(App, entry)
      : entry.item.type === "recall"
      ? recallHtml(App, entry)
      : entry.item.type === "mcq-multi"
      ? mcqMultiHtml(App, entry)
      : mcqHtml(App, entry);

  return bar + body;
}

function debriefHtml(App) {
  const s = App.sessionStats;
  const notes = [];
  const missObj = s.missesByObjective || {};
  const top = Object.entries(missObj).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2) {
    notes.push(`${top[1]} of your ${s.answered - s.correct} misses were in objective ${top[0]}, ${App.content.objectiveById[top[0]]?.title || ""}. That is a topic gap rather than bad luck.`);
  }
  if (s.rushed >= 2) {
    notes.push(`${s.rushed} answers came in under six seconds and were wrong. Slowing down on the stem is worth more marks right now than more questions.`);
  }
  if (s.banked > s.retired && s.banked >= 3) {
    notes.push(`You banked ${s.banked} corrections and cleared ${s.retired}. The bank is growing, which is normal early and is the thing to watch.`);
  }
  if (s.retired && s.retired >= s.banked) {
    notes.push(`You cleared ${s.retired} correction${s.retired === 1 ? "" : "s"} and banked ${s.banked}. Net, you are closing gaps faster than you are finding them.`);
  }
  if (!notes.length) return "";
  return `<div class="card tight"><h2 class="eyebrow">What this session showed</h2>
    <ul class="req" style="margin:0">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`;
}

function sessionSummary(App) {
  const s = App.sessionStats;
  const acc = s.answered ? s.correct / s.answered : 0;
  const st = streakStatus(App.state);
  return `<h1>Session complete</h1>
  <div class="card">
    <div class="spread">
      <div>
        <div class="score-big">${s.correct}<span class="faint" style="font-size:var(--t-xl)">/${s.answered}</span></div>
        <div class="faint">${pct(acc)} correct</div>
      </div>
      <dl class="side-stats" style="margin:0;min-width:230px">
        <div class="stat"><dt>Banked</dt><dd class="${s.banked ? "warn" : ""}">${s.banked}</dd></div>
        <div class="stat"><dt>Cleared</dt><dd class="${s.retired ? "good" : ""}">${s.retired}</dd></div>
        <div class="stat"><dt>Streak</dt><dd>${st.current} day${st.current === 1 ? "" : "s"}</dd></div>
      </dl>
    </div>
  </div>
  ${debriefHtml(App)}
  <div class="row">
    <button class="btn" data-action="start-drill">Another session</button>
    <button class="btn ghost" data-action="start-weak">Work the weak spots</button>
    <button class="btn ghost" data-action="go-readiness">See readiness</button>
  </div>`;
}

// --- PBQ lab ---------------------------------------------------------------
export function pbqLabView(App) {
  if (App.queue.length && App.queue[App.idx]?.kind === "pbq" && App.mode === "pbq") {
    return pbqHtml(App.queue[App.idx].pbq, App.pbqAnswers, {
      locked: !!App.pbqGraded, graded: App.pbqGraded,
    });
  }

  const byKind = {};
  for (const p of App.content.pbqs) (byKind[p.kind] ||= []).push(p);
  const KIND_LABEL = {
    "acl-table": "Firewall and ACL",
    "wireless-config": "Wireless configuration",
    "network-diagram": "Network diagram analysis",
  };

  const groups = Object.entries(byKind)
    .map(([kind, list]) => {
      const cards = list
        .map((p) => {
          const att = App.state.pbq[p.id]?.attempts || [];
          const best = att.length ? Math.max(...att.map((a) => a.percent)) : null;
          const badge =
            best === null ? `<span class="tag">not attempted</span>`
            : best >= 90 ? `<span class="tag" style="border-color:var(--good);color:var(--good);background:var(--good-soft)">best ${best}%</span>`
            : best >= 70 ? `<span class="tag warn">best ${best}%</span>`
            : `<span class="tag" style="border-color:var(--bad);color:var(--bad);background:var(--bad-soft)">best ${best}%</span>`;
          return `<div class="card tight"><div class="spread">
            <div>
              <b>${esc(p.title)}</b>
              <div class="faint">objective ${esc(p.objective)} &middot; ${Math.round(p.targetSeconds / 60)} min target &middot; difficulty ${p.difficulty}/5</div>
              <div class="row" style="margin-top:var(--s2)">${badge}${
                att.length ? `<span class="faint">${att.length} attempt${att.length === 1 ? "" : "s"}</span>` : ""
              }</div>
            </div>
            <button class="btn ${best === null ? "" : "ghost"} small" data-action="open-pbq" data-id="${esc(p.id)}">${att.length ? "Retry" : "Start"}</button>
          </div></div>`;
        })
        .join("");
      return `<h2>${esc(KIND_LABEL[kind] || kind)}</h2>${cards}`;
    })
    .join("");

  return `<h1>PBQ lab</h1>
    <p class="sub">Performance-based questions, graded per subtask with partial credit. Four to five of these open the real exam, and they are worth more than a multiple choice item, so the eight minute target matters.</p>
    ${groups || emptyState({ title: "No PBQs loaded", body: "Add JSON files under content/pbq and rerun build_manifest.py." })}`;
}

// --- mentor bank -----------------------------------------------------------
export function mentorView(App) {
  const openList = mentor.open(App.state, App.content);
  const retired = Object.entries(App.state.misconceptions).filter(([, r]) => r.retired);
  const now = Date.now();

  if (!openList.length && !retired.length) {
    return `<h1>Mentor bank</h1>
      ${emptyState({
        glyph: "&#9873;",
        title: "Nothing banked yet",
        body: "Every question you miss puts a targeted correction here and schedules it to come back on a different question.",
        actions: `<button class="btn" data-action="start-drill">Start drilling</button>`,
      })}`;
  }

  const sorted = openList
    .map((x) => ({ ...x, due: x.rec.due || x.rec.fsrs.due }))
    .sort((a, b) => a.due - b.due);
  const dueNow = sorted.filter((x) => now >= x.due).length;

  const cards = sorted
    .map((x) => {
      const overdue = now >= x.due;
      const needed = x.def.retireAfter ?? 2;
      return `<div class="card tight" style="border-left:3px solid ${overdue ? "var(--bad)" : "var(--line)"}">
        <div class="spread">
          <div>
            <b>${esc(x.def.label)}</b>
            <div class="faint">${esc(objectiveLabel(App.content, x.def.objective))}</div>
            <div class="row" style="margin-top:var(--s2)">
              <span class="tag ${x.def.severity === "high" ? "warn" : ""}">${esc(x.def.severity)} impact</span>
              <span class="tag">missed ${x.rec.hits}&times;</span>
              <span class="tag">${x.rec.cleanPasses.length}/${needed} clean</span>
              <span class="tag ${overdue ? "warn" : ""}">${overdue ? "due now" : `due in ${humanise(x.due - now)}`}</span>
            </div>
          </div>
          <button class="btn ghost small" data-action="expand-mc" data-id="${esc(x.id)}">${App.expanded === x.id ? "Hide" : "Open"}</button>
        </div>
        ${App.expanded === x.id ? mentorCardHtml(mentor.card(x.id, App.content, App.state)) : ""}
      </div>`;
    })
    .join("");

  return `<h1>Mentor bank</h1>
    <p class="sub">${openList.length} open, ${dueNow} due now, ${retired.length} cleared. A correction is only cleared after clean passes on <b>different</b> questions, so you cannot clear it by memorising the one you failed.</p>
    ${dueNow ? `<div class="row" style="margin-bottom:var(--s4)"><button class="btn" data-action="start-weak">Drill the ${dueNow} due now</button></div>` : ""}
    ${cards}
    ${retired.length
      ? `<h2>Cleared</h2><div class="card tight"><div class="row">${retired
          .map(([id]) => `<span class="tag">${esc(App.content.misconceptions[id]?.label || id)}</span>`)
          .join("")}</div></div>`
      : ""}`;
}

// --- readiness -------------------------------------------------------------
export function readinessView(App) {
  const r = readiness(App.state, App.content);
  const cov = coverageDeficit(App.state, App.content);
  const posOf = (score) => ((score - 100) / 800) * 100;

  const cells = Object.values(r.perObjective)
    .sort((a, b) => a.mastery - b.mastery)
    .map(
      (o) => `<div class="cell s-${o.status}${o.thin ? " is-thin" : ""}">
        <div class="spread"><b>${esc(o.objective)}</b><small>${o.status === "no-items" ? "&mdash;" : pct(o.mastery)}</small></div>
        <div class="bar"><span style="width:${Math.round(o.mastery * 100)}%"></span></div>
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

  return `<h1>Readiness</h1>
  <p class="sub">${r.confident
      ? "Based on enough reviews to mean something."
      : `Low confidence so far: ${r.reviewCount} reviews across ${r.objectivesSampled} of 28 objectives. The band narrows as you drill.`}</p>

  ${r.bankDepth < 0.8 ? `<div class="card tight" style="border-left:3px solid var(--warn)">
    <h2 class="eyebrow">What this score can and cannot see</h2>
    <p style="margin:0">Graded items reach <b>${r.topicsCovered} of ${r.topicsTotal}</b> blueprint topics (${pct(r.bankDepth)}).${
      r.emptyObjectives ? ` ${r.emptyObjectives} objective${r.emptyObjectives === 1 ? " has" : "s have"} no items at all.` : ""
    } ${r.thinObjectives} of 28 objectives are marked thin below. The estimate is an honest read of how you did on what exists, and the band is widened to carry the rest. A thin objective reading "strong" means you answered its items correctly, not that the topic is covered.</p>
  </div>` : ""}

  <div class="card">
    <div class="spread" style="align-items:flex-start">
      <div>
        <div class="score-big">${r.low}<span class="faint" style="font-size:var(--t-xl)"> to </span>${r.high}</div>
        <div class="faint">estimated scaled score &middot; pass line 750</div>
      </div>
      <dl class="side-stats" style="margin:0;min-width:220px">
        <div class="stat"><dt>Weighted mastery</dt><dd class="${r.scaled >= 750 ? "good" : "warn"}">${pct(r.mastery)}</dd></div>
        ${r.daysLeft != null ? `<div class="stat"><dt>Days to exam</dt><dd>${r.daysLeft}</dd></div>` : ""}
        <div class="stat"><dt>Reviews</dt><dd>${r.reviewCount}</dd></div>
      </dl>
    </div>
    <div class="gauge">
      <div class="band" style="left:${posOf(r.low)}%;width:${Math.max(1.5, posOf(r.high) - posOf(r.low))}%"></div>
      <div class="pass" style="left:${posOf(750)}%"></div>
    </div>
    <div class="gauge-scale"><span>100</span><span>750 pass</span><span>900</span></div>
    <p class="faint" style="margin:var(--s3) 0 0">An estimate from your own drilling, not a predicted exam score. It weights each objective by its real exam weight and drags on open misconceptions.</p>
  </div>

  ${(() => {
    const c = calibration(App.state);
    if (c.answered < 8) return "";
    const tone = c.overconfidence > 0.3 ? "bad" : c.overconfidence > 0.15 ? "warn" : "good";
    return `<div class="card">
      <h2 class="eyebrow">Confidence calibration</h2>
      <div class="cal-grid">
        <div class="quad q-good"><b>${c.sureRight}</b><span>Sure and right</span><small>Secure</small></div>
        <div class="quad q-bad"><b>${c.sureWrong}</b><span>Sure and wrong</span><small>Dangerous: you will not look these up</small></div>
        <div class="quad q-warn"><b>${c.guessRight}</b><span>Guessed and right</span><small>Fragile: the score flatters you</small></div>
        <div class="quad"><b>${c.guessWrong}</b><span>Guessed and wrong</span><small>Honest gap, cheapest to fix</small></div>
      </div>
      <p class="faint" style="margin:var(--s3) 0 0">When you say you are sure you are wrong <b style="color:var(--${tone})">${pct(c.overconfidence)}</b> of the time, and ${pct(c.fragile)} of your guesses land. Both numbers should fall as you get ready; the first one matters more.</p>
    </div>`;
  })()}
  ${(() => {
    const roots = mentor.sharedRootCauses(App.state, App.content);
    if (!roots.length) return "";
    return `<div class="card tight" style="border-left:3px solid var(--warn)">
      <h2 class="eyebrow">One cause under several misses</h2>
      ${roots.slice(0, 3).map((r) => `<div class="root-cause">
        <b>${esc(r.def.label)}</b>
        <span>is still open and sits underneath ${r.blocks.length} other correction${r.blocks.length === 1 ? "" : "s"} you are carrying:
        ${r.blocks.slice(0, 4).map((b) => esc(App.content.misconceptions[b]?.label || b)).join("; ")}.</span>
      </div>`).join("")}
      <p class="faint" style="margin:var(--s3) 0 0">Repairing the one underneath is worth more than drilling the ${roots[0].blocks.length} on top of it, and the queue will route you there first.</p>
    </div>`;
  })()}
  ${weakest.length
    ? `<div class="card tight"><h2 class="eyebrow">Spend your next session here</h2>
       <ol class="next-up">${weakest
         .map((o) => `<li>
            <span class="code">${esc(o.objective)}</span>
            <span class="what">${esc(o.title)}</span>
            <span class="mastery s-${o.status}">${pct(o.mastery)}</span>
          </li>`)
         .join("")}</ol></div>`
    : ""}

  <h2>Per objective</h2>
  <div class="heat">${cells}</div>

  <h2>Domain balance</h2>
  <div class="card">
    <div class="scroll-x"><table class="grid">
      <thead><tr><th>Domain</th><th>Exam weight</th><th>Your share</th><th></th><th>Graded items seen</th></tr></thead>
      <tbody>${domains}</tbody></table></div>
    <p class="faint" style="margin:var(--s3) 0 0">The drill queue biases new items toward whichever domain is furthest under its exam weight. Only graded practice counts here: a revealed vocabulary card does not cover a domain, because the exam never asks you to reveal anything.</p>
  </div>`;
}

// --- settings --------------------------------------------------------------
export function settingsView(App) {
  const p = App.state.profile;
  const c = App.content;
  const counts = {
    mcq: c.items.filter((i) => i.type === "mcq").length,
    recall: c.items.filter((i) => i.type === "recall").length,
    pbq: c.pbqs.length,
    mc: Object.keys(c.misconceptions).length,
  };
  const h = App.health;
  const st = streakStatus(App.state);

  return `<h1>Settings</h1>

  <h2 class="eyebrow">Exam and pacing</h2>
  <div class="card">
    <div class="field-row"><label for="f-date">Exam date</label>
      <input id="f-date" type="date" data-setting="examDate" value="${esc(p.examDate || "")}"></div>
    <div class="field-row"><label for="f-pace">Pace</label>
      <select id="f-pace" data-setting="pace">
        ${[["bootcamp", "Bootcamp (short steps, high intake)"],
           ["balanced", "Balanced"],
           ["longhaul", "Long haul (wide intervals)"]]
          .map(([v, l]) => `<option value="${v}" ${p.pace === v ? "selected" : ""}>${l}</option>`).join("")}
      </select></div>
    <div class="field-row"><label for="f-ret">Target retention</label>
      <select id="f-ret" data-setting="desiredRetention">
        ${[0.85, 0.88, 0.9, 0.92, 0.95].map((v) =>
          `<option value="${v}" ${p.desiredRetention === v ? "selected" : ""}>${Math.round(v * 100)}%</option>`).join("")}
      </select></div>
    <div class="field-row"><label for="f-goal">Daily review goal</label>
      <select id="f-goal" data-setting="dailyReviewGoal">
        ${[20, 30, 40, 60, 80, 120].map((v) =>
          `<option value="${v}" ${p.dailyReviewGoal === v ? "selected" : ""}>${v} reviews</option>`).join("")}
      </select></div>
    <p class="faint" style="margin:var(--s3) 0 0">No review is ever scheduled past your exam date. As the date approaches, every interval compresses to fit inside the time left.</p>
  </div>

  <h2 class="eyebrow">Where your progress lives</h2>
  <div class="card">
    ${h
      ? `<table class="grid"><tbody>
          <tr><td>Durable copy</td><td class="mono">${esc(h.stateFile || "")}</td></tr>
          <tr><td>Snapshots kept</td><td class="mono">${h.snapshots ?? 0}${h.newestSnapshot ? ` &middot; newest ${esc(h.newestSnapshot)}` : ""}</td></tr>
          <tr><td>Reviews on disk</td><td class="mono">${h.reviews ?? 0}</td></tr>
          <tr><td>Open / cleared</td><td class="mono">${h.misconceptionsOpen ?? 0} / ${h.misconceptionsRetired ?? 0}</td></tr>
        </tbody></table>
        <p class="faint" style="margin:var(--s3) 0 0">The browser keeps a fast copy and mirrors it to that file a second or two behind. Clearing site data no longer loses your history.</p>`
      : `<p class="muted" style="margin:0">The study server is not reachable, so progress is only in this browser right now. Start it with <span class="mono">./serve.sh</span> and reload.</p>`}
    <div class="row" style="margin-top:var(--s4)">
      <button class="btn ghost" data-action="export">Export a copy</button>
      <button class="btn ghost" data-action="import">Import</button>
      <button class="btn danger" data-action="reset">Reset everything</button>
    </div>
  </div>

  <h2 class="eyebrow">Consistency</h2>
  <div class="card">
    <dl class="side-stats" style="margin:0;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));display:grid">
      <div class="stat"><dt>Current streak</dt><dd class="${st.current ? "good" : ""}">${st.current} d</dd></div>
      <div class="stat"><dt>Best streak</dt><dd>${st.best} d</dd></div>
      <div class="stat"><dt>Days studied</dt><dd>${(App.state.streak?.days || []).length}</dd></div>
      <div class="stat"><dt>Reviews today</dt><dd>${reviewsToday(App.state)}</dd></div>
    </dl>
  </div>

  <h2 class="eyebrow">Content loaded</h2>
  <div class="card">
    <table class="grid"><tbody>
      <tr><td>Multiple choice items</td><td class="mono">${counts.mcq}</td></tr>
      <tr><td>Recall items (imported)</td><td class="mono">${counts.recall}</td></tr>
      <tr><td>Performance-based questions</td><td class="mono">${counts.pbq}</td></tr>
      <tr><td>Misconceptions with mentor guides</td><td class="mono">${counts.mc}</td></tr>
      <tr><td>Objectives / tagged topics</td><td class="mono">${c.objectives.counts.objectives} / ${c.objectives.counts.topics}</td></tr>
    </tbody></table>
    ${c.referenceSources?.length
      ? `<p class="faint" style="margin:var(--s3) 0 0">Page references available from: ${c.referenceSources.map(esc).join("; ")}</p>`
      : ""}
  </div>`;
}
