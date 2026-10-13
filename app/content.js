// Content loader. Everything under content/ is plain JSON, and the server
// hands all of it over in one response: GET /api/content is the whole bank,
// rebuilt when a file changes and answered with 304 when this browser already
// holds it. Adding content is adding a file; the app never carries a manifest.

import { hasGrader } from "./grade.js";

/**
 * Graded practice: an item that makes you choose between options and marks you
 * right or wrong. A revealed vocabulary card is not this, so it cannot stand in
 * for exam-shaped coverage of a domain.
 */
export const isGraded = (it) => typeof it.type === "string" && it.type.startsWith("mcq");

export async function loadContent() {
  // Default cache mode on purpose: the server tags the bundle, the browser
  // keeps it and asks first, and a reload is one 304 rather than 1.9 MB.
  const res = await fetch("/api/content");
  if (!res.ok) throw new Error(`Could not load content: ${res.status}`);
  const b = await res.json();
  const objectives = b.objectives;
  const glossary = b.glossary || {};

  // id -> the misconceptions it depends on, and why. Several edges can share a
  // head, so this is a many-to-many collapsed into one lookup.
  const prerequisites = {};
  for (const e of b.prerequisites?.edges || []) {
    for (const r of e.requires) (prerequisites[e.id] ||= []).push({ id: r, why: e.why });
  }

  const misconceptions = {};
  for (const m of b.mentor || []) misconceptions[m.id] = m;

  const items = b.items || [];
  // A PBQ whose kind has no engine in this build is listed in the lab, with
  // the reason, and nothing else ever sees it: not the queue, not a mock, not
  // readiness. The validator refuses such a file; this is for one added by hand.
  const pbqs = (b.pbq || []).filter(hasGrader);
  const pbqsWithoutEngine = (b.pbq || []).filter((p) => !hasGrader(p));

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
  for (const idx of b.index || []) {
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
    prerequisites, pbqsWithoutEngine,
    itemsById: Object.fromEntries(items.map((i) => [i.id, i])),
    pbqsById: Object.fromEntries(pbqs.map((p) => [p.id, p])),
  };
}
