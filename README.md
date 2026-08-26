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

## Supabase tracking

Tracking is stored in Supabase project `czzwqpyylagvannwsvix` in these tables:

- `pacman_user_activity`
- `pacman_game_sessions`
- `pacman_level_completions`
- `pacman_daily_activity`

Pass the application user ID in the game URL:

```text
https://your-game.example/?user_id=YOUR_USER_ID
```

The aliases `userId`, `userid`, and `uid` are also accepted. An embedding page can instead set `window.PACMAN_USER_ID` before `tracking.js` loads. If no valid ID is supplied, analytics tracking remains disabled for that browser and the visit is not counted in the admin portal.

The integration records user arrivals, game starts, level completions, final scores, session status, and active time spent. A heartbeat updates active sessions every 15 seconds. Daily activity is grouped in India Standard Time for date filters and cohort retention.

## Admin analytics

Open `/admin/` to access the private Funda Champ analytics portal. It includes Overview and Users tabs, Today/Yesterday/Last 3 days/Last 7 days/custom filters, D0–D8+ retention, sortable player activity, and CSV export.

The dashboard accepts any valid email with the shared password `FundaChamp@2026`. The email is used only as the displayed admin identity. Supabase verifies the shared password against a private bcrypt hash before returning analytics; no Supabase Auth account or email confirmation is required.
