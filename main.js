const SUPABASE_URL = 'https://bemcdwxyxdguhcrgkhth.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbWNkd3h5eGRndWhjcmdraHRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMjMzOTgsImV4cCI6MjA5NjU5OTM5OH0.GrPUSR7EKSlOGXVI7gxQnwvQvwZBUcuOi2I9EsbrNxk';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const isAdmin = new URLSearchParams(location.search).has('admin');

// ── DOM ──
const adminPanel      = document.getElementById('adminPanel');
const loginBox        = document.getElementById('loginBox');
const writeBox        = document.getElementById('writeBox');
const loginBtn        = document.getElementById('loginBtn');
const logoutBtn       = document.getElementById('logoutBtn');
const postBtn         = document.getElementById('postBtn');
const loginStatus     = document.getElementById('loginStatus');
const postStatus      = document.getElementById('postStatus');
const archiveList     = document.getElementById('archiveList');
const postPhoto       = document.getElementById('postPhoto');
const postFileName    = document.getElementById('postFileName');
const postFilterStatus= document.getElementById('postFilterStatus');
const multiPreview    = document.getElementById('multiPreview');
const postModal       = document.getElementById('postModal');
const modalClose      = document.getElementById('modalClose');
const modalImages     = document.getElementById('modalImages');
const modalDate       = document.getElementById('modalDate');
const modalTitle      = document.getElementById('modalTitle');
const modalExcerpt    = document.getElementById('modalExcerpt');
const modalWeather    = document.getElementById('modalWeather');

const OW_KEY = '22e32b9735460bfc73f39f24811548cf';
let posts        = [];
let filteredBlobs = [];
let currentWeather = null;

// 날씨 미리 가져오기 (글 작성 시 포함)
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(({ coords }) => {
    fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${coords.latitude}&lon=${coords.longitude}&appid=${OW_KEY}&units=metric&lang=kr`)
      .then(r => r.json())
      .then(d => {
        if (d.main) currentWeather = `${Math.round(d.main.temp)}°C · ${d.main.humidity}% · ${d.weather[0].description}`;
      })
      .catch(() => {});
  }, () => {});
}

// ── Admin ──
if (isAdmin) {
  adminPanel.style.display = 'block';
  sb.auth.getSession().then(({ data }) => {
    if (data.session) showWriteBox();
  });
}

// ── Retro filter ──
function applyRetroFilter(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1400;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX || h > MAX) {
        const r = Math.min(MAX / w, MAX / h);
        w = Math.round(w * r); h = Math.round(h * r);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      const id = ctx.getImageData(0, 0, w, h);
      const px = id.data;
      const cx = w / 2, cy = h / 2, maxDist = Math.sqrt(cx*cx + cy*cy);

      for (let i = 0; i < px.length; i += 4) {
        let r = px[i], g = px[i+1], b = px[i+2];

        const gray = r * 0.299 + g * 0.587 + b * 0.114;
        r = r * 0.15 + gray * 0.85;
        g = g * 0.15 + gray * 0.85;
        b = b * 0.15 + gray * 0.85;

        const sr = r * 0.393 + g * 0.769 + b * 0.189;
        const sg = r * 0.349 + g * 0.686 + b * 0.168;
        const sb = r * 0.272 + g * 0.534 + b * 0.131;
        r = r * 0.88 + sr * 0.12;
        g = g * 0.88 + sg * 0.12;
        b = b * 0.88 + sb * 0.12;

        r = (r * 0.86 - 128) * 1.1 + 128;
        g = (g * 0.86 - 128) * 1.1 + 128;
        b = (b * 0.86 - 128) * 1.1 + 128;

        const px_ = (i / 4) % w, py_ = Math.floor((i / 4) / w);
        const dx = px_ - cx, dy = py_ - cy;
        const dist = Math.sqrt(dx*dx + dy*dy) / maxDist;
        const vig = dist > 0.4 ? (dist - 0.4) / 0.6 * 0.55 : 0;
        r = r * (1 - vig);
        g = g * (1 - vig);
        b = b * (1 - vig);

        const n = (Math.random() - 0.5) * 18;
        px[i]   = Math.min(255, Math.max(0, r + n));
        px[i+1] = Math.min(255, Math.max(0, g + n));
        px[i+2] = Math.min(255, Math.max(0, b + n));
      }
      ctx.putImageData(id, 0, 0);
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.88);
    };
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.readAsDataURL(file);
  });
}

// ── Multi photo preview ──
postPhoto.addEventListener('change', async () => {
  const files = Array.from(postPhoto.files);
  filteredBlobs = [];
  multiPreview.innerHTML = '';

  if (!files.length) { postFileName.textContent = ''; postFilterStatus.textContent = ''; return; }

  postFileName.textContent    = `${files.length}장 선택됨`;
  postFilterStatus.textContent = '필터 적용 중—';

  for (const file of files) {
    const blob = await applyRetroFilter(file);
    filteredBlobs.push(blob);
    const img = document.createElement('img');
    img.className = 'multi-thumb';
    img.src = URL.createObjectURL(blob);
    multiPreview.appendChild(img);
  }

  postFilterStatus.textContent = '';
});

// ── Login ──
async function doLogin() {
  const email    = document.getElementById('adminEmail').value.trim();
  const password = document.getElementById('adminPassword').value;
  if (!email || !password) return;
  loginBtn.disabled = true;
  loginStatus.textContent = '—';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { loginStatus.textContent = error.message; loginBtn.disabled = false; return; }
  showWriteBox();
}

loginBtn.addEventListener('click', doLogin);
document.getElementById('adminPassword').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

logoutBtn.addEventListener('click', async () => {
  await sb.auth.signOut();
  writeBox.style.display = 'none';
  loginBox.style.display = 'block';
});

// ── Post submit ──
postBtn.addEventListener('click', async () => {
  const title   = document.getElementById('postTitle').value.trim();
  const excerpt = document.getElementById('postExcerpt').value.trim();
  const date    = document.getElementById('postDate').value.trim();
  const artist  = document.getElementById('postArtist').value.trim();
  if (!title) { postStatus.textContent = '제목을 입력해주세요.'; return; }
  postBtn.disabled = true;
  postStatus.textContent = '—';

  const image_urls = [];
  const blobs = filteredBlobs.length ? filteredBlobs : Array.from(postPhoto.files);

  for (let i = 0; i < blobs.length; i++) {
    const blob = blobs[i];
    const path = `archive/${Date.now()}-${Math.random().toString(36).slice(2)}-${i}.jpg`;
    const { error: upErr } = await sb.storage
      .from('weather-photos')
      .upload(path, blob, { contentType: 'image/jpeg' });
    if (upErr) {
      postStatus.textContent = `사진 업로드 실패 (${i+1}번): ${upErr.message}`;
      postBtn.disabled = false;
      return;
    }
    image_urls.push(sb.storage.from('weather-photos').getPublicUrl(path).data.publicUrl);
  }

  const minOrder = posts.length ? Math.min(...posts.map(p => p.order_index ?? 0)) : 0;

  const { error } = await sb.from('archive_posts').insert({
    title,
    excerpt: excerpt || null,
    image_url: image_urls[0] || null,
    image_urls: image_urls,
    post_date: date || null,
    artist: artist || null,
    weather_text: currentWeather || null,
    order_index: minOrder - 1
  });

  if (error) {
    postStatus.textContent = `저장 실패: ${error.message}`;
    postBtn.disabled = false;
    return;
  }

  postStatus.textContent = '올라갔습니다.';
  ['postTitle','postExcerpt','postDate','postArtist'].forEach(id => document.getElementById(id).value = '');
  postPhoto.value = '';
  postFileName.textContent = '';
  filteredBlobs = [];
  multiPreview.innerHTML = '';
  postBtn.disabled = false;
  await loadArchive();
});

// ── Load archive ──
async function loadArchive() {
  const { data, error } = await sb
    .from('archive_posts')
    .select('*')
    .order('order_index', { ascending: true });

  if (error || !data || data.length === 0) {
    archiveList.innerHTML = '<div class="list-empty">—</div>';
    posts = [];
    return;
  }

  posts = data;
  archiveList.innerHTML = data.map((post, i) => renderItem(post, i, data.length)).join('');
  bindItemEvents();
}

function renderItem(post, i, total) {
  const meta = post.post_date || String(i + 1).padStart(2, '0');
  const adminControls = isAdmin ? `
    <span class="admin-controls">
      <button class="ctrl-btn move-up"   data-id="${escapeAttr(post.id)}" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="ctrl-btn move-down" data-id="${escapeAttr(post.id)}" ${i === total-1 ? 'disabled' : ''}>↓</button>
      <button class="ctrl-btn delete-btn" data-id="${escapeAttr(post.id)}">삭제</button>
    </span>` : '';

  return `
    <div class="list-item" data-id="${escapeAttr(post.id)}">
      <span class="list-item-meta">${escapeHtml(meta)}</span>
      <span class="list-item-title">${escapeHtml(post.title)}${adminControls}</span>
      <span class="list-item-artist">${escapeHtml(post.artist || 'mikihoo')}</span>
    </div>`;
}

function bindItemEvents() {
  archiveList.querySelectorAll('.list-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.ctrl-btn')) return;
      const post = posts.find(p => p.id === el.dataset.id);
      if (post) openModal(post);
    });
  });

  if (!isAdmin) return;

  archiveList.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('삭제할까요?')) return;
      await sb.from('archive_posts').delete().eq('id', btn.dataset.id);
      await loadArchive();
    });
  });

  archiveList.querySelectorAll('.move-up').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const idx = posts.findIndex(p => p.id === btn.dataset.id);
      if (idx <= 0) return;
      await swapOrder(posts[idx], posts[idx - 1]);
    });
  });

  archiveList.querySelectorAll('.move-down').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const idx = posts.findIndex(p => p.id === btn.dataset.id);
      if (idx >= posts.length - 1) return;
      await swapOrder(posts[idx], posts[idx + 1]);
    });
  });
}

async function swapOrder(a, b) {
  const oa = a.order_index, ob = b.order_index;
  await sb.from('archive_posts').update({ order_index: ob }).eq('id', a.id);
  await sb.from('archive_posts').update({ order_index: oa }).eq('id', b.id);
  await loadArchive();
}

// ── Modal ──
function openModal(post) {
  // 이미지 목록: image_urls 배열 우선, 없으면 image_url 단일
  const imgs = (post.image_urls && post.image_urls.length)
    ? post.image_urls
    : (post.image_url ? [post.image_url] : []);

  modalImages.innerHTML = imgs.map(url =>
    `<img class="modal-img" src="${escapeAttr(url)}" alt="" loading="lazy" />`
  ).join('');

  modalDate.textContent    = post.post_date || '';
  modalTitle.textContent   = post.title;
  modalExcerpt.textContent = post.excerpt || '';
  if (modalWeather) modalWeather.textContent = post.weather_text || '';
  postModal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  postModal.classList.remove('open');
  document.body.style.overflow = '';
  modalImages.innerHTML = '';
}

modalClose.addEventListener('click', closeModal);
postModal.addEventListener('click', e => { if (e.target === postModal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function showWriteBox() {
  loginBox.style.display = 'none';
  writeBox.style.display = 'block';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escapeAttr(str) {
  return String(str).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

loadArchive();
