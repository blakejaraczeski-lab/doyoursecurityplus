# Content schema

Three content types. All are plain JSON, validated by `scripts/validate_content.py`
and written in one canonical shape by `scripts/format_content.py`: items and
misconceptions live in one file per objective (`content/items/4.1.json`,
`content/mentor/4.1.json`), keys in a fixed order, defaults left out.

## Misconception (`content/mentor/*.json`)

The heart of the system. A misconception is the *scheduled object*: what you
actually got wrong, independent of which item exposed it.

```jsonc
{
  "id": "wpa3-sae-vs-enterprise",
  "label": "WPA3-Personal (SAE) vs WPA3-Enterprise (802.1X)",
  "objective": "4.1",
  "topics": ["wi-fi-protected-access-3", "aaa-radius"],
  "severity": "high",              // high | medium | low: exam impact
  "mentor": {
    "diagnosis": "What you probably believed when you picked the distractor.",
    "contrast": [                  // side by side, the fastest way to kill a confusion
      ["Aspect", "WPA3-Personal", "WPA3-Enterprise"],
      ["Credential", "One shared passphrase", "Per user, from the identity store"]
    ],
    "rule": "One short rule of thumb you can recall under time pressure.",
    "tell": "The words in the question stem that should trigger this rule.",
    "trap": "Why the wrong answer looked right. Optional but high value."
  },
  "retireAfter": 3                 // clean passes on DISTINCT items to retire it; 2 is the default and is left out
}
```

`retireAfter` is why this is not Anki: the misconception is only retired after N
clean passes on **different** items that test the same discrimination, so you
cannot pass by memorising one card's shape.

## MCQ item (`content/items/*.json`)

```jsonc
{
  "id": "sec-4.1-012",
  "type": "mcq",                   // mcq | mcq-multi
  "objective": "4.1",
  "topics": ["wi-fi-protected-access-3"],
  "difficulty": 3,                 // 1-5, feeds the scaled score projection
  "stem": "The question text.",
  "options": [
    { "id": "a", "text": "...", "correct": true,
      "why": "Why this is right, in one or two sentences." },
    { "id": "b", "text": "...", "misconception": "wpa3-sae-vs-enterprise",
      "why": "Correction aimed at THIS error, not a restatement of the answer." }
  ],
  "selectCount": 2                 // mcq-multi only; absent on mcq
}
```

Rule: every wrong option carries a `misconception` id. An option without one is a
throwaway distractor, which is wasted teaching surface. The validator rejects it.

## PBQ (`content/pbq/*.json`)

```jsonc
{
  "id": "pbq-wireless-001",
  "kind": "wireless-config",       // wireless-config | acl-table | network-diagram
  "objective": "4.1",
  "topics": [...],
  "difficulty": 4,
  "title": "Short title shown in the lab list.",
  "scenario": "The corporate requirements, written like the real exam.",
  "targetSeconds": 480,            // 8 minutes, the exam pace target
  "config": { ... },               // kind specific: the interactive surface
  "solution": { ... },             // kind specific: what correct looks like
  "subtasks": [                    // partial credit, one entry per scoreable unit
    { "id": "st1", "label": "Authentication mode",
      "points": 2, "misconception": "wpa3-sae-vs-enterprise" }
  ]
}
```

Every subtask maps to a misconception, so a half correct PBQ still produces
precise remediation for exactly the half you missed.
