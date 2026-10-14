// What every test file shares: the loaded content, and the two things a test does,
// say a line and check a condition. A test file is plain top-level code (see the
// loop in selftest.html); it imports what it needs from here and from ../app/.
import { loadContent } from "../app/content.js";

export const content = await loadContent();
export const lines = [];
export let failures = 0;
export const say = (s, cls) => lines.push(cls ? `<span class="${cls}">${s}</span>` : s);
export const check = (cond, label, detail = "") => {
  if (cond) say(`  ok   ${label}`, "ok");
  else { failures++; say(`  FAIL ${label} ${detail}`, "fail"); }
};
