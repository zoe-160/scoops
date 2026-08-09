# Scoops adaptive learning v44

Date: 2026-08-09

## What changed

- Diagnostic result cards are now colored by actual performance instead of primary-goal status. Scores of 85% or higher use a green strength treatment; scores below 85% use a red needs-practice treatment; missing evidence stays neutral.
- The result screen no longer outlines a strong lowest-scoring skill in red merely because it became the primary goal.
- Diagnostic answer choices were audited for answer-length and effort clues. Vocabulary, morphology, comprehension, and text-evidence distractors were rewritten to be similarly detailed and similarly plausible.
- Diagnostic option buttons now share a consistent minimum height so one longer answer does not visually dominate the set.
- Existing v39 Targeted Phonics, Learn-card alignment, Word Builder purple identity, Spelling Bee behavior, quiz sound effects, Reading Detective independent-reading behavior, and other adaptive-learning features are preserved.

## Existing assets

Keep `Phonics.mp4`, `Vocab.mp4`, and `Spelling.mp4` beside `index.html`.


- Updated Fun with Phonics cover art to a green-and-white target with “PHONICS” curved above it on a green background.


## v44 Fun with Phonics renderer fix
- Removed the late CAT-art `v22PhonicsIcon()` renderer that was overriding the approved cover art.
- Fun with Phonics now renders a green-and-white target with PHONICS curved above it.
- The Fun with Phonics card is green from initial HTML paint and after adaptive learning-path refreshes.
- Added a final semantic guard so a later redraw cannot restore the old CAT art.


## v44 phone/tablet navigation

- On screens up to 1180 CSS px wide, the Home / Learn / Create / Friends navigation bar smoothly collapses when the reader scrolls farther down the content and reappears when the reader scrolls back upward.
- The Scoops logo/header remains visible.
- A movement threshold prevents flickering from tiny scroll motions.
- The navigation is always restored near the top of the page, when changing primary sections, and when returning to a desktop-width layout.
- Reduced-motion preferences disable the animation while preserving the behavior.


## v44 additions
- Fun with Phonics keeps its green card background but uses a more colorful coded target illustration with purple PHONICS lettering, a yellow bullseye, pink/purple/blue accents, and a blue/pink dart.
- Mobile/tablet navigation now uses touch direction plus a transition lock so its own height animation cannot immediately trigger the opposite scroll direction and make the bar flash back into view.
