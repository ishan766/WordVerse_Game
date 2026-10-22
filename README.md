# Wordverse

A local-first word puzzle game with Daily Challenge, Classic, Hard Mode, and a 90-second Time Attack. Daily puzzles, scores, progress, settings, and the local leaderboard are stored in this browser. No account or backend is required.

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

On Windows PowerShell with script execution disabled, use `npm.cmd` in place of `npm`.

## Verify and build

```sh
npm test
npm run build
npm run preview
```

The production build is written to `dist/`. Once served and opened online, its service worker caches the app shell and built assets for later offline visits. External fonts fall back to system fonts offline.

## Game rules

- Six attempts to find a five-letter word. Correct positions are emerald; misplaced letters are cyan.
- Daily Challenge is selected from a frozen versioned word list using the player's local calendar date. Everyone with the same local date gets the same answer.
- Hard Mode requires all prior green positions and yellow letters, including repeated-letter quantities, in subsequent guesses.
- Each word offers one optional letter-position hint. A solved puzzle loses 35 points if a hint was used.
- Daily streaks count consecutive daily wins. Yesterday's streak remains available until the end of today; a missed day or daily loss breaks it.
- Time Attack lasts 90 seconds. Finish a word and press **Next word** to continue while time remains.
- Leaving Time Attack ends that timed run. Starting it again begins a fresh 90-second run; an interrupted run is not restored after refresh.
- If a completed Daily Challenge record survives but its saved board is unavailable or corrupt, the game keeps that date locked and shows an explanation instead of granting another attempt.
- The leaderboard is explicitly local to this browser. It does not compare scores across players.
- After finishing a puzzle, **Reveal your Word DNA** analyzes each guess against the versioned answer list. It shows candidate counts, expected Shannon information gain, a transparent 0–100 game score, letter usage, a rule-based solving style, and a supported improvement tip. Shared text and PNG cards omit the answer.

Word DNA treats every answer in the v1 list as equally likely. Its candidate counts are exact within that list, not estimates of every English word. Expected information gain is the prior `log₂(candidate count)` minus the partition-size-weighted expected posterior entropy. Observed information is the sum of `log₂(before / after)` along the actual guess trail. DNA score is `round(20 if solved + 35 × (7 − guesses) / 6 + 25 × min(1, observed bits / initial bits) + 20 × min(1, observed bits / (2 × guesses)))`. When the initial list has one answer, the uncertainty-removal fraction is defined as 1. Unsolved puzzles are capped at 49 and all scores at 100. Incomplete or inconsistent saved sessions show the available feedback without an invented score.

The answer list is `DAILY_WORDS_V1` in `src/words.ts`. A new list version and identifier should be used for any future changes after release, so past daily answers remain stable.
