/**
 * wizard.js — renderer-side driver for the 4-step GUI setup wizard (T030). Talks to the main
 * process ONLY through `window.meridianos` (exposed by preload.js's contextBridge) — no direct
 * Node/Electron API access from this (untrusted, web-standards) context.
 */
(() => {
  const steps = Array.from(document.querySelectorAll('.step'));
  let current = 1;

  function showStep(n) {
    steps.forEach((el) => el.classList.toggle('active', Number(el.dataset.step) === n));
    current = n;
  }

  document.querySelectorAll('[data-next]').forEach((btn) => btn.addEventListener('click', () => showStep(current + 1)));
  document.querySelectorAll('[data-back]').forEach((btn) => btn.addEventListener('click', () => showStep(current - 1)));

  document.getElementById('finish').addEventListener('click', async () => {
    const statusEl = document.getElementById('status');
    statusEl.textContent = 'Saving...';
    statusEl.className = 'status';

    const anthropicKey = document.getElementById('anthropic-key').value.trim();
    const deepseekKey = document.getElementById('deepseek-key').value.trim();
    const budget = document.getElementById('budget').value;

    try {
      if (anthropicKey) {
        const r = await window.meridianos.saveApiKey('anthropic', anthropicKey);
        if (!r.ok) throw new Error(`Anthropic key: ${r.error}`);
      }
      if (deepseekKey) {
        const r = await window.meridianos.saveApiKey('deepseek', deepseekKey);
        if (!r.ok) throw new Error(`DeepSeek key: ${r.error}`);
      }
      statusEl.textContent = 'Starting MeridianOS...';
      const result = await window.meridianos.finishSetup(Number(budget) || 0);
      if (!result.healthy) throw new Error('Daemon did not become healthy — check the logs.');
      statusEl.textContent = 'Done — loading dashboard...';
      statusEl.className = 'status ok';
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.className = 'status error';
    }
  });
})();
