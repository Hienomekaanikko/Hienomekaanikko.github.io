const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const sounds = {};
const soundToButton = {};

window.addEventListener('pagehide', () => audioCtx.close());
window.addEventListener('unload', () => {});

const SUPABASE_URL = 'https://eavorbolhkfdluacjzvl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_T6YvgNDX-bxjrmNVd199Lw_tBhakmBV';
const STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/soundpacks/`;
const SOUNDS_STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/sounds/`;
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let themes = [];
const bufferCache = new Map();

async function loadCustomPack(packId) {
	const { data: pack, error } = await db.from('custom_packs').select('id, name, grid_size, bg_image').eq('id', packId).single();
	if (error || !pack) { console.error('Custom pack not found', error); return null; }

	const { data: packSounds } = await db.from('custom_pack_sounds').select('slot, sound_id').eq('pack_id', packId);
	if (!packSounds?.length) return null;

	const soundIds = packSounds.map(ps => ps.sound_id);
	const { data: soundRows } = await db.from('sounds').select('id, file_path').in('id', soundIds);
	if (!soundRows?.length) return null;

	const soundMap = Object.fromEntries(soundRows.map(s => [s.id, s.file_path]));
	const sounds = {};
	packSounds.forEach(ps => {
		if (soundMap[ps.sound_id]) sounds[ps.slot] = SOUNDS_STORAGE_BASE + soundMap[ps.sound_id];
	});

	return {
		id: pack.id,
		name: pack.name,
		gridSize: pack.grid_size,
		colors: ['#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#f87171'],
		bg: ['#0d001a', '#1a0035'],
		bgImage: pack.bg_image || null,
		bodyClass: null,
		sounds
	};
}

// Fetch only pack metadata upfront — sounds loaded lazily per theme
async function fetchThemes() {
	const { data: packs, error } = await db
		.from('packs')
		.select('id, name, colors, bg, bg_image, body_class, sort_order')
		.order('sort_order');

	if (error) { console.error('Failed to fetch packs', error); return; }

	themes = packs.map(pack => ({
		id: pack.id,
		name: pack.name,
		colors: pack.colors,
		bg: pack.bg,
		bgImage: pack.bg_image || null,
		bodyClass: pack.body_class || null,
		sounds: null  // loaded on demand
	}));
}

// Fetch sound URLs for a theme if not already loaded
async function ensureThemeSounds(theme) {
	if (theme.sounds !== null) return;
	const { data, error } = await db
		.from('pack_sounds')
		.select('slot, file_path')
		.eq('pack_id', theme.id);
	if (error) { console.error('Failed to fetch sounds for', theme.name, error); theme.sounds = {}; return; }
	theme.sounds = Object.fromEntries(data.map(s => [s.slot, STORAGE_BASE + s.file_path]));
}

// Evict decoded buffers for themes outside current ± 1 range to keep memory bounded
function evictDistantBuffers(currentIndex) {
	const keep = new Set([
		(currentIndex - 1 + themes.length) % themes.length,
		currentIndex,
		(currentIndex + 1) % themes.length
	]);
	const keepUrls = new Set();
	for (const idx of keep) {
		const t = themes[idx];
		if (t?.sounds) Object.values(t.sounds).forEach(url => keepUrls.add(url));
	}
	for (const url of bufferCache.keys()) {
		if (!keepUrls.has(url)) bufferCache.delete(url);
	}
}

let currentThemeIndex = 0;

const buttonRows = {
	btn1: 1, btn2: 1, btn3: 1, btn4: 1, btn5: 1,
	btn6: 2, btn7: 2, btn8: 2, btn9: 2, btn10: 2,
	btn11: 3, btn12: 3, btn13: 3, btn14: 3, btn15: 3,
	btn16: 4, btn17: 4, btn18: 4, btn19: 4, btn20: 4,
	btn21: 5, btn22: 5, btn23: 5, btn24: 5, btn25: 5
};

// Track the currently playing loop per row
const rowActive = {
	1: null,
	2: null,
	3: null,
	4: null,
	5: null
};

// Stutter state per row: depth = saved divisor (4/8/16), mode = 0 (off) or active divisor
const rowStutter = { 1: { mode: 0, depth: 4, source: null }, 2: { mode: 0, depth: 4, source: null }, 3: { mode: 0, depth: 4, source: null }, 4: { mode: 0, depth: 4, source: null }, 5: { mode: 0, depth: 4, source: null } };
const STUTTER_DEPTHS = [4, 8, 16];

let masterLoopName = null;
let masterStartTime = null;
let masterLoopDuration = null;
let splitActive = false;

const rowVolumes = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 };
let currentFadeTime = 0;

const rowFilters = {};
const rowGains = {};
for (let r = 1; r <= 5; r++) {
	const f = audioCtx.createBiquadFilter();
	f.type = 'lowpass';
	f.frequency.value = 20000;
	f.Q.value = 0.5;
	f.connect(audioCtx.destination);
	rowFilters[r] = f;

	const g = audioCtx.createGain();
	g.connect(rowFilters[r]);
	rowGains[r] = g;
}

// Load a single sound
async function loadSound(name, url) {
	if (!bufferCache.has(url)) {
		const resp = await fetch(url);
		const raw = await resp.arrayBuffer();
		bufferCache.set(url, await audioCtx.decodeAudioData(raw));
	}
	sounds[name] = { buffer: bufferCache.get(url), source: null, startTimeoutId: null };
}

// Calculate the next "bar" start time for perfect sync
function getNextStartTime() {
	if (!masterStartTime || !masterLoopDuration) {
		const bufferDuration = Object.values(sounds)[0]?.buffer?.duration || 1;
		const now = audioCtx.currentTime;
		const futureStart = now + 0.1; // safety margin
		masterStartTime = futureStart;
		masterLoopDuration = bufferDuration / (splitActive ? 2 : 1);
		console.log(`[Clock] Initializing master at ${futureStart.toFixed(2)}s (duration: ${bufferDuration}s)`);
		return futureStart;
	}

	const now = audioCtx.currentTime;
	const elapsed = now - masterStartTime;
	const bars = Math.floor(elapsed / masterLoopDuration);
	const nextBarTime = masterStartTime + (bars + 1) * masterLoopDuration;

	return nextBarTime;
}

// Start a loop with syncing
function startLoop(name, buttonId) {
	const sound = sounds[name];
	if (!sound) return;

	const source = audioCtx.createBufferSource();
	source.buffer = sound.buffer;
	source.loop = true;
	source.loopEnd = sound.buffer.duration / (splitActive ? 2 : 1);

	const row = buttonRows[buttonId];
	source.connect(rowGains[row]);

	const button = document.getElementById(buttonId);
	const startTime = getNextStartTime();

	// Schedule gain: fade in or snap to volume
	const gain = rowGains[row];
	gain.gain.cancelScheduledValues(startTime);
	if (currentFadeTime > 0) {
		gain.gain.setValueAtTime(0, startTime);
		gain.gain.linearRampToValueAtTime(rowVolumes[row], startTime + currentFadeTime);
	} else {
		gain.gain.setValueAtTime(rowVolumes[row], startTime);
	}

	console.log(`[Start] ${name} scheduled for ${startTime.toFixed(2)} (current: ${audioCtx.currentTime.toFixed(2)})`);

	if (button) {
		button.classList.remove('active');
		button.classList.add('blink');
	}

	source.start(startTime);
	sound.source = source;
	rowActive[row] = { name, buttonId };

	sound.startTimeoutId = setTimeout(() => {
		if (!sound.source) return;
		if (button) {
			button.classList.remove('blink');
			button.classList.add('active');
		}
		if (!masterLoopName) masterLoopName = name;
		sound.startTimeoutId = null;
	}, (startTime - audioCtx.currentTime) * 1000);
}

// Stop a loop (force=true skips fade, used on theme switch)
function stopLoop(name, force = false) {
	const sound = sounds[name];
	if (!sound) return;

	const btnId = soundToButton[name];
	const button = btnId ? document.getElementById(btnId) : null;
	const row = btnId ? buttonRows[btnId] : null;

	if (sound.startTimeoutId) {
		clearTimeout(sound.startTimeoutId);
		sound.startTimeoutId = null;
	}

	if (button) button.classList.remove('blink', 'active');
	if (row && rowActive[row]?.name === name) rowActive[row] = null;
	if (masterLoopName === name) masterLoopName = null;

	const anyActive = Object.values(rowActive).some(a => a !== null);
	if (!anyActive) {
		console.log("[Clock] All loops stopped, resetting master clock");
		masterStartTime = null;
		masterLoopDuration = null;
	}

	if (sound.source) {
		const gain = row ? rowGains[row] : null;
		if (!force && currentFadeTime > 0 && gain) {
			gain.gain.cancelScheduledValues(audioCtx.currentTime);
			gain.gain.setValueAtTime(gain.gain.value, audioCtx.currentTime);
			gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + currentFadeTime);
			const src = sound.source;
			sound.source = null;
			setTimeout(() => {
				try { src.stop(); } catch (e) {}
				gain.gain.setValueAtTime(rowVolumes[row], audioCtx.currentTime);
			}, currentFadeTime * 1000 + 50);
		} else {
			if (gain) {
				gain.gain.cancelScheduledValues(audioCtx.currentTime);
				gain.gain.setValueAtTime(rowVolumes[row], audioCtx.currentTime);
			}
			sound.source.stop();
			sound.source = null;
		}
	}
}

// Toggle loop on click
async function toggleLoop(name, buttonId) {
	if (audioCtx.state === 'suspended') {
		await audioCtx.resume();
	}

	const row = buttonRows[buttonId];

	// Clear any active stutter for this row before switching sounds
	if (rowStutter[row].mode !== 0) {
		const st = rowStutter[row];
		if (st.source) { try { st.source.stop(); } catch (e) {} st.source = null; }
		st.mode = 0;
		for (const id of [`stutter-btn-${row}`, `mob-stutter-btn-${row}`]) {
			const b = document.getElementById(id);
			if (b) { b.textContent = 'STU'; b.classList.remove('stutter-active'); }
		}
	}

	const current = rowActive[row];

	// If something is already playing in this row, stop it first
	if (current) {
		stopLoop(current.name);

		// If it's the same button, just stop (don’t restart)
		if (current.name === name) {
			return;
		}
	}

	// Start the new loop for this row
	startLoop(name, buttonId);
}

function updateProgressBars() {
	const fill = document.getElementById('master-bar-fill');
	const anyActive = Object.values(rowActive).some(a => a !== null);

	if (fill && anyActive && masterStartTime && masterLoopDuration) {
		const now = audioCtx.currentTime;
		const elapsed = Math.max(0, (now - masterStartTime) % masterLoopDuration);
		fill.style.width = (elapsed / masterLoopDuration * 100) + '%';
		fill.style.opacity = '1';
	} else if (fill) {
		fill.style.opacity = '0';
	}

	requestAnimationFrame(updateProgressBars);
}

function applyThemeColors(theme) {
	const root = document.documentElement;
	theme.colors.forEach((c, i) => root.style.setProperty(`--c${i + 1}`, c));
	root.style.setProperty('--bg-top', theme.bg[0]);
	root.style.setProperty('--bg-bottom', theme.bg[1]);

	// Toggle body classes for theme-specific backgrounds
	themes.forEach(t => t.bodyClass && document.body.classList.remove(t.bodyClass));
	if (theme.bodyClass) document.body.classList.add(theme.bodyClass);

	// Apply background image from DB, fall back to gradient
	document.body.style.backgroundImage = theme.bgImage
		? `url('${theme.bgImage}')`
		: '';
}

function updateThemeLabels() {
	if (themes.length === 0) return;
	const prev = themes[(currentThemeIndex - 1 + themes.length) % themes.length];
	const next = themes[(currentThemeIndex + 1) % themes.length];
	document.getElementById('theme-label-left').textContent = themes.length > 1 ? prev.name : '';
	document.getElementById('theme-label-right').textContent = themes.length > 1 ? next.name : '';
}

async function prefetchAdjacentThemes(currentIndex) {
	if (themes.length <= 1) return;
	const indices = [
		(currentIndex - 1 + themes.length) % themes.length,
		(currentIndex + 1) % themes.length
	];
	for (const idx of indices) {
		const t = themes[idx];
		if (!t) continue;
		// Fetch sound metadata if not loaded yet
		await ensureThemeSounds(t);
		if (!t.sounds) continue;
		// Warm HTTP cache — max 4 concurrent fetches per neighbour to avoid flooding
		const urls = Object.values(t.sounds).filter(url => !bufferCache.has(url));
		for (let i = 0; i < urls.length; i += 4) {
			await Promise.all(urls.slice(i, i + 4).map(url => fetch(url).catch(() => {})));
		}
		if (t.bgImage) fetch(t.bgImage).catch(() => {});
	}
}

async function loadThemeSounds(theme) {
	// Ensure sound URLs are fetched for this theme
	await ensureThemeSounds(theme);

	// Clear all stutter sources
	for (let r = 1; r <= 5; r++) {
		const st = rowStutter[r];
		if (st.source) { try { st.source.stop(); } catch (e) {} st.source = null; }
		st.mode = 0;
		for (const id of [`stutter-btn-${r}`, `mob-stutter-btn-${r}`]) {
			const btn = document.getElementById(id);
			if (btn) { btn.textContent = 'STU'; btn.classList.remove('stutter-active'); }
		}
	}

	// Stop and clear all active sounds
	for (const name of Object.keys(sounds)) {
		if (sounds[name]?.source) stopLoop(name, true);
	}
	for (const key of Object.keys(sounds)) delete sounds[key];
	for (const key of Object.keys(soundToButton)) delete soundToButton[key];

	// Reset master clock
	masterLoopName = null;
	masterStartTime = null;
	masterLoopDuration = null;

	// Mark all buttons as loading
	for (let i = 1; i <= 25; i++) {
		const btn = document.getElementById(`btn${i}`);
		if (btn) btn.classList.add('btn-loading');
	}

	// Load all sounds in parallel — enable each button as it becomes ready
	await Promise.all(
		Object.entries(theme.sounds).map(([slot, url]) => {
			const name = `sound${slot}`;
			const id = `btn${slot}`;
			return loadSound(name, url)
				.then(() => {
					soundToButton[name] = id;
					const btn = document.getElementById(id);
					if (btn) btn.classList.remove('btn-loading');
				})
				.catch(() => {
					console.warn(`[Skip] Could not load slot ${slot}`);
					const btn = document.getElementById(id);
					if (btn) btn.classList.remove('btn-loading');
				});
		})
	);

	// Evict decoded audio buffers for themes far from current to keep memory bounded
	evictDistantBuffers(currentThemeIndex);
}

function startStutter(row, divisor) {
	const active = rowActive[row];
	if (!active) return;
	const sound = sounds[active.name];
	if (!sound?.buffer) return;

	// Stop any existing stutter source immediately
	const st = rowStutter[row];
	if (st.source) { try { st.source.stop(); } catch (e) {} st.source = null; }

	const bufDur = sound.buffer.duration / (splitActive ? 2 : 1);
	const loopLen = bufDur / divisor;

	const startTime = getNextStartTime();

	// Stop regular source exactly when stutter begins
	if (sound.source) { sound.source.stop(startTime); sound.source = null; }

	const src = audioCtx.createBufferSource();
	src.buffer = sound.buffer;
	src.loop = true;
	src.loopStart = 0;
	src.loopEnd = loopLen;
	src.connect(rowGains[row]);
	src.start(startTime);
	st.source = src;
}

function releaseStutter(row) {
	const st = rowStutter[row];
	if (st.source) { try { st.source.stop(); } catch (e) {} st.source = null; }
	st.mode = 0;

	const active = rowActive[row];
	if (active) startLoop(active.name, active.buttonId);

	updateStutterBtn(row);
}

function updateStutterBtn(row) {
	const st = rowStutter[row];
	const label = `1/${st.depth}`;
	const active = st.mode !== 0;
	for (const id of [`stutter-btn-${row}`, `mob-stutter-btn-${row}`]) {
		const btn = document.getElementById(id);
		if (!btn) continue;
		btn.textContent = label;
		btn.classList.toggle('stutter-active', active);
	}
}

// Short tap: toggle stutter on/off at current depth
function tapStutter(row) {
	if (audioCtx.state === 'suspended') audioCtx.resume();
	const st = rowStutter[row];
	if (st.mode !== 0) {
		releaseStutter(row);
	} else {
		startStutter(row, st.depth);
		st.mode = st.depth;
		updateStutterBtn(row);
	}
}

// Single tap: cycle depth — transition at next bar boundary to stay in sync
function cycleStutterDepth(row) {
	const st = rowStutter[row];
	const idx = STUTTER_DEPTHS.indexOf(st.depth);
	st.depth = STUTTER_DEPTHS[(idx + 1) % STUTTER_DEPTHS.length];

	if (st.mode !== 0) {
		const active = rowActive[row];
		const sound = active ? sounds[active.name] : null;
		if (sound?.buffer && st.source) {
			const startTime = getNextStartTime();
			const bufDur = sound.buffer.duration / (splitActive ? 2 : 1);
			const loopLen = bufDur / st.depth;

			// Stop current stutter source exactly at bar boundary
			try { st.source.stop(startTime); } catch (e) {}

			// Start new stutter source at the same bar boundary
			const src = audioCtx.createBufferSource();
			src.buffer = sound.buffer;
			src.loop = true;
			src.loopStart = 0;
			src.loopEnd = loopLen;
			src.connect(rowGains[row]);
			src.start(startTime);
			st.source = src;
			st.mode = st.depth;
		}
	}

	updateStutterBtn(row);
}

let themeOverlay = null;
function getThemeOverlay() {
	if (!themeOverlay) {
		themeOverlay = document.createElement('div');
		themeOverlay.style.cssText = 'position:fixed;inset:0;background:#050300;z-index:9998;opacity:0;pointer-events:none;';
		document.body.appendChild(themeOverlay);
	}
	return themeOverlay;
}

async function switchTheme(direction) {
	if (themes.length === 0) return;
	const container = document.querySelector('.container');
	container.classList.add('switching');

	const overlay = getThemeOverlay();
	overlay.style.transition = 'none';
	overlay.style.opacity = '1';

	currentThemeIndex = (currentThemeIndex + direction + themes.length) % themes.length;
	const theme = themes[currentThemeIndex];

	updateThemeLabels();

	// Preload background image before revealing
	await new Promise(resolve => {
		if (!theme.bgImage) { applyThemeColors(theme); resolve(); return; }
		const img = new Image();
		img.onload = () => { applyThemeColors(theme); resolve(); };
		img.onerror = () => { applyThemeColors(theme); resolve(); };
		img.src = theme.bgImage;
	});

	// Reveal UI immediately — sounds load in background, then prefetch neighbours
	overlay.style.transition = 'opacity 0.4s ease';
	overlay.style.opacity = '0';
	container.classList.remove('switching');
	loadThemeSounds(theme).then(() => prefetchAdjacentThemes(currentThemeIndex));
}

// Load sounds and bind buttons
window.addEventListener("load", async () => {
	const customPackId = new URLSearchParams(window.location.search).get('pack');

	if (customPackId) {
		const customTheme = await loadCustomPack(customPackId);
		if (customTheme) {
			themes = [customTheme];
			// Hide navigation — custom packs are standalone
			document.getElementById('prev-btn').style.display = 'none';
			document.getElementById('next-btn').style.display = 'none';
			document.getElementById('theme-label-left').style.display = 'none';
			document.getElementById('theme-label-right').style.display = 'none';
			// Dim buttons outside this grid size
			const active = customTheme.gridSize * customTheme.gridSize;
			for (let i = active + 1; i <= 25; i++) {
				const btn = document.getElementById(`btn${i}`);
				if (btn) { btn.style.opacity = '0.15'; btn.style.pointerEvents = 'none'; }
			}
		}
	} else {
		await fetchThemes();
	}

	if (themes.length === 0) { console.error('No packs loaded from Supabase'); return; }

	// --- Particle system ---
	const pCanvas = document.getElementById('particle-canvas');
	const pCtx = pCanvas.getContext('2d');
	const pList = [];

	function resizePCanvas() {
		pCanvas.width = window.innerWidth;
		pCanvas.height = window.innerHeight;
	}
	window.addEventListener('resize', resizePCanvas);
	resizePCanvas();

	function getThemeColors() {
		const s = getComputedStyle(document.documentElement);
		return [1,2,3,4,5].map(i => s.getPropertyValue(`--c${i}`).trim());
	}

	function triggerBurst(btn) {
		const rect = btn.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		const row = buttonRows[btn.id];
		const color = getThemeColors()[row - 1] || '#fff';
		for (let i = 0; i < 12; i++) {
			const angle = Math.random() * Math.PI * 2;
			const speed = Math.random() * 2.5 + 1;
			pList.push({
				x, y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed - 1.5,
				color,
				size: Math.random() * 2 + 1,
				life: 0.55,
				decay: Math.random() * 0.02 + 0.018,
				burst: true
			});
		}
	}

	function addAmbient() {
		if (pList.filter(p => !p.burst).length >= 55) return;
		const color = getThemeColors()[Math.floor(Math.random() * 5)];
		pList.push({
			x: Math.random() * pCanvas.width,
			y: pCanvas.height + 5,
			vx: (Math.random() - 0.5) * 0.6,
			vy: -(Math.random() * 0.7 + 0.25),
			color,
			size: Math.random() * 1.8 + 0.4,
			life: 0.65 + Math.random() * 0.35,
			decay: 0.0014 + Math.random() * 0.001,
			burst: false
		});
	}

	function animateParticles() {
		pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
		addAmbient();
		for (let i = pList.length - 1; i >= 0; i--) {
			const p = pList[i];
			p.x += p.vx;
			p.y += p.vy;
			if (p.burst) p.vy += 0.14;
			p.life -= p.decay;
			if (p.life <= 0 || p.y < -20) { pList.splice(i, 1); continue; }
			pCtx.save();
			pCtx.globalAlpha = Math.max(0, p.burst ? p.life : p.life * 0.75);
			pCtx.fillStyle = p.color;
			pCtx.shadowBlur = p.burst ? 5 : 5;
			pCtx.shadowColor = p.color;
			pCtx.beginPath();
			pCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
			pCtx.fill();
			pCtx.restore();
		}
		requestAnimationFrame(animateParticles);
	}
	animateParticles();

	// Bind pad buttons once — they always map soundN → btnN
	for (let i = 1; i <= 25; i++) {
		const name = `sound${i}`;
		const id = `btn${i}`;
		const btn = document.getElementById(id);
		if (!btn) continue;
		// touchstart resumes AudioContext immediately within the gesture (required by iOS Safari)
		btn.addEventListener('touchstart', () => {
			if (audioCtx.state === 'suspended') audioCtx.resume();
		}, { passive: true });
		btn.addEventListener('touchend', e => {
			e.preventDefault();
			toggleLoop(name, id);
			triggerBurst(btn);
		}, { passive: false });
		btn.onclick = () => { toggleLoop(name, id); triggerBurst(btn); };
	}

	// Bind nav buttons
	document.getElementById('prev-btn').onclick = () => switchTheme(-1);
	document.getElementById('next-btn').onclick = () => switchTheme(1);

	// Split toggle
	document.getElementById('split-btn').onclick = () => {
		splitActive = !splitActive;
		document.getElementById('split-btn').classList.toggle('active', splitActive);
		const divisor = splitActive ? 2 : 1;
		for (const row of Object.values(rowActive)) {
			if (row) {
				const sound = sounds[row.name];
				if (sound?.source) sound.source.loopEnd = sound.source.buffer.duration / divisor;
			}
		}
		if (masterLoopDuration) masterLoopDuration = splitActive
			? masterLoopDuration / 2
			: masterLoopDuration * 2;
	};

	// Load initial theme — show UI as soon as bg is ready, sounds load in background
	await new Promise(resolve => {
		if (!themes[0].bgImage) { applyThemeColors(themes[0]); resolve(); return; }
		const img = new Image();
		img.onload = () => { applyThemeColors(themes[0]); resolve(); };
		img.onerror = () => { applyThemeColors(themes[0]); resolve(); };
		img.src = themes[0].bgImage;
	});
	updateThemeLabels();
	const loader = document.getElementById('loader');
	loader.style.opacity = '0';
	setTimeout(() => loader.remove(), 300);
	loadThemeSounds(themes[0]).then(() => prefetchAdjacentThemes(0));

	// --- Knob helpers ---
	const KNOB_TRACK = 'M 10.69 33.31 A 16 16 0 1 1 33.31 33.31';

	function knobAngleXY(angleDeg, r) {
		const rad = angleDeg * Math.PI / 180;
		return { x: +(22 + r * Math.sin(rad)).toFixed(2), y: +(22 - r * Math.cos(rad)).toFixed(2) };
	}

	function knobArcPath(value) {
		if (value <= 0) return '';
		const endDeg = -135 + (value / 100) * 270;
		const s = knobAngleXY(-135, 16);
		const e = knobAngleXY(endDeg, 16);
		const large = (value / 100) * 270 > 180 ? 1 : 0;
		return `M ${s.x} ${s.y} A 16 16 0 ${large} 1 ${e.x} ${e.y}`;
	}

	function updateKnobVisual(wrap, value) {
		const fill = wrap.querySelector('.knob-fill');
		const dot  = wrap.querySelector('.knob-dot');
		if (fill) fill.setAttribute('d', knobArcPath(value));
		if (dot) {
			const p = knobAngleXY(-135 + (value / 100) * 270, 11);
			dot.setAttribute('cx', p.x);
			dot.setAttribute('cy', p.y);
		}
	}

	function createKnob(id, colorClass) {
		const wrap = document.createElement('div');
		wrap.className = `knob-wrap ${colorClass}`;
		wrap.id = id;
		const initDot = knobAngleXY(135, 11);
		wrap.innerHTML = `
			<svg class="knob-svg" viewBox="0 0 44 44">
				<circle class="knob-bg" cx="22" cy="22" r="20"/>
				<path class="knob-track" d="${KNOB_TRACK}"/>
				<path class="knob-fill" d="${KNOB_TRACK}"/>
				<circle class="knob-dot" cx="${initDot.x}" cy="${initDot.y}" r="2.5"/>
			</svg>`;
		return wrap;
	}

	function setupKnobDrag(wrap, getValue, setValue) {
		let dragging = false, startY = 0, startVal = 0;

		wrap.addEventListener('mousedown', e => {
			dragging = true; startY = e.clientY; startVal = getValue();
			e.preventDefault();
		});
		window.addEventListener('mousemove', e => {
			if (!dragging) return;
			setValue(Math.max(0, Math.min(100, startVal + (startY - e.clientY))));
		});
		window.addEventListener('mouseup', () => { dragging = false; });

		wrap.addEventListener('touchstart', e => {
			dragging = true; startY = e.touches[0].clientY; startVal = getValue();
			e.preventDefault();
		}, { passive: false });
		window.addEventListener('touchmove', e => {
			if (!dragging) return;
			setValue(Math.max(0, Math.min(100, startVal + (startY - e.touches[0].clientY))));
			e.preventDefault();
		}, { passive: false });
		window.addEventListener('touchend', () => { dragging = false; });

		wrap.addEventListener('wheel', e => {
			e.preventDefault();
			setValue(Math.max(0, Math.min(100, getValue() + (e.deltaY < 0 ? 2 : -2))));
		}, { passive: false });
	}

	// Build and wire knobs
	const volCol    = document.getElementById('vol-knobs');
	const filterCol = document.getElementById('filter-knobs');
	const mobVolPanel = document.getElementById('mob-vol-panel');
	const mobLpPanel  = document.getElementById('mob-lp-panel');
	const mobStuPanel = document.getElementById('mob-stu-panel');

	for (let row = 1; row <= 5; row++) {
		const colorClass = `row-color-${row}`;

		// VOL
		const volWrap    = createKnob(`vol-wrap-${row}`, colorClass);
		const mobVolWrap = createKnob(`mob-vol-wrap-${row}`, colorClass);
		volCol.appendChild(volWrap);
		mobVolPanel.appendChild(mobVolWrap);
		let volVal = 100;
		setupKnobDrag(volWrap,    () => volVal, v => { volVal = v; rowVolumes[row] = v / 100; rowGains[row].gain.setValueAtTime(v / 100, audioCtx.currentTime); updateKnobVisual(volWrap, v); updateKnobVisual(mobVolWrap, v); });
		setupKnobDrag(mobVolWrap, () => volVal, v => { volVal = v; rowVolumes[row] = v / 100; rowGains[row].gain.setValueAtTime(v / 100, audioCtx.currentTime); updateKnobVisual(volWrap, v); updateKnobVisual(mobVolWrap, v); });

		// LP filter
		const filterWrap    = createKnob(`filter-wrap-${row}`, colorClass);
		const mobFilterWrap = createKnob(`mob-filter-wrap-${row}`, colorClass);
		filterCol.appendChild(filterWrap);
		mobLpPanel.appendChild(mobFilterWrap);
		let filterVal = 100;
		setupKnobDrag(filterWrap,    () => filterVal, v => { filterVal = v; rowFilters[row].frequency.setValueAtTime(200 * Math.pow(100, v / 100), audioCtx.currentTime); updateKnobVisual(filterWrap, v); updateKnobVisual(mobFilterWrap, v); });
		setupKnobDrag(mobFilterWrap, () => filterVal, v => { filterVal = v; rowFilters[row].frequency.setValueAtTime(200 * Math.pow(100, v / 100), audioCtx.currentTime); updateKnobVisual(filterWrap, v); updateKnobVisual(mobFilterWrap, v); });
	}

	// Build stutter buttons (single tap = cycle depth, double tap = toggle on/off)
	const stutterCol = document.getElementById('stutter-btns');
	for (let row = 1; row <= 5; row++) {
		let tapCount = 0, tapTimer = null;
		const onTap = () => {
			if (audioCtx.state === 'suspended') audioCtx.resume();
			tapCount++;
			clearTimeout(tapTimer);
			tapTimer = setTimeout(() => {
				if (tapCount === 1) cycleStutterDepth(row);
				else tapStutter(row);
				tapCount = 0;
			}, 280);
		};

		const makeBtn = (id) => {
			const btn = document.createElement('button');
			btn.id = id;
			btn.className = 'stutter-btn';
			btn.textContent = '1/4';
			btn.addEventListener('click', onTap);
			btn.addEventListener('touchend', e => { e.preventDefault(); onTap(); }, { passive: false });
			return btn;
		};

		stutterCol.appendChild(makeBtn(`stutter-btn-${row}`));
		mobStuPanel.appendChild(makeBtn(`mob-stutter-btn-${row}`));
	}

	// Mobile tab switching
	document.querySelectorAll('.mob-tab').forEach(tab => {
		tab.addEventListener('click', () => {
			document.querySelectorAll('.mob-tab').forEach(t => t.classList.remove('active'));
			document.querySelectorAll('.mob-panel').forEach(p => p.classList.remove('active'));
			tab.classList.add('active');
			document.getElementById(`mob-${tab.dataset.panel}-panel`).classList.add('active');
		});
	});

	requestAnimationFrame(updateProgressBars);

	// --- Auth UI ---
	const authOverlay = document.getElementById('auth-overlay');
	const authBtn     = document.getElementById('auth-btn');

	function setAuthBtn(session) {
		const logoutBtn = document.getElementById('logout-btn');
		if (session) {
			authBtn.textContent = session.user.email.split('@')[0];
			authBtn.classList.add('logged-in');
			logoutBtn.classList.remove('hidden');
		} else {
			authBtn.textContent = 'Log in';
			authBtn.classList.remove('logged-in');
			logoutBtn.classList.add('hidden');
		}
	}

	document.getElementById('logout-btn').onclick = async () => {
		await db.auth.signOut();
	};

	function showAuthStatus(type, msg) {
		const el = document.getElementById('auth-status');
		el.className = `auth-status ${type}`;
		el.textContent = msg;
	}

	// Open / close
	authBtn.onclick = () => authOverlay.classList.remove('hidden');
	document.getElementById('auth-close').onclick = () => authOverlay.classList.add('hidden');
	authOverlay.addEventListener('click', e => { if (e.target === authOverlay) authOverlay.classList.add('hidden'); });

	document.getElementById('google-signin').onclick = () => {
		db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
	};

	// Tabs
	document.querySelectorAll('.auth-tab').forEach(tab => {
		tab.onclick = () => {
			document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
			tab.classList.add('active');
			document.getElementById('auth-login').classList.toggle('hidden', tab.dataset.tab !== 'login');
			document.getElementById('auth-signup').classList.toggle('hidden', tab.dataset.tab !== 'signup');
			document.getElementById('auth-status').className = 'auth-status hidden';
		};
	});

	// Login
	document.getElementById('login-submit').onclick = async () => {
		const email    = document.getElementById('login-email').value.trim();
		const password = document.getElementById('login-password').value;
		const btn = document.getElementById('login-submit');
		btn.disabled = true;
		const { data, error } = await db.auth.signInWithPassword({ email, password });
		btn.disabled = false;
		if (error) return showAuthStatus('error', error.message);
		setAuthBtn(data.session);
		authOverlay.classList.add('hidden');
	};

	// Sign up
	document.getElementById('signup-submit').onclick = async () => {
		const email    = document.getElementById('signup-email').value.trim();
		const password = document.getElementById('signup-password').value;
		const btn = document.getElementById('signup-submit');
		btn.disabled = true;
		const { error } = await db.auth.signUp({ email, password });
		btn.disabled = false;
		if (error) return showAuthStatus('error', error.message);
		showAuthStatus('success', 'Check your email to confirm your account.');
	};

	// Check subscription status and show/hide subscribe button
	async function updateSubscribeBtn(session) {
		const btn = document.getElementById('subscribe-btn');
		if (!session) { btn.classList.add('hidden'); return; }

		const { data } = await db.from('subscribers').select('status').eq('user_id', session.user.id).maybeSingle();
		if (data?.status === 'active') {
			btn.classList.add('hidden');
		} else {
			btn.classList.remove('hidden');
		}
	}

	// Subscribe button
	document.getElementById('subscribe-btn').onclick = async () => {
		const { data: { session } } = await db.auth.refreshSession();
		if (!session) { authOverlay.classList.remove('hidden'); return; }

		const btn = document.getElementById('subscribe-btn');
		btn.textContent = 'Loading…';
		btn.disabled = true;

		const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
			method: 'POST',
			headers: { 'Authorization': `Bearer ${session.access_token}` }
		});
		const { url } = await res.json();
		if (url) window.location.href = url;
		else { btn.textContent = 'Get Sound Packs'; btn.disabled = false; }
	};

	// Edit mode
	const ADMIN_EMAIL = 'mikesuokas@gmail.com';
	const editBtn = document.getElementById('edit-btn');
	const slotFileInput = document.getElementById('slot-file-input');
	let editMode = false;
	let pendingSlot = null;

	function setEditVisible(session) {
		if (session?.user?.email === ADMIN_EMAIL) {
			editBtn.classList.remove('hidden');
		} else {
			editBtn.classList.add('hidden');
			if (editMode) toggleEditMode();
		}
	}

	const changeBgBtn = document.getElementById('change-bg-btn');
	const bgFileInput = document.getElementById('bg-file-input');
	const removePackBtn = document.getElementById('remove-pack-btn');

	function toggleEditMode() {
		editMode = !editMode;
		document.body.classList.toggle('edit-mode', editMode);
		editBtn.textContent = editMode ? 'Exit Edit' : 'Edit Pack';
		editBtn.classList.toggle('edit-btn-active', editMode);
		changeBgBtn.classList.toggle('hidden', !editMode);
		removePackBtn.classList.toggle('hidden', !editMode);
	}

	removePackBtn.onclick = async () => {
		const theme = themes[currentThemeIndex];
		if (!confirm(`Remove "${theme.name}"? This cannot be undone.`)) return;

		removePackBtn.textContent = 'Removing…';
		removePackBtn.disabled = true;

		// Delete storage files for this pack
		const { data: files } = await db.storage.from('soundpacks').list(theme.id.toString());
		if (files?.length) {
			await db.storage.from('soundpacks').remove(files.map(f => `${theme.id}/${f.name}`));
		}

		// Delete pack_sounds and pack rows
		await db.from('pack_sounds').delete().eq('pack_id', theme.id);
		const { error } = await db.from('packs').delete().eq('id', theme.id);

		if (error) {
			removePackBtn.textContent = 'Remove Pack';
			removePackBtn.disabled = false;
			alert('Failed to delete pack: ' + error.message);
			return;
		}

		// Remove from local themes array and switch to nearest remaining theme
		themes.splice(currentThemeIndex, 1);
		if (themes.length === 0) {
			toggleEditMode();
			removePackBtn.classList.add('hidden');
			editBtn.classList.add('hidden');
			alert('Pack deleted. No packs remaining.');
			return;
		}
		currentThemeIndex = Math.min(currentThemeIndex, themes.length - 1);

		// Show deleted message briefly then load next theme
		removePackBtn.textContent = 'Pack deleted';
		setTimeout(async () => {
			removePackBtn.textContent = 'Remove Pack';
			removePackBtn.disabled = false;
			toggleEditMode();
			const theme = themes[currentThemeIndex];
			await new Promise(resolve => {
				if (!theme.bgImage) { applyThemeColors(theme); resolve(); return; }
				const img = new Image();
				img.onload = () => { applyThemeColors(theme); resolve(); };
				img.onerror = () => { applyThemeColors(theme); resolve(); };
				img.src = theme.bgImage;
			});
			updateThemeLabels();
			loadThemeSounds(theme);
		}, 1500);
	};

	changeBgBtn.onclick = () => { bgFileInput.value = ''; bgFileInput.click(); };

	bgFileInput.onchange = async () => {
		const file = bgFileInput.files[0];
		if (!file) return;
		const theme = themes[currentThemeIndex];
		if (!theme.id) { console.error('No theme id', theme); return; }

		changeBgBtn.textContent = 'Uploading…';
		changeBgBtn.disabled = true;

		const { data: { session } } = await db.auth.getSession();
		if (!session) { changeBgBtn.textContent = 'Not logged in'; changeBgBtn.disabled = false; return; }

		const ext = file.name.split('.').pop();
		const bgPath = `${theme.id}/bg.${ext}`;

		// Remove any existing bg files (different extensions leave stale files)
		const { data: existing } = await db.storage.from('soundpacks').list(theme.id.toString());
		if (existing) {
			const oldBgs = existing.filter(f => f.name.startsWith('bg.')).map(f => `${theme.id}/${f.name}`);
			if (oldBgs.length) await db.storage.from('soundpacks').remove(oldBgs);
		}

		const { error: storageErr } = await db.storage.from('soundpacks').upload(bgPath, file, { upsert: true });
		if (storageErr) {
			console.error('Storage upload failed:', storageErr);
			changeBgBtn.textContent = 'Upload failed';
			changeBgBtn.disabled = false;
			return;
		}

		// Cache-bust so CDN doesn't serve the old image
		const bgUrl = `${SUPABASE_URL}/storage/v1/object/public/soundpacks/${bgPath}?v=${Date.now()}`;
		const { error: dbErr } = await db.from('packs').update({ bg_image: bgUrl }).eq('id', theme.id);
		if (dbErr) {
			console.error('DB update failed:', dbErr);
			changeBgBtn.textContent = 'DB update failed';
			changeBgBtn.disabled = false;
			return;
		}

		theme.bgImage = bgUrl;
		document.body.style.backgroundImage = `url('${bgUrl}')`;
		changeBgBtn.textContent = 'Change BG';
		changeBgBtn.disabled = false;
	};

	editBtn.onclick = toggleEditMode;

	// Clicking a pad button in edit mode opens file picker for that slot
	document.querySelectorAll('.container .btn').forEach(btn => {
		btn.addEventListener('click', e => {
			if (!editMode) return;
			e.stopPropagation();
			const slot = parseInt(btn.id.replace('btn', ''));
			pendingSlot = slot;
			slotFileInput.value = '';
			slotFileInput.click();
		}, true);
	});

	slotFileInput.onchange = async () => {
		const file = slotFileInput.files[0];
		if (!file || pendingSlot === null) return;

		const theme = themes[currentThemeIndex];
		if (!theme.id) return;

		const slot = pendingSlot;
		pendingSlot = null;
		const btnEl = document.getElementById(`btn${slot}`);
		btnEl.classList.add('uploading');

		const ext = file.name.split('.').pop();
		const filePath = `${theme.id}/sound${slot}.${ext}`;

		// Upload to storage (upsert)
		const { error: upErr } = await db.storage.from('soundpacks').upload(filePath, file, { upsert: true });
		if (upErr) { btnEl.classList.remove('uploading'); console.error(upErr); return; }

		// Update or insert pack_sounds row
		await db.from('pack_sounds').upsert({ pack_id: theme.id, slot, file_path: filePath }, { onConflict: 'pack_id,slot' });

		// Reload sound into buffer
		const soundName = `sound${slot}`;
		const url = `${STORAGE_BASE}${filePath}`;
		bufferCache.delete(url);
		await loadSound(soundName, url);
		soundToButton[soundName] = `btn${slot}`;

		btnEl.classList.remove('uploading');
		btnEl.classList.add('upload-done');
		setTimeout(() => btnEl.classList.remove('upload-done'), 2000);
	};

	// Restore session on load
	const { data: { session } } = await db.auth.getSession();
	setAuthBtn(session);
	updateSubscribeBtn(session);
	setEditVisible(session);

	db.auth.onAuthStateChange((_event, session) => {
		setAuthBtn(session);
		updateSubscribeBtn(session);
		setEditVisible(session);
	});
});
