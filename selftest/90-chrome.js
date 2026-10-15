// The sidebar's streak line: gentle, never a warning colour, and honest about a rest day.
import { streakStat } from "../app/ui/chrome.js";
import { say, check } from "./harness.js";

say("");
say("<b>The streak line is never a warning</b>");
{
  const tones = [
    ["a fresh record", { current: 0, best: 0, studiedToday: false, alive: false }],
    ["studied today", { current: 4, best: 6, studiedToday: true, alive: true }],
    ["a rest day, streak intact", { current: 4, best: 6, studiedToday: false, alive: true, restDay: true }],
    ["a lapsed streak", { current: 0, best: 12, studiedToday: false, alive: false }],
  ].map(([label, st]) => [label, streakStat(st)]);
  check(tones.every(([, s]) => s.tone !== "warn"), "no streak state is in the warning tone");
  check(streakStat({ current: 4, best: 6, studiedToday: true, alive: true }).tone === "good", "studying today is the one state that is marked good");
  const rest = streakStat({ current: 4, best: 6, studiedToday: false, alive: true, restDay: true });
  check(/rest/i.test(rest.label) && rest.value.includes("4"), "a rest day keeps the number and says it is a rest day", rest.label);
  const lapsed = streakStat({ current: 0, best: 12, studiedToday: false, alive: false });
  check(/best/i.test(lapsed.label) && lapsed.value.includes("12"), "a lapsed streak shows the best one instead of a zero", `${lapsed.label} ${lapsed.value}`);
  const fresh = streakStat({ current: 0, best: 0, studiedToday: false, alive: false });
  check(fresh.value.includes("0") && fresh.tone === "", "a fresh record shows a plain 0");
  const old = streakStat({ current: 3, studiedToday: false, alive: true });
  check(old.value.includes("3"), "a streak record without best or restDay still reads");
}
