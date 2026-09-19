import { TILE } from './level.js';

export function proximityLevel(player, monster) {
  return Math.max(0, 1 - Math.hypot(player.x - monster.x, player.y - monster.y) / (8 * TILE));
}

// 無外部素材的低頻距離音效。必須由玩家按鈕啟用，音量隨距離平滑改變。
export function createThreatAudio(button) {
  let context, oscillator, gain;
  let enabled = false;
  const silence = () => {
    if (context && gain) gain.gain.setTargetAtTime(0, context.currentTime, 0.08);
  };
  window.addEventListener('blur', silence);
  const onVisibility = () => { if (document.hidden) silence(); };
  document.addEventListener('visibilitychange', onVisibility);
  button.onclick = async () => {
    try {
      if (!context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        context = new Audio();
        oscillator = context.createOscillator();
        gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 65;
        gain.gain.value = 0;
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
      }
      await context.resume();
      enabled = !enabled;
      button.textContent = enabled ? '距離音效：開' : '距離音效：關';
      button.setAttribute('aria-pressed', String(enabled));
      if (!enabled) silence();
    } catch {
      enabled = false;
      button.textContent = '音效無法啟用';
      button.setAttribute('aria-pressed', 'false');
      silence();
    }
  };
  return {
    update(session) {
      if (!context || !gain) return;
      const level = enabled && session.monsterActive && !document.hidden && document.hasFocus()
        ? proximityLevel(session.player, session.monster) : 0;
      gain.gain.setTargetAtTime(level * level * 0.06, context.currentTime, 0.25);
      oscillator.frequency.setTargetAtTime(55 + 70 * level, context.currentTime, 0.25);
    },
    destroy() {
      window.removeEventListener('blur', silence);
      document.removeEventListener('visibilitychange', onVisibility);
      button.onclick = null;
      if (context) void context.close();
    },
  };
}
