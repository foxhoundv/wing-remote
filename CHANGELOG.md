# WING Remote — Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.3.64] — 2026-03-29

### Fixed (Architecture)

- **Hash discovery replaced with direct ordered-query mapping** — all previous
  correlation approaches (dump value matching, realtime range matching, snapshot
  comparison) were fundamentally flawed because they relied on value coincidence
  to identify parameters. Many parameters share the same dB value, causing wrong
  assignments and missed channels.

  The correct approach is simple: the V3.1.0 protocol doc gives us every OSC
  parameter path. We query each known path in order via OSC GET. Wing echoes
  each GET back on ChID 1 in the same order. We pair hash[i] → path[i] directly
  with no value comparison at all.

  `_build_hash_table()` fires after the ChID 1 subscription and queries ~280
  paths (faders, mutes, pans for all strip types). The hash table is fully
  populated in ~2 seconds. Results are cached to disk so subsequent sessions
  load instantly.

---

## [2.3.55] — 2026-03-29

### Fixed (Architecture)

- **Wing→Remote fader sync still not working** — the blob tree walk approach
  (v2.3.49–2.3.54) discovered 2640 paths but used the wrong hash namespace.
  Wing has two separate hash systems: blob-query node-tree hashes (used by
  OSC blob queries) and Audio Engine ChID 1 hashes (used for live push events).
  These are completely different 4-byte values for the same parameter.

  The correct hashes were visible in the log all along as "unknown hash"
  entries — `0xf7b4a715` and `0xfafd64cf` were the fader hashes Wing used
  during hardware fader moves. These appeared in the very first network
  capture from Wing Edit and throughout every diagnostic session.

  **New approach: value-correlation with the initial state dump.**
  When Wing Remote sends `DF D1 DA DC`, Wing immediately replies with a full
  dump of every Audio Engine parameter at its current value. Wing Remote
  captures all hash→value pairs from this dump (`_dump_capture`), then
  correlates them against `app_state.mixer` (populated by OSC bulk query)
  after 600ms. For each unique dB value in the dump that matches a known
  fader position, the hash is stored in `_hash_to_path`.

  This correctly identifies fader hashes without needing to know the hash
  algorithm or traverse the node tree. Fader positions are unique per channel
  so the match is unambiguous for all non-default faders.

- **Removed OSC blob tree walk** — `_walk_hash_tree`, `_parse_blob_children`,
  and related infrastructure removed. The temporary UDP socket on port 2228
  is no longer used.

---

## [2.3.49] — 2026-03-29

### Fixed

- **Hash table never populated — 0 paths mapped on startup** — v2.3.48's
  ordered-queue correlation assumed Wing would push NRP ChID 1 events in
  response to OSC GET queries. It doesn't. OSC (UDP 2223) and NRP (TCP 2222)
  are completely separate channels; Wing does not cross-post between them.
  The queue had 1776 unmatched GETs and 0 discovered hashes.

  Fixed with a proper **OSC blob tree walk** at startup, exactly as described
  in the V3.1.0 protocol docs. After the ChID 1 subscription is sent, Wing
  Remote opens a temporary UDP socket on port 2228 and sends `/<path> ,b DD`
  blob queries to Wing for each strip path (`/ch/1`, `/ch/2`, ..., `/dca/16`).
  Wing replies with a blob listing all child parameter hashes in the format:
  `DF <len> <4-zero> <4-byte hash> <2-zero> <name_len> <name> <label_len> <label>`.
  
  Wing Remote parses these replies and populates `_hash_to_path` with entries
  like `0xF7B4A715 → /ch/1/fdr`. Approximately 500+ parameters are mapped
  in ~5 seconds. Once populated, all ChID 1 NRP push events (`D7 <hash> D5
  <float32>`) are dispatched instantly to the correct handler.

  The tree walk runs as an asyncio task after TCP connect and repeats on
  reconnect. Port 2228 is only used during the walk (~5s) and then closed.

---

## [2.3.48] — 2026-03-29

### Fixed (Architecture)

- **Root cause of all fader sync issues identified and fixed** — a 40-second
  network capture (raw socket, all traffic to/from Wing ports 2222–2225)
  revealed that the OSC `/*S` subscription is not how fader push events work.
  There is zero OSC traffic during normal Wing operation. All parameter push
  events travel exclusively on **TCP port 2222, NRP binary protocol, ChID 1
  (Audio Engine)** — the same TCP connection Wing Remote already uses for
  hardware meter data.

  Wing Edit connects to TCP 2222 and sends `DF D1 DA DC` to subscribe to
  ChID 1. Wing then pushes `D7 <4-byte hash> D5 <float32>` tokens whenever
  any parameter changes — continuously, with no 10-second expiry, no
  keepalive required, and multiple clients coexist (each has its own TCP
  connection).

  Wing Remote was fighting a non-existent problem: the `/*S` OSC subscription
  never delivered fader push events at all. The fader sync that appeared to
  work was incidental or from the initial bulk query. The dropouts, the 13-
  second `/*S` disruption pauses, the keepalive tuning — all addressed a
  symptom of the wrong architecture.

### Changed

- **Removed OSC `/*S` subscription** — `subscription_keepalive()` is now a
  no-op stub. The `/*S` packet is no longer sent on connect, on setup apply,
  or periodically. The TCP keepalive `D4 00 00 00 01` (already sent every 4s
  by the meter engine) is sufficient to keep the TCP connection alive for
  both ChID 3 (meters) and ChID 1 (parameter pushes).

- **Added ChID 1 Audio Engine subscription** — after the ChID 3 meter
  subscription, `meter_engine()` now sends `DF D1 DA DC` on the same TCP
  connection. Wing immediately begins pushing all parameter changes (fader
  moves, mute toggles, pan changes, etc.) as NRP tokens on ChID 1.

- **Added NRP hash discovery** — Wing identifies parameters by 4-byte hash
  (Wing-internal node IDs, algorithm unknown). Wing Remote discovers the
  hash→path mapping at startup via ordered-queue correlation: each OSC GET
  sent during the bulk query is recorded in a deque; when Wing pushes an NRP
  event for an unknown hash, the next path in the deque is assigned to it.
  Wing responds to GETs in strict FIFO order so this correlation is exact.
  The `_hash_to_path` table is fully populated by the end of the bulk query
  (~540 paths). Hash table resets on TCP reconnect so discovery reruns.

---

## [2.3.47] — 2026-03-29

### Fixed

- **Fader positions wrong when Wing pushes values** — `_wing_db_to_raw()`
  was using an incorrect piecewise formula derived from the doc's SET
  command data points, not the actual raw values Wing uses internally.
  Wing push events carry dB values (e.g. `-20.3dB`) which must be
  converted to raw 0–1 for the UI. The old formula gave `0.462` for
  `-20.3dB` when Wing's actual raw position is `0.371` — a 10% error,
  making pushed fader positions visually wrong.

  Recalibrated against Wing's own bulk query replies (`,sff` format where
  `args[1]` is the authoritative raw 0–1 position):

  | dB    | Old raw | New raw | Actual |
  |-------|---------|---------|--------|
  | -0.2  | 0.708   | 0.745   | 0.745  |
  | -9.9  | 0.503   | 0.503   | 0.502  |
  | -20.3 | 0.462   | 0.367   | 0.371  |
  | -47.3 | 0.361   | 0.142   | 0.142  |

  New formula: linear `0.75 + dB * 0.025` from -10dB to +10dB (matches
  Wing exactly), and power law `0.5 * ((dB+144)/134)^3.86` below -10dB
  (matches Wing bulk query values within 1.5%).

- **Diagnostic fader push logging removed** — the `[OSC recv] push:
  /ch/N/fdr` log line added in v2.3.44 has served its purpose and is
  removed to reduce log noise.

---

## [2.3.46] — 2026-03-29

### Fixed

- **Periodic ~13-second push dropout caused by /*S renewal** — gap analysis
  of the push event log revealed that `/*S` causes a two-phase disruption:
  Phase 1: 7-8 second pause while Wing re-registers the subscription;
  Phase 2: 200ms burst of buffered events; Phase 3: 5-6 second second
  pause while Wing fully settles. Total: ~13 seconds of disrupted push
  stream every 8 seconds — far worse than letting the subscription expire
  (2 seconds of silence once per 10s).

  The gaps were spaced exactly 8 seconds apart, confirming the 8-second
  `/*S` renewal timer was the cause.

  Key insight: Wing's own push events reset its subscription timer. As
  long as Wing is sending data to us (fader moves, mute changes, bulk query
  replies), the subscription stays alive without any `/*S` from our side.
  When Wing goes quiet (nothing moving), we send a `/ch/1/fdr` GET every
  7 seconds — Wing answers, which resets the timer. `/*S` is only sent
  when Wing has been completely silent for 9+ seconds, meaning the
  subscription genuinely expired. The disruption is unavoidable at that
  point, but rare during normal use.

---

## [2.3.45] — 2026-03-29

### Fixed

- **Wing fader push stops mid-movement — subscription expiry** — the
  diagnostic log proved the push events ARE arriving at the backend
  (at ~125Hz during fader movement). They stopped at `02:56:36`, then
  7 seconds later the keepalive fired a `/ch/1/fdr` GET which came back
  — proving Wing is alive. But Wing had stopped pushing because the
  subscription expired at `02:56:42` (10s after `/*S` was sent at
  `02:56:32`).

  The two-tier keepalive logic was flawed: it used `last_osc_recv` to
  decide whether to send `/*S` or a GET. But `last_osc_recv` at the
  keepalive firing time (`02:56:43`) was only 7.26 seconds old — within
  the 9-second threshold — so it sent a GET instead of `/*S`. The
  subscription had already expired 1 second earlier.

  Root cause: `/*S` renewal must fire on its own independent 8-second
  timer based on when `/*S` was last sent — not on incoming traffic.
  GET queries and fader SETs do NOT reset Wing's subscription timer.
  Only `/*S` does.

  Fixed: added `app_state.last_sub_sent` — updated only when `/*S` is
  sent. The keepalive now fires `/*S` whenever `last_sub_sent` is 8+
  seconds old, unconditionally. A lightweight GET is sent as a
  supplementary inactivity ping only when `last_osc_sent` is 7+ seconds
  old AND the `/*S` renewal is not yet due.

---

## [2.3.44] — 2026-03-29

### Diagnostics

- **Fader push logging enabled** — all incoming `/ch/*/fdr` push events
  from Wing now log at INFO level as `[OSC recv] push: /ch/N/fdr args=[...]`.
  This makes Wing→Remote fader movement visible in `docker compose logs`
  so we can confirm whether push events are arriving at the backend and
  distinguish between: (a) Wing not pushing, (b) pushes arriving but not
  reaching the browser, or (c) pushes arriving and being processed but
  the browser not rendering them.

---

## [2.3.43] — 2026-03-29

### Fixed

- **Wing fader push stops after hardware fader goes still** — Wing only
  sends push events on parameter *change*, not continuously. Once the user
  stops moving a Wing fader, no more push events arrive. After 7 seconds
  of this silence, `last_osc_sent` (updated on incoming packets) goes stale
  and the keepalive fires `/*S`, causing Wing to re-register the subscription
  and pause pushes for ~2 seconds. The user then moves another fader on Wing
  Remote, which works, but moving the Wing fader again shows nothing.

  Fixed with a **two-tier keepalive**:

  - **Wing active** (`last_osc_recv` within 9s, `last_osc_sent` stale 7s+):
    Send a `/ch/1/fdr` GET query. This resets Wing's subscription timer
    harmlessly — Wing replies with the fader value, `datagram_received`
    processes it, `last_osc_sent` resets, and no push disruption occurs.

  - **Wing completely silent** (`last_osc_recv` older than 9s): The
    subscription has likely expired. Send `/*S` to re-establish it.
    This is the only situation where `/*S` is needed outside of the
    initial connection.

  The key insight: when Wing is actively pushing (even if just bulk query
  replies or the occasional mute/fader change), a GET is sufficient to
  keep the subscription timer alive. `/*S` is only needed for a true
  cold-restart of the subscription after genuine silence.

---

## [2.3.42] — 2026-03-29

### Fixed

- **7-second push dropout when Wing fader is moved** — incoming push
  events from Wing (fader moves on the hardware) were not updating
  `last_osc_sent`. So after the user stopped moving a fader in Wing
  Remote, `last_osc_sent` went stale and the keepalive fired `/*S`
  exactly 7 seconds later, causing Wing to re-register the subscription
  and pause pushes for ~2 seconds.

  Fixed: `datagram_received` now updates both `last_osc_recv` and
  `last_osc_sent` on every incoming Wing packet. Receiving a push event
  proves the subscription is alive — there is no need to send `/*S` while
  Wing is actively pushing to us. The keepalive now only fires during
  genuine silence (no packets in either direction for 7+ seconds).

- **Auto-discovery always sending default IP** — the `/api/setup/discover`
  endpoint was relying on the frontend to pass `?known_ip=`, but the
  frontend was fetching `/api/status` which returned `192.168.1.100` (the
  unconfigured default). Simplified: the endpoint now uses `WING_IP()`
  directly from server state — always current, no frontend coordination needed.

- **Auto-discovery failing on first run** — when Wing IP is the default
  `192.168.1.100`, unicast fails (nothing at that address) and
  `255.255.255.255` is blocked by Docker bridge networking. Added a third
  broadcast target: the server's own LAN subnet broadcast, derived by
  opening a dummy socket to detect the outbound LAN IP (e.g. the server
  is at `192.168.1.238`, so it broadcasts to `192.168.1.255`). This works
  through Docker bridge on first run without any IP configuration.

---

## [2.3.41] — 2026-03-29

### Fixed

- **Push dropout exactly 10s after connect** — the log proved the exact
  timing: `/*S` sent at `02:14:39` → subscription expires at `02:14:49`.
  Deep query ends at `02:14:42`. Keepalive was set to fire after 8 seconds
  of silence → fires at `02:14:50` — **1 second after expiry**. And even
  if it had fired in time, it sent a `/ch/1/fdr` GET query which does NOT
  reset the subscription timer (only `/*S`, `/*s`, or `/*b` do).

  Fixed both issues:
  1. Keepalive now sends plain `/*S` (not a GET query)
  2. Inactivity threshold tightened from 8s to **7s**, giving a 3-second
     safety margin against the 10-second expiry even with event loop jitter

  During active use (fader drags, mute presses) `last_osc_sent` is updated
  continuously and `/*S` never fires — no disruption during normal operation.
  The `/*S` only goes out during genuine idle periods.

- **Auto-discovery sending wrong IP** — the wizard fetched
  `?known_ip=192.168.1.100` (the form field default) instead of the
  server's actual configured Wing IP. Fixed to call `/api/status` first
  and use `wing_ip` from the response, so unicast discovery targets the
  real Wing IP even on first open.

---

## [2.3.40] — 2026-03-29

### Fixed

- **Wing→Remote push broken after setup apply** — `app_state.last_osc_recv`
  was not reset when `/api/setup/apply` was called. The probe loop uses
  `last_osc_recv` to shortcut connectivity checks — if Wing had sent any
  packet recently (e.g. meter UDP data arriving on the binary channel, or
  a GET reply from the keepalive), `last_osc_recv` would be non-zero, the
  probe loop would see `connected=True`, skip the state transition, and
  never send `/*S`. Without `/*S`, Wing never pushes OSC events.

  Fixed: `/api/setup/apply` now resets `last_osc_recv = 0.0` alongside
  `wing_connected = False`, forcing the probe loop through a full
  reconnect cycle that sends `/*S` and re-establishes the push subscription.

- **Wing auto-discovery fails in Docker bridge mode** — `255.255.255.255`
  broadcasts are confined to the Docker bridge network (`172.18.x.x`) and
  never reach the physical LAN. Added unicast and subnet broadcast targets:

  1. **Direct unicast to the configured Wing IP** — always works through
     Docker bridge since it routes as a normal UDP packet to the LAN
  2. **Subnet broadcast** derived from the configured IP
     (e.g. `192.168.1.162` → `192.168.1.255`)
  3. **255.255.255.255** global broadcast as last resort

  The wizard now passes the current Wing IP as `?known_ip=` to
  `/api/setup/discover` so the backend can use unicast. On first run
  (IP still at default `192.168.1.100`) only broadcasts are used.

---

## [2.3.39] — 2026-03-29

### Added

- **Wing auto-discovery in Setup Wizard** — when the wizard opens, it
  immediately sends a `WING?` UDP broadcast to port 2222 on the local
  network. If a Wing responds within 2 seconds, the network step shows:

  > ✓ Wing Found
  > Wing-fullsize (ngc-full)
  > IP: 192.168.1.162 · fw 1.07.2
  > [Connect to this Wing]  [Enter manually]

  Clicking "Connect to this Wing" applies the discovered IP immediately
  via `/api/setup/apply` and advances to the next step. The manual IP
  entry form only appears if no Wing is found within 2 seconds, or if
  the user clicks "Enter manually".

- **`/api/setup/discover` endpoint** — calls `discover_wing()` in
  `setup.py`, sends `WING?` broadcast to `255.255.255.255:2222`, and
  parses the Wing reply (`WING,<ip>,<name>,<model>,<serial>,<firmware>`).
  Returns `{found, ip, name, model, serial, firmware}` on success or
  `{found: false, message}` on timeout.

---

## [2.3.38] — 2026-03-29

### Changed

- **`/*S` now used only on initial connection and manual reconnect** —
  `/*S` is sent in exactly two places:
  1. `wing_probe_loop` when Wing first becomes reachable (or after a
     disconnect/reconnect cycle)
  2. The Setup Wizard apply path when the user changes the Wing IP

  The keepalive no longer sends `/*S` under any circumstances. Instead it
  sends a `/ch/1/fdr` GET query (12-byte address-only packet) after 8+
  seconds of inactivity. Any OSC packet sent to Wing — fader SET, mute,
  pan, GET query, or bulk query packet — resets Wing's subscription timer,
  so `/*S` is only needed when the connection is first established, not to
  maintain it.

  `last_osc_sent` is now updated in all three outgoing paths (normal
  `send_osc`, initial `/*S` on connect, and reconnect `/*S`) so the
  inactivity timer accurately reflects when Wing last heard from us.

---

## [2.3.37] — 2026-03-29

### Fixed

- **Subscription renewal now only fires during inactivity** — the periodic
  2-second pause every 7-9 seconds was caused by Wing internally
  re-registering the subscription every time it received `/*S`, even while
  fader moves and other packets were already keeping the subscription alive.
  The doc's "renew every 10 seconds" rule only applies when no other packets
  are being sent. Any OSC packet we transmit (fader SET, GET query, bulk
  query response) resets the Wing's subscription timer.

  Changed `subscription_keepalive` to track `app_state.last_osc_sent` — a
  timestamp updated on every outgoing OSC packet via `send_osc()`. The
  keepalive now checks every second and only sends `/*S` if we have been
  completely silent for 8+ seconds. During active use (fader dragging,
  button presses) the keepalive never fires and causes no disruption.

- **Meter renewal removed** — the Wing pushes meter data on its own
  schedule on ChID 3 of the TCP binary channel. There is no need to send
  renewal tokens; the TCP connection stays open as long as it is not
  explicitly closed. The 4-second meter renewal sends were unnecessary
  traffic on the binary channel.

---

## [2.3.36] — 2026-03-29

### Fixed

- **4-second dropout caused by /*S renewal** — the pattern of "4 seconds
  of working, then a pause" matches the 7-second renewal cycle exactly:
  7s interval − ~3s Wing re-registration pause = ~4s of clean signal between
  pauses. Every `/*S` renewal causes Wing to internally re-register the
  subscription, pausing push events for ~2-3 seconds regardless of whether
  the port-redirect prefix is used.

  Two changes to minimise impact:

  1. **Switched from `/%2224/*S` (12 bytes) to plain `/*S` (4 bytes)**.
     Sending from port 2224, plain `/*S` tells Wing "renew subscription,
     push to this source port (2224)" — identical behaviour to the
     port-redirect form but a simpler command that may cause less internal
     Wing state disruption.

  2. **Interval increased from 7s to 9s** — as close to the 10-second
     subscription timeout as safely possible, reducing dropout frequency
     from approximately once every 7 seconds to once every 9 seconds.
     The Wing re-registration pause (~2-3s) is unavoidable when `/*S`
     is received, so the only lever is how often it fires.

---

## [2.3.35] — 2026-03-29

### Fixed

- **Keepalive restored to `/*S` renewal** — the V3.1.0 doc specifies two
  distinct 10-second timers: (1) the TCP native binary connection inactivity
  timer, reset by any data on that TCP stream; and (2) the OSC `/*S`
  subscription timer, reset **only** by sending `/*S`, `/*s`, or `/*b`.
  A `/ch/1/mute` GET query resets the TCP timer but does not renew the
  OSC subscription, which is why the subscription kept dropping.

  Reverted to sending `/%2224/*S` (port-redirect prefix + subscription
  command) from the **main receive socket** (port 2224) every 7 seconds.
  The port-redirect tells Wing to keep pushing to port 2224 — which it
  already does — so Wing treats this as a clean renewal with no state
  change or push interruption. The previous pauses attributed to `/*S`
  were caused by two simultaneous 16.5-second deep queries starving the
  event loop, not by `/*S` itself. That is fixed since v2.3.31.

---

## [2.3.34] — 2026-03-29

### Changed

- **Keepalive reverted to `/ch/1/mute` GET query, 7-second interval** —
  the root cause of the earlier subscription dropout was two simultaneous
  deep queries (3,312 params each, ~16.5s total) starving the event loop,
  not the keepalive mechanism itself. With the double-query fixed in 2.3.31
  and the deep query reduced to ~1.7s, the event loop is free and any OSC
  packet reliably resets the Wing's 10-second subscription timer. A simple
  no-arg `/ch/1/mute` GET sent from the main socket every 7 seconds is
  sufficient — no `/*S` re-subscription needed, no disruption to the push
  stream.

---

## [2.3.33] — 2026-03-29

### Fixed

- **Subscription renewal from ephemeral socket caused dropout** — sending
  `/%2224/*S` from a fresh ephemeral UDP socket (closed immediately after
  `sendto`) meant Wing's acknowledgement/response went to the now-closed
  port and was lost. More critically, Wing may briefly redirect its push
  stream to the ephemeral source port before processing the port-redirect
  prefix, causing a momentary gap in push delivery to port 2224.

  Fixed: renewal now sends `/%2224/*S` from the **main receive socket**
  (port 2224) using `_transport.sendto()`. Wing sees the renewal arriving
  from the same port it already pushes to, with an explicit instruction to
  keep pushing there. No redirect, no state reset, no disruption.

- **Fader drag position overridden by incoming Wing push** — when a user
  drags a fader in Wing Remote, the Wing correctly moves its fader and
  echoes the new value back via `/*S`. This echo was being applied to the
  browser's DOM, jumping the fader handle to the Wing's reported position
  mid-drag, fighting the user's mouse. Added `activeDrags` set in
  `faders.js`: the strip key is added on `mousedown` and removed on
  `mouseup`. Incoming `fader` push messages in `osc.js` are suppressed for
  any strip currently in `activeDrags`.

---

## [2.3.32] — 2026-03-29

### Fixed

- **Periodic pause root cause: probe loop opening a new UDP socket every
  15 seconds** — `wing_probe_loop` called `test_osc_connection()` which
  called `_udp_send_recv()` which opened a fresh UDP endpoint and sent
  `/?` to the Wing. The Wing sees this probe arriving from a new ephemeral
  source port and briefly redirects its response there, disrupting the push
  stream to port 2224 for the duration. This was the source of the periodic
  pause.

  `wing_probe_loop` now uses a `last_osc_recv` timestamp updated on every
  incoming Wing packet. If a packet arrived within the last 20 seconds, the
  Wing is considered connected — no UDP probe needed. The expensive
  `test_osc_connection` round-trip only fires if Wing has been silent for
  20+ seconds (indicating a genuine disconnect). This eliminates all
  periodic probe disruptions while Wing is actively pushing.

- **`_udp_send_recv` blocked for full timeout duration** — the probe helper
  slept for the entire `timeout=2.0` seconds even when a response arrived
  immediately. Fixed to return as soon as the response future resolves,
  with timeout only as a fallback.

---

## [2.3.31] — 2026-03-29

### Fixed

- **Double bulk query on startup** — `_delayed_bulk_query()` fired at t=3s
  unconditionally, then `wing_probe_loop()` fired a second `bulk_query_wing()`
  when Wing connected at t=8s. Both spawned `_deep_query_wing()`, causing two
  16-second deep queries running simultaneously. Removed `_delayed_bulk_query`
  entirely — the probe loop is the sole trigger for the bulk query.

- **Deep query starving event loop for 16.5 seconds** — the deep query was
  querying 3,312 parameters (EQ bands 1-4, dynamics, gate for all 40
  channels plus aux/bus/main). At 50ms per 10-packet batch this took 16.5
  seconds, preventing the subscription keepalive from firing at all during
  that window, causing the subscription to expire and drop fader updates.

  EQ, dynamics, and gate parameters removed from the background deep query —
  these are only needed when the Channel Settings panel is opened and will
  be queried on-demand at that point. The deep query now covers only sends
  (lvl + on), inserts, and phantom/invert/locut/hicut flags — 1,696 params
  completing in ~1.7 seconds. The keepalive can fire multiple times during
  this window.

- **SET commands logged at INFO** — fader drag, mute, and pan OSC SET
  commands now log at INFO level with the target IP so fader control issues
  are immediately visible in `docker compose logs`.

---

## [2.3.30] — 2026-03-29

### Fixed

- **Bulk query GET packets rejected by Wing — wrong format** — the essential
  and deep query loops were calling `send_message(path, [])` directly on
  `wing_client`. This sends a 16-byte pythonosc packet (12-byte padded
  address + 4-byte empty type tag `,\0\0\0`) which the Wing rejects
  silently. The Wing only answers 12-byte address-only GET packets. Both
  query loops now call `send_osc(path, None)` which builds the correct raw
  address-only packet. This means the bulk query replies now actually arrive,
  populating fader positions, mutes, and channel names properly.

- **Deep query batch gap increased from 20ms to 50ms** — at 20ms per batch
  of 10 packets, the deep query occupied the asyncio event loop for ~1.6
  seconds solid. The subscription keepalive coroutine's `asyncio.sleep(3)`
  cannot fire while the loop is busy, risking the subscription expiring
  during the deep query. At 50ms gaps the event loop is available for ~83%
  of the deep query duration, ensuring keepalive renewals fire on schedule.

---

## [2.3.27] — 2026-03-29

### Fixed

- **Subscription expiring during bulk query — event loop starvation** —
  the sniffer revealed the Wing had already stopped pushing *before* the
  renewal fired. The `[SNIFF PRE] no packets in 0.5s window` result
  confirms the 10s subscription timer expired before our 6s renewal ran.

  Root cause: the bulk query sends ~3,500 OSC GET packets in batches of 10
  with `asyncio.sleep(0.02)` between each batch, occupying the event loop
  for ~7 seconds. The keepalive coroutine's `asyncio.sleep(6)` cannot
  fire on time while the event loop is saturated, causing the renewal to
  arrive after the 10s deadline.

  Two fixes applied:

  1. **`SUBSCRIPTION_INTERVAL` reduced to 3 seconds** — even under event
     loop pressure, at least two renewals will attempt to fire within any
     10s window, ensuring at least one gets through.

  2. **Immediate `/*S` sent when Wing first connects** — before the bulk
     query starts, the probe loop now sends `/%2224/*S` from an ephemeral
     socket as soon as the Wing is confirmed reachable, establishing the
     subscription at a known t=0 before the query flood begins.

- **Removed debug sniffer and renewal debug logging** — all temporary
  diagnostic code (`[SNIFF PRE/POST]`, `[RENEWAL DBG]`, `_renewal_debug`
  globals) removed. The sniffer was also stealing packets from the main
  receive socket and causing blocking calls on the event loop thread.

---

## [2.3.28] — 2026-03-29

### Diagnostics

- **Renewal debug: switched back to main socket** — the ephemeral socket
  approach produced zero `[RENEWAL DBG]` packets, meaning Wing stopped
  sending to port 2224 entirely after receiving `/%2224/*S` from an
  ephemeral port. To determine whether Wing pauses briefly then resumes
  (reset) vs stops completely (misroutes), the renewal is temporarily
  switched back to `/*S` from the main socket on port 2224. The 2.5-second
  debug window in `datagram_received` will now show timestamped packets
  revealing exactly when Wing resumes after the reset.

  Run: `docker compose logs -f wing-remote | grep RENEWAL`

---

## [2.3.27] — 2026-03-29

### Diagnostics

- **Subscription renewal packet logger** — the sniffer socket approach
  failed because Linux delivers each UDP packet to only one socket when
  two are bound to the same port; the main receive socket consumed all
  packets and the sniffer saw nothing.

  Replaced with an in-process debug flag `_renewal_debug`. When the
  keepalive fires it sets `_renewal_debug = True` and `_renewal_debug_until`
  to `now + 2.5s`. The existing `datagram_received` handler checks this flag
  and logs every raw packet as `[RENEWAL DBG] t+N.NNNs ...` — timestamped
  relative to the renewal send — for the 2.5-second window. Wing ack packets
  (`/*S`, `/?`) are also now logged as `[OSC recv] Wing ack:` instead of
  being silently discarded. Run `docker compose logs -f wing-remote | grep
  RENEWAL` to see only the renewal-window output.

---

## [2.3.26] — 2026-03-28

### Diagnostics

- **Subscription renewal packet sniffer** — added a 2.5-second capture
  window around each `/*S` renewal to log every raw UDP packet the Wing
  sends to port 2224: 0.5s before (baseline) and 2.0s after (Wing response).
  Each packet is logged as `[SNIFF PRE]` or `[SNIFF POST]` with the decoded
  OSC address and first 48 hex chars of raw bytes. This will show whether
  the Wing sends an acknowledgement, redirects the push stream, or goes
  silent after the renewal — identifying the exact cause of the dropout.

  **Note:** The sniffer opens a second socket on port 2224 with
  `SO_REUSEADDR`. While sniffing, both the sniffer and the main receive
  socket compete for incoming packets — some packets will go to one and
  some to the other. This is intentional for diagnosis only and will be
  removed once the renewal behaviour is understood.

---

## [2.3.25] — 2026-03-28

### Fixed

- **Subscription renewal causing brief push dropout** — sending `/*S` from
  the receive socket (port 2224) causes the Wing to reset its push
  destination mid-stream. Even though the destination doesn't change (still
  2224), the reset itself interrupts the push flow for the duration of the
  Wing's internal subscription re-registration.

  Fix: send `/%2224/*S` from a **separate ephemeral UDP socket** on each
  renewal. The port-redirect prefix `/%2224` explicitly tells Wing to push
  events to port 2224 regardless of which source port the renewal came
  from. The receive socket on port 2224 is never touched during the renewal,
  so Wing's push stream continues uninterrupted. The Wing sees the renewal
  command, resets its 10-second timer, and keeps pushing to 2224 without
  any gap.

---

## [2.3.24] — 2026-03-28

### Fixed

- **Subscription expiring — GET query does not renew it** — the V3.1.0 doc
  states explicitly: *"Subscriptions must be renewed every 10 seconds to keep
  the subscription alive by sending one of the 3 messages shown below"* —
  those being `/*b~`, `/*s~`, and `/*S~`. A GET query like `/ch/1/mute` does
  NOT renew the subscription timer; it only keeps the TCP connection alive
  (which is a separate mechanism for the native binary channel, not OSC).
  The tcpdump confirmed the GET packet arrived at the Wing correctly but
  pushes stopped immediately afterward, proving the Wing drops the
  subscription when it receives a non-renewal packet after the timer nears
  expiry.

  Restored `/*S` (raw 4-byte form) as the subscription renewal command,
  sent every 6 seconds. The disruption seen in earlier testing when using
  `/*S` as the keepalive was caused by the bulk query flooding the Wing's
  OSC queue simultaneously — not by `/*S` itself. With the bulk query now
  running only once at connection time, `/*S` renewal is clean.

  Renewal log raised to INFO so it's visible in `docker compose logs`
  for verification.

---

## [2.3.23] — 2026-03-28

### Fixed

- **`.env` corruption guard in `apply_env_config`** — if the `.env` file
  is corrupted (e.g. contains JavaScript source or other non-KEY=VALUE
  content), `apply_env_config` now detects this before writing by checking
  whether at least 50% of lines are valid env format. If corruption is
  detected, it logs a warning and rebuilds the file from scratch using the
  current config values rather than propagating the corrupted content.

### Notes

- The `.env` corruption (`unexpected character "/" in variable name`) was
  caused by a prior session writing file content to the wrong path. The
  `docker-compose.yml` bind-mounts `./.env` on the host directly to
  `/app/.env` in the container, so any write to `/app/.env` inside the
  container immediately modifies the host file — which Docker then parses
  with `env_file: .env` on the next `docker compose up`. The Dockerfile
  `ENV` defaults (`WING_IP=192.168.1.100` etc.) serve as the correct
  fallback when `.env` is absent or corrupted.

---

## [2.3.22] — 2026-03-28

### Fixed

- **Keepalive and GET queries sending wrong packet format** — `send_osc(path,
  None)` was calling `send_message(path, [])` which pythonosc builds as a
  16-byte packet: padded address (12 B) + empty type tag string `,\0\0\0`
  (4 B). The Wing docs show a GET query as address-only — `->W 12 B:
  /ch/1/mute~~` — with no type tag at all. The Wing was rejecting the
  16-byte form, so every GET query (including the subscription keepalive
  ping) was silently dropped, causing the subscription to expire after
  10 seconds.

  Both `send_osc(path, None)` and the keepalive now build the raw packet
  directly: `address.encode() + null padding to next multiple of 4`, with
  no type tag string. Verified against doc examples:
  `/ch/1/mute` → 12 bytes `2f63682f312f6d7574650000` ✓

- **Padding formula off-by-one** — the initial formula `4 - (len+1) % 4`
  returns `4` when already aligned (should be `0`), producing 4 extra null
  bytes. Replaced with `(len + 1 + 3) & ~3` which correctly rounds up to
  the next multiple of 4 in all cases.

---

## [2.3.21] — 2026-03-28

### Fixed

- **Subscription dropping every 5 seconds — `/*S` keepalive was interfering
  with itself** — re-sending `/*S` every 5 seconds was not just renewing the
  timer; it was re-registering the subscription each time, which causes the
  Wing to momentarily reset its push state and interrupts the flow of events.
  The doc says any OSC packet resets the inactivity timer — `/*S` is only
  needed once to establish the subscription.

  Replaced the `/*S` keepalive with a lightweight GET query for `/ch/1/mute`
  (no arguments). This sends a 12-byte OSC packet every 7 seconds, resets
  the Wing's 10-second subscription timer harmlessly, and the reply is
  processed by the normal mute handler with no side effects. The subscription
  established at startup remains undisturbed.

  Interval relaxed from 5s back to 7s — a GET query carries no risk of
  disruption so the tighter margin is not needed.

---

## [2.3.20] — 2026-03-28

### Fixed

- **Subscription dropping every ~10 seconds — keepalive interval too close
  to Wing's timeout** — the Wing drops the `/*S` subscription after exactly
  10 seconds without a renewal. The keepalive was firing every 8 seconds,
  which leaves only a 2-second window to account for packet delay, event
  loop scheduling jitter, and the bulk query's ~3,500 OSC packets occupying
  the Wing's receive queue at startup. The result was a recurring 4-second
  gap in fader updates every ~10 seconds.

  `SUBSCRIPTION_INTERVAL` reduced from `8.0` to `5.0` seconds, giving a
  comfortable 2× safety margin against the 10-second timeout. The Wing resets
  its subscription timer on every `/*S` it receives, so more frequent renewals
  have no downside.

  Also removed a duplicate `SUBSCRIPTION_INTERVAL = 8.0` definition that had
  been silently overriding the first one.

---

## [2.3.19] — 2026-03-28

### Fixed

- **Meter TCP connect failing — engine not waiting for Wing to be reachable**
  — `meter_engine` was gating on `app_state.wing_client` (the OSC socket
  existing) rather than `app_state.wing_connected` (the Wing actually
  responding). On startup the OSC client is created immediately but the Wing
  may not yet be reachable, so TCP port 2222 connections were attempted and
  refused before the probe loop confirmed connectivity. Changed the guard to
  `not app_state.wing_connected` so the meter engine only attempts the TCP
  connection once the Wing is confirmed live.

- **UDP socket `Address already in use` on retry** — on each failed
  connection attempt the meter loop retried from the top but did not close
  the UDP socket from the previous iteration before calling `bind()` again,
  causing `OSError: [Errno 98] Address already in use` on the second attempt
  which then cascaded into further failures. Added explicit cleanup of any
  leftover `udp_sock` at the top of each loop iteration, and added
  `SO_REUSEADDR` on the UDP socket so rapid restarts don't hit TIME_WAIT.

---

## [2.3.18] — 2026-03-28

### Fixed

- **Setup Wizard IP change not taking effect for outgoing OSC** — when the
  user saves a new Wing IP through the Setup Wizard, `apply_env_config` writes
  it to `.env` and `set_wing_target` + `update_target` update the live
  in-memory target. However an indentation bug caused the subscription send
  and `wing_connected = False` reset to be inside the `if app_state.wing_client:`
  block as a mis-indented continuation, so they ran correctly but the
  `update_target` call itself was never updating `_wing_ip` on the transport
  — only `set_wing_target` (the module-level global) was updated. Fixed
  indentation so `update_target`, the subscription send, and the probe reset
  all execute in the right order.

- **Wrong default port constants in `apply_env_config`** — `setup.py` was
  defaulting `WING_OSC_PORT` to `2222` (the binary TCP port) and
  `LOCAL_OSC_PORT` to `2223` (the Wing's OSC port). Both were inverted.
  Corrected to `WING_OSC_PORT=2223` and `LOCAL_OSC_PORT=2224`.

- **Reverted `.env` to placeholder IP** — `.env` and `.env.example` restored
  to `WING_IP=192.168.1.100`. The correct IP is set by each user via the
  Setup Wizard at first run, which writes it to `.env` inside the container.

---

## [2.3.17] — 2026-03-28

### Fixed

- **Fader moves from Wing Remote not reaching the Wing — wrong target IP** —
  OSC SET commands (fader moves, mutes, pan changes) were being sent to
  `192.168.1.100` (the `.env` placeholder default) instead of the Wing at
  `192.168.1.162`. Incoming push events still arrived because the Wing sends
  them back to the source of the `/*S` subscription packet, which uses the
  correct bound socket. But outgoing SET commands read `WING_IP` from the
  environment, which was never updated from the default.

  Updated `.env` and `.env.example` to `WING_IP=192.168.1.162`.

- **OSC send log raised to INFO with target IP** — `send_osc()` now logs at
  INFO level and includes the actual `host:port` the packet is sent to,
  making it immediately visible in `docker compose logs` if the Wing IP is
  misconfigured.

---

## [2.3.16] — 2026-03-28

### Fixed

- **Bypassed `Handler.invoke()` entirely** — pythonosc's `Handler.invoke`
  has inconsistent behaviour across versions and was producing `'list' object
  has no attribute 'address'` errors on every incoming packet. The method
  internally accesses the OSC message object in some code paths, which is
  incompatible with our direct byte parsing approach. Both invocation sites
  (OSC datagram receiver and NRP binary dispatcher) now retrieve the
  underlying callback directly via `getattr(h, 'callback', None) or
  getattr(h, '_callback', None)` and call it as `cb(address, *args)`,
  bypassing `Handler.invoke` completely. Our handler functions receive
  `(address, *args)` exactly as they were written.

---

## [2.3.15] — 2026-03-28

### Fixed

- **`Handler.invoke()` argument mismatch** — pythonosc 1.9.3's
  `Handler.invoke(self, address, args_list)` takes exactly 3 positional
  arguments: self, address, and args as a **list**. It then unpacks the
  list internally when calling the registered callback as
  `callback(address, *args_list)`. We were calling `h.invoke(address, *args)`
  which unpacked the args at the call site — passing e.g. 5 positional
  arguments for a `,sfi` triplet reply instead of the expected 3. Changed
  both invocation sites (OSC datagram receiver and NRP binary dispatcher)
  to `h.invoke(address, list(args))`. Handler functions still receive
  `(address, *args)` correctly via pythonosc's internal unpack.

---

## [2.3.14] — 2026-03-28

### Fixed

- **NameError crashing every OSC packet** — `_first_msg_logged` was defined
  as a class attribute on `_Protocol` but referenced as a bare name inside
  `datagram_received`, raising `NameError: name '_first_msg_logged' is not
  defined` on every single incoming Wing push event. This silently discarded
  every fader move, mute change, and name update the Wing sent.

- **Replaced pythonosc `OscMessage` parser with a direct implementation** —
  rather than fix the class-attribute scoping, the entire `datagram_received`
  handler now uses a self-contained `_parse_osc()` function that parses OSC
  packets directly from bytes with no pythonosc dependency. Handles all Wing
  push formats (`,f` float, `,i` int, `,s` string, `,sff` / `,sfi` GET reply
  triplets) and Wing subscription echo packets (`/*S`, `/?`) which are
  silently discarded. Parse failures log at WARNING with the raw hex. Handler
  errors per-path also log at WARNING with the specific address.

---

## [2.3.13] — 2026-03-28

### Diagnostics

- **OSC parse errors now logged at WARNING level** — `datagram_received` was
  catching all `OscMessage` parse exceptions at `DEBUG` level, silently hiding
  them in normal log output. Raised to `WARNING` so any failure to parse an
  incoming Wing push event shows immediately in `docker compose logs`.

---

## [2.3.12] — 2026-03-28

### Fixed

- **OSC subscription sent as exact 4-byte raw packet** — pythonosc builds
  an 8-byte OSC message for `/*S` (4-byte address + 4-byte empty type tag
  string `,\x00\x00\x00`). Some Wing firmware versions reject this longer
  form and don't register the subscription at all. The doc shows the correct
  form as exactly 4 bytes: `->W 4 B: /*S~` i.e. `2f 2a 53 00` — the address
  string with its null terminator, no type tag. Changed both the keepalive
  loop and the setup-path subscription send to use
  `_transport.sendto(b'\x2f\x2a\x53\x00', ...)` directly, bypassing
  pythonosc's message builder entirely.

---

## [2.3.11] — 2026-03-28

### Changed

- **OSC subscription simplified to `/*S` with no port-redirect prefix** —
  removed the `/%2224/*S` port-override form. Wing sends subscription push
  events back to the source IP and port of the packet that sent `/*S`,
  which is already our local OSC port 2224 (the same socket used for all
  outgoing OSC). No redirect prefix is needed or wanted.

---

## [2.3.10] — 2026-03-28

### Fixed

- **NRP channel demultiplexer — root cause of missing fader updates** —
  The Wing multiplexes 14 logical channels over a single TCP connection on
  port 2222 using NRP (Native Remote Protocol) framing. Channel switches
  are signalled by `0xDF 0xD<ChID>` in the byte stream:

  - ChID 0 (`0xDF 0xD0`) = Control Engine
  - ChID 1 (`0xDF 0xD1`) = Audio Engine ← fader moves, mutes, param changes
  - ChID 3 (`0xDF 0xD3`) = Meter Data

  The previous TCP parser ignored `0xDF` bytes entirely, meaning every
  channel-switch prefix was treated as unknown data. The channel-select byte
  that follows (e.g. `0xD1`) was then misread as a token, misaligning the
  entire parse for that block. Fader moves from the Wing arrived as Audio
  Engine (ChID 1) tokens but were silently dropped because the parser never
  correctly identified them.

  Replaced with a proper Python port of the NRP receive routine from the
  V3.1.0 docs (`nrpc_data_rx` C pseudocode). The demultiplexer correctly
  handles escape sequences (`0xDF 0xDE` = literal `0xDF`), tracks the active
  channel, and routes only ChID 1 (Audio Engine) bytes to the token parser.
  Channel switches and escaped bytes are handled per spec. NRP state
  (`_nrp_escf`, `_nrp_ch_rx`) is reset on every TCP reconnect.

  Verified against all three doc examples and the captured hex dump:
  `DF D1 D7 CB A1 42 33 D5 C0 F4 10 00` → hash `0xcba14233` = `−7.63 dB` ✓

---

## [2.3.9] — 2026-03-27

### Fixed

- **UDP and TCP read buffers increased to match Wing's 32KB maximum** —
  the V3.1.0 doc states the maximum UDP packet size is 32,768 bytes (32KB).
  Three receive buffer sizes were set below this limit:

  - **Meter UDP `recvfrom`** — raised from `8192` to `32768`. The current
    meter packet is ~1,348 bytes, so no data was being lost, but this future-
    proofs against larger meter collections and matches the documented spec.

  - **Meter UDP `SO_RCVBUF`** — the OS-level socket receive buffer is now
    explicitly set to 32,768 bytes via `setsockopt(SOL_SOCKET, SO_RCVBUF,
    32768)`. Without this, the OS may use a smaller default buffer and silently
    drop oversized incoming packets before `recvfrom` can read them.

  - **TCP binary change reader** — `tcp_reader.read(4096)` raised to
    `tcp_reader.read(32768)`. Wing can push multiple parameter change tokens
    in a single TCP segment; reading only 4KB per call could leave data in the
    kernel buffer for an extra loop iteration, increasing latency.

---

## [2.3.8] — 2026-03-27

### Fixed

- **Subscription command contained a literal tilde instead of a null byte**
  — the Wing protocol documentation uses `~` to represent `\0` (null byte)
  in printed examples, e.g. `/*S~` means the OSC string `/*S\0`. This is a
  documentation convention, not a literal character. OSC requires every string
  to be null-terminated and padded to a multiple of 4 bytes — pythonosc
  handles this automatically when the address is passed without a tilde.

  Our subscription command was `/%2224/*S~` (11 chars + null + 1 pad = 12
  bytes), which sent ASCII `0x7E` (tilde) as the last address character,
  making the Wing receive an unrecognised command. The fix is `/%2224/*S`
  (9 chars + null + 2 pads = 12 bytes), which pythonosc encodes correctly
  as `2f25323232342f2a53000000` — a valid, Wing-recognised OSC address.

---

## [2.3.7] — 2026-03-27

### Changed

- **Bulk query fires only once — on Wing connect, not on every browser open**
  — `bulk_query_wing()` now has exactly two trigger points:

  1. **Startup** (`_delayed_bulk_query`) — runs 3 seconds after the container
     starts, once the OSC server is ready, to populate `app_state.mixer` with
     the Wing's initial state.
  2. **Wing (re)connect** (`wing_probe_loop`) — fires once each time the probe
     loop detects the Wing has become reachable after being unreachable,
     ensuring state is refreshed if the Wing rebooted or was disconnected.

  The previous behaviour sent ~3,500 OSC GET requests to the Wing on **every
  new browser tab or page refresh**, which is unnecessary and can flood the
  Wing's OSC server. `app_state.mixer` is kept current in real time by the
  `/*S~` subscription push events and the binary TCP parameter change receiver,
  so a new browser tab simply receives the cached snapshot already held in
  memory — no Wing queries needed.

---

## [2.3.7] — 2026-03-27

### Fixed

- **8-second meter/fader delay** — `bulk_query_wing()` was sending ~5,500 OSC
  GET requests (40 channels × ~110 params each + aux/bus/main/matrix) in batches
  of 10 with a 20ms sleep between batches. Total blocking time: ~11 seconds of
  `await asyncio.sleep()`. While the event loop technically processes other
  coroutines during sleep, the Wing's OSC server was also being flooded with
  5,500 UDP queries, causing it to queue replies for ~8–11 seconds before
  processing live push events. Meters and fader moves appeared with an 8-second
  lag as a result.

  **Fix:** Split into two tiers:
  - **Tier 1 (Essential)** — name, fader, mute, pan, solo, icon, color for all
    strips (~240 queries, batches of 20, 5ms gaps → completes in ~0.3s). Runs
    on every browser connect.
  - **Tier 2 (Deep)** — EQ, dynamics, gate, sends, input options (~800 queries,
    batches of 10, 20ms gaps → runs in background). Starts 1 second after the
    essential query, so live updates are never blocked.

- **Meter loop stalling 100ms per iteration** — `_read_binary_tcp_changes()`
  called `asyncio.wait_for(tcp_reader.read(256), timeout=0.1)` which blocked
  for 100ms waiting for TCP data that usually isn't there. With the meter loop
  running at 25ms intervals, this caused every fourth frame to take 100ms
  instead of 25ms, reducing effective meter rate to ~8fps and adding
  unpredictable latency. Fixed to `timeout=0.0` (non-blocking poll) — if no
  TCP data is buffered the call returns immediately.

---

## [2.3.6] — 2026-03-27

### Fixed — Protocol compliance review against V3.1.0 spec

- **Fader SET sends dB not raw 0–1** — the V3.1.0 doc is explicit:
  `->W /ch/2/fdr ,f [-3.0000]` sets to −3 dB. The Wing's `,sff` GET reply
  includes a raw 0–1 value at `arg1` as a convenience, but SET must use dB.
  Our code was sending raw (e.g. `0.75`) which Wing interpreted as `+0.75 dB`,
  placing every fader at the wrong position. Added `_wing_raw_to_db()` —
  the inverse of `_wing_db_to_raw()` — and the fader SET path now converts
  before transmitting.

- **Input options OSC paths corrected** — all input option paths were wrong.
  The Wing groups input settings under `/ch/N/in/set/` and filters under
  `/ch/N/flt/`:

  | Old (wrong) | Correct per V3.1.0 |
  |---|---|
  | `/ch/N/gain` | `/ch/N/in/set/$g` |
  | `/ch/N/trim` | `/ch/N/in/set/trim` |
  | `/ch/N/phantom` | `/ch/N/in/set/$vph` |
  | `/ch/N/inv` | `/ch/N/in/set/inv` |
  | `/ch/N/dly/on` | `/ch/N/in/set/dlyon` |
  | `/ch/N/dly/time` | `/ch/N/in/set/dly` |
  | `/ch/N/hpf/on` | `/ch/N/flt/lc` |
  | `/ch/N/hpf/f` | `/ch/N/flt/lcf` |
  | `/ch/N/lpf/on` | `/ch/N/flt/hc` |
  | `/ch/N/lpf/f` | `/ch/N/flt/hcf` |
  | `/ch/N/tilt` | `/ch/N/flt/tf` |

  Corrected in both the bulk query list and the OSC dispatcher registrations
  for channels and aux strips. All corresponding handlers updated to parse
  GET replies using `args[2]` (the actual value field in `,sff` responses).

- **Added missing aux input option handlers** — `handle_aux_phantom`,
  `handle_aux_invert`, `handle_aux_hpf_on/freq`, `handle_aux_lpf_on/freq`
  were registered in the dispatcher but not defined as functions. Added.

- **Added `handle_ch_tilt_on`** — tilt filter enable handler was missing.

---

## [2.3.5] — 2026-03-27

### Fixed

- **`/*S~` subscription — missing tilde** — Wing's OSC subscription commands
  require a trailing tilde (`~`) which is the OSC null-padding character.
  The subscription was being sent as `/*S` instead of `/*S~`, which the Wing
  was silently ignoring. Fixed to send `/%2224/*S~` (port-redirect + correct
  command format). The diagnostic sniffer confirmed the Wing gave no response
  to `/*S` — it now receives `/*S~` and will begin pushing single-value OSC
  events to port 2224.

### Added

- **Binary TCP parameter change receiver** — hex dump analysis of a live
  fader move revealed that the Wing *also* sends parameter changes on the
  native binary TCP channel 2 (port 2222), interleaved with meter data.
  These arrive as `0xD7 <hash> 0xD5/D6/D4 <value>` tokens — the Wing's
  internal hash-addressed binary protocol. Added `_read_binary_tcp_changes()`
  which reads and parses these packets from the meter TCP stream on every
  loop iteration, and `_dispatch_binary_change()` which routes them through
  the same OSC dispatcher handlers so fader, mute, pan, and all other
  parameter updates update `app_state.mixer` and broadcast to browsers
  via WebSocket — regardless of whether the `/*S~` OSC subscription is
  also working. This provides a second, independent path for receiving
  real-time Wing state changes.

---

## [2.3.4] — 2026-03-27

### Changed

- **`docker-compose.yml` revised for Windows bridge networking** — switched
  from `network_mode: host` (Linux-only) to explicit bridge port mappings
  so the container works on Windows Docker Desktop and macOS. Port layout:

  | Port | Protocol | Direction | Purpose |
  |---|---|---|---|
  | 8000 | TCP | inbound | Web UI |
  | 2224 | UDP | inbound | OSC push events from Wing (matches `LOCAL_OSC_PORT`) |
  | 2225 | UDP | inbound | Binary meter data from Wing (matches `METER_UDP_PORT`) |
  | 2222 | TCP | outbound | Container → Wing meter subscription (no mapping needed) |
  | 2223 | UDP | outbound | Container → Wing OSC commands (no mapping needed) |

### Fixed in docker-compose.yml

- Port 2222 was listed as `udp` in the uploaded replacement file — corrected
  to `tcp`. The Wing binary meter interface uses a **TCP** connection (the
  container opens a persistent TCP stream to Wing port 2222 to subscribe to
  meter data). Using the wrong protocol would silently drop the connection.

- Port 2225/udp (meter UDP receiver) was missing from the uploaded file.
  Wing sends binary meter packets to this port after the TCP subscription
  is established. Without it mapped, all meter data is silently dropped
  by the Docker bridge NAT layer.

---

## [2.3.3] — 2026-03-27

### Fixed

- **Wing push events never arrived — subscription port mismatch** — the Wing
  OSC subscription command `/*S` tells Wing to push parameter change events
  back to the sender's source port. However, Wing only honours one active
  subscription at a time across the entire console. If Wing Edit or any
  other OSC client had previously subscribed from a different port, Wing
  continues pushing to that port and ignores our `/*S`. The fix uses the
  Wing port-redirect prefix: `/%PORT/*S` (e.g. `/%2224/*S`), which
  explicitly instructs Wing to send push events to a specific UDP port
  regardless of what other clients have registered. This ensures our app
  always receives live fader, mute, pan, name, EQ, and dynamics updates
  from the Wing in real time, even when Wing Edit is also running.

- **Pan values parsed incorrectly from GET replies** — Wing's GET reply for
  pan uses tag format `,sff`: `arg0` is an ASCII string label, `arg1` is a
  normalised 0–1 raw position (0.5 = centre), and `arg2` is the actual pan
  value in Wing's −100..100 degree scale. `parse_wing_pan` was reading
  `arg1` (0.5) and dividing by 100, yielding 0.005 instead of 0.0 for a
  centred pan. Fixed to read `arg2` from GET replies (when `arg0` is a
  string) and `arg0` directly from `/*S` push events (which send the
  actual value as a single float).

---

## [2.3.2] — 2026-03-27

### Fixed

- **All Wing state ignored — root cause found and fixed** — every fader
  position, mute state, pan, name, EQ value, gate, and dynamics parameter
  received from the Wing (both GET replies and `/*S` subscription pushes)
  was being silently discarded. Root cause: the OSC message dispatcher in
  `WingOSCTransport.datagram_received` called
  `h.invoke(msg.address, msg.params)`, passing the params list as a
  **single argument**. Python-osc's `Handler.invoke` signature expects
  `(address, *args)` — individual positional arguments. Every handler
  therefore received `args = ([list_of_values],)` — a one-element tuple
  containing the whole list — so `parse_wing_float(args)` saw
  `args[0]` as a list (not a string or float) and returned `0.0` for
  every fader, `False` for every mute, `""` for every name. The fix is
  one character: `h.invoke(msg.address, *msg.params)` — unpacking the
  params list so handlers receive the values as intended.

- **Bulk query not firing on browser connect** — the guard condition
  `if not any(app_state.mixer["channels"].values())` was always `False`
  because `app_state.mixer["channels"]` is pre-populated with 40 default
  channel dicts at init time. The condition was intended to detect "mixer
  state is empty", but an empty dict is falsy and a dict with keys is
  always truthy regardless of whether those keys hold real Wing values or
  defaults. Changed to `if app_state.wing_connected:` so a fresh bulk
  query is triggered on every new browser connect while the Wing is live,
  ensuring a just-opened tab always shows the current console state.

---

## [2.3.1] — 2026-03-27

### Fixed

- **Fader handle position off by 7px** — the `.fader-handle` CSS rule used
  `transform: translate(-50%, 50%)`, where the `50%` Y component shifts the
  element downward by half its own height (7px, since the handle is 14px tall).
  Combined with `bottom: calc(X% - 7px)`, the handle centre ended up at
  `X% - 7px` instead of exactly `X%`, placing every handle 7px lower than the
  corresponding Wing console position. Fixed by changing the transform to
  `translateX(-50%)` (horizontal centring only). The `bottom: calc(X% - 7px)`
  formula is unchanged and now correctly places the handle centre at `X%`.

---

## [2.3.0] — 2026-03-27

### Overview
Full bidirectional state synchronisation between the Wing console and the
web app, matching the behaviour of Wing Edit: physical changes on the console
are immediately reflected in the app, and changes made in the app are
immediately applied to the console.

### Added

#### Full Wing → App Push Coverage
- **New OSC dispatcher handlers** registered for every parameter that was
  previously query-only (GET but no live push handler):
  - `phantom` — +48V phantom power state
  - `inv` / `invert` — signal polarity invert
  - `hpf/on` + `hpf/f` — lo-cut filter on/off and frequency
  - `lpf/on` + `lpf/f` — hi-cut filter on/off and frequency
  - `dly/on` + `dly/time` — delay on/off and time value
  - `gain` — preamp gain level
  - `trim` — trim level
  - `icon` — channel icon index
  - `col` — channel colour index
  - `preins/on` + `preins/ins` — Insert 1 enable and FX slot assignment
  - `postins/on` + `postins/ins` — Insert 2 enable and FX slot assignment
  - Aux equivalents for gain, trim, icon, col, and preins

  Any physical change to these parameters on the Wing console now immediately
  updates `app_state.mixer` and is broadcast to all connected browsers.

#### New Frontend WebSocket Message Types
- `input_options` — carries `{strip, ch, key, value}` for any input options
  change; applied to local state and re-renders the channel settings INPUT
  section if it is currently open for the affected channel
- `icon` — updates `iconId` on the affected strip; refreshes the channel
  settings nav rail thumbnail if open
- `color` — updates `colorIdx` and immediately updates the color bar on
  the strip DOM element
- `insert` — updates `ins1` / `ins2` objects; re-renders the Insert section
  in channel settings if currently open for the affected channel

#### Expanded Bulk State Query
- Added to the startup GET query for all 40 channels and 8 aux strips:
  `phantom`, `inv`, `hpf/on`, `hpf/f`, `lpf/on`, `lpf/f`, `dly/on`,
  `dly/time`, `icon`, `col`, `gain`, `trim`, `gate/hld`, `dyn/hld`,
  `preins/on`, `preins/ins`, `postins/on`, `postins/ins`, all 4 main
  sends (`main/1-4/on` + `main/1-4/lvl`), and bus send pan values

#### Expanded Snapshot Application
- Browser `snapshot` handler now applies all new fields from the Wing state
  on connect: `phantom`, `invert`, `locut`, `hicut`, `tilt`, `delay`,
  `gain`, `trim`, `locut_freq`, `hicut_freq`, `delay_time`, `iconId`,
  `colorIdx`, `ins1`, `ins2`, `eq`, `dyn`, `gate`, `sends`, `mainSends`

### Fixed

#### Meter Engine — Subscription Split into Two TCP Writes
- The Wing binary meter subscription packet was being sent as a single
  combined TCP write (port declaration + report ID + collection). The
  Wing V3.1.0 protocol docs show these as two separate writes. Splitting
  them with a 50 ms gap between the port declaration and the collection
  write resolves the issue where Wing was not sending any UDP meter data
  back to the app.

#### Meter Parser — Correct DCA Word Count
- DCA strips have 4 words (8 bytes) per strip as specified in Table 5 of
  the V3.1.0 docs (pre-fader L/R + post-fader L/R only — no gate/dyn
  words). The parser was using 16 bytes for all strips including DCA,
  misaligning the offset for everything following the DCA section in the
  packet. Fixed with `METER_WORDS_PER_STRIP` dict and a running byte
  offset instead of a flat stride.

#### Meters View — All Strip Types
- The Meters nav view was only showing the 40 channel strips. Now renders
  all five metered strip types in labelled sections with section-specific
  heights and accent colours: CH (orange), AUX (blue), BUS (cyan),
  MAIN (red), MTX (green).

#### Right Channel Meter Smoothing
- The right channel VU bar was being updated directly from `applyMeterValues`
  bypassing the attack/release smoothing loop. Both channels now go through
  the same `animateMeters` interpolation (`ch.meter[1]` for right channel).

#### Bulk Query Flooding
- `bulk_query_wing()` was called on every browser WebSocket connect,
  sending ~3,200+ OSC queries to the Wing every time a browser tab was
  opened or refreshed. It now only fires when `app_state.mixer["channels"]`
  is empty — i.e. once when Wing first connects — avoiding unnecessary
  UDP floods that could cause the Wing OSC server to become unresponsive.

---

## [2.2.2] — 2026-03-27

### Fixed

- **Auxiliary channel nav rail** — opening Channel Settings on an AUX strip was
  showing the Dynamics and Insert 2 rail cards, which do not exist on auxiliary
  channels per the Wing V3.1.0 protocol spec.

  - **Dynamics**: AUX channels have `/aux/n/dyn` (PSE/LA combo compressor) so
    the Dynamics section is correctly retained.
  - **Insert 2**: AUX channels have `/aux/n/preins` (one insert slot, equivalent
    to Insert 1) but no `/aux/n/postins` (post-insert), so Insert 2 is now
    hidden for AUX strips.

### Changed

- **`CS_SECTION_MAP`** — new per-strip-type section allowlist controls which nav
  rail cards are shown when Channel Settings opens. Sections are filtered for
  each strip type based on what the Wing hardware actually supports:

  | Strip type | Sections |
  |---|---|
  | CH 1–40 | Home · Input · Gate · EQ · Dynamics · Insert 1 · Insert 2 · Main Sends · Bus Sends |
  | AUX 1–8 | Home · Input · Gate · EQ · Dynamics · Insert 1 · Main Sends · Bus Sends |
  | BUS / MAIN / MTX | Home · EQ · Dynamics · Main Sends |
  | DCA 1–16 | Home only |

- **`_csSectionsForType()`** — returns the filtered section list for the current
  strip type; used by both `_csRenderNavRail` and `_csDrawNavThumbs` so thumbnail
  canvases are only drawn for sections actually present in the DOM.

---

## [2.2.1] — 2026-03-27

### Fixed

- **Input Settings Rail Thumb** — the nav rail card for the Gain / Input section was
  showing a plain yellow gain-bar thumbnail that did not reflect the new input_options
  pill layout. Replaced with a 3×2 grid of six labelled pill boxes drawn on the 80×40
  canvas, one for each input option: **48V**, **LC**, **INV**, **HC**, **TILT**, **DLY**.
  Each pill reads live channel state and renders lit (coloured background + border) when
  enabled or dim (near-transparent) when disabled — matching the accent colours used in
  the content area (amber / blue / red / cyan / green / orange respectively). The thumbnail
  updates every time the nav rail redraws, so toggling any option in the content area is
  immediately reflected in the rail card.

### Changed

- **Rail card label** — the Gain section rail card label changed from **GAIN** to **INPUT**
  to match the section's actual function (input signal path options) and the backend
  rename to *Input Settings Rail Thumb*.
- **Rail card badge** — the gain dB value badge that previously appeared below the GAIN
  label has been removed. The six pill states in the thumbnail now communicate input
  status at a glance without needing a separate badge.

---

## [2.2.0] — 2026-03-27

### Added

#### Medium Grey Theme
- Added a third UI theme — **Mid Grey** — sitting comfortably between the
  existing dark and light modes. Background layers use desaturated charcoal
  greys (`#2a2c31` through `#42454d`), borders are medium-dark, and text is
  slightly softer than full dark mode. All accent colours (orange, green,
  cyan, red, amber, blue) are inherited unchanged from dark mode so the
  UI chrome retains full contrast and vibrancy against the grey surface.

#### Three-State Theme Cycle Button
- Replaced the two-icon dark/light toggle with a **composite SVG pill** showing
  three segments side by side, each representing one theme:
  - **☀ Half-sun** (left) — rays and a left semicircle arc; full opacity in Light mode
  - **⬤ Circle + lines** (center) — neutral mid-point symbol; full opacity in Mid Grey mode
  - **☽ Half-crescent** (right) — right-facing moon arc; full opacity in Dark mode
- Inactive segments dim to 35% opacity; the active segment is always visually
  distinct. All transitions animate at `0.2s` via CSS.
- Clicking the button cycles **Dark → Mid Grey → Light → Dark** in order.
- `localStorage` key `wing-theme` now stores `'dark'`, `'mid'`, or `'light'`.
  The saved value is restored before the first paint to prevent a theme flash
  on page reload.
- Button tooltip text cycles with the active theme to indicate the next state:
  e.g. *"Dark → Switch to Mid Grey"*.

#### Static Asset Paths Fixed
- The JS/CSS modular refactor in v2.1 introduced relative asset paths
  (`css/main.css`, `js/state.js`) that resolved to the wrong URL against
  FastAPI's `/static/` mount point. All `<link>` and `<script>` references
  updated to absolute paths (`/static/css/main.css`, `/static/js/state.js`)
  so the browser correctly fetches all stylesheets and scripts.

---

## [2.1.0] — 2026-03-26

### Added

#### Channel Settings Panel
- Clicking any channel name strip now opens a full-screen Wing-style channel
  editor that replaces the center area. A back arrow and channel name header
  are shown at the top; all changes are sent to the Wing via OSC immediately
  with no Save button required.
- **Left nav rail** with nine sections, each showing a mini-thumbnail canvas
  preview of the current state (EQ curve, gate transfer line, compressor curve,
  bus send bars, pan puck, gain bar, color swatch):
  - **Home** — four horizontal tabs: Overview, Icon/Color, Name, Tags
  - **Gain** — Channel Input (gain slider, +48V / Pad / Invert toggles), Trim &
    Balance, Filter (Lo-Cut / Hi-Cut / Tilt EQ on/off)
  - **Gate** — ON/OFF toggle, transfer curve canvas (blue when active), threshold /
    range / attack / release sliders
  - **EQ** — ON/OFF toggle, full-width frequency response canvas, six band tabs
    (Low Shelf, PEQ 1–4, High Shelf) each with per-band gain / frequency (log-scale)
    / Q sliders; Lo-Cut and Hi-Cut filter enable toggles on shelf bands; EQ graph
    redraws on every slider movement
  - **Dynamics** — ON/OFF toggle, compressor transfer curve (threshold / ratio /
    knee), and a separate Envelope canvas showing attack (left slope) / hold (flat top)
    / release (right slope) as a trapezoid with control point circles
  - **Insert 1 / Insert 2** — FX processor ON/OFF enable, slot type display
  - **Main Sends** — four vertical faders (M1–M4) with fixed-width dB displays,
    ON/OFF per send, and a horizontal L–R pan bar visualiser with a blue puck
  - **Bus Sends** — 16 vertical channel strips with TAP toggle (PRE amber / POST blue),
    fixed-width dB display, vertical fader, ON/OFF, and PAN LNK toggle; all 16
    scroll horizontally

#### View Pages (top nav)
- **Recording view** now fully wired: Record button sends `record_start` /
  `record_stop` WebSocket messages to the backend; timer counts from real
  backend state; recorded files listed with download and delete buttons;
  list reloads automatically when a recording stops
- **Library view** — two-column layout showing recorded WAV files (with
  download and delete) and scene snapshot slots
- **Utility view** — live connection status panel (Wing IP, OSC port,
  connected state, sample rate, bit depth, audio availability) fetched from
  `/api/status`; Setup Wizard shortcut button; system version display
- **Effects, Routing, Library** — display a 50% opaque greyed-out overlay with
  the message *"This feature is in progress as a sub-project to be implemented
  later. Thanks for stopping by!"*
- **Meters view** — full-width VU grid for all 40 channels updated live from
  the hardware meter engine at ~30 fps

#### Frontend Refactor — Modular File Structure
- The single 5,029-line `index.html` (212 KB) has been split into 13 focused
  files — an 85% reduction in index.html size (now 728 lines / 32 KB):

  ```
  frontend/static/
  ├── index.html           (728 lines — HTML structure only)
  ├── css/
  │   ├── main.css         (mixer UI, strips, meters, panels, ch-settings)
  │   └── wizard.css       (setup wizard overlay)
  └── js/
      ├── state.js         (shared state, LAYERS config, constants)
      ├── strips.js        (mixer model init, layer nav, strip rendering)
      ├── meters.js        (meter animation, EQ canvas helpers)
      ├── faders.js        (fader/knob drag, touch, mute/solo/rec)
      ├── detail.js        (channel selection, detail panel)
      ├── recording.js     (recording transport, waveform, param updaters)
      ├── views.js         (setView, all view builders, theme toggle)
      ├── osc.js           (WebSocket, OSC, Wing status, message handler, clock, init)
      ├── wizard.js        (setup wizard)
      └── ch-settings.js  (channel settings panel — all 9 sections)
  ```

- All 10 JS files pass Node.js syntax validation independently

---

### Fixed

- **Fader levels not syncing from Wing hardware** — root cause: `WingOSCTransport`
  (the UDP socket used to send OSC) was binding to an ephemeral port, so Wing
  sent all GET replies and subscription push events back to that ephemeral port
  rather than to the port our server was listening on. Fixed with a single
  unified UDP socket that both sends *from* and receives *on* `LOCAL_OSC_PORT`
  (2224), so Wing always replies to the right port.

- **Fader dB conversion** — Wing's `/*S` subscription pushes fader values as
  **dB** (e.g. `-3.0`), not raw 0–1. The old code clamped these to 0.0–1.0,
  so every pushed fader read as zero. Fixed with `_wing_db_to_raw()` — a
  piecewise linear converter derived from exact data points in the V3.1.0 docs:
  `raw=0.675@-3dB`, `0.75@0dB`, `0.85@+4dB`, `0.923@+10dB`.

- **No Master strip under Mains 1–4** — the `showMaster` flag was appending a
  disconnected hardcoded strip and not rendering the real main strips. Removed
  `showMaster`; main strips now render as normal strips with `main/1` styled as
  the L/R master (wider border, orange accent).

- **Port 8000 unreachable after BoundUDPClient change** — `BoundUDPClient`
  called `sock.bind()` in `__init__`, then `AsyncIOOSCUDPServer` tried to bind
  the same port. Even with `SO_REUSEPORT`, many Linux/Docker kernels block two
  sockets sharing a UDP port. Fixed by replacing both with `WingOSCTransport` —
  a single `asyncio.DatagramProtocol` that handles send and receive on one socket.

- **Setup wizard and channel settings not loading** — a Python script used raw
  strings with `\`` and `\${}` which wrote literal backslash-backtick and
  backslash-dollar-brace sequences into the JS files. JavaScript template literals
  interpret `\`` as an invalid escape and abort parsing, preventing all JS from
  loading. Fixed by: (a) replacing `\`` occurrences with plain backticks, (b)
  rewriting `_csEQRenderBandDetail` using `document.createElement` and
  `addEventListener` instead of HTML string concatenation to avoid all quote/
  escape conflicts.

- **EQ toggle button showing literal `${eq.on?'on':''}` text** — `\\${` escaped
  template expressions in `_csRenderEQ` and `_csEQRenderBandTabs` were rendering
  as literal text. Fixed by scoped `\\${` → `${` replacement within those
  function bodies.

- **Gate ON/OFF toggle cleared section content** — `_csSendToggle` called
  `_csShowSection` (which calls `_csRenderNavRail`) and then called
  `_csRenderNavRail` again — the double render race cleared the DOM before
  re-population. Fixed by rewriting `_csSendToggle` to render section content
  directly without the cascading call chain.

- **Pan visualiser in Main Sends non-functional** — replaced a non-interactive
  circular scope with a horizontal L–R bar: a track with a blue puck that
  physically moves as the pan slider changes, with a filled region and L/C/R
  labels. The `_csMainPan` handler now calls `sendPan()` and redraws on every
  input event.

- **Main Sends dB column width shifting** — when send level showed `−∞` or a
  multi-digit value (e.g. `−12.3 dB`) the column width changed. Fixed with a
  fixed `width:52px` container and `overflow:hidden` on every dB display.

- **44.1 kHz missing from wizard** — added `44100 Hz (CD Quality)` as the
  first option in the Setup Wizard Step 4 sample rate dropdown.

---

### Changed

- `_csDynParam` split into `_csDynParam` (transfer curve: threshold, ratio,
  knee) and `_csDynEnvParam` (envelope: attack, hold, release) for clarity

---

### Infrastructure

- **Docker `inflight` memory leak warning eliminated** — replaced the `docker-ce-cli`
  apt package installation (which triggered an internal npm chain containing the
  deprecated `inflight` package) with a direct download of the static Docker CLI
  binary from Docker's release server. No npm is invoked at any point during
  the build.
- **`.npmrc` added** — sets `fund=false`, `audit=false`, `loglevel=error` as
  a belt-and-suspenders guard against spurious npm warnings from Docker Buildkit
  or Compose v2 host tooling.

---

## [2.0.0] — 2026-03-26

### Overview
Version 2.0 is a full rewrite of the original prototype. Every layer of the
stack — OSC protocol implementation, mixer state model, strip rendering,
meter engine, and UI — was rebuilt from scratch against the official
**Behringer Wing Remote Protocols V3.1.0** documentation.

### Added

#### Hardware Meter Engine
- Implemented the Wing native binary TCP protocol (port 2222, Channel 3)
  for real hardware VU meter data
- Subscribes to all strip types: channels 1–40, aux 1–8, buses 1–16,
  mains 1–4, matrix 1–8, DCA 1–16
- Parses 2-byte signed big-endian meter words (1/256 dB units) per strip
- Subscription renewed every 4 seconds
- Gate (G) and Dynamics (D) LED indicators lit in real time from hardware
  meter gate_key / dyn_key values

#### Full Strip Type Coverage
- All six Wing strip types: CH 1–40, AUX 1–8, BUS 1–16, MAIN 1–4, MTX 1–8, DCA 1–16
- Layer tabs: CH three tabs (1–16, 17–32, 33–40), BUS/DCA two tabs of 8 each

#### Detail Panel
- EQ curves, compressor, gate, bus sends reflecting actual hardware state
- Bulk state query (~3,200 OSC queries) on every browser connect

#### Other
- Auto-connect with status updates within 500 ms of page load
- Live IP/port change via Setup Wizard without container restart
- Dark and light mode with Material Design SVG icons, persisted to localStorage
- `/*S` subscription push events with correct dB→raw conversion
- Wing probe loop broadcasting `wing_status` to all connected browsers

### Fixed
- OSC port (2222→2223), paths (X32→Wing syntax), mute semantics, solo path,
  subscription command, master path, tab labels, YAML corruption, pan parsing

---

## [1.0.0] — Initial Release

- Basic FastAPI backend with OSC bridge and WebSocket hub
- Single-page HTML UI with Wing-inspired dark theme
- 16-channel strip display with placeholder VU meters
- Setup Wizard (5 steps): environment detection, OSC test, audio config,
  recording format, apply
- Multitrack WAV recording via sounddevice + soundfile
- Docker + docker-compose deployment
