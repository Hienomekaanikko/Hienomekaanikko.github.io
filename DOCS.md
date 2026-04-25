# Launchpad — Technical Documentation

## Table of Contents
1. [Overview](#overview)
2. [File Structure](#file-structure)
3. [Database & Storage](#database--storage)
4. [Launchpad Logic](#launchpad-logic)
5. [Sound Engine](#sound-engine)
6. [Effects System](#effects-system)
7. [Admin Panel](#admin-panel)
8. [Performance & Caching](#performance--caching)

---

## Overview

The app is a browser-based beat launchpad. Users browse themed sound packs, trigger looping audio samples in sync, and apply live effects. It is built in vanilla JS with Supabase as the backend (database, storage, auth).

Pages:
- `index.html` — landing page with pack previews and subscription flow
- `app.html` + `script.js` — the launchpad player
- `admin.html` — pack creation and management (admin only)
- `style.css` — shared styles for `app.html`

---

## File Structure

```
/
├── index.html        Landing page
├── app.html          Launchpad player UI
├── script.js         All launchpad logic and audio engine
├── style.css         Styles for the player
├── admin.html        Admin panel (self-contained)
└── assets/
    ├── landing-page.webp
    └── theme1-bg.webp
```

---

## Database & Storage

### Supabase Tables

#### `packs`
One row per launchpad theme.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key, also used as the storage folder name |
| `name` | text | Display name shown in nav arrows |
| `colors` | text[] | Array of 5 hex colors — one per row |
| `bg` | text[] | Array of 2 hex colors for gradient fallback `[top, bottom]` |
| `bg_image` | text | Public URL to background image in storage (nullable) |
| `body_class` | text | Optional CSS class applied to `<body>` for theme-specific overrides |
| `sort_order` | int | Controls left/right navigation order |
| `is_free` | bool | Whether the pack is accessible without a subscription |

#### `pack_sounds`
One row per sound slot per pack.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `pack_id` | uuid | Foreign key → `packs.id` |
| `slot` | int | Button slot number (1–25) |
| `file_path` | text | Storage path relative to the `soundpacks` bucket root |

#### `subscribers`
Tracks active subscriptions.

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | uuid | References Supabase auth user |
| `status` | text | `"active"` when subscribed |

### Supabase Storage

Bucket: `soundpacks`

All files for a pack live in a single folder named after the pack's UUID:

```
soundpacks/
└── {pack-uuid}/
    ├── bg.jpg          Background image
    ├── sound1.wav      Slot 1
    ├── sound2.wav      Slot 2
    └── ...
```

Legacy packs uploaded before this convention may have files under a name-based folder (e.g. `theme1/`). These still work as long as `pack_sounds.file_path` points to the correct location.

### How Data Flows into the App

1. On load, `fetchThemes()` fetches only `packs` metadata (no sounds yet)
2. When a theme is about to play, `ensureThemeSounds(theme)` fetches its `pack_sounds` rows
3. Sound URLs are constructed as: `STORAGE_BASE + file_path`
4. Audio files are fetched, decoded, and stored in `bufferCache`

---

## Launchpad Logic

### Grid Layout

The player has a 5×5 grid (25 buttons = 25 sound slots). Buttons are grouped into 5 rows:

```
Row 1: btn1  – btn5
Row 2: btn6  – btn10
Row 3: btn11 – btn15
Row 4: btn16 – btn20
Row 5: btn21 – btn25
```

Each row has its own audio chain: one GainNode (volume) → one BiquadFilterNode (low-pass) → AudioContext destination.

### One Sound Per Row Rule

Only one sound can play per row at a time. Pressing a button:
- If the row is empty → start that sound
- If the same sound is playing → stop it
- If a different sound is playing → stop the current one, start the new one

This is enforced by `rowActive[row]` which tracks `{ name, buttonId }` for each row.

### Master Clock & Sync

All loops are kept in sync via a shared master clock:

- `masterStartTime` — the Web Audio timestamp when the first loop started
- `masterLoopDuration` — the duration of the loop in seconds

When a new sound starts, `getNextStartTime()` calculates the next bar boundary:

```
nextBarTime = masterStartTime + (floor(elapsed / loopDuration) + 1) * loopDuration
```

The new source is scheduled to `start(nextBarTime)`, keeping all rows perfectly phase-aligned regardless of when you press buttons.

If no loops are playing, the first button press initialises the clock. When all rows are stopped, the clock resets.

### Theme Navigation

Themes are stored in the `themes` array ordered by `sort_order`. Left/right arrows call `switchTheme(-1)` or `switchTheme(1)`, which wraps around using modulo arithmetic. Navigation:

1. Instantly covers screen with a dark overlay
2. Fetches the new theme's sound URLs (if not already loaded)
3. Preloads the background image
4. Fades the overlay out once the background is ready
5. Loads sounds in the background (buttons dim until each sound is ready)

### Split Mode

The `SPLIT ½` button halves the loop length for all active sounds (`loopEnd = buffer.duration / 2`). This creates a half-time or double-time feel depending on the sounds. The master clock duration is also halved so sync is preserved.

---

## Sound Engine

### Audio Graph Per Row

```
AudioBufferSourceNode
        ↓
   GainNode (rowGains[row])       ← volume knob
        ↓
BiquadFilterNode (rowFilters[row]) ← LP filter knob
        ↓
  AudioContext.destination
```

Each row has its own gain and filter so effects are applied independently per row.

### Loading Sounds

`loadSound(name, url)` fetches and decodes an audio file:

1. Check `bufferCache` — if already decoded, reuse it
2. Otherwise `fetch(url)` → `arrayBuffer()` → `audioCtx.decodeAudioData()`
3. Store the decoded `AudioBuffer` in `bufferCache`
4. Attach to `sounds[name]`

### Playing & Stopping

`startLoop(name, buttonId)`:
- Creates a new `AudioBufferSourceNode` with `loop = true`
- Connects it to the row's GainNode
- Schedules `source.start(getNextStartTime())`
- Sets `loopEnd` based on split mode
- Animates the button (blink → active)

`stopLoop(name, force)`:
- If `force = true` (theme switch): stops immediately, resets gain
- If `force = false` (user press): fades out over `currentFadeTime` seconds, then stops

---

## Effects System

### Volume Knobs (VOL column)

Each knob maps 0–100 to gain 0.0–1.0:
```js
rowGains[row].gain.setValueAtTime(v / 100, audioCtx.currentTime)
```
Affects all sounds in the row equally.

### Low-Pass Filter Knobs (LP column)

Each knob maps 0–100 to filter frequency using an exponential curve:
```js
rowFilters[row].frequency.setValueAtTime(200 * Math.pow(100, v / 100), audioCtx.currentTime)
```
At 100 (fully open): ~20,000 Hz (inaudible cutoff, all frequencies pass).  
At 0 (fully closed): 200 Hz (only bass frequencies pass).  
The exponential curve gives natural-feeling control across the sweep.

### Stutter Effect (STU column)

One stutter button per row. State per row:
```js
{ mode: 0,    // 0 = off, or active divisor (4, 8, 16)
  depth: 4,   // saved divisor, persists when stutter is off
  source: null }
```

**Single tap** — toggles stutter on/off at current depth.  
**Double tap** — cycles depth: `1/4 → 1/8 → 1/16 → 1/4`.

**Activating stutter:**
- Waits for `getNextStartTime()` (next bar boundary)
- Regular source is scheduled to `stop(startTime)`
- A new looping source starts at the same time with `loopStart = 0`, `loopEnd = bufferDuration / divisor`

**Changing depth while active:**
- Same bar-boundary scheduling: old source stops, new source starts at identical `startTime`
- No audio gap, no sync drift

**Releasing stutter:**
- Stutter source stopped immediately
- Regular loop restarted via `startLoop()` (bar-synced)

**Auto-clear:** stutter is cleared automatically when switching sounds in a row or changing themes.

---

## Admin Panel

`admin.html` is a self-contained page. Only the admin email (`mikesuokas@gmail.com`) can access edit controls inside the player. Admin panel itself requires Supabase email/password login.

### Creating a Pack

1. Fill in Pack Name, Tag, Description
2. Toggle whether it's a free pack
3. Pick 5 row colours and 2 gradient background colours
4. Optionally upload a background image (JPG/PNG/WebP)
5. Drop sound files — name them `sound1.wav` through `sound25.wav` for auto slot detection, or assign slots manually
6. Click **Create Pack**

The upload flow:
1. INSERT into `packs` → get back the new `id`
2. If background image: delete any existing `bg.*` in `{id}/`, upload as `{id}/bg.{ext}`, UPDATE `packs.bg_image` with public URL + cache-bust timestamp
3. For each sound: upload to `{id}/sound{slot}.{ext}`, INSERT into `pack_sounds`

### Editing a Pack (in-player)

Admin users see **Edit Pack** button in the player. When active:
- Click any pad button → file picker → replaces that slot's sound (uploads to storage, upserts `pack_sounds` row, reloads buffer)
- **Change BG** → replaces background image (deletes old `bg.*`, uploads new, updates `packs.bg_image`)
- **Remove Pack** → deletes all storage files, all `pack_sounds` rows, the `packs` row, then navigates to the nearest remaining theme

### Renaming a Pack

Change `packs.name` directly in the Supabase dashboard. The new name appears in the nav arrows automatically on next page load.

---

## Performance & Caching

### Load Strategy

| Stage | What happens |
|-------|-------------|
| Page load | Fetch all `packs` metadata only (no sounds) |
| Theme selected | Fetch `pack_sounds` for that theme, load sounds in parallel |
| UI appears | As soon as background image is ready — sounds load behind the scenes |
| Buttons | Dimmed while loading, activate individually as each sound decodes |

### Buffer Cache

Decoded `AudioBuffer` objects are stored in `bufferCache` (a `Map` keyed by URL). On each theme load, `evictDistantBuffers()` removes decoded buffers for themes more than 1 step away from the current index. This keeps memory bounded to roughly 3 themes worth of audio (~15MB) regardless of how many packs exist.

### Adjacent Theme Prefetch

After a theme finishes loading, `prefetchAdjacentThemes()` silently fetches the left and right neighbours' sound files into the browser HTTP cache (max 4 concurrent requests per neighbour). When the user navigates, `decodeAudioData` still runs but the network fetch is instant from cache.

### Landing Page Preload

`index.html` silently fetches the first theme's sound files after the page loads, so the very first Play click benefits from cached files too.
