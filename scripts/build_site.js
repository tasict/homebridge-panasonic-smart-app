// Builds the project site pages (site/index.html, site/<lang>/index.html) from scripts/site_text.json.
// Usage: node scripts/build_site.js
// Page copy lives in site_text.json (a \n in the headline marks where it breaks). Shared CSS/JS and images are in
// site/assets/ and are edited directly. Published to GitHub Pages by .github/workflows/pages.yml.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const T = JSON.parse(fs.readFileSync(path.join(__dirname, 'site_text.json'), 'utf8'));

const BASE = 'https://tasict.github.io/homebridge-panasonic-smart-app/';
const REPO = 'https://github.com/tasict/homebridge-panasonic-smart-app';
const NPM = 'https://www.npmjs.com/package/homebridge-panasonic-smart-app';
const PAYPAL = 'https://paypal.me/tasict';
const BOBA = 'https://tasict.bobaboba.me';

// [hreflang, directory, html lang, native name, og locale]
const LANGS = [
  ['en', '', 'en', 'English', 'en_US'],
  ['zh-TW', 'zh-TW/', 'zh-Hant-TW', '繁體中文', 'zh_TW'],
  ['ja', 'ja/', 'ja', '日本語', 'ja_JP']
];

// The device types the plugin supports, in the order they appear everywhere on the page.
const DEVICES = ['ac', 'dehu', 'air'];

const svg = (body, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const GLOBE = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2.2 2.3 3.2 4.8 3.2 7.5s-1 5.2-3.2 7.5c-2.2-2.3-3.2-4.8-3.2-7.5s1-5.2 3.2-7.5z"/></svg>';
// One glyph per device type, used on the demo tile, the feature cards and the settings preview.
const GLYPH = {
  ac: svg('<rect x="2.5" y="5" width="19" height="7.5" rx="2.5"/><path d="M6 10h12M8 16q4 1.6 8 0M10 19.5q2 .9 4 0"/>'),
  dehu: svg('<rect x="6" y="3" width="12" height="18" rx="3"/><path d="M9 6.5h6M9 9h6"/><path d="M12 12.5c1.4 1.7 2.1 2.9 2.1 3.8a2.1 2.1 0 0 1-4.2 0c0-.9.7-2.1 2.1-3.8z"/>'),
  air: svg('<rect x="7" y="2.5" width="10" height="19" rx="5"/><circle cx="12" cy="13" r="2.6"/><path d="M10 6.5h4"/>'),
  other: svg('<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M5 10h14M8 6.5v1M8 13v2"/>')
};
const PHONE = svg('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M9.5 12 12 9.8l2.5 2.2M10.3 11.3v3.2h3.4v-3.2"/>');
const HUB = svg('<rect x="3" y="5" width="18" height="6" rx="1.5"/><rect x="3" y="13" width="18" height="6" rx="1.5"/><path d="M7 8h.01M7 16h.01"/>');
const MODULE = svg('<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M8.5 5.8a5 5 0 0 1 7 0M6.3 3.6a8 8 0 0 1 11.4 0"/><path d="M8 14.5h.01M11 14.5h5"/>');
const CLOUD = svg('<path d="M7 18.5h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.3A4.7 4.7 0 0 0 7 18.5z"/>');

// The hero's three appliances, drawn in one frame; the CSS shows the chosen one and animates its air.
const SCENE = alt => `<svg class="scene" viewBox="0 0 480 250" role="img" aria-label="${e(alt)}">
      <g class="dev dev-ac">
        <rect class="body" x="40" y="18" width="400" height="98" rx="28"/>
        <rect class="vent" x="84" y="88" width="312" height="11" rx="5.5"/>
        <circle class="led" cx="398" cy="46" r="5"/>
        <g class="air down">
          <path d="M120 142q120 42 240 0"/>
          <path d="M150 186q90 34 180 0"/>
          <path d="M182 226q58 24 116 0"/>
        </g>
      </g>
      <g class="dev dev-dehu">
        <rect class="body" x="176" y="86" width="128" height="156" rx="24"/>
        <path class="vent" d="M204 104h72M204 116h72"/>
        <rect class="tank" x="194" y="170" width="92" height="54" rx="12"/>
        <rect class="water" x="194" y="196" width="92" height="28" rx="12"/>
        <circle class="led" cx="282" cy="140" r="5"/>
        <g class="air up">
          <path d="M196 70q44-22 88 0"/>
          <path d="M210 44q30-16 60 0"/>
          <path d="M222 20q18-10 36 0"/>
        </g>
      </g>
      <g class="dev dev-air">
        <rect class="body" x="190" y="80" width="100" height="164" rx="50"/>
        <circle class="grille" cx="240" cy="170" r="30"/>
        <circle class="grille" cx="240" cy="170" r="16"/>
        <path class="vent" d="M218 102h44"/>
        <circle class="led" cx="240" cy="222" r="5"/>
        <g class="air up">
          <path d="M196 66q44-22 88 0"/>
          <path d="M210 40q30-16 60 0"/>
          <path d="M222 16q18-10 36 0"/>
        </g>
      </g>
    </svg>`;

// Root page only: send first-time visitors to their browser language; an explicit choice (saved by site.js) wins.
const REDIRECT = `<script>
try {
  if (!localStorage.getItem('lang')) {
    const pick = tag => {
      const t = tag.toLowerCase();
      if (t.startsWith('zh')) return 'zh-TW';
      return ['ja', 'en'].find(l => t.startsWith(l));
    };
    const lang = (navigator.languages || [navigator.language]).map(pick).find(Boolean);
    if (lang && lang !== 'en') location.replace(lang + '/' + location.search + location.hash);
  }
} catch { /* storage blocked: stay on English */ }
</script>
`;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
function e(s) { return String(s).replace(/[&<>"']/g, c => ESC[c]); }

function page([code, dir, htmlLang, native, og]) {
  const t = T[code];
  const up = dir ? '../' : '';
  const a = `${up}assets/`;

  const alts = LANGS.map(([c, d]) => `<link rel="alternate" hreflang="${c}" href="${BASE}${d}">`).join('\n');
  const menu = LANGS.map(([c, d, hl, nm]) =>
    `<li><a href="${up + d || './'}" hreflang="${c}" lang="${hl}"${c === code ? ' aria-current="page"' : ''}>${e(nm)}</a></li>`).join('');
  const pairs = (items, tag = 'li') => items.map(([h, p]) => `<${tag}><h3>${e(h)}</h3><p>${e(p)}</p></${tag}>`).join('');

  // Demo strings for site.js.
  const demoText = { st: t.st, now: t.now, aq: t.aq };
  const picker = DEVICES.map(d =>
    `<label><input type="radio" name="device" value="${d}"${d === 'ac' ? ' checked' : ''}><span>${e(t.devices[d])}</span></label>`).join('');
  const modeSets = DEVICES.map(d => {
    const modes = Object.entries(t.modes[d]).map(([m, label], i) =>
      `<label><input type="radio" name="mode-${d}" value="${m}"${i === 1 ? ' checked' : ''}><span>${e(label)}</span></label>`).join('');
    return `<fieldset class="seg modes" data-for="${d}"><legend>${e(t.mode_legend)}</legend>${modes}</fieldset>`;
  }).join('\n          ');
  const tileIcons = DEVICES.map(d => `<span class="tile-icon" data-for="${d}">${GLYPH[d]}</span>`).join('');

  const flowIcons = [PHONE, HUB, MODULE];
  const flow = t.flow.map(([name, sub], i) =>
    `<li class="node"><span class="node-icon">${flowIcons[i]}</span><strong>${e(name)}</strong><small>${e(sub)}</small></li>` +
    (i < t.flow_links.length ? `<li class="link" aria-hidden="true"><span>${e(t.flow_links[i])}</span></li>` : '')).join('\n        ');

  const kinds = DEVICES.map(d => `<li class="kind">
        <span class="kind-icon">${GLYPH[d]}</span>
        <h3>${e(t.devices[d])}</h3>
        <ul>${t.kinds[d].map(x => `<li>${e(x)}</li>`).join('')}</ul>
      </li>`).join('\n      ');

  // A static preview of the plugin's settings screen: one card per device, with the switch that keeps it in HomeKit.
  const cards = t.preview.map(([glyph, name, type, chips, supported]) => `<div class="pv-card${supported ? '' : ' pv-off'}">
          <span class="pv-icon">${GLYPH[glyph]}</span>
          <div class="pv-title"><strong>${e(name)}</strong><small>${e(type)}</small></div>
          ${supported ? `<span class="pv-switch"><i></i>${e(t.in_homekit)}</span>` : `<span class="pv-badge">${e(t.not_supported)}</span>`}
          <div class="pv-chips">${chips.map(c => `<span>${e(c)}</span>`).join('')}</div>
        </div>`).join('\n        ');

  return `<!doctype html>
<html lang="${htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(t.title)}</title>
<meta name="description" content="${e(t.desc)}">
<link rel="canonical" href="${BASE}${dir}">
${alts}
<link rel="alternate" hreflang="x-default" href="${BASE}">
<meta property="og:type" content="website">
<meta property="og:title" content="${e(t.title)}">
<meta property="og:description" content="${e(t.desc)}">
<meta property="og:url" content="${BASE}${dir}">
<meta property="og:image" content="${BASE}assets/og.png">
<meta property="og:locale" content="${og}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#f3f6fa" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0c1522" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${a}icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${a}icon.png">
<link rel="stylesheet" href="${a}site.css">
${dir ? '' : REDIRECT}</head>
<body>
<header class="wrap masthead">
  <a class="wordmark" href="./"><img src="${a}icon.svg" alt="" width="30" height="30">Panasonic Smart App</a>
  <a href="${REPO}">${e(t.source)}</a>
  <a class="tip head-tip" href="${BOBA}" aria-label="${e(t.boba)}"><img src="${a}boba.png" alt="" width="24" height="24"><span>${e(t.boba)}</span></a>
  <details class="lang">
    <summary aria-label="${e(t.lang_menu)}">${GLOBE}<span>${e(native)}</span></summary>
    <ul>${menu}</ul>
  </details>
</header>

<main>
<div class="wrap">
  <section class="hero" aria-labelledby="hero-title">
    <div class="hero-copy">
      <h1 id="hero-title">${e(t.h1).replace(/\n/g, '<br>')}</h1>
      <p class="lede">${e(t.lede)}</p>
      <div class="actions">
        <a class="btn" href="#start">${e(t.cta)}</a>
        <a href="${REPO}">${e(t.github)}</a>
      </div>
      <p class="fine">${e(t.fine)}</p>
    </div>
    <div class="room" data-demo data-device="ac" data-mode="cool" data-t='${e(JSON.stringify(demoText))}'>
      <fieldset class="seg devices">
        <legend>${e(t.device_legend)}</legend>
        ${picker}
      </fieldset>
      ${SCENE(t.scene_alt)}
      <div class="tile">
        <div class="tile-head">
          ${tileIcons}
          <div class="tile-name"><strong data-name></strong><span data-status aria-live="polite"></span></div>
          <span class="tile-now" data-now></span>
        </div>
        <div class="dial">
          <button type="button" class="step" data-step="-1" aria-label="${e(t.lower)}">&minus;</button>
          <output class="target"><span data-value></span><small data-unit></small></output>
          <button type="button" class="step" data-step="1" aria-label="${e(t.raise)}">+</button>
        </div>
        ${modeSets}
      </div>
      <p class="hint">${e(t.demo_hint)}</p>
      <script type="application/json" data-names>${JSON.stringify(t.names).replace(/</g, '\\u003c')}</script>
    </div>
  </section>

  <section class="band" aria-labelledby="h-local">
    <div class="intro">
      <h2 id="h-local">${e(t.local_h2)}</h2>
      <p>${e(t.local_p)}</p>
    </div>
    <ol class="flow">
        ${flow}
    </ol>
    <div class="cloud">
      <span class="cloud-icon">${CLOUD}</span>
      <div>
        <h3>${e(t.cloud_h3)}</h3>
        <p>${e(t.cloud_p)}</p>
      </div>
    </div>
  </section>

  <section class="band" aria-labelledby="h-feat">
    <div class="intro">
      <h2 id="h-feat">${e(t.feat_h2)}</h2>
      <p>${e(t.feat_p)}</p>
    </div>
    <ul class="kinds">
      ${kinds}
    </ul>
    <p class="fine">${e(t.feat_note)}</p>
  </section>

  <section class="band" aria-labelledby="h-pick">
    <div class="split">
      <div class="intro">
        <h2 id="h-pick">${e(t.pick_h2)}</h2>
        <p>${e(t.pick_p)}</p>
        <p>${e(t.pick_p2)}</p>
      </div>
      <figure class="preview">
        <div class="pv-head" aria-hidden="true"><strong>${e(t.preview_title)}</strong><span>${e(t.preview_load)}</span></div>
        <div class="pv-cards" aria-hidden="true">
        ${cards}
        </div>
        <figcaption>${e(t.preview_caption)}</figcaption>
      </figure>
    </div>
  </section>

  <section class="band" id="start" aria-labelledby="h-start">
    <h2 id="h-start">${e(t.start_h2)}</h2>
    <ol class="steps">${pairs(t.steps)}</ol>
    <p class="fine">${e(t.start_note)} <a href="${REPO}#homebridge-setup">${e(t.docs)}</a></p>
  </section>

  <section class="band" aria-labelledby="h-know">
    <div class="intro">
      <h2 id="h-know">${e(t.know_h2)}</h2>
    </div>
    <dl class="notes">${t.notes.map(([h, p]) => `<div><dt>${e(h)}</dt><dd>${e(p)}</dd></div>`).join('')}</dl>
  </section>

  <section class="band" aria-labelledby="h-support">
    <div class="tipjar">
      <img src="${a}boba.png" alt="" width="120" height="120">
      <div>
        <h2 id="h-support">${e(t.support_h2)}</h2>
        <p>${e(t.support_p)}</p>
        <div class="actions">
          <a class="btn" href="${BOBA}"><img src="${a}boba.png" alt="" width="22" height="22">${e(t.boba)}</a>
          <a class="tip" href="${PAYPAL}">${e(t.paypal)}</a>
        </div>
        <p class="fine">${e(t.support_card)}</p>
      </div>
    </div>
  </section>
</div>
</main>

<footer>
  <div class="wrap">
    <div class="foot">
      <div>
        <p>${e(t.made)}</p>
        <ul>
          <li><a href="${REPO}">${e(t.source)}</a></li>
          <li><a href="${NPM}">${e(t.npm)}</a></li>
          <li><a href="${REPO}/blob/master/CHANGELOG.md">${e(t.changelog)}</a></li>
          <li><a href="${REPO}/issues">${e(t.issues)}</a></li>
        </ul>
      </div>
      <ul class="langs">${menu}</ul>
    </div>
    <p class="tm">${e(t.tm)}</p>
  </div>
</footer>
<script src="${a}site.js"></script>
</body>
</html>
`;
}

for (const lang of LANGS) {
  const file = path.join(ROOT, 'site', lang[1], 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, page(lang));
  console.log('wrote', path.relative(ROOT, file));
}
