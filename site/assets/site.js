// Project site: language choice and the hero's appliance demo.

// Remember an explicit language choice so the English root page stops redirecting to the browser language.
for (const a of document.querySelectorAll('a[hreflang]')) {
  a.addEventListener('click', () => {
    try { localStorage.setItem('lang', a.hreflang); } catch { /* storage blocked: the choice just isn't remembered */ }
  });
}

// Close the language menu when clicking elsewhere.
const langMenu = document.querySelector('.lang');
document.addEventListener('click', e => {
  if (langMenu?.open && !langMenu.contains(e.target)) langMenu.open = false;
});

// Appliance demo: pick an air conditioner, dehumidifier or air purifier, then its mode. The room reading drifts the
// way the appliance would move it, and the ranges match what the plugin exposes: 16-30 °C in 1° steps, target
// humidity 40-70% in 5% steps, and the purifier's air quality graded from PM2.5 with the plugin's thresholds.
const room = document.querySelector('[data-demo]');
if (room) {
  const text = JSON.parse(room.dataset.t);
  const names = JSON.parse(room.querySelector('[data-names]').textContent);
  const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  const deg = v => `${Number.isInteger(v) ? v : v.toFixed(1)}°`;

  const state = {
    ac: { min: 16, max: 30, step: 1, target: 26, now: 29, rest: 29 },
    dehu: { min: 40, max: 70, step: 5, target: 50, now: 68, rest: 68 },
    air: { pm: 42, rest: 42 }
  };
  // PM2.5 (µg/m³) upper bounds for Excellent, Good, Fair and Inferior; anything above is Poor.
  const AQ = [35, 53, 70, 150];
  const PURIFY = { auto: 2, low: 1, high: 3 };

  const device = () => room.querySelector('input[name="device"]:checked').value;
  const mode = d => room.querySelector(`input[name="mode-${d}"]:checked`).value;

  function render() {
    const d = device(), m = mode(d), s = state[d];
    room.dataset.device = d;
    room.dataset.mode = m;
    room.querySelector('[data-name]').textContent = names[d];

    let value, unit = '', now, status;
    if (d === 'ac') {
      value = deg(s.target);
      now = fill(text.now.ac, { t: deg(s.now) });
      status = fill(text.st.ac[m], { t: deg(s.target) });
    } else if (d === 'dehu') {
      value = s.target; unit = '%';
      now = fill(text.now.dehu, { t: `${s.now}%` });
      status = fill(text.st.dehu[m], { t: `${s.target}%` });
    } else {
      value = s.pm; unit = 'µg/m³';
      now = text.now.air;
      const grade = AQ.findIndex(limit => s.pm <= limit);
      status = m === 'off' ? text.st.air.off : fill(text.st.air.on, { q: text.aq[grade < 0 ? AQ.length : grade] });
    }
    room.querySelector('[data-value]').textContent = value;
    room.querySelector('[data-unit]').textContent = unit;
    room.querySelector('[data-now]').textContent = now;
    room.querySelector('[data-status]').textContent = status;

    for (const b of room.querySelectorAll('[data-step]')) {
      const next = s.target + Number(b.dataset.step) * (s.step ?? 1);
      b.disabled = d === 'air' || m === 'off' || next < s.min || next > s.max;
    }
  }

  room.addEventListener('change', render);
  for (const b of room.querySelectorAll('[data-step]')) {
    b.addEventListener('click', () => {
      const s = state[device()];
      s.target = Math.min(s.max, Math.max(s.min, s.target + Number(b.dataset.step) * s.step));
      render();
    });
  }

  const toward = (v, goal, by) => v > goal ? Math.max(goal, v - by) : Math.min(goal, v + by);
  setInterval(() => {
    const ac = state.ac, dehu = state.dehu, air = state.air;
    const acMode = mode('ac'), dehuMode = mode('dehu'), airMode = mode('air');

    // Cooling only lowers the room temperature, heating only raises it; Auto does both. Off drifts back.
    if (acMode === 'off') ac.now = toward(ac.now, ac.rest, 0.5);
    else if ((acMode === 'cool' || acMode === 'auto') && ac.now > ac.target) ac.now -= 0.5;
    else if ((acMode === 'heat' || acMode === 'auto') && ac.now < ac.target) ac.now += 0.5;

    // Auto dries down to the target; continuous and laundry drying keep going.
    if (dehuMode === 'off') dehu.now = toward(dehu.now, dehu.rest, 1);
    else dehu.now = Math.max(dehuMode === 'auto' ? Math.min(dehu.now, dehu.target) : 40, dehu.now - 1);

    air.pm = airMode === 'off' ? toward(air.pm, air.rest, 1) : Math.max(5, air.pm - PURIFY[airMode]);

    render();
  }, 2500);

  render();
}
