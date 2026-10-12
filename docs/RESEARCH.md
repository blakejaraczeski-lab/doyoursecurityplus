# Research Loop: CompTIA Security+ SY0-701

Completed 2026-09-12. Everything below is verified against the official CompTIA
objectives document (stored in `reference/`) or multiple independent sources.

## 1. Exam facts that drive the build

| Fact | Value | Why it matters here |
|---|---|---|
| Exam code | SY0-701 (V7, launched Nov 2023, still current) | Content targets objectives v5.0 |
| Questions | Maximum of 90 | Mock exam mode caps at 90 |
| Time | 90 minutes | Mock exam timer, ~55 sec/question pace budget |
| Question types | Multiple choice + performance based | Two separate engines required |
| Scoring | Scaled 100 to 900, pass at 750 | Readiness projection reports a scaled estimate |
| Scaled scoring is weighted | Harder items are worth more | Projection must weight by item difficulty, not raw % |
| PBQ count | 1 to 10, typically 4 to 5 | Mock exam draws 4 to 5 PBQs |
| PBQ placement | Front loaded, at the very start | Mock exam presents PBQs first, with flag-and-return |
| PBQ weight | Commonly cited as 2x to 3x a multiple choice item | Scoring model weights PBQ subtasks accordingly |
| Partial credit | Exists on most PBQs (CompTIA does not publish specifics) | Graders must be per-subtask, never all-or-nothing |

## 2. Domain weights

| Domain | Title | Weight | Objectives |
|---|---|---|---|
| 1.0 | General Security Concepts | 12% | 4 |
| 2.0 | Threats, Vulnerabilities, and Mitigations | 22% | 5 |
| 3.0 | Security Architecture | 18% | 4 |
| 4.0 | Security Operations | 28% | 9 |
| 5.0 | Security Program Management and Oversight | 20% | 6 |

Domains 2, 4, and 5 are 70% of the exam. Domain 4 alone is 28% and holds 9 of the
28 objectives. The scheduler uses these weights so drilling time is spent where
score actually moves.

Full taxonomy: 28 objectives, 684 tagged sub-topics, in `content/objectives.json`.

## 3. Objective stems map to question style

The verb in each objective tells you what the exam can ask, which tells the item
author what shape the item must take.

- "Compare and contrast" (1.1, 2.1, 3.1, 3.3) produces discrimination items and
  drag-to-category PBQs. Distractors are the neighbouring concept.
- "Explain" / "Summarize" (most of domain 5) produces definition and
  best-fit-term items.
- "Given a scenario" (2.4, 3.2, 4.1, 4.5, 4.6, 4.9, 5.6) is where PBQs live.
  Eight of the 28 objectives carry this stem and they are the PBQ recruiting pool.

## 4. PBQ types actually reported on SY0-701

Confirmed recurring formats, in rough order of frequency:

1. Firewall / ACL rule table construction (order matters, implicit deny, least
   privilege, specific port and direction).
2. Log analysis: read firewall / auth / web logs, identify the attack, name the
   remediation.
3. Network diagram analysis: click hosts, identify the infected or misplaced
   device, apply the right containment action.
4. Drag and drop categorisation: threat actors, control types, attack names,
   incident response phases into ordered or bucketed slots.
5. Wireless access point configuration: WPA3, SAE vs Enterprise, 802.1X, EAP
   method, RADIUS server, band and SSID settings.
6. PKI / certificate troubleshooting: read certificate fields, spot the expiry,
   name mismatch, untrusted root, or missing SAN, pick the fix.
7. Secure protocol / port matching (insecure protocol to secure replacement).
8. IAM configuration: least privilege permission assignment, MFA factor
   selection, access control model choice.
9. Command output interpretation and light terminal simulation.

The three the user called out (wireless config, firewall ACL, malware on a
network diagram) are 1, 3 and 5 on that list, so they are the right first three
PBQ engines to build.

## 5. Scheduling algorithm

FSRS over SM-2. FSRS v5 models three variables per card (stability, difficulty,
retrievability) against SM-2's single ease factor, is MIT licensed with reference
implementations including JavaScript, and needs roughly 20 to 30% fewer reviews
for the same retention. Default parameters were trained on ~700 million reviews,
so it performs well before any personal optimisation. Decision: implement FSRS v5
with default parameters, log every review so parameters can be optimised later.

The twist for this build: the scheduler does not only schedule items, it
schedules **misconceptions**. See `docs/ARCHITECTURE.md`.

## 6. Content integrity rules

- CompTIA's policy treats verbatim exam content ("brain dumps") as grounds for
  revoking a certification. Every item in this bank is original, written to the
  published objective and sub-topic, never transcribed from a live exam or from
  a commercial question bank.
- The official objectives PDF in `reference/` is CompTIA copyright, kept locally
  as a personal study reference. Do not redistribute it with the app.
- Third party materials the user owns are used as **coverage and difficulty
  calibration references**. Items are rewritten from scratch against the
  objective, not paraphrased from the source.

## Sources

- [CompTIA Security+ SY0-701 Exam Objectives v5.0 (official PDF)](https://assets.ctfassets.net/82ripq7fjls2/6TYWUym0Nudqa8nGEnegjG/0f9b974d3b1837fe85ab8e6553f4d623/CompTIA-Security-Plus-SY0-701-Exam-Objectives.pdf)
- [Professor Messer SY0-701 course index](https://www.professormesser.com/security-plus/sy0-701/sy0-701-video/sy0-701-comptia-security-plus-course/)
- [Infosec Institute: navigating Security+ performance-based questions](https://www.infosecinstitute.com/resources/securityplus/security-exam-information-performance-based-questions/)
- [StationX: CompTIA Security+ performance-based questions](https://www.stationx.net/comptia-security-plus-performance-based-questions/)
- [FlashGenius: SY0-701 PBQ types and examples](https://flashgenius.net/blog-article/comptia-security-pbqs-explained-sy0-701-types-examples-and-how-to-prepare)
- [Anki FAQ: which spaced repetition algorithm](https://faqs.ankiweb.net/what-spaced-repetition-algorithm)
- [FSRS vs SM-2 comparison](https://www.antiagent.io/blog/fsrs-vs-sm2-spaced-repetition-algorithm)
- [CertVerdict: SY0-701 objectives and domains](https://certverdict.com/cert/security-plus-exam-objectives)
