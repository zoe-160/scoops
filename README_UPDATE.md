# Scoops adaptive learning v29

Date: 2026-08-08

v29 is a navigation-design update built on the v28 spelling and adaptive-learning behavior.

## What changed

- Replaced the old full-width grey navigation strip with a modern four-tab navigation inspired by the colorful, sleek Word Builder / Word Workshop styling.
- Navigation order is now **Home · Learn · Create · Friends** so learning comes before creation.
- Each tab has its own Scoops accent palette, subtle gradient, rounded card treatment, coded line icon, hover lift, and clearer active state.
- The navigation remains compact and responsive on phones and short landscape screens.
- Active-page matching now uses each tab's explicit page identifier and updates `aria-current` for accessibility.
- No generated images were added; all navigation artwork is coded SVG/CSS.
- Existing v28 Spelling Bee behavior remains intact: only `Correct!` or `Incorrect!` appears beneath the writing line, correct answers are green, wrong/revealed answers are red, and Next Word clears the old writing state before the next word.
- Existing adaptive diagnostic, Word Path, Word Builder, Reading Detective, Mailpit email, and progress-report behavior is preserved.

## Required runtime files

- index.html
- server.js
- package.json
- Phonics.mp4 (keep your existing copy)
- Vocab.mp4 (keep your existing copy)
- Spelling.mp4 (keep your existing copy)

The preview HTML files, README, and validation TXT are reference files and are not required to run Scoops.
