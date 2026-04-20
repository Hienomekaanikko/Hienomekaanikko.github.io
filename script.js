const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const sounds = {};
const soundToButton = {};

const SUPABASE_URL = 'https://eavorbolhkfdluacjzvl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_T6YvgNDX-bxjrmNVd199Lw_tBhakmBV';
const STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/soundpacks/`;
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let themes = [];

async function fetchThemes() {
	const { data: packs, error } = await db
		.from('packs')
		.select('*, pack_sounds(*)')
		.order('sort_order');

	if (error) { console.error('Failed to fetch packs', error); return; }

	themes = packs.map(pack => ({
		name: pack.name,
		colors: pack.colors,
		bg: pack.bg,
		bodyClass: pack.body_class || null,
		sounds: Object.fromEntries(
			pack.pack_sounds.map(s => [s.slot, STORAGE_BASE + s.file_path])
		)
	}));
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
	const resp = await fetch(url);
	const buffer = await resp.arrayBuffer();
	sounds[name] = {
		buffer: await audioCtx.decodeAudioData(buffer),
		source: null,
		startTimeoutId: null
	};
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
function toggleLoop(name, buttonId) {
	if (audioCtx.state === 'suspended') {
		audioCtx.resume();
	}

	const row = buttonRows[buttonId];
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
}

function updateThemeLabels() {
	const prev = themes[(currentThemeIndex - 1 + themes.length) % themes.length];
	const next = themes[(currentThemeIndex + 1) % themes.length];
	document.getElementById('theme-label-left').textContent = prev.name;
	document.getElementById('theme-label-right').textContent = next.name;
}

async function loadThemeSounds(theme) {
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

	for (let i = 1; i <= 25; i++) {
		const name = `sound${i}`;
		const id = `btn${i}`;
		const url = theme.sounds[i];
		if (!url) continue;
		try {
			await loadSound(name, url);
			soundToButton[name] = id;
		} catch (e) {
			console.warn(`[Skip] Could not load slot ${i}`);
		}
	}
}

async function switchTheme(direction) {
	const container = document.querySelector('.container');
	container.classList.add('switching');

	currentThemeIndex = (currentThemeIndex + direction + themes.length) % themes.length;
	const theme = themes[currentThemeIndex];

	applyThemeColors(theme);
	updateThemeLabels();
	await loadThemeSounds(theme);

	container.classList.remove('switching');
}

// Load sounds and bind buttons
window.addEventListener("load", async () => {
	await fetchThemes();
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
		if (btn) btn.onclick = () => { toggleLoop(name, id); triggerBurst(btn); };
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

	// Load initial theme
	applyThemeColors(themes[0]);
	updateThemeLabels();
	await loadThemeSounds(themes[0]);

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

		wrap.addEventListener('wheel', e => {
			e.preventDefault();
			setValue(Math.max(0, Math.min(100, getValue() + (e.deltaY < 0 ? 2 : -2))));
		}, { passive: false });
	}

	// Build and wire knobs
	const volCol    = document.getElementById('vol-knobs');
	const filterCol = document.getElementById('filter-knobs');

	for (let row = 1; row <= 5; row++) {
		const colorClass = `row-color-${row}`;

		const volWrap = createKnob(`vol-wrap-${row}`, colorClass);
		volCol.appendChild(volWrap);
		let volVal = 100;
		setupKnobDrag(volWrap,
			() => volVal,
			v => {
				volVal = v;
				rowVolumes[row] = v / 100;
				rowGains[row].gain.setValueAtTime(v / 100, audioCtx.currentTime);
				updateKnobVisual(volWrap, v);
			}
		);

		const filterWrap = createKnob(`filter-wrap-${row}`, colorClass);
		filterCol.appendChild(filterWrap);
		let filterVal = 100;
		setupKnobDrag(filterWrap,
			() => filterVal,
			v => {
				filterVal = v;
				rowFilters[row].frequency.setValueAtTime(200 * Math.pow(100, v / 100), audioCtx.currentTime);
				updateKnobVisual(filterWrap, v);
			}
		);
	}

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

	// Restore session on load
	const { data: { session } } = await db.auth.getSession();
	setAuthBtn(session);
	updateSubscribeBtn(session);

	db.auth.onAuthStateChange((_event, session) => {
		setAuthBtn(session);
		updateSubscribeBtn(session);
	});
});
