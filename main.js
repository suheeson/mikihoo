const SUPABASE_URL = 'https://bemcdwxyxdguhcrgkhth.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbWNkd3h5eGRndWhjcmdraHRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMjMzOTgsImV4cCI6MjA5NjU5OTM5OH0.GrPUSR7EKSlOGXVI7gxQnwvQvwZBUcuOi2I9EsbrNxk';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const isAdmin = new URLSearchParams(location.search).has('admin');

// ── DOM ──
const adminPanel  = document.getElementById('adminPanel');
const loginBox    = document.getElementById('loginBox');
const writeBox    = document.getElementById('writeBox');
const loginBtn    = document.getElementById('loginBtn');
const logoutBtn   = document.getElementById('logoutBtn');
const postBtn     = document.getElementById('postBtn');
const loginStatus = document.getElementById('loginStatus');
const postStatus  = document.getElementById('postStatus');
const archiveList = document.getElementById('archiveList');
const postPhoto   = document.getElementById('postPhoto');
const postPreview = document.getElementById('postPreview');
const postFileName= document.getElementById('postFileName');
const postModal   = document.getElementById('postModal');
const modalClose  = document.getElementById('modalClose');
const modalImg    = document.getElementById('modalImg');
const modalDate   = document.getElementById('modalDate');
const modalTitle  = document.getElementById('modalTitle');
const modalExcerpt= document.getElementById('modalExcerpt');

let posts = []; // 현재 로드된 포스트 목록

// ── Admin ──
if (isAdmin) {
  adminPanel.style.display = 'block';
  sb.auth.getSession().then(({ data }) => {
    if (data.session) showWriteBox();
  });
}

postPhoto.addEventListener('change', () => {
  const file = postPhoto.files[0];
  if (!file) { postPreview.style.display = 'none'; postFileName.textContent = ''; return; }
  postFileName.textContent = file.name;
  const reader = new FileReader();
  reader.onload = e => { postPreview.src = e.target.result; postPreview.style.display = 'block'; };
  reader.readAsDataURL(file);
});

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
  if (!title) { postStatus.textContent = '제목을 입력해주세요.'; return; }
  postBtn.disabled = true;
  postStatus.textContent = '—';

  let image_url = null;
  const file = postPhoto.files[0];
  if (file) {
    const ext  = file.name.split('.').pop();
    const path = `archive/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: upErr } = await sb.storage
      .from('weather-photos')
      .upload(path, file, { contentType: file.type });
    if (upErr) {
      postStatus.textContent = `사진 업로드 실패: ${upErr.message}`;
      postBtn.disabled = false;
      return;
    }
    image_url = sb.storage.from('weather-photos').getPublicUrl(path).data.publicUrl;
  }

  // order_index: 현재 최솟값 - 1 (맨 앞에 삽입)
  const minOrder = posts.length ? Math.min(...posts.map(p => p.order_index ?? 0)) : 0;

  const { error } = await sb.from('archive_posts')
    .insert({ title, excerpt: excerpt || null, image_url, post_date: date || null, order_index: minOrder - 1 });
  if (error) {
    postStatus.textContent = `저장 실패: ${error.message}`;
    postBtn.disabled = false;
    return;
  }

  postStatus.textContent = '올라갔습니다.';
  ['postTitle','postExcerpt','postDate'].forEach(id => document.getElementById(id).value = '');
  postPhoto.value = '';
  postPreview.style.display = 'none';
  postFileName.textContent = '';
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
      <button class="ctrl-btn move-down" data-id="${escapeAttr(post.id)}" ${i === total - 1 ? 'disabled' : ''}>↓</button>
      <button class="ctrl-btn delete-btn" data-id="${escapeAttr(post.id)}">삭제</button>
    </span>
  ` : '';

  return `
    <div class="list-item" data-id="${escapeAttr(post.id)}">
      <span class="list-item-meta">${escapeHtml(meta)}</span>
      <span class="list-item-title">
        ${escapeHtml(post.title)}
        ${adminControls}
      </span>
      <span class="list-item-artist">suheeson</span>
    </div>
  `;
}

function bindItemEvents() {
  // 클릭 → 모달
  archiveList.querySelectorAll('.list-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.ctrl-btn')) return; // 컨트롤 버튼 클릭 제외
      const id   = el.dataset.id;
      const post = posts.find(p => p.id === id);
      if (post) openModal(post);
    });
  });

  if (!isAdmin) return;

  // 삭제
  archiveList.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('삭제할까요?')) return;
      await sb.from('archive_posts').delete().eq('id', btn.dataset.id);
      await loadArchive();
    });
  });

  // 순서 위로
  archiveList.querySelectorAll('.move-up').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const idx  = posts.findIndex(p => p.id === btn.dataset.id);
      if (idx <= 0) return;
      await swapOrder(posts[idx], posts[idx - 1]);
    });
  });

  // 순서 아래로
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
  if (post.image_url) {
    modalImg.src = post.image_url;
    modalImg.style.display = 'block';
  } else {
    modalImg.style.display = 'none';
    modalImg.src = '';
  }
  modalDate.textContent    = post.post_date || '';
  modalTitle.textContent   = post.title;
  modalExcerpt.textContent = post.excerpt || '';
  postModal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  postModal.classList.remove('open');
  document.body.style.overflow = '';
  modalImg.src = '';
}

modalClose.addEventListener('click', closeModal);
postModal.addEventListener('click', e => {
  if (e.target === postModal) closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ── Helpers ──
function showWriteBox() {
  loginBox.style.display = 'none';
  writeBox.style.display = 'block';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

loadArchive();
