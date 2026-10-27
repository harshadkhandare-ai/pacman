# Funda Champ

Funda Champ is a mobile-first maze-chase game presented inside a retro yellow handheld console.

## Play locally

Open `index.html` directly, or serve the folder with any static web server.

## Controls

- Touch or click the D-pad to move.
- Swipe across the game screen to change direction.
- Use arrow keys or WASD on a keyboard.
- Use the small Play/Pause and How to Play buttons for game options.

The game uses the Web Audio API for its original chip-tune music and sound effects.

## Android haptics bridge

Every D-pad `pointerdown` requests a light native haptic. The game supports `AndroidBridge.haptic("light")`, a JSON `HAPTIC` action through `AndroidBridge.postMessage(...)` or `ReactNativeWebView.postMessage(...)`, and the legacy `Android.vibrate(12)` shape. `navigator.vibrate(12)` is used only as a browser fallback.

## Activity tracking

`tracking.js` sends gameplay to the Funda Activity Tracking API, `POST https://apip-preprod.classplusapp.com/funda/api/activity/events` (set `window.FUNDA_EVENTS_URL` before `tracking.js` loads to use another environment), with `app: "pacman"`.

Open the game with the player's Funda token:

```text
https://your-game.example/?token=FUNDA_JWT
```

The backend reads the player from the token. The token is kept in localStorage for reloads. Without a token, tracking stays off.

Each page load is one session (`session.sessionId`, `session.activeSeconds` = visible seconds so far). Events: `session_started`, `session_paused`, `session_resumed`, `session_ended`, `game_started {gameId, level}`, `level_completed {gameId, level, score, timeSpentSeconds}` and `game_ended {gameId, level, score, timeSpentSeconds, status}` where status is `game_over`, `restarted` or `abandoned`. Queued events are sent every 5 seconds in batches of up to 20; an empty batch every 30 seconds is the heartbeat.

The admin portal in `admin/` still reads the old Supabase project and does not show data sent to the Funda API.

## Admin analytics

Open `/admin/` to access the private Funda Champ analytics portal. It includes Overview and Users tabs, Today/Yesterday/Last 3 days/Last 7 days/custom filters, D0–D8+ retention, sortable player activity, and CSV export.

The dashboard accepts any valid email with the shared password `FundaChamp@2026`. The email is used only as the displayed admin identity. Supabase verifies the shared password against a private bcrypt hash before returning analytics; no Supabase Auth account or email confirmation is required.
