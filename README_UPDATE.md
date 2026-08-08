# Scoops adaptive learning v26

Date: 2026-08-08

v26 is a corrective behavior and interface update built on the v25 adaptive-assessment redesign.

## What changed

- Diagnostic spelling audio reads the spelling question with the target word once. It never repeats the word and never reads answer choices.
- Spelling Bee audio now says the spelling question once (for example, “Spell the word carefully.”) without repeating the target or adding answer choices.
- Spelling Bee gives the reader up to three attempts on the same word. A wrong attempt leaves the input editable and keeps the same question.
- A correct spelling turns the reader’s answer green and unlocks Next.
- After three incorrect attempts, the correct spelling replaces the answer on the main writing line in orange and then unlocks Next.
- The obsolete three-line correction block is no longer part of the active flow.
- The grade-specific Spelling Bee pool is no longer overwritten by an older start function.
- Both old and current Parent Section renderers now populate “Why this word path” with diagnostic evidence, what the path practices, why it stays independent from comprehension placement, what happens as new evidence is collected, and a direct activity button.
- Word Path cards no longer stretch to match a taller neighboring card, eliminating the large empty area.
- Word Builder now has a Word Workshop quiz theme using Scoops’ existing purple, pink, and yellow visual language and word-part tile styling.
- Reading Detective now has a Case File quiz theme using Scoops’ blue/purple visual language, evidence styling, and detective-question framing.
- Existing v25 skill placements remain compatible; new diagnostics save v26 placement metadata.
- Existing adaptive diagnostic follow-up behavior remains active: 12 core questions with targeted follow-ups up to 27 when evidence is low, mixed, or needs confirmation.

## Required runtime files

- index.html
- server.js
- package.json
- Phonics.mp4 (keep your existing copy)
- Vocab.mp4 (keep your existing copy)
- Spelling.mp4 (keep your existing copy)

The preview HTML files, README, and validation TXT are reference files and are not required to run Scoops.
