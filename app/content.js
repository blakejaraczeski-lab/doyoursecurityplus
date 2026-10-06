// Content loader. Everything under content/ is plain JSON fetched at runtime,
// so adding items never means touching the app.

// Resolved against this module's own URL, so the app works no matter where the
// page that loads it lives.
const CONTENT = new URL("../content/", import.meta.url);

async function j(path) {
  const res = await fetch(new URL(path, CONTENT), { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

export async function loadContent() {
  const manifest = await j("manifest.json");
  const [objectives, mentorFiles, itemFiles, pbqFiles, indexFiles, prereqDoc] = await Promise.all([
    j("objectives.json"),
    Promise.all(manifest.mentor.map((f) => j(`mentor/${f}`))),
    Promise.all(manifest.items.map((f) => j(`items/${f}`))),
    Promise.all(manifest.pbq.map((f) => j(`pbq/${f}`))),
    Promise.all((manifest.index || []).map((f) => j(`index/${f}`).catch(() => null))),
    j("graph/prerequisites.json").catch(() => ({ edges: [] })),
  ]);

  // id -> the misconceptions it depends on, and why. Several edges can share a
  // head, so this is a many-to-many collapsed into one lookup.
  const prerequisites = {};
  const dependents = {};
  for (const e of prereqDoc.edges || []) {
    for (const r of e.requires) {
      (prerequisites[e.id] ||= []).push({ id: r, why: e.why });
      (dependents[r] ||= []).push(e.id);
    }
  }

  const misconceptions = {};
  for (const m of mentorFiles.flat()) misconceptions[m.id] = m;

  const items = itemFiles.flat();
  const pbqs = pbqFiles.flat();

  // A recall card whose term has been turned into a discrimination question is
  // superseded: the derived question tests the same vocabulary in the shape the
  // exam actually uses, so serving both is just repeating yourself.
  const supersededRecall = new Set(
    items.filter((i) => i.derived && i.sourceItem).map((i) => i.sourceItem)
  );

  const objectiveById = {};
  const topicById = {};
  const domainOf = {};
  for (const d of objectives.domains) {
    for (const o of d.objectives) {
      objectiveById[o.id] = { ...o, domain: d.id, domainTitle: d.title, weight: d.weight };
      domainOf[o.id] = d.id;
      for (const t of o.topics) topicById[t.id] = { ...t, objective: o.id, domain: d.id };
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
    objectives, objectiveById, topicById, domainOf,
    misconceptions, items, pbqs,
    referenceSources: sources, notesByObjective, supersededRecall,
    prerequisites, dependents,
    itemsById: Object.fromEntries(items.map((i) => [i.id, i])),
    pbqsById: Object.fromEntries(pbqs.map((p) => [p.id, p])),
  };
}
