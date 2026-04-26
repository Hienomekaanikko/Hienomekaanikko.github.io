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
        <div style="background:rgba(232,213,188,0.88); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); border:1px solid rgba(42,106,173,0.15); border-radius:16px; padding:36px 40px; max-width:500px;">
          <h1 style="font-family:'Poppins',sans-serif; font-weight:800; font-size:clamp(28px,4vw,42px); color:#1a3a6b; margin-bottom:32px; letter-spacing:-0.5px;">What would you like to do?</h1>
          <div style="display:flex; flex-direction:column; gap:16px;">
            <a href="app.html" style="display:flex; align-items:center; gap:20px; background:#2a6aad; color:#fff; border-radius:14px; padding:20px 24px; text-decoration:none; transition:transform 0.15s, box-shadow 0.2s; box-shadow:0 4px 24px rgba(42,106,173,0.35);" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 32px rgba(42,106,173,0.5)'" onmouseout="this.style.transform='';this.style.boxShadow='0 4px 24px rgba(42,106,173,0.35)'">
              <span style="font-size:32px; line-height:1;">▶</span>
              <div>
                <div style="font-family:'Poppins',sans-serif; font-weight:700; font-size:18px; margin-bottom:3px;">Play</div>
                <div style="font-size:13px; opacity:0.8;">Play themed launchpads</div>
              </div>
            </a>
            <a href="studio.html" style="display:flex; align-items:center; gap:20px; background:rgba(26,42,74,0.07); color:#1a3a6b; border:1px solid rgba(42,106,173,0.2); border-radius:14px; padding:20px 24px; text-decoration:none; transition:transform 0.15s, background 0.2s;" onmouseover="this.style.transform='translateY(-2px)';this.style.background='rgba(26,42,74,0.12)'" onmouseout="this.style.transform='';this.style.background='rgba(26,42,74,0.07)'">
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

  if (!packs?.length) return;

  section.style.display = 'block';
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
