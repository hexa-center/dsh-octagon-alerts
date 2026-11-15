/**
 * Sound alerts — browser half.
 *
 * Watches `uiSession.sessionStatus` (the Session Controller's UI status: running
 * / pending interaction / unread completion) and plays one short synthesized
 * chime per state transition:
 *
 *   approval  — a Session is waiting for the user to grant or deny permission
 *   question  — a Session is waiting for the user to pick an option / answer
 *   done      — a Session stopped running (the turn finished)
 *
 * Each alert kind plays a chime preset the user picks in Settings → General
 * (eight synthesized presets, previewable). The Web Audio graph is created
 * lazily and kept alive for the page; nothing is played while the user has
 * muted the alerts. Mute state, the completion preference and the chosen
 * presets persist in localStorage. A small toggle lives in the Session header
 * utilities for quick muting, and the same preferences appear as rows in
 * Settings → General.
 *
 * Subagent Sessions are ignored: their turns start and stop constantly and
 * would turn the feature into noise.
 */

window.__ModuleLoader__.load({
  id: 'dsh-octagon-alerts',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const LOCALE_NS = 'soundAlerts';
    const STORAGE_KEY = 'dsh:sound-alerts:settings:v1';
    const TOGGLE_ID = 'sound-alerts-toggle';

    /** English keys are the message ids; `zh` carries the translations. */
    const EN = Object.freeze({
      'Sound alerts': 'Sound alerts',
      'Mute sound alerts for all sessions': 'Mute sound alerts for all sessions',
      'Unmute sound alerts for all sessions': 'Unmute sound alerts for all sessions',
      'Choose which chime plays for a choice, an approval, or a finished turn.': 'Choose which chime plays for a choice, an approval, or a finished turn.',
      'Choice chime': 'Choice chime',
      'Approval chime': 'Approval chime',
      'Completion chime': 'Completion chime',
      'Preview': 'Preview',
      'Volume': 'Volume',
      'Volume 100% is the default level; higher values boost the chime.': 'Volume 100% is the default level; higher values boost the chime.',
      'Silent at 0% volume.': 'Silent at 0% volume.',
      'When a Session asks you to pick an option.': 'When a Session asks you to pick an option.',
      'When a Session asks for permission to run a tool.': 'When a Session asks for permission to run a tool.',
      'When a turn finishes.': 'When a turn finishes.',
      'Preview still plays while alerts are muted.': 'Preview still plays while alerts are muted.',
      'When completion chimes': 'When completion chimes',
      'Knock': 'Knock',
      'Bell': 'Bell',
      'Soft descent': 'Soft descent',
      'Arpeggio': 'Arpeggio',
      'Drop': 'Drop',
      'Deep': 'Deep',
      'Marimba': 'Marimba',
      'Pulse': 'Pulse',
      'Only when I am elsewhere': 'Only when I am elsewhere',
      'Every turn': 'Every turn',
    });
    const ZH = Object.freeze({
      'Sound alerts': '音效提醒',
      'Mute sound alerts for all sessions': '静音所有会话的音效',
      'Unmute sound alerts for all sessions': '开启所有会话的音效',
      'Choose which chime plays for a choice, an approval, or a finished turn.': '为等待选择、等待授权、任务结束分别挑选提示音。',
      'Choice chime': '选择提示音',
      'Approval chime': '授权提示音',
      'Completion chime': '完成提示音',
      'Preview': '试听',
      'Volume': '音量',
      'Volume 100% is the default level; higher values boost the chime.': '音量 100% 是默认电平，调高会放大提示音。',
      'Silent at 0% volume.': '音量为 0%，试听无声。',
      'When a Session asks you to pick an option.': '会话请你选择时。',
      'When a Session asks for permission to run a tool.': '会话请求授权时。',
      'When a turn finishes.': '回合结束时。',
      'Preview still plays while alerts are muted.': '静音状态下「试听」仍会发声。',
      'When completion chimes': '完成提示音时机',
      'Knock': '三声轻敲',
      'Bell': '清脆铃',
      'Soft descent': '柔和下行',
      'Arpeggio': '上行琶音',
      'Drop': '水滴',
      'Deep': '低沉双音',
      'Marimba': '木琴',
      'Pulse': '电子脉冲',
      'Only when I am elsewhere': '仅在我不看着时',
      'Every turn': '每个回合',
    });

    /* ------------------------------- settings ------------------------------- */

    /** Default chime preset per alert kind; the presets themselves live below. */
    const DEFAULT_CHIMES = Object.freeze({ approval: 'knock', question: 'bell', done: 'soft' });
    /** Per-kind gain multiplier: 1 is the chime's own level, 2 is twice as loud. */
    const DEFAULT_VOLUMES = Object.freeze({ approval: 1, question: 1, done: 1 });
    const VOLUME_MIN = 0;
    const VOLUME_MAX = 2;

    function clampVolume(value, fallback) {
      const number = typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : Number.NaN;
      if (!Number.isFinite(number)) return fallback;
      const snapped = Math.round(number * 20) / 20;
      return Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, snapped));
    }

    const DEFAULT_SETTINGS = Object.freeze({
      muted: false,
      doneMode: 'away',
      chimes: DEFAULT_CHIMES,
      volumes: DEFAULT_VOLUMES,
    });

    function normalizeSettings(parsed) {
      const chosen = parsed?.chimes && typeof parsed.chimes === 'object' ? parsed.chimes : {};
      const chimes = {};
      for (const kind of Object.keys(DEFAULT_SETTINGS.chimes)) {
        const preset = chosen[kind];
        chimes[kind] = typeof preset === 'string' && CHIME_IDS.includes(preset)
          ? preset
          : DEFAULT_SETTINGS.chimes[kind];
      }
      const chosenVolumes = parsed?.volumes && typeof parsed.volumes === 'object' ? parsed.volumes : {};
      const volumes = {};
      for (const kind of Object.keys(DEFAULT_VOLUMES)) {
        volumes[kind] = clampVolume(chosenVolumes[kind], DEFAULT_VOLUMES[kind]);
      }
      return {
        muted: parsed?.muted === true,
        doneMode: parsed?.doneMode === 'always' ? 'always' : 'away',
        chimes: Object.freeze(chimes),
        volumes: Object.freeze(volumes),
      };
    }

    let settings = DEFAULT_SETTINGS;
    const settingsListeners = new Set();

    function readSettings() {
      try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (typeof raw !== 'string' || raw === '') return { ...DEFAULT_SETTINGS };
        return normalizeSettings(JSON.parse(raw));
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    }

    function updateSettings(patch) {
      const merged = { ...settings, ...patch };
      if (patch?.chimes) merged.chimes = { ...settings.chimes, ...patch.chimes };
      if (patch?.volumes) merged.volumes = { ...settings.volumes, ...patch.volumes };
      settings = Object.freeze(normalizeSettings(merged));
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        /* private mode / storage disabled: keep the in-memory preference */
      }
      for (const listener of [...settingsListeners]) {
        try {
          listener();
        } catch {
          /* a broken toggle must not break the others */
        }
      }
    }

    function subscribeSettings(listener) {
      settingsListeners.add(listener);
      return () => {
        settingsListeners.delete(listener);
      };
    }

    /* -------------------------------- locale -------------------------------- */

    let boundTranslate = null;

    function tr(key) {
      if (boundTranslate) {
        try {
          const value = boundTranslate(key);
          if (typeof value === 'string' && value !== '') return value;
        } catch {
          /* a stale binding after a language switch falls back to the key */
        }
      }
      return key;
    }

    /* --------------------------------- audio -------------------------------- */

    /**
     * Chime presets. A preset is described as notes: `at` is the offset from
     * the start of the chime, `partials` adds quieter overtones so the result
     * reads as a bell rather than a beep. The three defaults (`knock`, `bell`,
     * `soft`) are the original voices; the rest are alternatives the user can
     * pick per alert kind in Settings.
     */
    const CHIMES = Object.freeze({
      knock: Object.freeze({
        level: 0.5,
        notes: Object.freeze([
          Object.freeze({ at: 0, freq: 659.25, dur: 0.13, type: 'triangle', partials: [[2, 0.25]] }),
          Object.freeze({ at: 0.17, freq: 659.25, dur: 0.13, type: 'triangle', partials: [[2, 0.25]] }),
          Object.freeze({ at: 0.34, freq: 659.25, dur: 0.32, type: 'triangle', partials: [[2, 0.2], [3, 0.06]] }),
        ]),
      }),
      bell: Object.freeze({
        level: 0.52,
        notes: Object.freeze([
          Object.freeze({ at: 0, freq: 783.99, dur: 0.45, type: 'sine', partials: [[2, 0.16], [3, 0.05]] }),
          Object.freeze({ at: 0.16, freq: 1046.5, dur: 0.55, type: 'sine', partials: [[2, 0.2], [3, 0.06]] }),
        ]),
      }),
      soft: Object.freeze({
        level: 0.58,
        notes: Object.freeze([
          Object.freeze({ at: 0, freq: 659.25, dur: 0.4, type: 'sine', partials: [[2, 0.1]] }),
          Object.freeze({ at: 0.18, freq: 493.88, dur: 0.75, type: 'sine', partials: [[2, 0.12], [3, 0.04]] }),
        ]),
      }),
      arpeggio: Object.freeze({
        level: 0.46,
        notes: Object.freeze([
          Object.freeze({ at: 0, freq: 523.25, dur: 0.4, type: 'sine', partials: [[2, 0.12]] }),
          Object.freeze({ at: 0.11, freq: 659.25, dur: 0.4, type: 'sine', partials: [[2, 0.12]] }),
          Object.freeze({ at: 0.22, freq: 783.99, dur: 0.4, type: 'sine', partials: [[2, 0.12]] }),
          Object.freeze({ at: 0.33, freq: 1046.5, dur: 0.6, type: 'sine', partials: [[2, 0.18], [3, 0.05]] }),
        ]),
      }),
      drop: Object.freeze({
        level: 0.5,
        notes: Object.freeze([
          Object.freeze({ at: 0, freq: 1174.66, dur: 0.16, type: 'sine', partials: [[2, 0.08]] }),
          Object.freeze({ at: 0.1, freq: 783.99, dur: 0.34, type: 'sine', partials: [[2, 0.1]] }),
        ]),
      }),
      deep: Object.freeze({
        level: 0.6,
        notes: Object.freeze([
          Object.freeze({ at: 0, freq: 220, dur: 0.5, type: 'triangle', partials: [[2, 0.2], [3, 0.06]] }),
          Object.freeze({ at: 0.2, freq: 277.18, dur: 0.9, type: 'triangle', partials: [[2, 0.18], [3, 0.05]] }),
        ]),
      }),
      marimba: Object.freeze({
        level: 0.54,
        notes: Object.freeze([
          Object.freeze({ at: 0, freq: 523.25, dur: 0.14, type: 'triangle', partials: [[4, 0.5]] }),
          Object.freeze({ at: 0.12, freq: 659.25, dur: 0.14, type: 'triangle', partials: [[4, 0.5]] }),
          Object.freeze({ at: 0.24, freq: 783.99, dur: 0.28, type: 'triangle', partials: [[4, 0.45]] }),
        ]),
      }),
      pulse: Object.freeze({
        level: 0.44,
        notes: Object.freeze([
          Object.freeze({ at: 0, freq: 880, dur: 0.09, type: 'sine', partials: [[3, 0.22]] }),
          Object.freeze({ at: 0.12, freq: 880, dur: 0.09, type: 'sine', partials: [[3, 0.22]] }),
        ]),
      }),
    });

    const CHIME_IDS = Object.freeze(Object.keys(CHIMES));
    /** Display names are locale keys; missing ones fall back to the preset id. */
    const CHIME_LABELS = Object.freeze({
      knock: 'Knock',
      bell: 'Bell',
      soft: 'Soft descent',
      arpeggio: 'Arpeggio',
      drop: 'Drop',
      deep: 'Deep',
      marimba: 'Marimba',
      pulse: 'Pulse',
    });

    const ALERT_PRIORITY = Object.freeze({ approval: 0, question: 1, done: 2 });
    /** Only absorbs double fires from one snapshot wave; the diff dedupes repeats. */
    const REPEAT_GUARD_MS = 300;

    let audioContext = null;
    let masterGain = null;
    const lastPlayed = new Map();
    const recentAlerts = [];

    function ensureAudioContext() {
      if (audioContext) return audioContext;
      const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (typeof Ctor !== 'function') return null;
      try {
        audioContext = new Ctor();
        masterGain = audioContext.createGain();
        masterGain.gain.value = 0.26;
        masterGain.connect(audioContext.destination);
      } catch {
        audioContext = null;
        masterGain = null;
      }
      return audioContext;
    }

    function scheduleNote(context, at, freq, type, dur, peak) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const safePeak = Math.max(0.0002, peak);
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.exponentialRampToValueAtTime(safePeak, at + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(freq, at);
      oscillator.connect(envelope);
      envelope.connect(masterGain ?? context.destination);
      oscillator.start(at);
      oscillator.stop(at + dur + 0.03);
    }

    function startChime(voice, volume = 1) {
      const context = ensureAudioContext();
      if (!context) return false;
      const peak = voice.level * clampVolume(volume, 1);
      try {
        if (context.state === 'suspended') {
          Promise.resolve(context.resume?.()).catch(() => {});
        }
        const startAt = context.currentTime + 0.03;
        for (const note of voice.notes) {
          scheduleNote(context, startAt + note.at, note.freq, note.type, note.dur, peak);
          for (const [multiple, amplitude] of note.partials ?? []) {
            scheduleNote(context, startAt + note.at, note.freq * multiple, note.type, note.dur, peak * amplitude);
          }
        }
      } catch {
        return false;
      }
      return true;
    }

    /** The preset the user picked for this alert kind, with a default fallback. */
    function resolveChime(kind) {
      const preset = settings.chimes?.[kind];
      return CHIMES[preset] ?? CHIMES[DEFAULT_CHIMES[kind]] ?? null;
    }

    function playAlert(kind, sessionId) {
      if (settings.muted) return false;
      const voice = resolveChime(kind);
      if (!voice) return false;
      const now = Date.now();
      const guardKey = `${sessionId ?? ''}:${kind}`;
      if (now - (lastPlayed.get(guardKey) ?? 0) < REPEAT_GUARD_MS) return false;
      const volume = settings.volumes?.[kind] ?? 1;
      if (!startChime(voice, volume)) return false;
      lastPlayed.set(guardKey, now);
      recentAlerts.push({ kind, sessionId: sessionId ?? null, at: now });
      if (recentAlerts.length > 50) recentAlerts.shift();
      return true;
    }

    /** The Settings "Preview" button: an explicit request, so mute and the guard do not apply. */
    function previewChime(presetId, volume = 1) {
      const voice = CHIMES[presetId];
      if (!voice) return false;
      return startChime(voice, volume);
    }

    /** A soft single note, so unmuting proves the audio path works right away. */
    function playConfirm() {
      const context = ensureAudioContext();
      if (!context) return false;
      try {
        if (context.state === 'suspended') {
          Promise.resolve(context.resume?.()).catch(() => {});
        }
        const at = context.currentTime + 0.03;
        scheduleNote(context, at, 880, 'sine', 0.28, 0.42);
        scheduleNote(context, at, 1760, 'sine', 0.28, 0.08);
        return true;
      } catch {
        return false;
      }
    }

    function playAlerts(alerts) {
      if (alerts.length === 0) return;
      const ranked = [...alerts].sort((a, b) => ALERT_PRIORITY[a.kind] - ALERT_PRIORITY[b.kind]);
      playAlert(ranked[0].kind, ranked[0].sessionId);
    }

    /* --------------------------- session status diff ------------------------- */

    function interactionKind(status) {
      const pending = status?.pendingInteraction;
      if (!pending) return null;
      return pending.kind === 'approval' ? 'approval' : 'question';
    }

    function interactionKey(status) {
      const pending = status?.pendingInteraction;
      if (!pending) return '';
      return `${interactionKind(status)}:${String(pending.key ?? '')}`;
    }

    function snapshotOf(observable) {
      try {
        const value = observable?.getSnapshot?.();
        return value instanceof Map ? value : null;
      } catch {
        return null;
      }
    }

    /**
     * A completion is worth a chime when the user is not looking at that
     * Session: `completionUnread` is set when a stop happened outside the main
     * view, and a backgrounded window or tab counts as away for the Session
     * that is selected.
     */
    function isWatching(status) {
      if (status?.completionUnread === true) return false;
      try {
        const doc = globalThis.document;
        if (!doc) return false;        if (doc.hidden === true) return false;
        if (typeof doc.hasFocus === 'function' && doc.hasFocus() === false) return false;
      } catch {
        /* no DOM (tests / non-browser host): assume the user is away */
      }
      return true;
    }

    /**
     * Compare two status snapshots and name the alerts that fired in between.
     * Pure with respect to the audio graph, so the behaviour is unit-testable.
     */
    function collectAlerts(previous, next, summaryOf) {
      const alerts = [];
      for (const [sessionId, current] of next) {
        const summary = summaryOf(sessionId);
        if (summary?.origin === 'subagent') continue;
        const before = previous.get(sessionId);
        const kind = interactionKind(current);
        if (kind !== null && interactionKey(current) !== interactionKey(before)) {
          alerts.push({ kind, sessionId });
        }
        if (before?.running === true && current.running === false) {
          const wanted = settings.doneMode === 'always' || !isWatching(current);
          if (wanted) alerts.push({ kind: 'done', sessionId });
        }
      }
      return alerts;
    }

    function safeGet(ctx, name) {
      try {
        return ctx.get(name);
      } catch {
        return undefined;
      }
    }

    function startStatusEngine(ctx) {
      const uiSession = safeGet(ctx, 'uiSession');
      const observable = uiSession?.sessionStatus;
      if (!observable || typeof observable.subscribe !== 'function') {
        // `uiSession` is in this module's inject list, so this only happens when
        // the Client half is loaded without the Session UI: keep the toggle and
        // make the reason discoverable instead of failing silently.
        try {
          globalThis.console?.warn?.('[sound-alerts] uiSession.sessionStatus unavailable; alerts are disabled');
        } catch {
          /* console unavailable */
        }
        return () => {};
      }
      const sessions = safeGet(ctx, 'sessions');
      const summaryOf = (sessionId) => {
        try {
          return sessions?.list?.getSnapshot?.()?.byId?.[sessionId];
        } catch {
          return undefined;
        }
      };
      let previous = snapshotOf(observable) ?? new Map();
      let stopped = false;
      const unsubscribe = observable.subscribe(() => {
        if (stopped) return;
        const next = snapshotOf(observable);
        if (!next) return;
        if (next === previous) return;
        const alerts = collectAlerts(previous, next, summaryOf);
        previous = next;
        if (alerts.length > 0) playAlerts(alerts);
      });
      return () => {
        stopped = true;
        try {
          unsubscribe?.();
        } catch {
          /* already torn down */
        }
      };
    }

    /** Browsers only let a page make noise after the first user gesture. */
    function primeAudioOnGesture() {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
      let done = false;
      const unlock = () => {
        if (done) return;
        done = true;
        cleanup();
        const context = ensureAudioContext();
        if (context?.state === 'suspended') {
          Promise.resolve(context.resume?.()).catch(() => {});
        }
      };
      const cleanup = () => {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
      };
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);
      return cleanup;
    }

    /* -------------------------------- toggle -------------------------------- */

    function SpeakerIcon({ muted }) {
      const common = {
        viewBox: '0 0 16 16',
        width: 16,
        height: 16,
        'aria-hidden': true,
        focusable: false,
        style: { display: 'block' },
      };
      const body = h('path', {
        d: 'M3.2 6.1h2.3L9 3.4v9.2L5.5 9.9H3.2z',
        fill: 'currentColor',
      });
      if (muted) {
        return h('svg', common, body, h('path', {
          d: 'M11.1 5.7l3.4 3.4M14.5 5.7l-3.4 3.4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
        }));
      }
      return h('svg', common, body,
        h('path', {
          d: 'M10.9 5.6a3.4 3.4 0 0 1 0 4.9',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M12.6 4a5.5 5.5 0 0 1 0 8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
        }));
    }

    function SoundToggle() {
      const [muted, setMuted] = React.useState(() => settings.muted);
      const [hover, setHover] = React.useState(false);
      React.useEffect(() => subscribeSettings(() => setMuted(settings.muted)), []);
      const enabled = !muted;
      const name = tr('Sound alerts');
      const action = tr(enabled ? 'Mute sound alerts for all sessions' : 'Unmute sound alerts for all sessions');
      return h('button', {
        type: 'button',
        className: 'dsa-sound-toggle',
        'data-sound-alerts-toggle': enabled ? 'on' : 'off',
        title: action,
        'aria-label': name,
        role: 'switch',
        'aria-checked': enabled ? 'true' : 'false',
        onClick: () => {
          const next = !settings.muted;
          updateSettings({ muted: next });
          if (!next) playConfirm();
        },
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onFocus: () => setHover(true),
        onBlur: () => setHover(false),
        style: {
          display: 'inline-flex',
          flex: 'none',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          padding: 0,
          margin: 0,
          border: 'none',
          borderRadius: 8,
          outlineOffset: 2,
          background: hover ? 'var(--dsw-alias-bg-overlay)' : 'transparent',
          color: 'var(--dsw-alias-label-secondary)',
          cursor: 'pointer',
          transition: 'background-color 120ms ease, color 120ms ease',
          WebkitAppearance: 'none',
          appearance: 'none',
        },
      }, h(SpeakerIcon, { muted }));
    }

    /* ----------------------------- settings rows ----------------------------- */

    const rowStyle = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 16,
      padding: '12px 0',
    };
    const labelColumnStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      flex: '1 1 240px',
      minWidth: 0,
    };
    const titleStyle = { fontSize: 13, lineHeight: '18px', color: 'var(--dsw-alias-label-primary)' };
    const descriptionStyle = { fontSize: 12, lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)' };
    const selectStyle = {
      flex: '0 1 auto',
      minWidth: 88,
      maxWidth: '100%',
      height: 30,
      padding: '0 8px',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: 13,
      outlineOffset: 2,
      cursor: 'pointer',
    };

    function SoundSwitch({ enabled, label, onToggle }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': enabled ? 'true' : 'false',
        'aria-label': label,
        onClick: onToggle,
        style: {
          position: 'relative',
          flex: 'none',
          width: 36,
          height: 20,
          padding: 0,
          border: 'none',
          borderRadius: 10,
          background: enabled ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)',
          cursor: 'pointer',
          outlineOffset: 2,
          transition: 'background-color 120ms ease',
          WebkitAppearance: 'none',
          appearance: 'none',
        },
      }, h('span', {
        style: {
          position: 'absolute',
          top: 2,
          left: enabled ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: 8,
          background: 'var(--dsw-alias-bg-base)',
          transition: 'left 120ms ease',
        },
      }));
    }

    function MuteRow() {
      const [muted, setMuted] = React.useState(() => settings.muted);
      React.useEffect(() => subscribeSettings(() => setMuted(settings.muted)), []);
      const label = tr('Sound alerts');
      return h('div', { style: rowStyle, 'data-sound-alerts-setting': 'mute' },
        h('div', { style: labelColumnStyle },
          h('span', { style: titleStyle }, label),
          h('span', { style: descriptionStyle }, tr('Choose which chime plays for a choice, an approval, or a finished turn.')),
          h('span', { style: descriptionStyle }, tr('Preview still plays while alerts are muted.')),
        ),
        h(SoundSwitch, {
          enabled: !muted,
          label,
          onToggle: () => {
            const next = !settings.muted;
            updateSettings({ muted: next });
            if (!next) playConfirm();
          },
        }));
    }

    function DoneRow() {
      const [doneMode, setDoneMode] = React.useState(() => settings.doneMode);
      React.useEffect(() => subscribeSettings(() => setDoneMode(settings.doneMode)), []);
      const label = tr('When completion chimes');
      return h('div', { style: rowStyle, 'data-sound-alerts-setting': 'done' },
        h('div', { style: labelColumnStyle }, h('span', { style: titleStyle }, label)),
        h('select', {
          value: doneMode,
          'aria-label': label,
          style: selectStyle,
          onChange: (event) => updateSettings({ doneMode: event.target.value === 'always' ? 'always' : 'away' }),
        },
        h('option', { value: 'away' }, tr('Only when I am elsewhere')),
        h('option', { value: 'always' }, tr('Every turn'))));
    }

    const controlGroupStyle = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      flexWrap: 'nowrap',
      gap: 8,
      minWidth: 0,
      flex: '1 1 auto',
    };
    const previewButtonStyle = {
      flex: 'none',
      height: 30,
      padding: '0 10px',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: 12,
      outlineOffset: 2,
      cursor: 'pointer',
      transition: 'background-color 120ms ease',
      WebkitAppearance: 'none',
      appearance: 'none',
    };

    const volumeGroupStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flex: '0 1 auto',
      minWidth: 0,
    };

    const volumeCaptionStyle = {
      flex: 'none',
      fontSize: 12,
      color: 'var(--dsw-alias-label-secondary)',
    };

    const volumeSliderStyle = {
      flex: '1 1 64px',
      minWidth: 48,
      maxWidth: 140,
      height: 30,
      margin: 0,
      accentColor: 'var(--dsw-alias-brand-primary)',
      outlineOffset: 2,
      cursor: 'pointer',
    };

    const volumeValueStyle = {
      flex: 'none',
      minWidth: 34,
      textAlign: 'right',
      fontSize: 12,
      fontVariantNumeric: 'tabular-nums',
      color: 'var(--dsw-alias-label-secondary)',
    };

    function ChimeRow({ alertKind, labelKey, descriptionKey, settingId }) {
      const [preset, setPreset] = React.useState(() => settings.chimes[alertKind] ?? DEFAULT_CHIMES[alertKind]);
      const [volume, setVolume] = React.useState(() => settings.volumes?.[alertKind] ?? 1);
      const [hover, setHover] = React.useState(false);
      React.useEffect(() => subscribeSettings(() => {
        setPreset(settings.chimes[alertKind]);
        setVolume(settings.volumes?.[alertKind] ?? 1);
      }), [alertKind]);
      const label = tr(labelKey);
      const previewLabel = `${tr('Preview')}: ${label}`;
      const volumeLabel = `${tr('Volume')}: ${label}`;
      const volumeHint = tr('Volume 100% is the default level; higher values boost the chime.');
      const sliderId = `sound-alerts-volume-${alertKind}`;
      const percent = Math.round(volume * 100);
      const silent = percent === 0;
      return h('div', { style: rowStyle, 'data-sound-alerts-setting': settingId },
        h('div', { style: labelColumnStyle },
          h('span', { style: titleStyle }, label),
          h('span', { style: descriptionStyle }, tr(descriptionKey)),
        ),
        h('div', { style: controlGroupStyle },
          h('select', {
            value: preset,
            'aria-label': label,
            'data-sound-alerts-chime': alertKind,
            style: selectStyle,
            onChange: (event) => {
              const value = event.target.value;
              updateSettings({ chimes: { [alertKind]: CHIME_IDS.includes(value) ? value : DEFAULT_CHIMES[alertKind] } });
            },
          }, CHIME_IDS.map((id) => h('option', { key: id, value: id }, tr(CHIME_LABELS[id] ?? id)))),
          h('div', { style: volumeGroupStyle },
            h('label', { style: volumeCaptionStyle, htmlFor: sliderId }, tr('Volume')),
            h('input', {
              id: sliderId,
              type: 'range',
              min: 0,
              max: VOLUME_MAX * 100,
              step: 5,
              value: percent,
              'aria-label': volumeLabel,
              'aria-valuetext': `${percent}%`,
              title: volumeHint,
              'data-sound-alerts-volume': alertKind,
              style: volumeSliderStyle,
              onChange: (event) => {
                const next = Number(event.target.value) / 100;
                updateSettings({ volumes: { [alertKind]: clampVolume(next, DEFAULT_VOLUMES[alertKind]) } });
              },
            }),
            h('span', { style: volumeValueStyle, 'aria-hidden': 'true' }, `${percent}%`),
          ),
          h('button', {
            type: 'button',
            className: 'dsa-preview',
            'aria-label': previewLabel,
            title: silent ? tr('Silent at 0% volume.') : previewLabel,
            'data-sound-alerts-preview': alertKind,
            disabled: silent,
            onClick: () => previewChime(
              settings.chimes[alertKind] ?? DEFAULT_CHIMES[alertKind],
              settings.volumes?.[alertKind] ?? 1,
            ),
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
            onFocus: () => setHover(true),
            onBlur: () => setHover(false),
            style: {
              ...previewButtonStyle,
              background: hover && !silent ? 'var(--dsw-alias-bg-overlay)' : 'transparent',
              opacity: silent ? 0.5 : 1,
              cursor: silent ? 'default' : 'pointer',
            },
          }, tr('Preview'))));
    }

    /** One Settings row per alert kind, so each moment can pick its own chime. */
    const CHIME_ROWS = Object.freeze([
      Object.freeze({
        id: 'sound-alerts-choice-chime', order: 26, alertKind: 'question',
        labelKey: 'Choice chime', descriptionKey: 'When a Session asks you to pick an option.', settingId: 'choice',
      }),
      Object.freeze({
        id: 'sound-alerts-approval-chime', order: 27, alertKind: 'approval',
        labelKey: 'Approval chime', descriptionKey: 'When a Session asks for permission to run a tool.', settingId: 'approval',
      }),
      Object.freeze({
        id: 'sound-alerts-done-chime', order: 28, alertKind: 'done',
        labelKey: 'Completion chime', descriptionKey: 'When a turn finishes.', settingId: 'completion-chime',
      }),
    ]);

    /* --------------------------------- apply -------------------------------- */

    function apply(ctx) {
      const locale = safeGet(ctx, 'locale');
      if (locale && typeof locale.register === 'function') {
        ctx.effect(() => {
          const disposers = [];
          try {
            disposers.push(locale.register(LOCALE_NS, 'en', EN));
          } catch {
            /* dictionary already owned: keep the key fallback */
          }
          try {
            disposers.push(locale.register(LOCALE_NS, 'zh', ZH));
          } catch {
            /* same as above */
          }
          return () => {
            for (const dispose of disposers) {
              try {
                dispose?.();
              } catch {
                /* already removed */
              }
            }
          };
        }, 'sound-alerts: locale dictionaries');
      }
      if (locale && typeof locale.bind === 'function') {
        try {
          boundTranslate = locale.bind(LOCALE_NS);
        } catch {
          boundTranslate = null;
        }
      }

      settings = readSettings();
      ctx.effect(() => primeAudioOnGesture(), 'sound-alerts: audio unlock');
      ctx.effect(() => startStatusEngine(ctx), 'sound-alerts: session status listener');

      const slots = ctx.slots;
      if (slots && typeof slots.inject === 'function' && typeof slots.register === 'function') {
        ctx.effect(() => slots.inject('conversation.session.header.utilities', () => slots.register({
          name: 'conversation.session.header.utilities',
          id: TOGGLE_ID,
          order: 30,
          label: () => tr('Sound alerts'),
        }, SoundToggle)), 'sound-alerts: header toggle');
        ctx.effect(() => slots.inject('settings.general.item', () => slots.register({
          name: 'settings.general.item',
          id: 'sound-alerts-mute',
          order: 25,
        }, MuteRow)), 'sound-alerts: general settings mute row');
        for (const row of CHIME_ROWS) {
          ctx.effect(() => slots.inject('settings.general.item', () => slots.register({
            name: 'settings.general.item',
            id: row.id,
            order: row.order,
          }, (props) => h(ChimeRow, { ...row, ...props }))), `sound-alerts: general settings ${row.settingId} chime row`);
        }
        ctx.effect(() => slots.inject('settings.general.item', () => slots.register({
          name: 'settings.general.item',
          id: 'sound-alerts-completion',
          order: 29,
        }, DoneRow)), 'sound-alerts: general settings completion row');
      }
    }

    if (globalThis.__DSH_SOUND_ALERTS_TEST__) {
      globalThis.__dshSoundAlertsTest = {
        alerts: recentAlerts,
        settings: () => ({ ...settings }),
        setMuted: (muted) => updateSettings({ muted: muted === true }),
        setDoneMode: (mode) => updateSettings({ doneMode: mode === 'always' ? 'always' : 'away' }),
        setChime: (kind, preset) => updateSettings({ chimes: { [kind]: preset } }),
        chimes: () => ({ ...settings.chimes }),
        setVolume: (kind, value) => updateSettings({ volumes: { [kind]: clampVolume(Number(value), DEFAULT_VOLUMES[kind]) } }),
        volumes: () => ({ ...settings.volumes }),
        previewAt: (preset, volume) => previewChime(preset, volume),
        clampVolume,
        chimeIds: () => [...CHIME_IDS],
        preview: (preset) => previewChime(preset),
        resetGuard: () => lastPlayed.clear(),
        play: (kind, sessionId) => playAlert(kind, sessionId),
        playConfirm: () => playConfirm(),
        collectAlerts,
      };
    }

    return {
      inject: ['slots', 'locale', 'uiSession', 'sessions'],
      apply,
    };
  },
});
