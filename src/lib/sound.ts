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
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.11 + 0.02);
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
