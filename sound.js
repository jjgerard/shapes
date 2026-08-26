// Tiny synthesized sound effects (Web Audio API) -- no audio files to
// download, just a few short oscillator envelopes. The AudioContext is
// created lazily on first use (and resumed if suspended) since browsers
// block audio until a user gesture has happened; every caller here already
// runs inside a click/drag handler, so that gesture has already occurred.
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// resume() is ASYNCHRONOUS, and that swallowed the first sound of every
// session. A browser hands you a suspended context until a user gesture has
// happened; the resume() above starts it, but the caller carries straight on
// and schedules its nodes at ctx.currentTime -- a clock that hasn't started
// yet -- so the very first click was silent even though every later one
// worked. Awaiting the promise inside each play* function would push the
// sound past the thing it is meant to accompany.
//
// So open and start the context on the first gesture anywhere on the page --
// typing a name, tapping Start -- which is many seconds before any piece can
// snap. By the time a sound is wanted the clock is already running.
function primeAudio() {
  try { getAudioCtx(); } catch (e) { /* no Web Audio here; every play* no-ops */ }
}
for (const ev of ['pointerdown', 'touchstart', 'keydown']) {
  window.addEventListener(ev, primeAudio, { once: true, capture: true });
}

// Sound is on by default but genuinely switchable, and the choice sticks
// across sessions. This is a classroom app: someone working through it on a
// shared desk, in a quiet room, or with sound sensitivity needs a mute they
// can find immediately, not a reason to close the tab. Every play* function
// below no-ops while muted, so nothing else has to check.
let soundMuted = localStorage.getItem('stb:muted') === '1';
function isSoundMuted() { return soundMuted; }
function setSoundMuted(muted) {
  soundMuted = !!muted;
  localStorage.setItem('stb:muted', soundMuted ? '1' : '0');
}

function playTone(freq, startTime, duration, { type = 'sine', peakGain = 0.2 } = {}) {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

function playNoiseBurst(ctx, startTime, duration, { filterType = 'bandpass', freq = 1500, q = 2, peakGain = 0.4 } = {}) {
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peakGain, startTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(startTime);
}

// Two pieces snapping together -- two layered noise transients (no musical
// tone at all) so it reads as a physical plastic snap-fit click rather than
// an electronic beep: a very short, high, sharp "tick" of first contact,
// immediately followed by a slightly longer, lower "clack" of the piece
// settling in.
function playClickSound() {
  if (soundMuted) return;
  const ctx = getAudioCtx();
  const now = ctx.currentTime;
  playNoiseBurst(ctx, now, 0.014, { filterType: 'highpass', freq: 3800, q: 0.7, peakGain: 0.55 });
  playNoiseBurst(ctx, now + 0.004, 0.032, { filterType: 'bandpass', freq: 1500, q: 2.5, peakGain: 0.4 });
}

// A sub-level (or the whole reveal) is fully complete -- a short ascending
// bell-like sparkle.
function playChimeSound() {
  if (soundMuted) return;
  const now = getAudioCtx().currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => playTone(freq, now + i * 0.09, 0.5, { type: 'sine', peakGain: 0.18 }));
}

// A correct guess on the final reveal level -- a bright two-note "ding".
function playCorrectSound() {
  if (soundMuted) return;
  const now = getAudioCtx().currentTime;
  playTone(784, now, 0.12, { type: 'triangle', peakGain: 0.2 });
  playTone(1046.5, now + 0.1, 0.22, { type: 'triangle', peakGain: 0.2 });
}

// A wrong guess (Level 3/4 quizzes) -- a short two-note descending "buzz",
// low and dull, so it reads as clearly distinct from playCorrectSound's
// bright ascending ding rather than just a quieter version of it.
function playWrongSound() {
  if (soundMuted) return;
  const now = getAudioCtx().currentTime;
  playTone(220, now, 0.16, { type: 'sawtooth', peakGain: 0.15 });
  playTone(174.6, now + 0.09, 0.22, { type: 'sawtooth', peakGain: 0.15 });
}
