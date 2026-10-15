// Data safety, the pure parts: the streak across a short break, the exam date
// check, what an export holds and how it is read back, and the calibration
// readout's silence flag. The server, the reset and the import run in
// scripts/selftests/data_safety.py.
import { say, check } from "./harness.js";
import { DEFAULT_STATE, touchStreak, streakStatus, examDateProblem, exportState, importState } from "../app/state.js";
import { calibrationOf } from "../app/reviews.js";

say("");
say("<b>A short break does not end a streak</b>");
{
  const at = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);
  const s = structuredClone(DEFAULT_STATE);
  for (const d of [1, 2, 3, 4, 5]) touchStreak(s, at(2026, 10, d));
  check(streakStatus(s, at(2026, 10, 5)).current === 5, "five days in a row read 5");
  const rest = streakStatus(s, at(2026, 10, 7));
  check(rest.current === 5 && rest.alive && rest.restDay && !rest.studiedToday && rest.best === 5,
        "two days away is a rest day: still 5, alive, restDay, best 5", JSON.stringify(rest));
  check(streakStatus(s, at(2026, 10, 5)).restDay === false, "studied today is not a rest day");
  check(streakStatus(s, at(2026, 10, 8)).current === 5, "three days away still reads 5");
  const gone = streakStatus(s, at(2026, 10, 9));
  check(gone.current === 0 && !gone.alive && !gone.restDay && gone.best === 5, "four days away reads 0 and keeps best 5", JSON.stringify(gone));
  touchStreak(s, at(2026, 10, 7));
  check(s.streak.current === 6, "studying after a two day break carries the streak on to 6", `(got ${s.streak.current})`);
  touchStreak(s, at(2026, 10, 15));
  check(s.streak.current === 1 && s.streak.best === 6, "after a long gap it starts again at 1 and best stays 6", JSON.stringify(s.streak));
  check(["current", "best", "studiedToday", "alive", "restDay"].every((k) => k in streakStatus(DEFAULT_STATE)),
        "a fresh state has every field of the contract");
}

say("");
say("<b>An exam date that cannot be right is refused</b>");
{
  const now = new Date(2026, 9, 14, 9, 0, 0);
  check(examDateProblem("", now) === null, "an empty date clears it");
  check(examDateProblem("2026-10-14", now) === null, "today is allowed (the exam is today)");
  check(examDateProblem("2026-12-01", now) === null, "a date seven weeks out is allowed");
  check(examDateProblem("2025-01-01", now)?.includes("already passed"), "a past date is refused, with the reason");
  check(examDateProblem("2026-10-13", now) !== null, "yesterday is refused");
  check(examDateProblem("2028-06-01", now)?.includes("18 months"), "a date past 18 months is refused");
  check(examDateProblem("2028-04-14", now) === null && examDateProblem("2028-04-15", now) !== null, "the limit is 18 calendar months");
  check(examDateProblem("20261201", now) !== null && examDateProblem("2026-13-45", now) !== null, "a malformed date is refused");
}

say("");
say("<b>An export is the whole record, and reads back</b>");
{
  const state = structuredClone(DEFAULT_STATE);
  state.items["c-001"] = { seen: 2, correct: 1, wrong: 1, lastSeen: 5 };
  state.misconceptions["m-1"] = { retired: false };
  const rows = [{ at: 1, kind: "item", id: "c-001", grade: 3 }, { at: 2, kind: "mock", scaled: 700 }];
  const back = importState(exportState(state, rows));
  check(back.rows.length === 2 && back.rows[1].kind === "mock", "the export carries the log rows, mock included");
  check(back.state.items["c-001"].seen === 2 && "m-1" in back.state.misconceptions, "and the state document");
  const legacy = importState(JSON.stringify(state));
  check(legacy.rows.length === 0 && legacy.state.items["c-001"], "a state-only file from before still imports, with no rows");
  const mixed = importState(exportState(state, [...rows, { nope: 1 }, "x"]));
  check(mixed.rows.length === 2 && mixed.skipped === 2, "lines that are not rows are counted and left out", `(${mixed.rows.length}, ${mixed.skipped})`);
  let msg = "";
  try { importState("not json"); } catch (e) { msg = e.message; }
  check(msg.includes("not a doyoursecurityplus progress export") && !msg.includes("Unexpected"), "a non-JSON file gets a plain sentence", msg);
}

say("");
say("<b>Silence is not confidence</b>");
{
  const allSure = Array.from({ length: 60 }, (_, i) => ({ at: i, kind: "item", grade: i % 3 ? 3 : 1, conf: "sure" }));
  const c = calibrationOf(allSure);
  check(c.silent === true && c.guessShare === 0, "60 answers, none marked a guess: silent", JSON.stringify(c));
  const few = calibrationOf(allSure.slice(0, 20));
  check(few.silent === false, "20 answers is too few to call silent");
  const mixed = calibrationOf([...allSure, ...Array.from({ length: 6 }, (_, i) => ({ at: 100 + i, kind: "item", grade: 3, conf: "guess" }))]);
  check(mixed.silent === false && mixed.guessShare > 0.05, "a learner who does mark guesses is not silent", JSON.stringify(mixed));
}
