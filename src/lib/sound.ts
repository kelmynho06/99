import { triggerLocalNotification } from './capacitorDevice';

export function playOfferAlertSound() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = [880, 1174.66, 1318.51];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.11);

      gain.gain.setValueAtTime(0.001, now + i * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.22, now + i * 0.11 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.11 + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + i * 0.11);
      osc.stop(now + i * 0.11 + 0.24);
    });
  } catch {
    // Ignore autoplay restriction if user hasn't interacted yet
  }
}

function playUrgentRingBurst() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const pattern = [
      { freq: 987.77, start: 0, dur: 0.16 },
      { freq: 1318.51, start: 0.18, dur: 0.18 },
      { freq: 1567.98, start: 0.38, dur: 0.26 },
      { freq: 1318.51, start: 0.7, dur: 0.18 },
      { freq: 1567.98, start: 0.9, dur: 0.3 },
    ];

    pattern.forEach((n) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(n.freq, now + n.start);

      gain.gain.setValueAtTime(0.001, now + n.start);
      gain.gain.exponentialRampToValueAtTime(0.2, now + n.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.02);
    });
  } catch {
    // Ignore audio context block before gesture
  }
}

export function startContinuousRideAlarm(title: string, body: string): () => void {
  let stopped = false;

  const vibrateBurst = () => {
    if (stopped) return;
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([450, 180, 450, 180, 700, 350]);
      }
    } catch {
      // Ignore vibration errors
    }
  };

  playUrgentRingBurst();
  vibrateBurst();
  triggerLocalNotification({
    title,
    body,
    playSound: false,
  });

  const soundInterval = window.setInterval(() => {
    if (!stopped) playUrgentRingBurst();
  }, 1900);

  const vibInterval = window.setInterval(() => {
    if (!stopped) vibrateBurst();
  }, 2400);

  return () => {
    stopped = true;
    window.clearInterval(soundInterval);
    window.clearInterval(vibInterval);
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(0);
      }
    } catch {
      // Ignore
    }
  };
}
