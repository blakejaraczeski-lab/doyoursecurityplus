// The mock measures the blueprint, and the forecast is about exam day.
import { isGraded } from "../app/content.js";
import { buildMock, examForecast, hoursToReady, PBQ_WEIGHT } from "../app/scheduler.js";
import { DEFAULT_STATE } from "../app/state.js";
import { minutesOf } from "../app/reviews.js";
import * as fsrs from "../app/fsrs.js";
import { say, check, content } from "./harness.js";

say("");
say("<b>The mock measures the blueprint, and the forecast is about exam day</b>");
{
  // Every domain's share of a full mock's points, PBQs counted at PBQ_WEIGHT.
  const pts = {};
  let total = 0, pbqs = 0, mocks = 20;
  for (let k = 0; k < mocks; k++) {
    for (const e of buildMock(content, { pbqCount: 5, total: 90 })) {
      const it = e.item || e.pbq;
      const w = e.pbq ? PBQ_WEIGHT : 1;
      pts[content.domainOf[it.objective]] = (pts[content.domainOf[it.objective]] || 0) + w;
      total += w;
      if (e.pbq) pbqs += 1;
    }
  }
  const off = content.objectives.domains.filter((d) => Math.abs(pts[d.id] / total - d.weight) > 0.01);
  check(off.length === 0 && pbqs === 5 * mocks,
        `a full mock's points match the domain weights to a point: ${content.objectives.domains.map((d) => `${d.id}:${(100 * pts[d.id] / total).toFixed(1)}%/${Math.round(d.weight * 100)}`).join(" ")}`);

  const now = new Date(2026, 9, 12, 12, 0, 0).getTime();
  const blank = structuredClone(DEFAULT_STATE);
  blank.profile.examDate = "2026-12-01";
  const fb = examForecast(blank, content, now);
  const held = structuredClone(blank);
  for (const it of content.items.filter(isGraded)) {
    held.items[it.id] = { seen: 4, correct: 4, wrong: 0, lastSeen: now,
      fsrs: { stability: 400, difficulty: 3, due: now + 300 * 86400000, lastReview: now, reps: 4, lapses: 0, state: "review" } };
  }
  const fh = examForecast(held, content, now);
  check(fb.scaled < 750 && !fb.stop.ready, `a blank record forecasts below the line (${fb.low} to ${fb.high}) and is not told to book`);
  check(fh.low >= 750 && !fh.stop.ready && fh.stop.rules[0].met && !fh.stop.rules[1].met,
        `everything held through the exam clears the band (${fh.low} to ${fh.high}) but still waits for two full mocks`);
  const mockRows = [{ at: now - 3 * 86400000, kind: "mock", format: "full", raw: 0.86, scaled: 816 },
                    { at: now - 86400000, kind: "mock", format: "full", raw: 0.88, scaled: 828 }];
  const fm = examForecast(held, content, now, mockRows);
  check(fm.stop.ready && fm.sd < fh.sd,
        `two full mocks above the line book it, and narrow the uncertainty (sd ${fh.sd.toFixed(3)} to ${fm.sd.toFixed(3)} raw)`);
  const low = examForecast(held, content, now, mockRows.map((m) => ({ ...m, raw: 0.6, scaled: 620 })));
  check(low.scaled < fh.scaled && !low.stop.ready, `two failing mocks pull the forecast down (${fh.scaled} to ${low.scaled}) and block booking`);

  const hb = hoursToReady(blank, content, now);
  const hh = hoursToReady(held, content, now);
  check(hb.reachable && hb.low > hh.low && hb.high > hb.low,
        `a blank record has ${Math.round(hb.low)} to ${Math.round(hb.high)} hours to the rule; everything held has ${hh.low.toFixed(0)} (the two mocks)`);

  const t0 = new Date(2026, 9, 12, 9, 0, 0).getTime();
  const m = minutesOf([
    { at: t0, kind: "item", ms: 30000, s: t0 },
    { at: t0 + 60000, kind: "item", ms: 9e6, s: t0 },                    // a tab left open: five minutes, not 150
    { at: t0 + 120000, kind: "misconception", grade: 1, s: t0 },          // logged with an answer: no time of its own
    { at: t0 + 4 * 3600e3, kind: "pbq", seconds: 420, s: t0 + 4 * 3600e3 },
    { at: t0 + 5 * 3600e3, kind: "mock", seconds: 1200 },
    { at: t0 + 5 * 3600e3, kind: "item", mock: true },                    // inside the mock's clock
  ]);
  check(m.sessions.length === 3 && Math.abs(m.total - (0.5 + 5 + 7 + 20)) < 1e-9,
        `time is counted per session from the log: ${m.sessions.map((x) => x.minutes.toFixed(1)).join(" + ")} = ${m.total.toFixed(1)} min`);
}
