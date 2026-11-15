/**
 * Behavioural tests for the sound-alerts client half, run under Node with a
 * fake React, a fake AudioContext and a fake Cordis context. The module's
 * browser entry (`window.__ModuleLoader__.load`) is captured instead of being
 * executed by the real loader.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* ---------------------------- browser substitutes --------------------------- */

class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.ramps = [];
  }
  setValueAtTime(value) {
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value) {
    this.value = value;
    this.ramps.push(value);
    return this;
  }
  linearRampToValueAtTime() {
    return this;
  }
}

class FakeNode {
  constructor() {
    this.gain = new FakeParam(1);
    this.connected = [];
  }
  connect(target) {
    this.connected.push(target);
    return target;
  }
  disconnect() {
    this.connected.length = 0;
  }
}

class FakeOscillator extends FakeNode {
  constructor(registry) {
    super();
    this.registry = registry;
    this.frequency = new FakeParam();
    this.type = 'sine';
    this.startedAt = null;
    this.stoppedAt = null;
  }
  start(at) {
    this.startedAt = at;
    this.registry.started.push({ freq: this.frequency.value, type: this.type, at });
  }
  stop(at) {
    this.stoppedAt = at;
  }
}

class FakeAudioContext {
  static instances = 0;
  static started = [];
  static gains = [];

  constructor() {
    FakeAudioContext.instances += 1;
    this.state = 'running';
    this.currentTime = 10;
    this.destination = new FakeNode();
    this.started = [];
    FakeAudioContext.lastStarted = this.started;
  }
  createGain() {
    const node = new FakeNode();
    FakeAudioContext.gains.push(node);
    return node;
  }
  createOscillator() {
    return new FakeOscillator(this);
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

globalThis.window = { __ModuleLoader__: { load(definition) { globalThis.__capturedModule = definition; } } };
globalThis.__DSH_SOUND_ALERTS_TEST__ = true;
globalThis.AudioContext = FakeAudioContext;

await import('../client.js');

const definition = globalThis.__capturedModule;
assert.ok(definition, 'the client module registers itself through __ModuleLoader__');
assert.equal(definition.id, 'dsh-octagon-alerts');

/* The fake React keeps element trees so the toggle can be asserted on. */
const fakeReact = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children };
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}];
  },
  useEffect() {},
};

const plugin = definition.factory((name) => (name === 'react' ? fakeReact : undefined));
const hook = globalThis.__dshSoundAlertsTest;
assert.ok(hook, 'the test hook is exposed only under the test flag');
assert.deepEqual(
  [...plugin.inject].sort(),
  ['locale', 'sessions', 'slots', 'uiSession'],
  'the client half declares the Session services it reads',
);

/* -------------------------------- harness ---------------------------------- */

function makeHarness() {
  let listener = null;
  let snapshot = new Map();
  const byId = {};
  const registered = [];
  const uiSession = {
    sessionStatus: {
      getSnapshot: () => snapshot,
      subscribe(fn) {
        listener = fn;
        return () => {
          if (listener === fn) listener = null;
        };
      },
    },
  };
  const services = {
    locale: { register: () => () => {}, bind: () => (key) => key },
    sessions: { list: { getSnapshot: () => ({ ids: Object.keys(byId), byId, phase: 'ready' }) } },
    uiSession,
  };
  const effects = [];
  const ctx = {
    get: (name) => services[name],
    effect(fn) {
      const dispose = fn();
      effects.push(dispose);
      return dispose;
    },
    on: () => () => {},
    slots: {
      inject: (_name, register) => register(),
      register(entry, component) {
        registered.push({ entry, component });
        return () => {};
      },
    },
  };
  return {
    ctx,
    registered,
    setById(id, summary) {
      byId[id] = summary;
    },
    publish(next) {
      snapshot = next;
      listener?.();
    },
    get listening() {
      return typeof listener === 'function';
    },
    dispose() {
      for (const dispose of effects.splice(0)) {
        try {
          dispose?.();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

function status(patch = {}) {
  return { running: false, pendingInteraction: undefined, completionUnread: false, ...patch };
}

function startedCount() {
  return FakeAudioContext.lastStarted?.length ?? 0;
}

/** Every envelope ramp target scheduled by `schedule` (boundaries, peaks and all). */
function schedulePeaks(schedule) {
  FakeAudioContext.gains.length = 0;
  schedule();
  return FakeAudioContext.gains.flatMap((node) => node.gain.ramps ?? []);
}

/** Loudest envelope peak scheduled by `schedule`, i.e. the chime level times its volume. */
function loudestPeak(schedule) {
  const peaks = schedulePeaks(schedule).filter((value) => value > 0.0002);
  return peaks.length === 0 ? 0 : Math.max(...peaks);
}

function applyFresh() {
  const harness = makeHarness();
  hook.resetGuard();
  plugin.apply(harness.ctx);
  return harness;
}

/* ---------------------------------- tests ---------------------------------- */

test('subscribes to session status and rings nothing for the baseline', () => {
  const harness = applyFresh();
  assert.equal(harness.listening, true, 'the engine subscribed to uiSession.sessionStatus');
  const before = startedCount();
  harness.publish(new Map([['s1', status({ running: true })]]));
  assert.equal(startedCount(), before, 'the first snapshot after subscribing is a baseline');
  harness.dispose();
});

test('an unanswered question rings the question voice once', () => {
  const harness = applyFresh();
  harness.publish(new Map([['s1', status({ running: true })]]));
  const before = startedCount();
  harness.publish(new Map([['s1', status({ running: true, pendingInteraction: { kind: 'question', key: 'q1', sessionId: 's1' } })]]));
  assert.ok(startedCount() > before, 'the question chime scheduled oscillators');
  assert.deepEqual(hook.alerts.at(-1)?.kind, 'question');

  const afterFirst = startedCount();
  hook.resetGuard();
  harness.publish(new Map([
    ['s1', status({ running: true, pendingInteraction: { kind: 'question', key: 'q1', sessionId: 's1' } })],
    ['s2', status()],
  ]));
  assert.equal(startedCount(), afterFirst, 'the same pending request does not ring again');
  harness.dispose();
});

test('a new approval request rings the approval voice', () => {
  const harness = applyFresh();
  harness.publish(new Map([['s1', status({ running: true, pendingInteraction: { kind: 'question', key: 'q1', sessionId: 's1' } })]]));
  const before = startedCount();
  harness.publish(new Map([['s1', status({ running: true, pendingInteraction: { kind: 'approval', key: 'approval:7', sessionId: 's1' } })]]));
  assert.ok(startedCount() > before);
  assert.equal(hook.alerts.at(-1)?.kind, 'approval');
  harness.dispose();
});

test('a turn that stops running rings the completion voice', () => {
  const harness = applyFresh();
  harness.publish(new Map([['s1', status({ running: true })]]));
  const before = startedCount();
  harness.publish(new Map([['s1', status({ running: false })]]));
  assert.ok(startedCount() > before);
  assert.equal(hook.alerts.at(-1)?.kind, 'done');
  harness.dispose();
});

test('a completion the user is watching stays silent', () => {
  const harness = applyFresh();
  globalThis.document = { hidden: false, hasFocus: () => true };
  try {
    harness.publish(new Map([['s1', status({ running: true })]]));
    const before = startedCount();
    harness.publish(new Map([['s1', status({ running: false })]]));
    assert.equal(startedCount(), before, 'no chime while the Session is in front of the user');

    harness.publish(new Map([['s1', status({ running: true })]]));
    const beforeHidden = startedCount();
    globalThis.document.hidden = true;
    harness.publish(new Map([['s1', status({ running: false })]]));
    assert.ok(startedCount() > beforeHidden, 'a hidden page rings');
  } finally {
    delete globalThis.document;
  }
  harness.dispose();
});

test('a completion in another Session rings even when the window is focused', () => {
  const harness = applyFresh();
  globalThis.document = { hidden: false, hasFocus: () => true };
  try {
    harness.publish(new Map([['s1', status({ running: true })]]));
    const before = startedCount();
    harness.publish(new Map([['s1', status({ running: false, completionUnread: true })]]));
    assert.ok(startedCount() > before, 'completionUnread marks a stop outside the main view');
  } finally {
    delete globalThis.document;
  }
  harness.dispose();
});

test('the completion preference "every turn" rings even while the user watches', () => {
  const harness = applyFresh();
  hook.setDoneMode('always');
  globalThis.document = { hidden: false, hasFocus: () => true };
  try {
    harness.publish(new Map([['s1', status({ running: true })]]));
    const before = startedCount();
    harness.publish(new Map([['s1', status({ running: false })]]));
    assert.ok(startedCount() > before, 'the user asked for a chime on every finished turn');
  } finally {
    hook.setDoneMode('away');
    delete globalThis.document;
  }
  harness.dispose();
});

test('the same voice is not repeated inside the guard window', () => {
  const harness = applyFresh();
  harness.publish(new Map([['s1', status({ running: false })]]));
  harness.publish(new Map([['s1', status({ running: true })]]));
  harness.publish(new Map([['s1', status({ running: false })]]));
  const afterFirstDone = startedCount();
  harness.publish(new Map([['s1', status({ running: true })]]));
  harness.publish(new Map([['s1', status({ running: false })]]));
  assert.equal(startedCount(), afterFirstDone, 'a second completion within the guard window stays silent');
  harness.dispose();
});

test('the guard is per Session, so a second Session still rings', () => {
  const harness = applyFresh();
  harness.publish(new Map([['s1', status({ running: true })], ['s2', status({ running: true })]]));
  const before = startedCount();
  harness.publish(new Map([['s1', status({ running: false })], ['s2', status({ running: true })]]));
  assert.ok(startedCount() > before);
  const afterFirst = startedCount();
  harness.publish(new Map([['s1', status({ running: false })], ['s2', status({ running: false })]]));
  assert.ok(startedCount() > afterFirst, 'another Session finishing right after still rings');
  harness.dispose();
});

test('a muted plugin tracks state without scheduling audio', () => {
  const harness = applyFresh();
  hook.setMuted(true);
  harness.publish(new Map([['s1', status({ running: true })]]));
  const before = startedCount();
  harness.publish(new Map([['s1', status({ running: false })]]));
  assert.equal(startedCount(), before);
  hook.setMuted(false);
  hook.resetGuard();
  const afterUnmute = startedCount();
  harness.publish(new Map([['s1', status({ running: true })]]));
  harness.publish(new Map([['s1', status({ running: false })]]));
  assert.ok(startedCount() > afterUnmute, 'unmuting resumes the chimes');
  harness.dispose();
});

test('subagent sessions stay silent', () => {
  const harness = applyFresh();
  harness.setById('s1', { id: 's1', origin: 'subagent', running: true });
  harness.publish(new Map([['s1', status({ running: true })]]));
  const before = startedCount();
  harness.publish(new Map([['s1', status({ running: false })]]));
  assert.equal(startedCount(), before, 'a subagent turn ending is not a task completion');

  harness.publish(new Map([['s1', status({ running: true, pendingInteraction: { kind: 'question', key: 'sq1', sessionId: 's1' } })]]));
  assert.equal(startedCount(), before, 'a subagent question is not the user being asked');
  harness.dispose();
});

test('disposing the plugin detaches the listener', () => {
  const harness = applyFresh();
  harness.publish(new Map([['s1', status({ running: false })]]));
  harness.dispose();
  assert.equal(harness.listening, false);
  const before = startedCount();
  harness.publish(new Map([['s1', status({ running: true })]]));
  harness.publish(new Map([['s1', status({ running: false })]]));
  assert.equal(startedCount(), before, 'a torn-down engine is inert');
});

test('requiring approval, question and completion use three different note sets', () => {
  const frequencies = {};
  for (const kind of ['approval', 'question', 'done']) {
    const harness = applyFresh();
    hook.resetGuard();
    const before = startedCount();
    hook.play(kind, `voice-${kind}`);
    frequencies[kind] = (FakeAudioContext.lastStarted ?? []).slice(before).map((entry) => Math.round(entry.freq * 100) / 100);
    assert.ok(frequencies[kind].length > 0, `${kind} scheduled notes`);
    harness.dispose();
  }
  assert.notDeepEqual(frequencies.approval, frequencies.question);
  assert.notDeepEqual(frequencies.question, frequencies.done);
  assert.notDeepEqual(frequencies.approval, frequencies.done);
  assert.ok(
    frequencies.approval.every((freq) => Math.abs(freq / 659.25 - Math.round(freq / 659.25)) < 0.01),
    'approval is a flat knock (overtones stay at multiples of 659.25Hz), not a rising figure',
  );
});

test('the header toggle exposes switch semantics and unmutes with feedback', () => {
  const harness = applyFresh();
  const entry = harness.registered.find((item) => item.entry.id === 'sound-alerts-toggle');
  assert.ok(entry, 'the toggle registered into conversation.session.header.utilities');
  assert.equal(entry.entry.order, 30);
  hook.setMuted(false);
  const button = entry.component();
  assert.equal(button.type, 'button');
  assert.equal(button.props.role, 'switch');
  assert.equal(button.props['aria-checked'], 'true');
  assert.equal(button.props['aria-label'], 'Sound alerts');
  assert.equal(button.props.title, 'Mute sound alerts for all sessions');
  assert.equal(button.props['data-sound-alerts-toggle'], 'on');
  assert.equal(button.props.style.flex, 'none');
  assert.equal(button.props.style.color, 'var(--dsw-alias-label-secondary)');

  hook.setMuted(true);
  const mutedButton = entry.component();
  assert.equal(mutedButton.props['aria-checked'], 'false');
  assert.equal(mutedButton.props['data-sound-alerts-toggle'], 'off');
  assert.equal(mutedButton.props.title, 'Unmute sound alerts for all sessions');
  assert.equal(mutedButton.props.style.color, 'var(--dsw-alias-label-secondary)', 'the mute state is not dimmed');

  hook.resetGuard();
  const before = startedCount();
  mutedButton.props.onClick();
  assert.equal(hook.settings().muted, false, 'clicking the muted toggle unmutes');
  assert.ok(startedCount() > before, 'unmuting plays a confirmation note');
  harness.dispose();
});

test('General settings rows expose the mute switch, one chime picker per kind, and the completion choice', () => {
  const harness = applyFresh();
  const row = (id) => harness.registered.find((item) => item.entry.id === id);
  const muteRow = row('sound-alerts-mute');
  const choiceRow = row('sound-alerts-choice-chime');
  const approvalRow = row('sound-alerts-approval-chime');
  const doneChimeRow = row('sound-alerts-done-chime');
  const doneRow = row('sound-alerts-completion');
  for (const [name, entry] of Object.entries({ muteRow, choiceRow, approvalRow, doneChimeRow, doneRow })) {
    assert.ok(entry, `${name} registered into settings.general.item`);
  }
  assert.deepEqual(
    [muteRow, choiceRow, approvalRow, doneChimeRow, doneRow].map((item) => item.entry.order),
    [25, 26, 27, 28, 29],
    'the rows are ordered mute → choice → approval → completion chime → completion timing',
  );

  hook.setMuted(false);
  hook.setDoneMode('away');
  const mute = muteRow.component();
  assert.equal(mute.props['data-sound-alerts-setting'], 'mute');
  const [labelColumn, soundSwitch] = mute.children;
  assert.equal(labelColumn.children[0].children[0], 'Sound alerts');
  assert.equal(labelColumn.children[1].children[0], 'Choose which chime plays for a choice, an approval, or a finished turn.');
  assert.equal(labelColumn.children[2].children[0], 'Preview still plays while alerts are muted.');
  assert.equal(soundSwitch.props.enabled, true);
  const switchNode = soundSwitch.type(soundSwitch.props);
  assert.equal(switchNode.props.role, 'switch');
  assert.equal(switchNode.props['aria-checked'], 'true');
  switchNode.props.onClick();
  assert.equal(hook.settings().muted, true, 'the settings switch mutes');

  const done = doneRow.component();
  assert.equal(done.props['data-sound-alerts-setting'], 'done');
  assert.equal(
    done.children[0].children[0].children[0],
    'When completion chimes',
    'the timing row is not confused with the completion chime picker',
  );
  const select = done.children[1];
  assert.equal(select.type, 'select');
  assert.equal(select.props.value, 'away');
  assert.deepEqual(
    select.children.map((option) => [option.props.value, option.children[0]]),
    [
      ['away', 'Only when I am elsewhere'],
      ['always', 'Every turn'],
    ],
  );
  select.props.onChange({ target: { value: 'always' } });
  assert.equal(hook.settings().doneMode, 'always', 'the settings select writes the completion preference');
  hook.setMuted(false);
  hook.setDoneMode('away');
  harness.dispose();
});

/* ------------------------------ chime presets ------------------------------ */

test('every alert kind starts on its own default preset', () => {
  applyFresh().dispose();
  assert.deepEqual(hook.chimes(), { approval: 'knock', question: 'bell', done: 'soft' });
  assert.deepEqual(hook.chimeIds(), ['knock', 'bell', 'soft', 'arpeggio', 'drop', 'deep', 'marimba', 'pulse']);
});

test('the preset picked for a kind is the one that rings', () => {
  const harness = applyFresh();
  hook.setChime('question', 'arpeggio');
  hook.resetGuard();
  const before = startedCount();
  hook.play('question', 'picked');
  const frequencies = (FakeAudioContext.lastStarted ?? []).slice(before).map((entry) => Math.round(entry.freq * 100) / 100);
  assert.ok(frequencies.includes(523.25), 'the arpeggio starts on C5 instead of the bell figure');
  assert.ok(frequencies.includes(1046.5), 'the arpeggio still climbs to C6');
  hook.setChime('question', 'bell');
  harness.dispose();
});

test('an unknown or missing preset falls back to the kind default', () => {
  const harness = applyFresh();
  hook.setChime('approval', 'nope');
  assert.equal(hook.chimes().approval, 'knock', 'an unknown preset id is stored as the default');
  hook.setChime('done', 'marimba');
  assert.equal(hook.chimes().done, 'marimba', 'a valid preset is kept');
  hook.setChime('done', 'soft');
  harness.dispose();
});

test('picking a preset for one kind leaves the other kinds alone', () => {
  const harness = applyFresh();
  hook.setChime('done', 'pulse');
  assert.deepEqual(hook.chimes(), { approval: 'knock', question: 'bell', done: 'pulse' });
  hook.setChime('done', 'soft');
  harness.dispose();
});

test('an older stored setting without chimes upgrades to the default presets', () => {
  globalThis.localStorage = {
    getItem: () => JSON.stringify({ muted: true, doneMode: 'always' }),
    setItem() {},
  };
  try {
    const legacy = makeHarness();
    plugin.apply(legacy.ctx);
    assert.deepEqual(hook.chimes(), { approval: 'knock', question: 'bell', done: 'soft' }, 'missing presets fall back to the defaults');
    assert.equal(hook.settings().muted, true, 'the existing mute preference survives');
    assert.equal(hook.settings().doneMode, 'always', 'the existing timing preference survives');
    assert.deepEqual(hook.volumes(), { approval: 1, question: 1, done: 1 }, 'missing volumes upgrade to full volume');
    legacy.dispose();

    globalThis.localStorage = {
      getItem: () => JSON.stringify({ muted: false, doneMode: 'away', chimes: { question: 'marimba', approval: 'bogus' } }),
      setItem() {},
    };
    const damaged = makeHarness();
    plugin.apply(damaged.ctx);
    assert.deepEqual(
      hook.chimes(),
      { approval: 'knock', question: 'marimba', done: 'soft' },
      'a valid stored preset is kept and an unknown one is replaced by the default',
    );
    damaged.dispose();
  } finally {
    delete globalThis.localStorage;
    hook.setMuted(false);
    hook.setDoneMode('away');
  }
});

test('three kinds can ring three different presets at the same time', () => {
  const harness = applyFresh();
  hook.setChime('question', 'arpeggio');
  hook.setChime('approval', 'deep');
  hook.setChime('done', 'bell');
  hook.resetGuard();
  const picked = {};
  for (const kind of ['question', 'approval', 'done']) {
    const before = startedCount();
    hook.play(kind, `multi-${kind}`);
    picked[kind] = (FakeAudioContext.lastStarted ?? []).slice(before).map((entry) => Math.round(entry.freq * 100) / 100);
  }
  assert.ok(picked.question.every((freq) => freq >= 523.25), 'the arpeggio never drops below its first note');
  assert.ok(picked.question.includes(523.25) && picked.question.includes(1046.5));
  assert.notDeepEqual(picked.question, picked.approval);
  assert.notDeepEqual(picked.approval, picked.done);
  assert.ok(picked.approval.includes(220) && picked.approval.includes(277.18), 'deep stays in the low register');
  assert.ok(picked.done.includes(783.99) && picked.done.includes(1046.5), 'the completion now rings the bell figure');
  hook.setChime('question', 'bell');
  hook.setChime('approval', 'knock');
  hook.setChime('done', 'soft');
  harness.dispose();
});

test('the preview button rings the chosen preset even while muted', () => {
  const harness = applyFresh();
  hook.setMuted(true);
  hook.setChime('question', 'drop');
  const before = startedCount();
  assert.equal(hook.preview('drop'), true);
  assert.ok(startedCount() > before, 'a preview is an explicit request and ignores mute');
  const afterDrop = startedCount();
  assert.equal(hook.preview('nope'), false, 'an unknown preset previews nothing');
  assert.equal(startedCount(), afterDrop);
  hook.setMuted(false);
  hook.setChime('question', 'bell');
  harness.dispose();
});

test('the chime rows list every preset, write the choice, and preview the current one', () => {
  const harness = applyFresh();
  const entry = harness.registered.find((item) => item.entry.id === 'sound-alerts-approval-chime');
  assert.ok(entry, 'the approval chime row registered');
  const wrapper = entry.component(entry.entry);
  assert.equal(wrapper.type.name, 'ChimeRow', 'the slot renders the shared chime row component');
  const node = wrapper.type(wrapper.props);
  assert.equal(node.props['data-sound-alerts-setting'], 'approval');
  const [labelColumn, controls] = node.children;
  assert.equal(labelColumn.children[0].children[0], 'Approval chime');
  assert.equal(labelColumn.children[1].children[0], 'When a Session asks for permission to run a tool.');
  const [select, volumeGroup, preview] = controls.children;
  assert.equal(select.type, 'select');
  assert.equal(select.props.value, 'knock');
  const [volumeCaption, volumeSlider, volumeValue] = volumeGroup.children;
  assert.equal(volumeCaption.type, 'label', 'the caption is a real label');
  assert.equal(volumeCaption.children[0], 'Volume');
  assert.equal(volumeCaption.props.htmlFor, 'sound-alerts-volume-approval', 'the label targets the slider');
  assert.equal(volumeSlider.type, 'input');
  assert.equal(volumeSlider.props.type, 'range');
  assert.equal(volumeSlider.props.min, 0);
  assert.equal(volumeSlider.props.max, 200, 'the slider can boost as well as reduce');
  assert.equal(volumeSlider.props.step, 5);
  assert.equal(volumeSlider.props.value, 100);
  assert.equal(volumeSlider.props['aria-label'], 'Volume: Approval chime');
  assert.equal(volumeSlider.props['aria-valuetext'], '100%');
  assert.equal(volumeSlider.props.id, 'sound-alerts-volume-approval');
  assert.match(volumeSlider.props.title, /100% is the default level/, 'the slider explains the 100% baseline');
  assert.equal(volumeValue.children[0], '100%');
  const options = select.children.flat();
  assert.deepEqual(
    options.map((option) => option.props.value),
    hook.chimeIds(),
    'every preset is offered in the picker',
  );
  assert.equal(options[0].children[0], 'Knock', 'preset names are localized keys, not ids');
  select.props.onChange({ target: { value: 'marimba' } });
  assert.equal(hook.chimes().approval, 'marimba', 'the picker writes the per-kind choice');
  assert.equal(preview.props['aria-label'], 'Preview: Approval chime');
  hook.resetGuard();
  const before = startedCount();
  preview.props.onClick();
  assert.ok(startedCount() > before, 'the preview button plays the selected preset');
  select.props.onChange({ target: { value: 'knock' } });
  assert.equal(hook.chimes().approval, 'knock', 'the picker can go back to the default preset');
  volumeSlider.props.onChange({ target: { value: '50' } });
  assert.equal(hook.volumes().approval, 0.5, 'the slider writes the per-kind volume');
  hook.resetGuard();
  const halfPeak = loudestPeak(() => preview.props.onClick());
  assert.ok(Math.abs(halfPeak - 0.25) < 1e-9, `the preview honours the row volume (got ${halfPeak})`);
  hook.resetGuard();
  hook.setChime('approval', 'knock');
  hook.setVolume('approval', 1);
  harness.dispose();
});

test('every alert kind starts at full volume', () => {
  applyFresh().dispose();
  assert.deepEqual(hook.volumes(), { approval: 1, question: 1, done: 1 });
});

test('lowering one kind scales its envelope and leaves the others alone', () => {
  const harness = applyFresh();
  hook.setChime('question', 'bell');
  hook.resetGuard();
  const full = loudestPeak(() => hook.play('question', 'volume-full'));
  hook.setVolume('question', 0.5);
  hook.resetGuard();
  const half = loudestPeak(() => hook.play('question', 'volume-half'));
  assert.ok(Math.abs(full - 0.52) < 1e-9, `full volume keeps the preset level (got ${full})`);
  assert.ok(Math.abs(half - 0.26) < 1e-9, `half volume halves the envelope peak (got ${half})`);
  assert.equal(hook.volumes().approval, 1, 'the approval volume is untouched');
  hook.setVolume('question', 1);
  harness.dispose();
});

test('a boosted volume reaches twice the preset level', () => {
  const harness = applyFresh();
  hook.resetGuard();
  const full = loudestPeak(() => hook.play('done', 'volume-boost-full'));
  hook.setVolume('done', 2);
  hook.resetGuard();
  const boosted = loudestPeak(() => hook.play('done', 'volume-boost-loud'));
  assert.ok(Math.abs(boosted - full * 2) < 1e-9, `200% doubles the preset level (got ${boosted} vs ${full})`);
  hook.setVolume('done', 1);
  harness.dispose();
});

test('volume zero still counts the alert but schedules silence', () => {
  const harness = applyFresh();
  hook.setVolume('approval', 0);
  hook.resetGuard();
  let played = null;
  const peaks = schedulePeaks(() => {
    played = hook.play('approval', 'volume-silent');
  });
  assert.equal(played, true, 'the alert is still delivered so the status diff stays observable');
  assert.ok(peaks.length > 0, 'notes are still scheduled');
  assert.ok(Math.max(...peaks) <= 0.0002, `every envelope stays inaudible (got ${Math.max(...peaks)})`);
  assert.equal(hook.alerts.at(-1)?.sessionId, 'volume-silent');
  hook.setVolume('approval', 1);
  harness.dispose();
});

test('volumes clamp to 0..200% and reject garbage', () => {
  const harness = applyFresh();
  hook.setVolume('done', 5);
  assert.equal(hook.volumes().done, 2, 'above the ceiling clamps to 200%');
  hook.setVolume('done', -3);
  assert.equal(hook.volumes().done, 0, 'below zero clamps to silence');
  hook.setVolume('done', 'loud');
  assert.equal(hook.volumes().done, 1, 'unreadable values fall back to full volume');
  hook.setVolume('done', '0.5');
  assert.equal(hook.volumes().done, 0.5, 'numeric strings are accepted');
  hook.setVolume('done', 1);
  harness.dispose();
});

test('a stored volume outside the range is clamped on load', () => {
  globalThis.localStorage = {
    getItem: () => JSON.stringify({ muted: false, doneMode: 'away', chimes: {}, volumes: { question: 5, approval: 0.4, done: 'x' } }),
    setItem() {},
  };
  try {
    const stored = makeHarness();
    plugin.apply(stored.ctx);
    assert.deepEqual(hook.volumes(), { approval: 0.4, question: 2, done: 1 }, 'valid values survive, out-of-range ones clamp');
    stored.dispose();
  } finally {
    delete globalThis.localStorage;
  }
});

test('a zero volume disables that row preview and explains why', () => {
  const harness = applyFresh();
  hook.setVolume('done', 0);
  const entry = harness.registered.find((item) => item.entry.id === 'sound-alerts-done-chime');
  const wrapper = entry.component(entry.entry);
  const node = wrapper.type(wrapper.props);
  const [, , preview] = node.children[1].children;
  assert.equal(preview.props.disabled, true, 'a silent volume cannot be previewed');
  assert.equal(preview.props.title, 'Silent at 0% volume.');
  hook.setVolume('done', 1);
  harness.dispose();
});
