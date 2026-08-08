# Scoops adaptive learning v25

Date: 2026-08-08

This update fixes a structural problem in v24: the v24 diagnostic redesign had been appended in a separate JavaScript scope and could not control the private diagnostic state used by the live onboarding flow. v25 moves the redesigned logic into the live adaptive-learning scope.

## Fixed

- All generated question speakers read the **question only**. Answer options are never enumerated by the diagnostic, Word Builder, or Reading Detective speakers.
- Spelling still speaks its hidden target word because hearing the word is the task; the visible spelling choices are never spoken.
- The diagnostic uses a 12-question skill-balanced core and can extend to **up to 27 questions** when any measured skill is low, mixed, or needs confirmation.
- Adaptive follow-ups are visibly labeled and balanced across weak skills instead of being limited mainly to comprehension/word analysis.
- Phonics, Word Analysis, Spelling, Vocabulary, Reading Comprehension, and Text Evidence maintain separate difficulty states.
- Diagnostic story families cannot repeat at a different grade in the same diagnostic, and the diagnostic passage bank is substantially larger.
- Reading Detective uses a larger separate practice bank and saved genre interests with passage history to reduce repetition.
- Word Builder answer events are recorded as **Word Analysis**, not Phonics.
- The Parent Section's “Why this word path” card now includes diagnostic evidence, what the path practices, why it remains independent from unrelated weak skills, what happens next, and a direct activity button.
- Existing pre-v25 accounts are clearly prompted to retake the diagnostic for the new grade-specific placement structure instead of silently presenting old results as current.

## Version

- Frontend: `adaptive-learning-v25-2026-08-08`
- package.json: `1.15.0`
- server health build: `adaptive-learning-v25-2026-08-08`

Keep the existing `Phonics.mp4`, `Vocab.mp4`, and `Spelling.mp4` beside `index.html`.

## Additional audit fixes

- The live v25 bindings are reapplied after the delayed legacy initializer so older spelling code cannot overwrite the skill-specific practice launcher.
- Reading Detective passage history now tracks story families across grade changes, not just grade-specific IDs.
- Parent priorities can update from new question-level activity evidence while diagnostic grade placements remain explicitly preliminary until a retake.
- Low performance is described as needing more evidence rather than implying mastery of a grade the child did not pass.
