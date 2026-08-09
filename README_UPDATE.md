# Scoops adaptive learning v34

Date: 2026-08-08

## What changed

- Reading Detective is permanently tied to the approved coded magnifying-glass artwork.
- Removed the positional Learn-card artwork fallback that could overwrite Reading Detective with the older phonics CAT artwork when it appeared as the fourth card.
- Added a semantic artwork guard that identifies Learn cards by activity/title instead of array position.
- Spelling Bee bee artwork was redrawn with a centered, horizontal, symmetrical stinger.
- Spelling Bee cover art is richer, with a bee, writing page, pencil, letter tiles, and accents while preserving the yellow activity identity.
- Vocabulary Vault cover art is richer, with a more dimensional red/coral vault, word-letter tiles, glow, and accents while preserving the red/coral activity identity.
- Existing v33 color-coded Learn cards and all adaptive-learning behavior are preserved.

## Runtime files

Use `index.html`, `server.js`, and `package.json` from this package. Keep the existing `Phonics.mp4`, `Vocab.mp4`, and `Spelling.mp4` files beside them.
