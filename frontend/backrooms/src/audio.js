import { TILE } from './level.js';

export function proximityLevel(player, monster) {
  return Math.max(0, 1 - Math.hypot(player.x - monster.x, player.y - monster.y) / (15 * TILE));
}

// Start media only from a user gesture. Preview briefly, then follow monster distance.
export function createThreatAudio(button) {
  let context, media, source, gain;
  let enabled = false, destroyed = false, previewUntil = 0;
  let lastSession, lastThreat = false, playPending = false;
  const silence = () => {
    if (context && gain) gain.gain.setTargetAtTime(0, context.currentTime, 0.08);
  };
  const fail = () => {
    enabled = false;
    button.textContent = 'Unable to play Jaws music. Click to retry.';
    button.setAttribute('aria-pressed', 'false');
    media?.pause();
    silence();
  };
  const onVisibility = () => { if (document.hidden) silence(); };
  window.addEventListener('blur', silence);
  document.addEventListener('visibilitychange', onVisibility);
  button.onclick = async () => {
    if (enabled) {
      enabled = false;
      previewUntil = 0;
      media.pause();
      silence();
      button.textContent = 'Jaws music: Off';
      button.setAttribute('aria-pressed', 'false');
      return;
    }
    button.disabled = true;
    try {
      if (!context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        context = new AudioContext();
        gain = context.createGain();
        gain.gain.value = 0;
        gain.connect(context.destination);
        media = new window.Audio(new URL('./assets/jaws.m4a', import.meta.url).href);
        media.loop = true;
        media.preload = 'auto';
        media.addEventListener('error', fail);
        source = context.createMediaElementSource(media);
        source.connect(gain);
      }
      // Both calls happen in the click handler so browser autoplay restrictions are respected.
      await Promise.all([context.resume(), media.play()]);
      if (destroyed) { media.pause(); return; }
      enabled = true;
      previewUntil = context.currentTime + 2;
      gain.gain.setTargetAtTime(0.25, context.currentTime, 0.08);
      button.textContent = 'Jaws music: On';
      button.setAttribute('aria-pressed', 'true');
    } catch { if (!destroyed) fail(); }
    finally { if (!destroyed) button.disabled = false; }
  };
  return {
    update(session) {
      if (!context || !gain) return;
      if (lastSession !== session) {
        if (lastSession) { media.pause(); previewUntil = 0; }
        lastSession = session; lastThreat = false;
      }
      const threat = session.monsterActive && !session.gameOver;
      if (threat && !lastThreat) media.currentTime = 0;
      lastThreat = threat;
      const audible = enabled && !session.gameOver && !document.hidden && document.hasFocus();
      const preview = context.currentTime < previewUntil;
      const shouldPlay = audible && (threat || preview);
      if (shouldPlay && media.paused && !playPending) {
        playPending = true;
        void media.play().catch(() => { if (!destroyed) fail(); }).finally(() => { playPending = false; });
      } else if (!shouldPlay) media.pause();
      const proximity = threat ? proximityLevel(session.player, session.monster) : 0;
      const volume = shouldPlay ? Math.max(preview ? 0.25 : 0, threat ? 0.05 + proximity * proximity * 0.95 : 0) : 0;
      gain.gain.setTargetAtTime(volume, context.currentTime, 0.25);
    },
    destroy() {
      destroyed = true;
      enabled = false;
      window.removeEventListener('blur', silence);
      document.removeEventListener('visibilitychange', onVisibility);
      button.onclick = null;
      if (media) {
        media.removeEventListener('error', fail);
        media.pause();
        media.removeAttribute('src');
        media.load();
      }
      source?.disconnect();
      gain?.disconnect();
      if (context) void context.close();
    },
  };
}
