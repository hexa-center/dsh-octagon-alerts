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
row (0–200%, where 100% is the preset's own level). The same preset can be
shared across the three moments or all three can differ, and each moment can be
quieter or louder than the others.

A speaker toggle sits in the Session header utilities, beside the other header
actions. It mutes every Session at once (the preference is stored in
`localStorage` under `dsh:sound-alerts:settings:v1` and survives reloads);
unmuting plays one confirmation note. Five rows in Settings → General mirror the
preferences: a mute switch, the three chime rows (preset, volume, preview) and
the completion-chime timing. Subagent Sessions stay silent, and at most one
chime plays per status change (approval > question > completion).

## Install

No npm package is required — the plugin ships as a single prebuilt archive and as
plain source files:

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

## How it works

`client.js` subscribes to `ctx.get('uiSession').sessionStatus` — the Browser-side
Session status snapshot (`running`, `pendingInteraction`, `completionUnread`) —
and diffs consecutive snapshots. Audio is synthesized with the Web Audio API,
so no asset files or network requests are involved. The audio graph is primed on
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
