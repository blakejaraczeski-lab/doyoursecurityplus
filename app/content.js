// Content loader. Everything under content/ is plain JSON fetched at runtime,
// so adding items never means touching the app. The server lists the content
// directory, so a new file is picked up on the next load with no build step.

// Resolved against this module's own URL, so the app works no matter where the
// page that loads it lives.
const CONTENT = new URL("../content/", import.meta.url);

/**
 * Graded practice: an item that makes you choose between options and marks you
 * right or wrong. A revealed vocabulary card is not this, so it cannot stand in
 * for exam-shaped coverage of a domain.
 */
export const isGraded = (it) => typeof it.type === "string" && it.type.startsWith("mcq");

async function j(path) {
  const res = await fetch(new URL(path, CONTENT), { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

async function listing() {
  const res = await fetch("/api/content", { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not list content: ${res.status}`);
  return res.json();
}

export async function loadContent() {
  const files = await listing();
  const [objectives, mentorFiles, itemFiles, pbqFiles, indexFiles, prereqDoc, glossary] =
    await Promise.all([
      j("objectives.json"),
      Promise.all(files.mentor.map((f) => j(`mentor/${f}`))),
      Promise.all(files.items.map((f) => j(`items/${f}`))),
      Promise.all(files.pbq.map((f) => j(`pbq/${f}`))),
      Promise.all(files.index.map((f) => j(`index/${f}`).catch(() => null))),
      j("graph/prerequisites.json").catch(() => ({ edges: [] })),
      j("glossary.json").catch(() => ({})),
    ]);

  // id -> the misconceptions it depends on, and why. Several edges can share a
  // head, so this is a many-to-many collapsed into one lookup.
  const prerequisites = {};
  for (const e of prereqDoc.edges || []) {
    for (const r of e.requires) (prerequisites[e.id] ||= []).push({ id: r, why: e.why });
  }

  const misconceptions = {};
  for (const m of mentorFiles.flat()) misconceptions[m.id] = m;

  const items = itemFiles.flat();
  const pbqs = pbqFiles.flat();

  const objectiveById = {};
  const domainOf = {};
  for (const d of objectives.domains) {
    for (const o of d.objectives) {
      objectiveById[o.id] = { ...o, domain: d.id, domainTitle: d.title, weight: d.weight };
      domainOf[o.id] = d.id;
    }
  }

  // "Where do I read about this" pointers into study guides the user already
  // owns. Titles and page numbers only, never the content itself.
  const notesByObjective = {};
  const sources = [];
  for (const idx of indexFiles.filter(Boolean)) {
    const src = idx.source?.title || idx.source?.slug || "reference";
    sources.push(src);
    for (const s of idx.sections) {
      if (!s.objective) continue;
      (notesByObjective[s.objective] ||= []).push({ ...s, source: src });
    }
  }

  return {
    objectives, objectiveById, domainOf,
    misconceptions, items, pbqs, glossary,
    referenceSources: sources, notesByObjective,
    prerequisites,
    itemsById: Object.fromEntries(items.map((i) => [i.id, i])),
    pbqsById: Object.fromEntries(pbqs.map((p) => [p.id, p])),
  };
}
