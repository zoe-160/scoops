# Scoops adaptive learning v24

Date: 2026-08-08

v24 is an assessment-design update built on the completed v23 interface work. It addresses the placement, diagnostic-audio, passage-variety, and Reading Detective personalization concerns reviewed before editing.

## What changed

- Diagnostic spelling audio now says only the target word; it does not read the answer choices.
- Audio-required compound-word items say the target/question without reading the answer choices.
- Diagnostic adaptation is now skill-specific. A spelling mistake cannot lower the next comprehension item, and a vocabulary success cannot raise word-analysis difficulty.
- School grades K, 1, 2, 3, 4, and 5 now start separately instead of collapsing Grades 3–5 into one band.
- The diagnostic uses a 12-item core and can branch up to 16 items when a skill profile is uncertain or appears substantially below school grade.
- Diagnostic comprehension passages are drawn from a separate passage bank and are not repeated within the same diagnostic session.
- Diagnostic passages are separate from regular Reading Detective passages, preventing practice on a story already used for placement.
- Scoops no longer presents one mixed-skill average as an overall reading grade. It stores six skill-specific preliminary instructional starting points: Phonics, Word Analysis, Spelling, Vocabulary, Reading Comprehension, and Text Evidence.
- A result two or more grades below the child’s school grade is not shown as a definitive grade equivalent unless lower-level material was actually tested. Otherwise it is explicitly marked as needing more evidence.
- Strong spelling or vocabulary remains at its own level instead of being lowered because comprehension or word analysis is weak.
- Vocabulary Vault now builds its quiz pool from the saved Vocabulary starting point.
- Spelling Bee now builds its word pool from the saved Spelling starting point while preserving typed independent scoring and correction practice.
- Word Builder now pulls word-analysis practice from the saved Word Analysis starting point instead of the mixed overall band.
- Reading Detective uses the saved setup interests when choosing fresh passages. Available interests include Animals, Adventure, Fantasy, Science, Friendship, Humor, Mysteries, and Everyday life.
- Reading Detective tracks recent passage IDs and avoids repeating a passage until the grade-level pool has been used.
- The Parent Section now explains the child’s school grade separately from instructional starting points and shows the evidence used for each skill placement.

## Placement philosophy

This prototype now describes diagnostic results as preliminary instructional starting points, not standardized grade-equivalent scores. The Parent Section explicitly explains when more evidence is required.

## Files

- index.html — main v24 prototype
- ADAPTIVE_SETUP_AND_DIAGNOSTIC_PREVIEW.html — setup and redesigned diagnostic preview
- PERSONALIZED_LEARNING_PATH_PREVIEW.html — Parent Section instructional-profile preview
- READING_DETECTIVE_PREVIEW.html — interest-aware Reading Detective preview
- WORD_BUILDER_PREVIEW.html — Word Builder preview with v23 artwork retained
- V24_VALIDATION.txt — static validation notes

## Existing assets

Keep the existing Phonics.mp4, Vocab.mp4, and Spelling.mp4 tutorial files beside index.html when using the full project.
