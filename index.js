const SUPABASE_URL = 'https://eavorbolhkfdluacjzvl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_T6YvgNDX-bxjrmNVd199Lw_tBhakmBV';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const overlay = document.getElementById('auth-overlay');
const loginBtn = document.getElementById('nav-login-btn');

function showStatus(type, msg) {
  const el = document.getElementById('auth-status');
  el.className = `auth-status ${type}`;
  el.textContent = msg;
}

const ctaBtnTop = document.getElementById('cta-subscribe-top');

async function updateUI(session) {
  const logoutBtn = document.getElementById('nav-logout-btn');
  if (session) {
    loginBtn.textContent = session.user.email.split('@')[0];
    loginBtn.style.pointerEvents = 'none';
    logoutBtn.style.display = 'block';
  } else {
    loginBtn.textContent = 'Log in';
    loginBtn.style.pointerEvents = '';
    logoutBtn.style.display = 'none';
    ctaBtnTop.textContent = 'Get All Sound Packs';
    document.getElementById('my-launchpads-section').style.display = 'none';
    return;
  }

  const { data } = await db.from('subscribers')
    .select('status').eq('user_id', session.user.id).maybeSingle();

  const subscribed = data?.status === 'active';

  loadMyLaunchpads(session.user.id);

  if (subscribed) {
    loginBtn.innerHTML = session.user.email.split('@')[0] + '<span class="nav-badge">⭐</span>';

    document.querySelector('.hero-inner').innerHTML = `
      <div class="hero-copy" style="perspective:none;">
        <div style="background:rgba(232,213,188,0.88); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border:1px solid rgba(245,158,11,0.2); border-radius:16px; padding:36px 40px; max-width:500px;">
          <h1 style="font-family:'Poppins',sans-serif; font-weight:800; font-size:clamp(28px,4vw,42px); color:#0d9488; margin-bottom:32px; letter-spacing:-0.5px;">What would you like to do?</h1>
          <div style="display:flex; flex-direction:column; gap:16px;">
            <a href="app.html" style="display:flex; align-items:center; gap:20px; background:linear-gradient(135deg,#f59e0b 0%,#f97316 100%); color:#1a0800; border-radius:20px; padding:20px 24px; text-decoration:none; transition:transform 0.15s, box-shadow 0.2s; box-shadow:0 4px 20px rgba(245,158,11,0.5); position:relative; overflow:hidden;" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 10px 36px rgba(245,158,11,0.6)'" onmouseout="this.style.transform='';this.style.boxShadow='0 4px 20px rgba(245,158,11,0.5)'">
              <span style="font-size:32px; line-height:1; position:relative; z-index:1;">▶</span>
              <div style="position:relative; z-index:1;">
                <div style="font-family:'Poppins',sans-serif; font-weight:700; font-size:18px; margin-bottom:3px;">Play</div>
                <div style="font-size:13px; opacity:0.85;">Play themed launchpads</div>
              </div>
              <div style="position:absolute; inset:0; background:linear-gradient(135deg,rgba(255,255,255,0.15) 0%,transparent 60%); pointer-events:none;"></div>
            </a>
            <a href="studio.html" style="display:flex; align-items:center; gap:20px; background:rgba(255,255,255,0.45); color:#0d9488; border:1px solid rgba(245,158,11,0.2); border-radius:20px; padding:20px 24px; text-decoration:none; transition:transform 0.15s, background 0.2s, box-shadow 0.2s; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);" onmouseover="this.style.transform='translateY(-2px)';this.style.background='rgba(255,255,255,0.65)';this.style.boxShadow='0 6px 24px rgba(26,42,74,0.12)'" onmouseout="this.style.transform='';this.style.background='rgba(255,255,255,0.45)';this.style.boxShadow=''">
              <span style="font-size:32px; line-height:1;">🎛️</span>
              <div>
                <div style="font-family:'Poppins',sans-serif; font-weight:700; font-size:18px; margin-bottom:3px;">Launchpad Studio</div>
                <div style="font-size:13px; opacity:0.6;">Create and manage your custom launchpads with 1000s of precurated sounds</div>
              </div>
            </a>
          </div>
        </div>
      </div>
      <div class="hero-pad">
        <div class="pad-mock" id="pad-mock"></div>
        <span class="float-tag float-tag-1">25 sounds</span>
      </div>`;
    buildPadMock();

    document.getElementById('packs-section-header').style.display = 'none';

  } else {
    ctaBtnTop.textContent = 'Get All Sound Packs';
    ctaBtnTop.onclick = () => startCheckout(session);
  }
}

async function loadMyLaunchpads(userId) {
  const section = document.getElementById('my-launchpads-section');
  const grid = document.getElementById('my-launchpads-grid');

  const { data: packs } = await db.from('custom_packs')
    .select('id, name, grid_size, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  section.style.display = 'block';
  if (!packs?.length) return;
  grid.innerHTML = '';

  packs.forEach(pack => {
    const playUrl = `app.html?pack=${pack.id}`;
    const shareUrl = `${window.location.origin}/app.html?pack=${pack.id}`;
    const date = new Date(pack.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const card = document.createElement('div');
    card.className = 'my-pack-card';
    card.innerHTML = `
      <button class="my-pack-delete" data-id="${pack.id}" title="Delete">✕</button>
      <h3>${pack.name}</h3>
      <div class="my-pack-meta">${pack.grid_size}×${pack.grid_size} grid &nbsp;·&nbsp; ${date}</div>
      <div class="my-pack-actions">
        <a href="${playUrl}" class="my-pack-play">▶ Play</a>
        <button class="my-pack-share" data-url="${shareUrl}">⎘ Copy link</button>
      </div>`;

    card.querySelector('.my-pack-delete').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${pack.name}"?`)) return;
      await db.from('custom_packs').delete().eq('id', pack.id);
      card.remove();
      const remaining = grid.querySelectorAll('.my-pack-card');
      if (!remaining.length) section.style.display = 'none';
    };

    card.querySelector('.my-pack-share').onclick = (e) => {
      const btn = e.currentTarget;
      navigator.clipboard.writeText(btn.dataset.url).then(() => {
        btn.textContent = '✓ Copied!';
        setTimeout(() => { btn.innerHTML = '⎘ Copy link'; }, 2000);
      });
    };

    grid.appendChild(card);
  });
}

async function startCheckout(session) {
  ctaBtnTop.textContent = 'Loading…';
  ctaBtnTop.disabled = true;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.access_token}` }
  });
  const { url, error } = await res.json();
  if (url) {
    window.location.href = url;
  } else {
    ctaBtnTop.textContent = 'Get All Sound Packs';
    ctaBtnTop.disabled = false;
    showStatus('error', error || 'Something went wrong');
  }
}

async function handleCtaClick() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) overlay.classList.remove('hidden');
}

ctaBtnTop.addEventListener('click', handleCtaClick);

loginBtn.addEventListener('click', e => {
  e.preventDefault();
  overlay.classList.remove('hidden');
});

document.getElementById('nav-logout-btn').addEventListener('click', async e => {
  e.preventDefault();
  await db.auth.signOut();
  window.location.reload();
});

document.getElementById('auth-close').onclick = () => overlay.classList.add('hidden');

document.getElementById('google-signin').onclick = () => {
  db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
};
overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('auth-login').classList.toggle('hidden', tab.dataset.tab !== 'login');
    document.getElementById('auth-signup').classList.toggle('hidden', tab.dataset.tab !== 'signup');
    document.getElementById('auth-status').className = 'auth-status hidden';
  };
});

document.getElementById('login-submit').onclick = async () => {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-submit');
  btn.disabled = true;
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  if (error) return showStatus('error', error.message);
  overlay.classList.add('hidden');
  updateUI(data.session);
};

document.getElementById('signup-submit').onclick = async () => {
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const btn = document.getElementById('signup-submit');
  btn.disabled = true;
  const { error } = await db.auth.signUp({ email, password });
  btn.disabled = false;
  if (error) return showStatus('error', error.message);
  showStatus('success', 'Check your email to confirm your account.');
};

db.auth.getSession().then(({ data: { session } }) => updateUI(session));

// Silently preload first theme's sounds into browser cache so app.html opens faster
(async () => {
  const STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/soundpacks/`;
  const { data: packs } = await db.from('packs').select('*, pack_sounds(*)').order('sort_order').limit(1);
  if (!packs?.length) return;
  packs[0].pack_sounds.forEach(s => {
    fetch(STORAGE_BASE + s.file_path).catch(() => {});
  });
})();

// Packs modal
const packsOverlay = document.getElementById('packs-overlay');
document.getElementById('packs-close').onclick = () => packsOverlay.classList.add('hidden');
packsOverlay.addEventListener('click', e => { if (e.target === packsOverlay) packsOverlay.classList.add('hidden'); });

async function openPacksModal() {
  packsOverlay.classList.remove('hidden');
  const grid = document.getElementById('packs-modal-grid');
  grid.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:14px;">Loading packs…</div>';

  const { data: packs } = await db.from('packs').select('*').order('sort_order');
  if (!packs?.length) { grid.innerHTML = '<div style="color:rgba(255,255,255,0.3)">No packs found.</div>'; return; }

  grid.innerHTML = '';
  packs.forEach(pack => {
    const colors = pack.colors || ['#ff1f71','#2db2ff','#1eff45','#ffd500','#ff6a00'];
    const grad = `linear-gradient(135deg, ${colors[0]}33 0%, ${colors[2]}22 50%, ${colors[4]}33 100%)`;
    const card = document.createElement('div');
    card.className = 'pm-card';
    card.innerHTML = `
      <div class="pm-card-header" style="background:${grad};">
        ${pack.is_free ? '<span class="pm-free-badge">Free</span>' : ''}
        <div class="pm-color-dots">
          ${colors.map(c => `<div class="pm-dot" style="background:${c};color:${c}"></div>`).join('')}
        </div>
      </div>
      <div class="pm-card-body">
        <span class="pm-tag">${pack.tag || 'Sound Pack'}</span>
        <h3>${pack.name}</h3>
        <p>${pack.description || ''}</p>
        <a href="app.html" class="pm-play-btn">▶ Play this pack</a>
      </div>`;
    grid.appendChild(card);
  });
}

document.getElementById('hero-browse-btn').addEventListener('click', e => {
  e.preventDefault();
  openPacksModal();
});

// Build pad mock with animated lit cells
function buildPadMock() {
  const mock = document.getElementById('pad-mock');
  if (!mock) return;
  mock.innerHTML = '';
  const rows = ['r1','r2','r3','r4','r5'];
  const litCells = new Set([1, 7, 13, 19, 23]);
  for (let i = 0; i < 25; i++) {
    const row = rows[Math.floor(i / 5)];
    const cell = document.createElement('div');
    cell.className = `pad-cell ${row}${litCells.has(i) ? ' lit' : ''}`;
    cell.appendChild(document.createElement('a'));
    mock.appendChild(cell);
  }
}
buildPadMock();

// Randomly pulse cells
setInterval(() => {
  const mock = document.getElementById('pad-mock');
  if (!mock) return;
  const cells = mock.querySelectorAll('.pad-cell');
  const idx = Math.floor(Math.random() * 25);
  const cell = cells[idx];
  cell.classList.add('lit');
  setTimeout(() => cell.classList.remove('lit'), 600);
}, 900);

const flipBtn = document.getElementById('flip-btn');
if (flipBtn) flipBtn.onclick = () => {
  const card = document.getElementById('hero-card');
  const btn = document.getElementById('flip-btn');
  const flipped = card.classList.toggle('flipped');
  btn.textContent = flipped ? '←' : '→';
};

// Ambient rising particles
(function () {
  const canvas = document.getElementById('particle-canvas');
  const ctx = canvas.getContext('2d');
  const particles = [];
  const colors = ['#14b8a6','#f59e0b','#f97316','#06b6d4','#0d9488'];

  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  window.addEventListener('resize', resize);
  resize();

  const goldenColors = ['#f5c432','#f59e0b','#fde68a','#f97316'];

  function addParticle() {
    if (particles.filter(p => !p.falling).length >= 55) return;
    const color = colors[Math.floor(Math.random() * colors.length)];
    particles.push({
      x: Math.random() * canvas.width,
      y: canvas.height + 5,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -(Math.random() * 0.7 + 0.25),
      color,
      size: Math.random() * 1.8 + 0.4,
      life: 0.65 + Math.random() * 0.35,
      decay: 0.0014 + Math.random() * 0.001,
      falling: false,
    });
  }

  function addFalling() {
    if (particles.filter(p => p.falling).length >= 35) return;
    const color = goldenColors[Math.floor(Math.random() * goldenColors.length)];
    particles.push({
      x: Math.random() * canvas.width,
      y: -5,
      vx: (Math.random() - 0.5) * 0.4,
      vy: Math.random() * 0.6 + 0.2,
      color,
      size: Math.random() * 1.5 + 0.3,
      life: 0.65 + Math.random() * 0.35,
      decay: 0.0012 + Math.random() * 0.001,
      falling: true,
    });
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    addParticle();
    addFalling();
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0 || p.y < -20 || p.y > canvas.height + 20) { particles.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life * 0.75);
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 5;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    requestAnimationFrame(animate);
  }

  animate();
})();

// Play button exit animation — elements slide aside before navigating
document.addEventListener('click', function(e) {
  const link = e.target.closest('a[href="app.html"]');
  if (!link) return;
  e.preventDefault();
  const dest = link.href;

  const heroCopy = document.querySelector('.hero-copy');
  const heroPad  = document.querySelector('.hero-pad');
  const nav      = document.querySelector('nav');

  if (heroCopy) {
    heroCopy.style.transition = 'transform 0.5s cubic-bezier(0.4,0,1,1), opacity 0.4s ease';
    heroCopy.style.transform  = 'translateX(-110%) scale(0.9)';
    heroCopy.style.opacity    = '0';
  }
  if (heroPad) {
    heroPad.style.transition = 'transform 0.5s cubic-bezier(0.4,0,1,1), opacity 0.4s ease';
    heroPad.style.transform  = 'translateX(110%) rotate(-8deg) scale(0.9)';
    heroPad.style.opacity    = '0';
  }
  if (nav) {
    nav.style.transition = 'transform 0.4s ease, opacity 0.35s ease';
    nav.style.transform  = 'translateY(-50px)';
    nav.style.opacity    = '0';
  }

  const packsHeader = document.getElementById('packs-section-header');
  if (packsHeader && packsHeader.getBoundingClientRect().top < window.innerHeight) {
    packsHeader.style.transition = 'transform 0.5s cubic-bezier(0.4,0,1,1), opacity 0.4s ease';
    packsHeader.style.transform  = 'translateY(60px) scale(0.97)';
    packsHeader.style.opacity    = '0';
  }

  setTimeout(() => { window.location.href = dest; }, 480);
});

