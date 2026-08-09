# Scoops adaptive learning v30

Date: 2026-08-08

v30 fixes the second-question Spelling Bee state bug and adds a focused visual polish pass.

## What changed

- Rebuilt the Spelling Bee next-word transition so every new word explicitly restores an enabled Check spelling button, an empty editable writing line, `Try 1 of 3`, unresolved state, and blank feedback.
- Next Word still appears only after the current word is resolved by a correct spelling or the third incorrect attempt.
- The Reading Detective `CASE EVIDENCE` label is inset from the left frame instead of touching the border.
- All four primary navigation tabs now use the same purple Home active-state gradient when selected. The inactive tabs keep their lighter individual accents.
- Vocabulary Vault now has richer coded cover art based on a colorful word vault with floating letter cards and sparkles.
- Spelling Bee now has richer coded cover art using a bee, writing page, pencil, and letter tiles.
- The richer Vocabulary Vault and Spelling Bee artwork is also used on their lesson/detail pages.
- No generated images were added; the new artwork is inline SVG/CSS.
- Existing adaptive diagnostic, Word Builder, Reading Detective, Parent Section, Mailpit, and report functionality is preserved.

## Required runtime files

- index.html
- server.js
- package.json
- Phonics.mp4 (keep your existing copy)
- Vocab.mp4 (keep your existing copy)
- Spelling.mp4 (keep your existing copy)

The preview HTML files, README, and validation TXT are reference files and are not required to run Scoops.
