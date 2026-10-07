'use strict';

/* ---------- Config ---------- */
const SITE_URL = 'https://timeless-figures.suvadipchakraborty.workers.dev/';
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const WIKI_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const ROSTER_SIZE = 20;

// Occupation label -> Wikidata Q-code
const OCCUPATIONS = {
  'Emperor': 'Q39018',
  'Scientist': 'Q1650915',
  'Philosopher': 'Q4964182',
  'Mathematician': 'Q170790',
  'Physicist': 'Q169470',
  'Astronomer': 'Q11063',
  'Inventor': 'Q205375',
  'Composer': 'Q36834',
  'Painter': 'Q1028181',
  'Poet': 'Q49757',
  'Writer': 'Q36180',
  'Explorer': 'Q11900058',
  'Architect': 'Q42973',
  'Chemist': 'Q593644',
  'Biologist': 'Q864503',
  'Engineer': 'Q81096',
  'Sculptor': 'Q1281618',
  'Economist': 'Q188094',
  'Actor': 'Q33999',
  'Singer': 'Q177220',
  'Film Director': 'Q2526255',
  'Military Officer': 'Q189290'
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const pillsEl = $('pills');
const rosterEl = $('roster');
const rosterTitle = $('roster-title');
const statusEl = $('status');
const dossier = $('dossier');
const dossierBody = $('dossier-body');
const dossierScroll = $('dossier-scroll');
const toastEl = $('toast');

let currentOccupation = null;
let currentFigure = null;     // { title, name }
let lastFocus = null;
let rosterRequest = 0;
let dossierRequest = 0;
let deferredPrompt = null;

/* ---------- Helpers ---------- */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

// Commons "Special:FilePath" URLs -> https + thumbnail width
function commonsThumb(url, width = 400) {
  if (!url) return null;
  return url.replace(/^http:/, 'https:') + (url.includes('?') ? '&' : '?') + 'width=' + width;
}

function portraitNode(src, name, cls) {
  const wrap = el('div', cls);
  const fallback = el('span', 'card-initials', initials(name));
  wrap.appendChild(fallback);
  if (src) {
    const img = new Image();
    img.alt = name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { fallback.hidden = true; wrap.appendChild(img); };
    img.onerror = () => { /* keep initials */ };
    img.src = src;
  }
  return wrap;
}

/* ---------- Tabs ---------- */
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
  document.querySelectorAll('.nav-btn').forEach((b) => {
    const active = b.dataset.tab === name;
    b.classList.toggle('is-active', active);
    if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('tab-archive').hidden = name !== 'archive';
  $('tab-about').hidden = name !== 'about';
  $('tab-archive').classList.toggle('is-active', name === 'archive');
  $('tab-about').classList.toggle('is-active', name === 'about');
  window.scrollTo({ top: 0 });
}

/* ---------- Occupation pills ---------- */
function renderPills() {
  Object.keys(OCCUPATIONS).forEach((label) => {
    const b = el('button', 'pill', label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', 'false');
    b.addEventListener('click', () => selectOccupation(label));
    pillsEl.appendChild(b);
  });
}

function removePill(label) {
  pillsEl.querySelectorAll('.pill').forEach((p) => { if (p.textContent === label) p.remove(); });
}

function selectOccupation(label) {
  if (label === currentOccupation && rosterEl.children.length) return;
  currentOccupation = label;
  pillsEl.querySelectorAll('.pill').forEach((p) => {
    const on = p.textContent === label;
    p.setAttribute('aria-selected', String(on));
  });
  loadRoster(label);
}

/* ---------- Wikidata engine ---------- */
function occConfig(label) {
  const c = OCCUPATIONS[label];
  return typeof c === 'string' ? { occ: [c] } : c;
}

function buildQuery(label) {
  const c = occConfig(label);
  const values = c.occ.map((q) => 'wd:' + q).join(' ');
  const gender = c.gender ? `?person wdt:P21 wd:${c.gender} .` : '';
  const exclude = c.exclude ? `FILTER NOT EXISTS { ?person wdt:P106 wd:${c.exclude} . }` : '';
  return `
SELECT ?person ?personLabel ?wikiTitle ?sitelinks ?image WHERE {
  {
    SELECT ?person ?wikiTitle ?sitelinks (SAMPLE(?img) AS ?image) WHERE {
      VALUES ?occ { ${values} }
      ?person wdt:P31 wd:Q5 ;
              wdt:P106 ?occ ;
              wikibase:sitelinks ?sitelinks .
      ${gender}
      ${exclude}
      ?article schema:about ?person ;
               schema:isPartOf <https://en.wikipedia.org/> ;
               schema:name ?wikiTitle .
      OPTIONAL { ?person wdt:P18 ?img . }
    }
    GROUP BY ?person ?wikiTitle ?sitelinks
    ORDER BY DESC(?sitelinks)
    LIMIT ${ROSTER_SIZE}
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?sitelinks)`;
}

async function fetchRoster(label) {
  const key = 'tf2-roster-' + label;
  try {
    const cached = JSON.parse(localStorage.getItem(key));
    if (cached && Date.now() - cached.t < CACHE_TTL) return cached.data;
  } catch (e) { /* ignore */ }

  const url = `${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(buildQuery(label))}`;
  const res = await fetch(url, { headers: { Accept: 'application/sparql-results+json' } });
  if (!res.ok) throw new Error('Wikidata responded with ' + res.status);
  const json = await res.json();

  const seen = new Set();
  const data = json.results.bindings.map((b) => ({
    name: b.personLabel ? b.personLabel.value : b.wikiTitle.value,
    title: b.wikiTitle.value,
    sitelinks: Number(b.sitelinks.value),
    image: b.image ? commonsThumb(b.image.value, 400) : null
  })).filter((p) => !seen.has(p.title) && seen.add(p.title));

  if (!data.length) return data; // never cache empty results
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch (e) { /* quota */ }
  return data;
}

function showSkeleton() {
  rosterEl.replaceChildren();
  for (let i = 0; i < 8; i++) {
    const li = el('li');
    const card = el('div', 'card skeleton');
    card.appendChild(el('div', 'card-frame'));
    const plate = el('div', 'card-plate');
    plate.append(el('div', 'sk-line'), el('div', 'sk-line short'));
    card.appendChild(plate);
    li.appendChild(card);
    rosterEl.appendChild(li);
  }
}

function showStatus(message, retry) {
  statusEl.replaceChildren(el('div', null, message));
  if (retry) {
    const b = el('button', null, 'Try again');
    b.type = 'button';
    b.addEventListener('click', retry);
    statusEl.appendChild(b);
  }
  statusEl.hidden = false;
}

async function loadRoster(label) {
  const req = ++rosterRequest;
  statusEl.hidden = true;
  rosterTitle.textContent = `Greatest ${label}s`;
  showSkeleton();
  try {
    const people = await fetchRoster(label);
    if (req !== rosterRequest) return;
    if (!people.length) {
      rosterEl.replaceChildren();
      removePill(label);
      rosterTitle.textContent = 'Select an occupation';
      currentOccupation = null;
      showStatus(`No figures found for ${label}. Pick another occupation.`);
      return;
    }
    renderRoster(people);
  } catch (err) {
    if (req !== rosterRequest) return;
    rosterEl.replaceChildren();
    showStatus(
      navigator.onLine
        ? 'Wikidata is taking too long to answer. Wait a moment, then try again.'
        : 'You are offline. Connect to the internet to load this list.',
      () => loadRoster(label)
    );
  }
}

function renderRoster(people) {
  rosterEl.replaceChildren();
  people.forEach((p, i) => {
    const li = el('li');
    const card = el('button', 'card');
    card.type = 'button';
    card.setAttribute('aria-label', `${p.name}, rank ${i + 1}. Open biography`);

    const frame = portraitNode(p.image, p.name, 'card-frame');
    frame.appendChild(el('span', 'card-rank', String(i + 1)));
    card.appendChild(frame);

    const plate = el('div', 'card-plate');
    plate.appendChild(el('h3', 'card-name', p.name));
    plate.appendChild(el('p', 'card-meta', `${p.sitelinks} languages`));
    card.appendChild(plate);

    card.addEventListener('click', () => openDossier(p));
    li.appendChild(card);
    rosterEl.appendChild(li);
  });
}

/* ---------- Dossier ---------- */
async function openDossier(person, { pushState = true } = {}) {
  currentFigure = { title: person.title, name: person.name || person.title };
  lastFocus = document.activeElement;
  const req = ++dossierRequest;

  // Skeleton content
  dossierBody.replaceChildren();
  dossierBody.appendChild(portraitNode(person.image || null, currentFigure.name, 'portrait'));
  dossierBody.appendChild(el('h2', 'dossier-name', currentFigure.name)).id = 'dossier-name';
  const sk = el('div', 'sk-block skeleton');
  sk.append(el('div', 'sk-line'), el('div', 'sk-line'), el('div', 'sk-line short'));
  dossierBody.appendChild(sk);

  dossier.classList.add('is-open');
  dossier.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  dossierScroll.scrollTop = 0;
  $('dossier-close').focus({ preventScroll: true });
  if (pushState) history.pushState({ dossier: true }, '', '?figure=' + encodeURIComponent(person.title));

  try {
    const url = WIKI_SUMMARY + encodeURIComponent(person.title.replace(/ /g, '_'));
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Wikipedia responded with ' + res.status);
    const d = await res.json();
    if (req !== dossierRequest) return;

    const name = d.title || currentFigure.name;
    currentFigure.name = name;
    const photo = (d.thumbnail && d.thumbnail.source) || (d.originalimage && d.originalimage.source) || person.image || null;

    dossierBody.replaceChildren();
    dossierBody.appendChild(portraitNode(photo, name, 'portrait'));
    const h = el('h2', 'dossier-name', name);
    h.id = 'dossier-name';
    dossierBody.appendChild(h);
    if (d.description) dossierBody.appendChild(el('p', 'dossier-desc', d.description));
    dossierBody.appendChild(el('hr', 'rule'));
    dossierBody.appendChild(el('p', 'dossier-text', d.extract || 'No summary is available for this figure.'));

    const page = d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page;
    if (page) {
      const a = el('a', 'dossier-link', 'Read the full article on Wikipedia');
      a.href = page;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      dossierBody.appendChild(a);
    }
  } catch (err) {
    if (req !== dossierRequest) return;
    sk.replaceWith(el('p', 'dossier-note',
      navigator.onLine
        ? 'The biography could not be loaded. Close this page and tap the figure again.'
        : 'You are offline. Connect to the internet to read this biography.'));
  }
}

function closeDossier({ fromPopState = false } = {}) {
  if (!dossier.classList.contains('is-open')) return;
  dossier.classList.remove('is-open');
  dossier.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  dossierRequest++;
  if (!fromPopState && new URLSearchParams(location.search).has('figure')) {
    if (history.state && history.state.dossier) history.back();
    else history.replaceState(null, '', location.pathname);
  }
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}

$('dossier-close').addEventListener('click', () => closeDossier());
window.addEventListener('popstate', () => {
  const fig = new URLSearchParams(location.search).get('figure');
  if (fig) { if (!dossier.classList.contains('is-open')) openDossier({ title: fig }, { pushState: false }); }
  else closeDossier({ fromPopState: true });
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDossier(); });

/* ---------- Share ---------- */
$('dossier-share').addEventListener('click', async () => {
  if (!currentFigure) return;
  const url = SITE_URL + '?figure=' + encodeURIComponent(currentFigure.title);
  const text = `Read about the life and legacy of ${currentFigure.name} on Timeless Figures!`;
  if (navigator.share) {
    try { await navigator.share({ title: currentFigure.name, text, url }); }
    catch (e) { /* user cancelled */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('Link copied to clipboard');
  } catch (e) {
    toast('Sharing is not supported on this browser');
  }
});

/* ---------- PWA install ---------- */
const installBtn = $('install-btn');
const installHint = $('install-hint');
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

function refreshInstallUI() {
  if (isStandalone()) {
    installBtn.disabled = true;
    installBtn.textContent = 'App installed';
    installHint.textContent = 'You are using the installed app.';
  } else if (deferredPrompt) {
    installBtn.disabled = false;
    installHint.textContent = 'Adds Timeless Figures to your home screen.';
  } else if (isIOS) {
    installHint.textContent = 'On iPhone or iPad: tap Share, then Add to Home Screen.';
  } else {
    installHint.textContent = 'If nothing happens, open your browser menu and choose Install app or Add to Home Screen.';
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  refreshInstallUI();
});
window.addEventListener('appinstalled', () => { deferredPrompt = null; refreshInstallUI(); toast('Timeless Figures installed'); });

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) { refreshInstallUI(); toast(installHint.textContent); return; }
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  refreshInstallUI();
});

/* ---------- Boot ---------- */
renderPills();
refreshInstallUI();
showStatus('Pick an occupation above to meet its most notable figures.');
rosterTitle.textContent = 'Select an occupation';

const deepLink = new URLSearchParams(location.search).get('figure');
if (deepLink) openDossier({ title: deepLink }, { pushState: false });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
