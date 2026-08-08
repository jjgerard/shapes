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

// Two pieces snapping together -- a short noise "snap" transient layered
// under a quick pitched-down "tock" body, more like a real plastic-piece
// click than a bare tone.
function playClickSound() {
  const ctx = getAudioCtx();
  const now = ctx.currentTime;

  const bufferSize = Math.floor(ctx.sampleRate * 0.025);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 2400;
  noiseFilter.Q.value = 0.8;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.4, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(now);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(720, now);
  osc.frequency.exponentialRampToValueAtTime(190, now + 0.08);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.25, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.1);
}

// A sub-level (or the whole reveal) is fully complete -- a short ascending
// bell-like sparkle.
function playChimeSound() {
  const now = getAudioCtx().currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => playTone(freq, now + i * 0.09, 0.5, { type: 'sine', peakGain: 0.18 }));
}

// A correct guess on the final reveal level -- a bright two-note "ding".
function playCorrectSound() {
  const now = getAudioCtx().currentTime;
  playTone(784, now, 0.12, { type: 'triangle', peakGain: 0.2 });
  playTone(1046.5, now + 0.1, 0.22, { type: 'triangle', peakGain: 0.2 });
}
