# Scoops adaptive learning v53

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


## v45 Fun with Phonics renderer fix
- Removed the late CAT-art `v22PhonicsIcon()` renderer that was overriding the approved cover art.
- Fun with Phonics now renders a green-and-white target with PHONICS curved above it.
- The Fun with Phonics card is green from initial HTML paint and after adaptive learning-path refreshes.
- Added a final semantic guard so a later redraw cannot restore the old CAT art.


## v45 phone/tablet navigation

- On screens up to 1180 CSS px wide, the Home / Learn / Create / Friends navigation bar smoothly collapses when the reader scrolls farther down the content and reappears when the reader scrolls back upward.
- The Scoops logo/header remains visible.
- A movement threshold prevents flickering from tiny scroll motions.
- The navigation is always restored near the top of the page, when changing primary sections, and when returning to a desktop-width layout.
- Reduced-motion preferences disable the animation while preserving the behavior.


## v45 additions
- Fun with Phonics keeps its green card background but uses a more colorful coded target illustration with purple PHONICS lettering, a yellow bullseye, pink/purple/blue accents, and a blue/pink dart.
- Mobile/tablet navigation now uses touch direction plus a transition lock so its own height animation cannot immediately trigger the opposite scroll direction and make the bar flash back into view.


## v45 mobile/tablet navigation stability
- Touch direction is now the source of truth while swiping on phones/tablets.
- Scroll events caused by sticky-header resizing, momentum, or Safari bounce are suppressed during and immediately after a touch gesture.
- The near-top reveal rule no longer runs ahead of the transition lock.
- A single touch gesture can change the navigation state only once, preventing hide/reveal flicker.
- The older `overflow: visible !important` navigation rule is explicitly overridden while the bar collapses.


## v53 iPhone/iPad scroll stability

- Reviewed the supplied iPhone screen recording and confirmed that the visible jolt came from the navigation changing the sticky header's layout height while the page was actively scrolling.
- Mobile/tablet primary navigation is now absolutely positioned beneath the Scoops header instead of participating in header layout flow.
- Hiding/showing the bar now changes only transform and opacity; it never changes max-height, padding, margins, or sticky-header height.
- A fixed scrollable top spacer gives the visible navigation room at the top of a page and naturally scrolls away with the content, so there is no layout jump when the bar disappears.
- On touch-capable devices, Safari scroll/momentum/bounce events are no longer allowed to alter navigation state. Only the actual finger swipe direction can hide or reveal the bar.
- Trackpad/mouse direction detection remains available for compact non-touch screens.


## v53 refresh/session paint fix
- Active browser sessions are detected in the document head before the login screen can paint.
- Refreshing a signed-in Scoops page no longer intentionally renders the login screen first.
- The saved top-level page is preselected during startup while normal route restoration completes.
- Logged-out sessions still load the login screen normally.


## v53 layout update
- Drafts and review status now renders as one full-width vertical column instead of a two-card grid.
- Each story uses a long horizontal status row with the status badge, title, saved time, review timeline, and actions preserved.
- Narrow phones keep the same one-per-row structure and stack the row contents cleanly rather than reverting to square cards.


## v53 settings ownership update
- Removed the Reading level selector from Settings.
- Removed reading-level editing from the Settings > Edit profile modal.
- Removed the Settings shortcut for Reader setup and placement.
- Reader setup, placement, and diagnostic changes remain available from the Parent Section through Edit reader setup and Retake diagnostic.
- Saving child-facing Settings now preserves the existing reader placement instead of resetting it.


## v53 Explore book filters
- Added a Filter button directly beside the Explore search bar.
- Kids can combine Genre, Author, and Difficulty filters with search.
- Added Frequently Read discovery filtering.
- Added Hidden Gems filtering: Scoops-selected high-quality books with relatively low discovery/read counts.
- Hidden Gems and Frequently Read are mutually exclusive discovery modes, while the other filters can be combined.
- Filter controls are responsive on phones and tablets and include a visible active-filter count and clear action.


## v53 Create finish and publishing review
- Removed the rocket emoji from the Publish button.
- Finish now requires the child to choose a genre and write a book description.
- Genre and description are saved with the story and restored with drafts/versions.
- Publish now sends the story to the saved review queue, creates an in-app parent review notification, closes the preview, and opens a clear confirmation modal.
- The Parent Section story review queue now reflects stories actually submitted from Create.


## v53 compact draft/review rows
- Kept Drafts and review status as a single full-width vertical list.
- Reduced each story row height and vertical padding.
- Reorganized desktop rows so title/status and metadata/progress/actions share a compact two-line layout.
- Kept phone layouts single-column/stacked where needed without returning to oversized cards.


## v53 story review flow
- Widened the Review Your Story modal for the larger finish workflow.
- Added required Book title alongside Genre and Book description.
- Renamed Publish to Submit for Review.
- New submissions enter Scoops safety review first; account-supervisor approval is only enabled after that stage passes.
- Added a two-step explanation of Scoops safety review followed by account-supervisor review.
- Added `markScoopsSafetyReviewComplete(storyId, passed, reason)` as the integration hook for a future real moderation backend. The local prototype does not pretend that text/drawing moderation has actually occurred.
