const SUPABASE_URL = 'https://eavorbolhkfdluacjzvl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_T6YvgNDX-bxjrmNVd199Lw_tBhakmBV';
const SOUNDS_STORAGE = `${SUPABASE_URL}/storage/v1/object/public/sounds/`;
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let gridSize = 5;
let slots = {}; // slot index -> { id, name, category, file_path }
let selectedSound = null; // sound object currently selected from pool
let allSounds = [];
let activeCategory = 'all';
let previewAudio = null;
let currentUser = null;
let bgFile = null;

// --- Auth check ---
async function init() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    // Redirect to home with a message — studio requires login
    window.location.href = 'index.html';
    return;
  }
  currentUser = session.user;
  await loadSounds();
  setupSetupScreen();
}

// --- Load all sounds from pool ---
async function loadSounds() {
  const { data, error } = await db.from('sounds').select('*').order('category').order('name');
  if (!error && data) allSounds = data;
}

// --- Setup screen ---
function setupSetupScreen() {
  const sizeButtons = document.querySelectorAll('.grid-size-btn');
  sizeButtons.forEach(btn => {
    btn.onclick = () => {
      sizeButtons.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      gridSize = parseInt(btn.dataset.size);
    };
  });

  document.getElementById('start-btn').onclick = () => {
    const name = document.getElementById('setup-name').value.trim() || 'My Launchpad';
    document.getElementById('setup-name').value = name;
    showBuilder();
  };
}

// --- Builder ---
function showBuilder() {
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('builder-screen').style.display = 'flex';

  // Update topbar with name input
  document.getElementById('topbar-right').innerHTML = `
    <input class="topbar-name" id="pack-name" value="${document.getElementById('setup-name').value}" maxlength="40">
    <a href="index.html" style="font-size:13px;color:rgba(26,42,74,0.5);text-decoration:none;letter-spacing:0.5px;font-weight:500;" onmouseover="this.style.color='#1a2a4a'" onmouseout="this.style.color='rgba(26,42,74,0.5)'">← Home</a>`;

  slots = {};
  selectedSound = null;
  buildGrid();
  buildPool();

  document.getElementById('reset-btn').onclick = resetToSetup;
  document.getElementById('save-btn').onclick = savePack;

  // Background image
  const bgUploadBtn = document.getElementById('bg-upload-btn');
  const bgFileInput = document.getElementById('bg-file-input');
  const bgPreviewStrip = document.getElementById('bg-preview-strip');
  const bgPreviewThumb = document.getElementById('bg-preview-thumb');
  const bgPreviewName = document.getElementById('bg-preview-name');
  const bgRemoveBtn = document.getElementById('bg-remove-btn');

  bgUploadBtn.onclick = () => { bgFileInput.value = ''; bgFileInput.click(); };
  bgFileInput.onchange = () => {
    const file = bgFileInput.files[0];
    if (!file) return;
    bgFile = file;
    const url = URL.createObjectURL(file);
    bgPreviewThumb.src = url;
    bgPreviewName.textContent = file.name;
    bgPreviewStrip.style.display = 'flex';
    const panel = document.getElementById('grid-panel');
    panel.style.backgroundImage = `url('${url}')`;
    panel.style.backgroundSize = 'cover';
    panel.style.backgroundPosition = 'center';
    panel.classList.add('has-bg');
  };
  bgRemoveBtn.onclick = () => {
    bgFile = null;
    bgPreviewStrip.style.display = 'none';
    const panel = document.getElementById('grid-panel');
    panel.style.backgroundImage = '';
    panel.classList.remove('has-bg');
  };
}

function resetToSetup() {
  slots = {};
  selectedSound = null;
  bgFile = null;
  stopPreview();
  const gp = document.getElementById('grid-panel');
  gp.style.backgroundImage = '';
  gp.classList.remove('has-bg');
  document.getElementById('builder-screen').style.display = 'none';
  document.getElementById('setup-screen').style.display = 'flex';
  document.getElementById('topbar-right').innerHTML = `
    <a href="index.html" style="font-size:13px;color:rgba(26,42,74,0.5);text-decoration:none;letter-spacing:0.5px;font-weight:500;" onmouseover="this.style.color='#1a2a4a'" onmouseout="this.style.color='rgba(26,42,74,0.5)'">← Home</a>`;
}

// --- Grid ---
function buildGrid() {
  const grid = document.getElementById('studio-grid');
  const slotSize = gridSize === 3 ? 120 : gridSize === 4 ? 110 : 100;
  grid.style.gridTemplateColumns = `repeat(${gridSize}, ${slotSize}px)`;
  grid.style.gridTemplateRows = `repeat(${gridSize}, ${slotSize}px)`;
  grid.innerHTML = '';

  const total = gridSize * gridSize;
  for (let i = 1; i <= total; i++) {
    const row = Math.ceil(i / gridSize);
    const slot = document.createElement('div');
    slot.className = `studio-slot sr${Math.min(row, 5)}`;
    slot.dataset.slot = i;
    slot.innerHTML = `
      <span class="slot-num">${i}</span>
      <div class="studio-slot-inner">
        <span class="slot-empty-icon">+</span>
        <span class="slot-sound-name" style="display:none;"></span>
      </div>
      <button class="slot-remove" title="Remove sound">✕</button>`;

    slot.onclick = (e) => {
      if (e.target.classList.contains('slot-remove')) return;
      handleSlotClick(i, slot);
    };

    slot.querySelector('.slot-remove').onclick = () => removeFromSlot(i, slot);

    // Drag and drop
    slot.addEventListener('dragover', e => { e.preventDefault(); slot.classList.add('drop-target'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('drop-target'));
    slot.addEventListener('drop', e => {
      e.preventDefault();
      slot.classList.remove('drop-target');
      const soundId = e.dataTransfer.getData('soundId');
      const sound = allSounds.find(s => s.id === soundId);
      if (sound) assignToSlot(i, slot, sound);
    });

    grid.appendChild(slot);
  }
}

function handleSlotClick(index, slotEl) {
  if (selectedSound) {
    assignToSlot(index, slotEl, selectedSound);
  } else if (slots[index]) {
    // Preview the assigned sound
    playPreview(SOUNDS_STORAGE + slots[index].file_path);
  }
}

function assignToSlot(index, slotEl, sound) {
  slots[index] = sound;
  slotEl.classList.add('has-sound');
  slotEl.querySelector('.slot-empty-icon').style.display = 'none';
  const nameEl = slotEl.querySelector('.slot-sound-name');
  nameEl.textContent = sound.name;
  nameEl.style.display = 'block';
  updateHint();
}

function removeFromSlot(index, slotEl) {
  delete slots[index];
  slotEl.classList.remove('has-sound');
  slotEl.querySelector('.slot-empty-icon').style.display = '';
  const nameEl = slotEl.querySelector('.slot-sound-name');
  nameEl.textContent = '';
  nameEl.style.display = 'none';
}


// --- Sound pool ---
const CATEGORIES = ['all', 'drums', 'rhythm', 'bass', 'melody', 'fx', 'vocal', 'other'];

function buildPool() {
  // Category tabs
  const tabs = document.getElementById('cat-tabs');
  tabs.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const tab = document.createElement('button');
    tab.className = `cat-tab${cat === activeCategory ? ' active' : ''}`;
    tab.textContent = cat === 'all' ? 'All' : cat;
    tab.onclick = () => {
      activeCategory = cat;
      tabs.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderPoolList();
    };
    tabs.appendChild(tab);
  });

  document.getElementById('pool-search').oninput = renderPoolList;
  renderPoolList();
}

function renderPoolList() {
  const query = document.getElementById('pool-search').value.toLowerCase();
  const list = document.getElementById('pool-list');

  const filtered = allSounds.filter(s => {
    const matchCat = activeCategory === 'all' || s.category === activeCategory;
    const matchQuery = !query || s.name.toLowerCase().includes(query) || s.category.toLowerCase().includes(query);
    return matchCat && matchQuery;
  });

  if (!filtered.length) {
    list.innerHTML = '<div class="pool-empty">No sounds found</div>';
    return;
  }

  list.innerHTML = '';
  filtered.forEach(sound => {
    const item = document.createElement('div');
    item.className = `pool-item${selectedSound?.id === sound.id ? ' selected' : ''}`;
    item.draggable = true;
    item.innerHTML = `
      <span class="pool-item-name">${sound.name}</span>
      <span class="pool-item-cat">${sound.category}</span>
      <button class="pool-preview-btn" title="Preview">▶</button>`;

    item.onclick = (e) => {
      if (e.target.classList.contains('pool-preview-btn')) return;
      selectSound(sound);
    };

    item.querySelector('.pool-preview-btn').onclick = (e) => {
      e.stopPropagation();
      togglePreview(sound, item.querySelector('.pool-preview-btn'));
    };

    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('soundId', sound.id);
      selectSound(sound);
    });

    list.appendChild(item);
  });
}

function selectSound(sound) {
  if (selectedSound?.id === sound.id) {
    selectedSound = null;
  } else {
    selectedSound = sound;
  }
  updateHint();
  renderPoolList();
}

function updateHint() {
  const hint = document.getElementById('assign-hint');
  if (selectedSound) {
    hint.textContent = `"${selectedSound.name}" selected — click a slot to assign it`;
    hint.classList.add('active');
  } else {
    hint.textContent = 'Click a sound from the pool, then click a slot to assign it';
    hint.classList.remove('active');
  }
}

// --- Audio preview ---
function stopPreview() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio = null;
  }
  document.querySelectorAll('.pool-preview-btn.playing').forEach(b => b.classList.remove('playing'));
}

function playPreview(url) {
  stopPreview();
  previewAudio = new Audio(url);
  previewAudio.play().catch(() => {});
  previewAudio.onended = () => stopPreview();
}

function togglePreview(sound, btn) {
  const url = SOUNDS_STORAGE + sound.file_path;
  if (previewAudio && !previewAudio.paused) {
    stopPreview();
    return;
  }
  stopPreview();
  previewAudio = new Audio(url);
  previewAudio.play().catch(() => {});
  btn.classList.add('playing');
  btn.textContent = '■';
  previewAudio.onended = () => {
    btn.classList.remove('playing');
    btn.textContent = '▶';
    previewAudio = null;
  };
}

// --- Save ---
async function savePack() {
  const assignedSlots = Object.keys(slots);
  if (assignedSlots.length === 0) {
    alert('Assign at least one sound before saving.');
    return;
  }

  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  const name = document.getElementById('pack-name')?.value.trim() || 'My Launchpad';

  const { data: pack, error: packErr } = await db.from('custom_packs').insert({
    user_id: currentUser.id,
    name,
    grid_size: gridSize
  }).select().single();


  if (packErr) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save & Share';
    alert('Error saving: ' + packErr.message);
    return;
  }

  // Upload background image if provided
  if (bgFile) {
    saveBtn.textContent = 'Uploading bg…';
    const ext = bgFile.name.split('.').pop();
    const bgPath = `custom/${pack.id}/bg.${ext}`;
    const { error: bgErr } = await db.storage.from('soundpacks').upload(bgPath, bgFile);
    if (!bgErr) {
      const bgUrl = `${SUPABASE_URL}/storage/v1/object/public/soundpacks/${bgPath}?v=${Date.now()}`;
      await db.from('custom_packs').update({ bg_image: bgUrl }).eq('id', pack.id);
    }
    saveBtn.textContent = 'Saving…';
  }

  const rows = assignedSlots.map(slot => ({
    pack_id: pack.id,
    slot: parseInt(slot),
    sound_id: slots[slot].id
  }));

  const { error: soundsErr } = await db.from('custom_pack_sounds').insert(rows);
  if (soundsErr) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save & Share';
    alert('Error saving sounds: ' + soundsErr.message);
    return;
  }

  saveBtn.disabled = false;
  saveBtn.textContent = 'Save & Share';

  const shareUrl = `${window.location.origin}/app.html?pack=${pack.id}`;
  document.getElementById('share-link').value = shareUrl;
  document.getElementById('share-modal').classList.remove('hidden');

  document.getElementById('copy-btn').onclick = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      document.getElementById('copy-btn').textContent = 'Copied!';
      setTimeout(() => { document.getElementById('copy-btn').textContent = 'Copy'; }, 2000);
    });
  };

  document.getElementById('play-btn').onclick = () => { window.location.href = shareUrl; };
  document.getElementById('close-modal-btn').onclick = () => {
    document.getElementById('share-modal').classList.add('hidden');
  };
}

init();
