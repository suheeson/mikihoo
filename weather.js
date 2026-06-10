const OW_KEY = '22e32b9735460bfc73f39f24811548cf';

const SUPABASE_URL = 'https://bemcdwxyxdguhcrgkhth.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbWNkd3h5eGRndWhjcmdraHRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMjMzOTgsImV4cCI6MjA5NjU5OTM5OH0.GrPUSR7EKSlOGXVI7gxQnwvQvwZBUcuOi2I9EsbrNxk';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const isAdmin = new URLSearchParams(location.search).has('admin');

// ── DOM ──
const weatherBar   = document.getElementById('weatherBar');
const weatherNow   = document.getElementById('weatherNow');
const form         = document.getElementById('weatherForm');
const nickInput    = document.getElementById('nickname');
const msgInput     = document.getElementById('message');
const photoInput   = document.getElementById('photo');
const fileNameEl   = document.getElementById('fileName');
const filterStatus = document.getElementById('filterStatus');
const previewImg   = document.getElementById('previewImg');
const submitBtn    = document.getElementById('submitBtn');
const statusEl     = document.getElementById('formStatus');
const listEl       = document.getElementById('entriesList');

let filteredBlob   = null;
let currentWeather = null;
let entriesMap     = {}; // id → entry (for export)

// ══════════════════════════════════════
// 1. 글감 placeholder 로테이션
// ══════════════════════════════════════

const PROMPTS = [
  '오늘 하늘이 어떤 색이었나요',
  '몸이 기억하는 오늘의 온도',
  '오늘 가장 오래 머문 곳',
  '스쳐간 냄새가 있었나요',
  '오늘 가장 작은 것을 본 순간',
  '소리가 달랐던 순간',
  '오늘의 빛이 어디서 왔나요',
  '잠깐 멈췄던 순간이 있었나요',
  '오늘 바람이 불었나요',
  '피부로 느낀 오늘',
  '오늘 가장 익숙했던 것',
  '낯설게 느껴진 순간',
  '오늘 가장 조용했던 때',
  '무언가 젖어있었나요',
  '그림자가 어디 있었나요',
  '오늘 하늘을 몇 번 봤나요',
  '오늘 발이 닿은 곳들',
  '스쳐간 얼굴이 있었나요',
  '오늘 가장 오래된 것',
  '지금 이 순간의 온도',
];

(function setRandomPlaceholder() {
  const lastIdx = parseInt(sessionStorage.getItem('last_prompt') || '-1', 10);
  let idx;
  do { idx = Math.floor(Math.random() * PROMPTS.length); } while (idx === lastIdx);
  sessionStorage.setItem('last_prompt', idx);
  if (msgInput) msgInput.placeholder = PROMPTS[idx];
})();

// ══════════════════════════════════════
// 2. 실시간 날씨
// ══════════════════════════════════════

function setWeatherText(text) {
  currentWeather = text;
  if (weatherNow) weatherNow.textContent = text;
  if (weatherBar) {
    weatherBar.textContent = `지금 이곳 — ${text}`;
    weatherBar.classList.add('visible');
  }
}

async function fetchWeatherByCoords(lat, lon) {
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OW_KEY}&units=metric&lang=kr`;
  const res = await fetch(url);
  const d = await res.json();
  if (!res.ok) throw new Error(d.message || res.statusText);
  setWeatherText(`${Math.round(d.main.temp)}°C · ${d.main.humidity}% · ${d.weather[0].description}`);
}

async function getCoordsByIP() {
  const res = await fetch('https://ipinfo.io/json');
  const d = await res.json();
  if (!d.loc) throw new Error('ip lookup failed');
  const [lat, lon] = d.loc.split(',').map(Number);
  return { latitude: lat, longitude: lon };
}

async function initWeather() {
  if (weatherNow) weatherNow.textContent = '—';
  const gpsCoords = await new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    const timer = setTimeout(() => resolve(null), 5000);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { clearTimeout(timer); resolve(coords); },
      ()           => { clearTimeout(timer); resolve(null); }
    );
  });
  try {
    const coords = gpsCoords || await getCoordsByIP();
    await fetchWeatherByCoords(coords.latitude, coords.longitude);
  } catch (err) {
    console.warn('[weather] failed:', err.message);
    if (weatherNow) weatherNow.textContent = '';
  }
}

// ══════════════════════════════════════
// 3. 레트로 필터
// ══════════════════════════════════════

function applyRetroFilter(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1200;
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
        let v = px[i] * 0.299 + px[i+1] * 0.587 + px[i+2] * 0.114;
        v = (v * 0.82 - 128) * 1.5 + 128;
        const px_ = (i / 4) % w, py_ = Math.floor((i / 4) / w);
        const dx = px_ - cx, dy = py_ - cy;
        const dist = Math.sqrt(dx*dx + dy*dy) / maxDist;
        const vig = dist > 0.35 ? (dist - 0.35) / 0.65 * 0.65 : 0;
        v = v * (1 - vig);
        const n = (Math.random() - 0.5) * 22;
        const out = Math.min(255, Math.max(0, v + n));
        px[i] = px[i+1] = px[i+2] = out;
      }
      ctx.putImageData(id, 0, 0);
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.88);
    };
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.readAsDataURL(file);
  });
}

photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  if (!file) {
    filteredBlob = null;
    fileNameEl.textContent = '';
    filterStatus.textContent = '';
    previewImg.style.display = 'none';
    previewImg.src = '';
    return;
  }
  fileNameEl.textContent = file.name;
  filterStatus.textContent = '필터 적용 중—';
  previewImg.style.display = 'none';
  filteredBlob = await applyRetroFilter(file);
  filterStatus.textContent = '';
  previewImg.src = URL.createObjectURL(filteredBlob);
  previewImg.style.display = 'block';
});

// ══════════════════════════════════════
// 4. 폼 제출
// ══════════════════════════════════════

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nickname = nickInput.value.trim();
  const message  = msgInput.value.trim();
  if (!nickname || !message) {
    statusEl.textContent = '닉네임과 일기를 모두 적어주세요.';
    return;
  }
  submitBtn.disabled = true;
  statusEl.textContent = '—';

  let image_url = null;
  const originalFile = photoInput.files[0];
  if (originalFile) {
    const uploadBlob = filteredBlob || originalFile;
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const { error: uploadError } = await sb.storage
      .from('weather-photos')
      .upload(path, uploadBlob, { contentType: 'image/jpeg', upsert: false });
    if (uploadError) {
      statusEl.textContent = `사진 업로드 실패: ${uploadError.message}`;
      submitBtn.disabled = false;
      return;
    }
    image_url = sb.storage.from('weather-photos').getPublicUrl(path).data.publicUrl;
  }

  const { error: insertError } = await sb
    .from('guestbook')
    .insert({ nickname, message, image_url, weather_text: currentWeather || null });

  if (insertError) {
    statusEl.textContent = `저장 실패: ${insertError.message}`;
    submitBtn.disabled = false;
    return;
  }

  statusEl.textContent = '남겨졌습니다.';
  form.reset();
  fileNameEl.textContent = '';
  filterStatus.textContent = '';
  filteredBlob = null;
  previewImg.style.display = 'none';
  previewImg.src = '';
  submitBtn.disabled = false;
  await loadEntries();
});

// ══════════════════════════════════════
// 5. 타임라인 렌더링
// ══════════════════════════════════════

async function loadEntries() {
  const { data, error } = await sb
    .from('guestbook')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(60);

  if (error || !data || data.length === 0) {
    listEl.innerHTML = '<p class="entries-empty">아직 아무것도 없습니다.</p>';
    return;
  }

  entriesMap = {};
  data.forEach(e => { entriesMap[e.id] = e; });
  listEl.innerHTML = data.map(renderTimelineItem).join('');
  bindTimelineEvents();
}

function renderTimelineItem(entry) {
  const date = formatDate(entry.created_at);
  const imgHtml = entry.image_url
    ? `<img class="tl-thumb" src="${escapeAttr(entry.image_url)}" alt="" loading="lazy" />`
    : '';
  const deleteBtn = isAdmin
    ? `<button class="ctrl-btn delete-btn tl-delete" data-id="${escapeAttr(entry.id)}">삭제</button>`
    : '';
  const weatherHtml = entry.weather_text
    ? `<span class="tl-weather">${escapeHtml(entry.weather_text)}</span>`
    : '';

  return `
    <div class="tl-item ${entry.image_url ? 'has-photo' : ''}" data-id="${escapeAttr(entry.id)}">
      <div class="tl-left">
        <span class="tl-date">${date}</span>
        ${deleteBtn}
      </div>
      <div class="tl-right">
        <span class="tl-nickname">${escapeHtml(entry.nickname)}</span>
        ${weatherHtml}
        ${imgHtml}
        <p class="tl-message">${escapeHtml(entry.message)}</p>
      </div>
    </div>
  `;
}

function bindTimelineEvents() {
  if (!isAdmin) return;
  listEl.querySelectorAll('.tl-delete').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { alert('로그인이 필요합니다.'); return; }
      if (!confirm('삭제할까요?')) return;
      const { error } = await sb.from('guestbook').delete().eq('id', btn.dataset.id);
      if (error) { alert('삭제 실패: ' + error.message); return; }
      await loadEntries();
    });
  });
}

// ══════════════════════════════════════
// 6. 채집하기
// ══════════════════════════════════════

const collectBtn = document.getElementById('collectBtn');
if (collectBtn) {
  collectBtn.addEventListener('click', async () => {
    collectBtn.disabled = true;
    collectBtn.textContent = '—';
    try {
      const { data, error } = await sb.from('guestbook').select('*');
      if (error || !data || data.length === 0) { collectBtn.textContent = '채집하기'; collectBtn.disabled = false; return; }
      const entry = data[Math.floor(Math.random() * data.length)];
      await exportEntryCard(entry);
    } catch (e) {
      console.warn('collect error', e);
    }
    collectBtn.textContent = '채집하기';
    collectBtn.disabled = false;
  });
}

// ══════════════════════════════════════
// 7. 카드 PNG 익스포트
// ══════════════════════════════════════

async function exportEntryCard(entry) {
  const SIZE = 1080;
  const PAD  = 80;
  const canvas = document.createElement('canvas');
  canvas.width  = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0f0f0f';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // 비율 결정
  const msgLen = (entry.message || '').length;
  let photoRatio = 0;
  if (entry.image_url) {
    if      (msgLen < 100) photoRatio = 0.6;
    else if (msgLen < 200) photoRatio = 0.5;
    else                   photoRatio = 0.4;
  }
  const photoH = Math.round(SIZE * photoRatio);
  const textH  = SIZE - photoH;

  // 사진
  if (entry.image_url && photoH > 0) {
    await new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        // center crop
        let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
        const targetAspect = SIZE / photoH;
        const imgAspect    = sw / sh;
        if (imgAspect > targetAspect) { sw = Math.round(sh * targetAspect); sx = (img.naturalWidth - sw) / 2; }
        else                          { sh = Math.round(sw / targetAspect); sy = (img.naturalHeight - sh) / 2; }

        const tmp  = document.createElement('canvas');
        tmp.width  = SIZE; tmp.height = photoH;
        const tctx = tmp.getContext('2d');
        tctx.drawImage(img, sx, sy, sw, sh, 0, 0, SIZE, photoH);

        const id = tctx.getImageData(0, 0, SIZE, photoH);
        const px = id.data;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i+1], b = px[i+2];
          const gray = r * 0.299 + g * 0.587 + b * 0.114;
          px[i]   = Math.min(255, (gray + (r - gray) * 0.2) * 0.75);
          px[i+1] = Math.min(255, (gray + (g - gray) * 0.2) * 0.75);
          px[i+2] = Math.min(255, (gray + (b - gray) * 0.2) * 0.75);
        }
        tctx.putImageData(id, 0, 0);
        ctx.drawImage(tmp, 0, 0);

        // fade into text area
        const fadeH = Math.min(100, photoH * 0.2);
        const grad  = ctx.createLinearGradient(0, photoH - fadeH, 0, photoH);
        grad.addColorStop(0, 'rgba(15,15,15,0)');
        grad.addColorStop(1, 'rgba(15,15,15,1)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, photoH - fadeH, SIZE, fadeH);
        resolve();
      };
      img.onerror = resolve;
      img.src = entry.image_url;
    });
  }

  // 텍스트 시작 Y — 사진 없으면 세로 중앙 정렬에 가깝게
  const textTop = photoH > 0 ? photoH + 52 : Math.round(SIZE * 0.22);

  ctx.textAlign = 'left';

  // 닉네임
  ctx.font      = `400 38px 'EB Garamond', serif`;
  ctx.fillStyle = '#e8e4dc';
  ctx.fillText(entry.nickname || '', PAD, textTop);

  let curY = textTop + 48;

  // 날씨
  if (entry.weather_text) {
    ctx.font      = `400 26px 'EB Garamond', serif`;
    ctx.fillStyle = '#a8a89e';
    ctx.fillText(entry.weather_text, PAD, curY);
    curY += 52;
  } else {
    curY += 8;
  }

  // 본문
  ctx.font      = `300 32px 'Noto Serif KR', serif`;
  ctx.fillStyle = '#c8c4bc';
  const lineH   = 32 * 1.6;
  const maxW    = SIZE - PAD * 2;
  curY = wrapText(ctx, entry.message || '', PAD, curY, maxW, lineH);

  // 워터마크 (우측 하단 고정)
  ctx.font      = `400 22px 'EB Garamond', serif`;
  ctx.fillStyle = 'rgba(168,168,158,0.35)';
  ctx.textAlign = 'right';
  ctx.fillText('mikihoo', SIZE - PAD, SIZE - 52);

  // 그레인 오버레이
  const gc = document.createElement('canvas');
  gc.width = gc.height = 200;
  const gctx = gc.getContext('2d');
  const gid  = gctx.createImageData(200, 200);
  for (let i = 0; i < gid.data.length; i += 4) {
    const v = Math.random() * 255 | 0;
    gid.data[i] = gid.data[i+1] = gid.data[i+2] = v; gid.data[i+3] = 255;
  }
  gctx.putImageData(gid, 0, 0);
  ctx.globalAlpha = 0.05;
  ctx.fillStyle   = ctx.createPattern(gc, 'repeat');
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.globalAlpha = 1;

  // 다운로드
  const date  = formatDate(entry.created_at).replace(/\./g, '');
  const fname = `mikihoo_채집물_${date}.png`;
  canvas.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const chars = text.split('');
  let line = '', curY = y;
  for (let i = 0; i < chars.length; i++) {
    const test = line + chars[i];
    if (ctx.measureText(test).width > maxW && line !== '') {
      ctx.fillText(line, x, curY);
      line = chars[i];
      curY += lineH;
    } else {
      line = test;
    }
  }
  if (line) { ctx.fillText(line, x, curY); curY += lineH; }
  return curY;
}

// ══════════════════════════════════════
// 7. 유틸
// ══════════════════════════════════════

function formatDate(iso) {
  const d   = new Date(iso);
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Admin login ──
const weatherAdminLogin = document.getElementById('weatherAdminLogin');
const wLoginBtn         = document.getElementById('wLoginBtn');
const wLoginStatus      = document.getElementById('wLoginStatus');

if (isAdmin) {
  sb.auth.getSession().then(({ data }) => {
    if (!data.session) weatherAdminLogin.style.display = 'block';
  });

  wLoginBtn && wLoginBtn.addEventListener('click', async () => {
    const email    = document.getElementById('wAdminEmail').value.trim();
    const password = document.getElementById('wAdminPassword').value;
    if (!email || !password) return;
    wLoginBtn.disabled = true;
    wLoginStatus.textContent = '—';
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      wLoginStatus.textContent = error.message;
      wLoginBtn.disabled = false;
      return;
    }
    weatherAdminLogin.style.display = 'none';
    wLoginStatus.textContent = '';
    await loadEntries();
  });

  document.getElementById('wAdminPassword') &&
    document.getElementById('wAdminPassword').addEventListener('keydown', e => {
      if (e.key === 'Enter') wLoginBtn.click();
    });
}

// ── init ──
initWeather();
loadEntries();
