// Domain 3 and 4 distractors teach the correction for the mistake they make, not a neighbor's.
import { say, check, content } from "./harness.js";

say("");
say("<b>Domain 3 and 4 distractors name the correction they teach</b>");
{
  const item = (id) => content.items.find((i) => i.id === id);
  const tag = (id, opt) => item(id).options.find((o) => o.id === opt).misconception;
  const cards = new Map(Object.entries(content.misconceptions));
  const pinned = {
    "dp-007 b": "controls-by-requirement", "dp-007 c": "controls-by-requirement",
    "dp-002 b": "trade-secret-vs-patent", "dp-002 c": "trade-secret-vs-patent", "dp-002 d": "trade-secret-vs-patent",
    "a-012 b": "trade-secret-vs-patent",
    "a-021 b": "air-gap-attack-paths", "a-021 c": "air-gap-attack-paths", "a-021 d": "air-gap-attack-paths",
    "en2-102 a": "secrets-in-code", "en2-102 b": "secrets-in-code", "en2-102 c": "secrets-in-code",
    "w-015 b": "wireless-planning-vs-testing", "w-015 c": "wireless-planning-vs-testing", "w-015 d": "wireless-planning-vs-testing",
    "tn-007 d": "fail-open-vs-fail-closed", "am-003 c": "specialised-system-constraints",
    "as-003 c": "asset-lifecycle", "as-012 c": "asset-lifecycle", "rs-003 d": "capacity-planning-dimensions",
    "ec-010 c": "host-hardening-enforcement", "ir-001 d": "threat-hunting-vs-detection",
    "mo-001 d": "monitoring-tool-selection", "iv-010 c": "compromised-vs-affected",
  };
  const wrong = Object.entries(pinned).filter(([k, card]) => { const [id, o] = k.split(" "); return tag(id, o) !== card; });
  check(wrong.length === 0, `${Object.keys(pinned).length} audited distractors carry the correction that fits their mistake`,
        wrong.map(([k]) => k).join(", "));
  check([...cards.keys()].filter((k) => pinned && Object.values(pinned).includes(k)).length === new Set(Object.values(pinned)).size,
        "every pinned correction exists");
  const typeCard = cards.get("data-type-vs-classification");
  const stray = content.items.filter((i) => /^[34]\./.test(i.objective) && (i.options || []).some((o) => o.misconception === typeCard.id)
    && !i.topics.some((t) => typeCard.topics.includes(t)));
  check(stray.length === 0, "the type-versus-classification card is attached only to items about data types and levels", stray.map((i) => i.id).join(", "));
}
