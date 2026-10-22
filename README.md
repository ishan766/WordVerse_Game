# Wordverse

A local-first word puzzle game with Daily Challenge, Classic, Hard Mode, and a 90-second Time Attack, plus private real-time Wordverse Arena rooms for two to four players. Solo modes, progress, settings, and the local leaderboard stay in the browser. Arena uses a separate Node.js server.

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

For multiplayer, run the Arena server in a second terminal:

```sh
npm run arena:dev
```

Open `http://localhost:5173` in two to four separate browser sessions. One player creates a room and shares its code or invite link; guests join and mark Ready, then the host starts. Solo Practice uses the existing Classic Play mode and does not need the server. On Windows PowerShell, use `npm.cmd` for these commands.

## Arena rules and architecture

- The Node server owns room membership, an unpredictable room code and reconnect token, the answer, validation, feedback, start/deadline, accepted guess sequence, and ranking. A client sees only its own guesses until the round ends.
- Rooms hold 2, 3, or 4 players. All connected players must be ready; only the host starts or rematches. Every player has six valid guesses. Standard or Hard Mode rules use the existing canonical evaluator and dictionary.
- Solvers rank above non-solvers; fewer valid guesses wins, then the server timestamp of the winning guess. Non-solvers rank by their strongest feedback (green = 2, yellow = 1); exact equal metrics share a rank. Solvers receive `max(20, 120 − 15 × (guesses − 1) − 10 × (rank − 1))` round points. Non-solvers receive 0.
- The server deadline is authoritative. Browser time is only a display estimate. One socket action is acknowledged before the client shows an accepted guess. Guess sequences and a 250 ms per-player throttle reject duplicates and rapid repeats.
- A disconnected player can resume with a per-tab session-stored 256-bit token while the room exists. Separate tabs can join as separate players. Lobbies expire after 30 minutes of inactivity, and disconnected lobby seats free up after 2 minutes; matches/results expire after 2 hours. The server stores rooms in memory, so a server restart ends all rooms. One server instance is supported; scaling to multiple instances needs a shared room store and Socket.IO adapter.
- Completed Arena rounds expose the answer and each player's own history to Word DNA. Shared Arena results omit the answer.

## Arena deployment

The Vite frontend can remain on Vercel, but Vercel's static frontend alone cannot host this long-running Socket.IO process. Deploy `npm run arena:start` as a persistent Node service with WebSocket support, using Node.js 20.19+ or 22.12+. The server uses `PORT`, then `ARENA_PORT`, then 3001. Configure `ARENA_ORIGINS` as a comma-separated list of exact frontend origins (for example your Vercel domain). The existing frontend variable is `VITE_ARENA_URL`; `.env.production` sets it to the deployed public Arena service at build time. A Vercel Production environment variable with the same name overrides that file, so keep its value synchronized. Redeploy the frontend after any change. Browsers on an HTTPS page require an HTTPS/WSS backend. The client shows a clear unavailable message if `VITE_ARENA_URL` is absent in production. For phone testing on a local network, set `ARENA_ORIGINS` to include the phone's frontend origin, such as `http://192.168.1.10:5173`; the dev client automatically uses the same host on port 3001. See `.env.example` for local configuration. The server health endpoint is `GET /health`; `/` returns 404 by design. Socket.IO uses its default `/socket.io/` transport path and `arena:action` / `arena:state` events.

For the current `https://wordversegame.vercel.app` frontend, `render.yaml` supplies a Render Web Service blueprint with the correct start command, health check, and exact allowed origins. It also preserves the earlier `https://word-verse-game.vercel.app` origin. The Render `ARENA_ORIGINS` value must be `https://wordversegame.vercel.app,https://word-verse-game.vercel.app` (no trailing slashes). If the live service has an environment override in the Render dashboard, update it there and redeploy the service; a GitHub push alone does not guarantee that a manually configured Render variable changes. The current backend is `https://wordverse-arena.onrender.com`. To enable public rooms after a fresh deployment:

1. In Render, create a Blueprint from the `ishan766/WordVerse_Game` GitHub repository. Wait for its Web Service to become healthy. Its `/health` endpoint should return `{"ok":true}`.
2. Check that the service's actual public URL matches `.env.production`; update `VITE_ARENA_URL` there if it changes.
3. In Vercel's Production environment variables, set `VITE_ARENA_URL=https://wordverse-arena.onrender.com` if you manage configuration in the dashboard. The committed `.env.production` supplies the same value when no dashboard override exists. Redeploy the frontend after saving or changing it; Vite embeds this variable during the build.
4. Reload the site, create a room, and join from another browser session. If the frontend domain changes, update `ARENA_ORIGINS` on the server to match the new exact origin.

The Blueprint uses Render's Free plan to avoid an automatic paid service. Free services can spin down after inactivity, and this Arena server keeps rooms only in memory, so a spin-down or redeploy ends active rooms. Use a continuously running single instance for a live competition demo.

On Windows PowerShell with script execution disabled, use `npm.cmd` in place of `npm`.

## Verify and build

```sh
npm test
npm run build
npm run arena:check
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
