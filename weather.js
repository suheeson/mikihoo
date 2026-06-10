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

// ── DOM ──
const weatherBar  = document.getElementById('weatherBar');
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

let filteredBlob = null; // canvas 처리된 이미지 blob

// ══════════════════════════════════════
// 1. 실시간 날씨
// ══════════════════════════════════════

function initWeather() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      try {
        const res = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?lat=${coords.latitude}&lon=${coords.longitude}&appid=${OW_KEY}&units=metric&lang=kr`
        );
        if (!res.ok) return;
        const d = await res.json();
        const temp = Math.round(d.main.temp);
        const hum  = d.main.humidity;
        const desc = d.weather[0].description;
        weatherBar.textContent = `지금 이곳 — ${temp}°C · 습도 ${hum}% · ${desc}`;
        weatherBar.classList.add('visible');
      } catch (_) { /* 조용히 실패 */ }
    },
    () => { /* 위치 거부 시 무시 */ }
  );
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
    .insert({ nickname, message, image_url });

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
}

function renderTimelineItem(entry) {
  const date = formatDate(entry.created_at);
  const imgHtml = entry.image_url
    ? `<img class="tl-thumb" src="${escapeAttr(entry.image_url)}" alt="" loading="lazy" />`
    : '';

  return `
    <div class="tl-item ${entry.image_url ? 'has-photo' : ''}">
      <div class="tl-left">
        <span class="tl-date">${date}</span>
      </div>
      <div class="tl-right">
        <span class="tl-nickname">${escapeHtml(entry.nickname)}</span>
        ${imgHtml}
        <p class="tl-message">${escapeHtml(entry.message)}</p>
      </div>
    </div>
  `;
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

// ── init ──
initWeather();
loadEntries();
