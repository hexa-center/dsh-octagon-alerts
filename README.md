# dsh-octagon-alerts

A DeepSeek Harness client plugin that plays a short synthesized chime when a
Session changes what it needs from you:

- **needs an answer** (question / plan review) — two rising bell notes
- **needs approval** (permission for a tool call) — three even knocks
- **finished its turn** — a softer descending pair. By default it only plays
  when you are not looking at that Session (window in the background or another
  Session selected); Settings → General → Completion chime can switch it to
  every turn

Each moment picks its own chime: Settings → General has one picker per alert
kind, offering eight synthesized presets (Knock, Bell, Soft descent, Arpeggio,
Drop, Deep, Marimba, Pulse) with a **Preview** button and a **Volume** slider per
row (0–200%, where 100% is the default and 200% doubles it). The same preset can
be shared across the three moments or all three can differ, and each moment can
be quieter or louder than the others.

A speaker toggle sits in the Session header utilities, beside the other header
actions. It mutes every Session at once (the preference is stored in
`localStorage` under `dsh:sound-alerts:settings:v1` and survives reloads);
unmuting plays one confirmation note. Five rows in Settings → General mirror the
preferences: a mute switch, the three chime rows (preset, volume, preview) and
the completion-chime timing. Subagent Sessions stay silent, and at most one
chime plays per status change (approval > question > completion).

## Install

Install from npm (fastest, served by the registry CDN):

```
dsh plugin add @octagon-teams/dsh-octagon-alerts
```

Or straight from the repository, no registry involved:

```
dsh plugin add github:hexa-center/dsh-octagon-alerts
```

or, from the prebuilt archive attached to the latest release (faster, no source
download):

```
dsh plugin add https://github.com/hexa-center/dsh-octagon-alerts/releases/latest/download/dsh-octagon-alerts.tgz
```

Once the catalog entry is live, Plugin Manager → Plugin Market lists it as
`dsh-octagon-alerts` under Notifications. Installing from a local checkout also
works (`dsh plugin add /path/to/dsh-octagon-alerts`).

### Slow or blocked GitHub

A profile dependency that points at a remote `.tgz` URL is re-resolved with an
HTTP `HEAD` on every install, and DSH runs that install while it boots. Where
`release-assets.githubusercontent.com` is resettable (mainland China, for one),
that `HEAD` turns into a 10s + 60s retry cycle and a slow or failed start.

Install the same archive from a local file instead — it pins the tarball by
path, so startup never touches the network:

```
curl -LO https://github.com/hexa-center/dsh-octagon-alerts/releases/latest/download/dsh-octagon-alerts.tgz
dsh plugin add ./dsh-octagon-alerts.tgz
```

Swap the file and reinstall to update. Keep the file where you put it: the
profile references that exact path.

## How it works

`client.js` subscribes to `ctx.get('uiSession').sessionStatus` — the Browser-side
Session status snapshot (`running`, `pendingInteraction`, `completionUnread`) —
and diffs consecutive snapshots. Audio is synthesized with the Web Audio API,
so no asset files or network requests are involved. A base gain of 3 is applied
to every envelope, so the default 100% is already 1.5× the original level and
200% is another doubling on top of that. The audio graph is primed on
the first click or keystroke, because browsers block audio until the page has
been interacted with.

## Layout

```
package.json                bundle manifest (host row + client half)
cordis.patch.yml            inserts the host row
index.js                    host half (no Host behaviour)
client.js                   browser half: status diff, chime synth, header toggle
locale/{en,zh}.json         plugin card title / description / detail
docs/                       one-image detail page (DETAIL.md, DETAIL.zh.md),
                            preview illustration, release checklist
test/                       Node tests for the diff, voices and toggle semantics
```

## Tests

```
node --test test/client.test.mjs
```

The test stubs React, `AudioContext` and the Cordis context, then drives
`uiSession.sessionStatus` through the real transitions (question, approval,
watched vs. away completions, per-Session guard, mute, subagents, teardown) and
asserts the chime pickers (per-kind preset resolution, unknown-id fallback,
preview), the per-kind volume (envelope scaling, clamping, inaudible at 0%), the
toggle's switch semantics and locale strings.

## License

MIT
