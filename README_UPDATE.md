# Scoops adaptive learning v36

Date: 2026-08-09

v36 is an interaction and layout update built on v35.

## What changed

- Spelling Bee now plays a short success tone for a correct spelling and a short fail tone for an incorrect spelling.
- Incorrect Spelling Bee entries briefly shake on the writing line while remaining red.
- On the third incorrect spelling attempt, the incorrect entry reacts first, then the correct spelling is revealed in red after the brief shake.
- Quiz controls now use the existing Scoops Sound effects preference for lightweight click feedback. Existing result tones remain distinct from the softer button click.
- Word Builder and Reading Detective answer selections now receive correct/incorrect result audio in addition to their visual feedback.
- Reading Detective no longer offers passage read-aloud controls. The passage must be read independently; question audio remains available.
- CASE EVIDENCE is now a real in-frame label rather than a negative-margin pseudo-element. It is stacked and centered directly above the grade-level passage pill.
- Vocabulary Vault's three ice-cream scoops are wider and positioned lower so they sit more naturally inside the bowl.
- v35 Learn-card artwork sizing, semantic Reading Detective magnifying-glass lock, adaptive placement logic, and existing Spelling Bee three-attempt behavior are preserved.

## Version

- package: 1.26.0
- build: adaptive-learning-v36-2026-08-09

## Existing assets

Keep `Phonics.mp4`, `Vocab.mp4`, and `Spelling.mp4` beside `index.html`. They are not replaced by this update.
