// Domains 1 and 2: the keyed option is not a giveaway, the distractor tags name the real slip,
// the whys teach, and the discriminations carry a one-line hook.
import { say, check, content } from "./harness.js";

say("");
say("<b>Domains 1 and 2: options, tags, whys and hooks</b>");
{
  const d12 = content.items.filter((i) => /^[12]\./.test(i.objective) && (i.type === "mcq" || i.type === "mcq-multi") && !i.source);
  const keyed = (i) => i.options.filter((o) => o.correct);
  const wrong = (i) => i.options.filter((o) => !o.correct);
  const len = (o) => o.text.length;

  const single = d12.filter((i) => i.type === "mcq");
  const longest = single.filter((i) => len(keyed(i)[0]) > Math.max(...wrong(i).map(len)));
  check(longest.length / single.length <= 0.4,
        `the keyed option is strictly the longest in at most 40% of single answer items (${longest.length} of ${single.length})`);

  const lopsided = single.filter((i) => len(keyed(i)[0]) > 20 && len(keyed(i)[0]) > 1.25 * Math.max(...wrong(i).map(len)));
  check(lopsided.length === 0, `no keyed option over 20 characters is 1.25 times longer than every distractor`, `(${lopsided.map((i) => i.id).join(", ")})`);

  const multi = d12.filter((i) => i.type === "mcq-multi");
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const skewed = multi.filter((i) => mean(keyed(i).map(len)) > 1.5 * mean(wrong(i).map(len)));
  check(skewed.length === 0, `no multi select item keys options averaging 1.5 times its distractors`, `(${skewed.map((i) => i.id).join(", ")})`);

  const tag = (id, opt) => content.items.find((i) => i.id === id).options.find((o) => o.id === opt).misconception;
  check(tag("sc2-109", "d") === "technical-vs-operational-vs-physical" && tag("sec-1.1-013", "d") === "technical-vs-operational-vs-physical"
        && tag("sc2-106", "b") === "technical-vs-operational-vs-physical",
        `a system chosen as a person's routine, or the reverse, banks the technical, operational, physical correction`);
  check(tag("fn-010", "b") === "deterrent-vs-preventive" && tag("fn-010", "c") === "deterrent-vs-preventive",
        `bollards and a vestibule chosen as deterrents bank deterrent versus preventive`);
  check(tag("cm-005", "d") === "change-management-elements" && tag("cr-003", "c") === "hashing-vs-encryption",
        `standard versus normal change and hashing as a key transport bank the matching corrections`);

  const hooked = d12.filter((i) => keyed(i).some((o) => o.why.includes("Remember: ")));
  check(hooked.length >= 55, `at least 55 items end the key's why with a one-line Remember hook (${hooked.length})`);
  check(d12.every((i) => keyed(i).every((o) => (o.why.match(/Remember: /g) || []).length <= 1)), `no item carries more than one hook`);

  const thin = d12.flatMap((i) => i.options.filter((o) => !o.correct && o.why.length < 45).map((o) => `${i.id}/${o.id}`))
    .filter((k) => ["th2-108/a", "th2-108/b", "c-036/d", "th2-106/d", "vt-007/c", "vt-007/d", "mx-006/c", "cr-005/c"].includes(k));
  check(thin.length === 0, `the distractor whys that only restated the stem now give the contrast`, `(${thin.join(", ")})`);

  const british = /organis|behaviour|authoris|tokenis|defence|programme|enrolment|judgement|national insurance/i;
  const touched = ["sec-1.1-010", "cr-016", "fn-006", "cr-005", "t-016", "ta-008", "mx-001", "c-008", "cm-006", "ch2-110"];
  check(touched.every((id) => !british.test(JSON.stringify(content.items.find((i) => i.id === id)))), `items edited in this pass use American spelling`);
  check(!d12.some((i) => /national insurance/i.test(JSON.stringify(i))), `no item names a UK national insurance number`);

  check(!/different thing from a collision/.test(content.items.find((i) => i.id === "t-016").options[3].text),
        `t-016 no longer carries its own refutation in the option text`);
}
