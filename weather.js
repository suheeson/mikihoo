/* ─────────────────────────────────────────
   설정
   OpenWeather 무료 키: openweathermap.org/api
   GitHub Pages 배포 시 이 파일에 직접 키 입력
   (도메인 제한으로 키 노출 최소화)
───────────────────────────────────────── */
const OW_KEY = '22e32b9735460bfc73f39f24811548cf';

const SUPABASE_URL = 'https://bemcdwxyxdguhcrgkhth.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlbWNkd3h5eGRndWhjcmdraHRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMjMzOTgsImV4cCI6MjA5NjU5OTM5OH0.GrPUSR7EKSlOGXVI7gxQnwvQvwZBUcuOi2I9EsbrNxk';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const isAdmin = new URLSearchParams(location.search).has('admin');

// ── DOM ──
const weatherBar  = document.getElementById('weatherBar');
const weatherNow  = document.getElementById('weatherNow');
const form        = document.getElementById('weatherForm');
const nickInput   = document.getElementById('nickname');
const msgInput    = document.getElementById('message');
const photoInput  = document.getElementById('photo');
const fileNameEl  = document.getElementById('fileName');
const filterStatus= document.getElementById('filterStatus');
const previewImg  = document.getElementById('previewImg');
const submitBtn   = document.getElementById('submitBtn');
const statusEl    = document.getElementById('formStatus');
const listEl      = document.getElementById('entriesList');

let filteredBlob = null;
let currentWeather = null; // 현재 날씨 텍스트 (저장 시 포함)

// ══════════════════════════════════════
// 1. 실시간 날씨
// ══════════════════════════════════════

function setWeatherText(text) {
  currentWeather = text;
  if (weatherNow) weatherNow.textContent = text;
  if (weatherBar) { weatherBar.textContent = text; weatherBar.classList.add('visible'); }
}

async function fetchWeatherByCoords(lat, lon) {
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OW_KEY}&units=metric&lang=kr`;
  const res = await fetch(url);
  const d = await res.json();
  if (!res.ok) throw new Error(d.message || res.statusText);
  const temp = Math.round(d.main.temp);
  const hum  = d.main.humidity;
  const desc = d.weather[0].description;
  setWeatherText(`${temp}°C · ${hum}% · ${desc}`);
}

async function getCoordsByIP() {
  const res = await fetch('https://ip-api.com/json?fields=lat,lon,status');
  const d = await res.json();
  if (d.status !== 'success') throw new Error('ip lookup failed');
  return { latitude: d.lat, longitude: d.lon };
}

async function initWeather() {
  if (weatherNow) weatherNow.textContent = '—';

  // GPS 시도 (5초 타임아웃)
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
// 2. 레트로 필터 (canvas)
// ══════════════════════════════════════

function applyRetroFilter(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1200;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX || h > MAX) {
        const r = Math.min(MAX / w, MAX / h);
        w = Math.round(w * r);
        h = Math.round(h * r);
      }

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      // 흑백 + 세피아 + 노출 보정
      ctx.filter = 'grayscale(85%) sepia(12%) brightness(0.86) contrast(1.1)';
      ctx.drawImage(img, 0, 0, w, h);
      ctx.filter = 'none';

      // 비네팅 (radial gradient)
      const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.22, w / 2, h / 2, h * 0.82);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.42)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      // 필름 그레인 (pixel noise)
      const imageData = ctx.getImageData(0, 0, w, h);
      const px = imageData.data;
      for (let i = 0; i < px.length; i += 4) {
        const n = (Math.random() - 0.5) * 18;
        px[i]     = Math.min(255, Math.max(0, px[i]     + n));
        px[i + 1] = Math.min(255, Math.max(0, px[i + 1] + n));
        px[i + 2] = Math.min(255, Math.max(0, px[i + 2] + n));
      }
      ctx.putImageData(imageData, 0, 0);

      canvas.toBlob(blob => {
        URL.revokeObjectURL(img.src);
        resolve(blob);
      }, 'image/jpeg', 0.88);
    };
    img.src = URL.createObjectURL(file);
  });
}

photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  if (!file) {
    filteredBlob = null;
    fileNameEl.textContent  = '';
    filterStatus.textContent = '';
    previewImg.style.display = 'none';
    previewImg.src = '';
    return;
  }

  fileNameEl.textContent   = file.name;
  filterStatus.textContent = '필터 적용 중—';
  previewImg.style.display = 'none';

  filteredBlob = await applyRetroFilter(file);

  filterStatus.textContent = '';
  previewImg.src = URL.createObjectURL(filteredBlob);
  previewImg.style.display = 'block';
});

// ══════════════════════════════════════
// 3. 폼 제출
// ══════════════════════════════════════

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const nickname = nickInput.value.trim();
  const message  = msgInput.value.trim();
  if (!nickname || !message) {
    statusEl.textContent = '닉네임과 날씨를 모두 적어주세요.';
    return;
  }

  submitBtn.disabled = true;
  statusEl.textContent = '—';

  let image_url = null;
  const originalFile = photoInput.files[0];

  if (originalFile) {
    const uploadBlob = filteredBlob || originalFile;
    const ext  = 'jpg';
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

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
  fileNameEl.textContent   = '';
  filterStatus.textContent = '';
  filteredBlob = null;
  previewImg.style.display = 'none';
  previewImg.src = '';
  submitBtn.disabled = false;

  await loadEntries();
});

// ══════════════════════════════════════
// 4. 타임라인 렌더링
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

  listEl.innerHTML = data.map(renderTimelineItem).join('');
  if (isAdmin) bindDeleteEvents();
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

function bindDeleteEvents() {
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
    if (data.session) {
      // 이미 로그인됨
    } else {
      weatherAdminLogin.style.display = 'block';
    }
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
