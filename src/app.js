// ─── Powkiddy XML ────────────────────────────────────────────────────────────

function parsePowkiddyXml(xmlText) {
  // BOM 제거, encoding 선언 정규화, 따옴표 없는 속성값 수정
  const cleaned = xmlText
    .replace(/^\ufeff/, '')
    .replace(/^<\?xml[^?]*\?>/, '<?xml version="1.0"?>')
    .replace(/=([^"'\s][^\s"'=><\/]*)/g, '="$1"');

  const parser = new DOMParser();
  const doc = parser.parseFromString(cleaned, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('XML 파싱 오류: ' + parseError.textContent);
  }

  const root = doc.querySelector('strings_resources');
  if (!root) throw new Error('strings_resources 루트 엘리먼트를 찾을 수 없습니다.');

  const games = [];
  for (const child of root.children) {
    if (!child.tagName.startsWith('icon_page')) continue;
    for (const entry of child.children) {
      const name = entry.getAttribute('name') || '';
      const gamePath = entry.getAttribute('game_path') || '';
      if (gamePath) games.push({ name, gamePath });
    }
  }

  return { games };
}

function exportPowkiddyXml(games) {
  const total = games.length;
  const pageSize = 8;
  const pageCount = Math.ceil(total / pageSize);

  let xml = '<?xml version="1.0"?>\n<strings_resources>\n';
  xml += `  <icon_para game_list_total="${total}" />\n`;

  for (let p = 0; p < pageCount; p++) {
    xml += `  <icon_page${p + 1}>\n`;
    for (let i = 0; i < pageSize; i++) {
      const idx = p * pageSize + i;
      if (idx >= total) break;
      const { name, gamePath } = games[idx];
      xml += `    <icon${i}_para name="${escapeXml(name)}" game_path="${escapeXml(gamePath)}" />\n`;
    }
    xml += `  </icon_page${p + 1}>\n`;
  }

  xml += '</strings_resources>\n';
  return xml;
}

function escapeXml(str) {
  return String(str)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── RetroArch .lpl (6줄 텍스트 포맷) ───────────────────────────────────────

const LINES_PER_ENTRY = 6;

function parseRetroArchLpl(text) {
  const lines = text.split(/\r?\n/);

  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();

  if (lines.length % LINES_PER_ENTRY !== 0) {
    console.warn(`줄 수 ${lines.length}가 ${LINES_PER_ENTRY}의 배수가 아닙니다.`);
  }

  const games = [];
  const entryCount = Math.floor(lines.length / LINES_PER_ENTRY);

  for (let i = 0; i < entryCount; i++) {
    const base = i * LINES_PER_ENTRY;
    const romPath = lines[base + 0] || '';
    const label = lines[base + 1] || '';
    const corePath = lines[base + 2] || '';
    const crc32 = lines[base + 3] || 'DETECT';
    const field5 = lines[base + 4] || 'DETECT';
    const dbName = lines[base + 5] || '';

    games.push({
      name: label,
      gamePath: extractFilename(romPath),
      _romPath: romPath,
      _corePath: corePath,
      _crc32: crc32,
      _field5: field5,
      _dbName: dbName,
    });
  }

  const meta = {
    romBasePath: games.length ? extractRomBasePath(games[0]._romPath) : '',
    corePath: games.length ? games[0]._corePath : '',
    dbName: games.length ? games[0]._dbName : '',
  };

  return { games, meta };
}

function exportRetroArchLpl(games, meta = {}) {
  const { romBasePath = '', corePath = '', dbName = '' } = meta;

  return games.map(game => {
    const romPath = game._romPath
      ? game._romPath
      : romBasePath
        ? romBasePath.replace(/\/$/, '') + '/' + game.gamePath
        : game.gamePath;

    const core = game._corePath || corePath || 'DETECT';
    const crc32 = game._crc32 || 'DETECT';
    const field5 = game._field5 || 'DETECT';
    const db = game._dbName || dbName || '';

    return [romPath, game.name, core, crc32, field5, db].join('\n');
  }).join('\n') + '\n';
}

function extractFilename(path) {
  return path.split('/').pop() || path;
}

function extractDirPath(path) {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/') + '/';
}

// /roms/ 이후 첫 번째 세그먼트까지만 추출 (ROM 기본 경로용)
// 예) /sdcard/roms/NES/games/Mario.nes → /sdcard/roms/NES/
// 예) /sdcard/roms/NES/Mario.nes       → /sdcard/roms/NES/
// 예) /sdcard/roms/Mario.nes           → /sdcard/roms/
function extractRomBasePath(romPath) {
  const romsIdx = romPath.indexOf('/roms/');
  if (romsIdx === -1) return extractDirPath(romPath);
  const afterRoms = romPath.slice(romsIdx + '/roms/'.length);
  const firstSlash = afterRoms.indexOf('/');
  if (firstSlash === -1) return romPath.slice(0, romsIdx + '/roms/'.length);
  return romPath.slice(0, romsIdx + '/roms/'.length + firstSlash + 1);
}

// ─── 상태 ─────────────────────────────────────────────────────────────────────

let state = {
  /** @type {Array<{name: string, gamePath: string}>} */
  games: [],
  /** @type {'powkiddy' | 'retroarch'} */
  importedFrom: null,
  /** @type {object} */
  retroarchMeta: {},
  selectedRows: new Set(),
  searchText: '',
  /** @type {'all'|'no-image'|'no-rom'} */
  gameFilter: 'all',
  editingIdx: null,
  /** @type {Map<string, string>} basename(소문자) -> data URL (base64) */
  thumbnailMap: new Map(),
  /** @type {FileSystemDirectoryHandle|null} 썸네일 폴더 핸들 (readwrite) */
  thumbDirHandle: null,
};

// ─── DOM 참조 ─────────────────────────────────────────────────────────────────

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const folderZone = document.getElementById('folderZone');
const gameListEl = document.getElementById('gameList');
const countEl = document.getElementById('gameCount');
const searchEl = document.getElementById('searchInput');
const addBtn = document.getElementById('addBtn');
const deleteBtn = document.getElementById('deleteBtn');
const moveUpBtn = document.getElementById('moveUpBtn');
const moveDownBtn = document.getElementById('moveDownBtn');
const sortBtn = document.getElementById('sortBtn');
const addNumberBtn = document.getElementById('addNumberBtn');
const autoSearchBtn = document.getElementById('autoSearchBtn');
const cleanupThumbBtn = document.getElementById('cleanupThumbBtn');
const exportPowkiddyBtn = document.getElementById('exportPowkiddy');
const exportRetroArchBtn = document.getElementById('exportRetroArch');
const romBasePathEl = document.getElementById('romBasePath');
const dbNameEl = document.getElementById('dbName');
const corePathEl = document.getElementById('corePath');
const exportOptionsEl = document.getElementById('exportOptions');
const statusEl = document.getElementById('status');
const thumbCheckEl = document.getElementById('thumbCheck');
const thumbInfoEl = document.getElementById('thumbInfo');
const autoFillFilenameBtn = document.getElementById('autoFillFilenameBtn');
const autoFillFileInput = document.getElementById('autoFillFileInput');
const batchUpdatePathsBtn = document.getElementById('batchUpdatePathsBtn');
const romExtEl = document.getElementById('romExt');

// ─── 초기화 ───────────────────────────────────────────────────────────────────

function init() {
  // 드래그 앤 드롭
  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length) handleFile(files[0]);
  });
  fileInput.addEventListener('change', e => {
    if (e.target.files.length) handleFile(e.target.files[0]);
  });

  folderZone.addEventListener('click', pickFolder);
  folderZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') pickFolder(); });

  thumbCheckEl.addEventListener('change', async () => {
    if (thumbCheckEl.checked) {
      await loadThumbnailFolder();
    } else {
      state.thumbnailMap = new Map();
      state.thumbDirHandle = null;
      thumbInfoEl.textContent = '';
      renderList();
    }
  });

  // 검색
  searchEl.addEventListener('input', () => {
    state.searchText = searchEl.value.toLowerCase();
    renderList();
  });

  // 게임 필터 칩
  document.getElementById('listFilterChips').addEventListener('click', e => {
    const chip = e.target.closest('.list-filter-chip');
    if (!chip) return;
    document.querySelectorAll('.list-filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.gameFilter = chip.dataset.filter;
    renderList();
  });

  // 버튼
  addBtn.addEventListener('click', addGame);
  deleteBtn.addEventListener('click', deleteSelected);
  moveUpBtn.addEventListener('click', () => moveSelected(-1));
  moveDownBtn.addEventListener('click', () => moveSelected(1));
  sortBtn.addEventListener('click', sortByName);
  addNumberBtn.addEventListener('click', addNumbers);
  autoSearchBtn.addEventListener('click', autoSearchImages);
  cleanupThumbBtn.addEventListener('click', cleanupThumbs);
  exportPowkiddyBtn.addEventListener('click', () => doExport('powkiddy'));
  exportRetroArchBtn.addEventListener('click', () => doExport('retroarch'));
  batchUpdatePathsBtn.addEventListener('click', batchUpdatePaths);

  autoFillFilenameBtn.addEventListener('click', () => {
    if (state.games.length === 0) {
      setStatus('⚠️ 먼저 ROM 폴더를 불러오세요', 'warn');
      return;
    }
    autoFillFileInput.click();
  });
  autoFillFileInput.addEventListener('change', e => {
    if (e.target.files.length) autoFillFilenames(e.target.files[0]);
    e.target.value = '';
  });

  renderList();
}

// ─── 파일 로드 ────────────────────────────────────────────────────────────────

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    try {
      if (file.name.endsWith('.xml')) {
        const { games } = parsePowkiddyXml(text);
        state.games = games;
        state.importedFrom = 'powkiddy';
        state.retroarchMeta = {};
        setStatus(`✅ Powkiddy XML 로드 완료 - ${games.length}개 게임`, 'success');
      } else if (file.name.endsWith('.lpl')) {
        const { games, meta } = parseRetroArchLpl(text);
        state.games = games;
        state.importedFrom = 'retroarch';
        state.retroarchMeta = meta;
        // 파싱한 메타 정보를 입력 필드에 자동 반영
        romBasePathEl.value = meta.romBasePath || '';
        dbNameEl.value = meta.dbName || '';
        corePathEl.value = meta.corePath || '';
        exportOptionsEl.style.display = 'block';
        setStatus(`✅ RetroArch .lpl 로드 완료 - ${games.length}개 게임`, 'success');
      } else {
        throw new Error('지원하지 않는 파일 형식입니다. (.xml 또는 .lpl 파일을 사용하세요)');
      }
      state.selectedRows.clear();
      state.searchText = '';
      searchEl.value = '';
      renderList();
    } catch (err) {
      setStatus('❌ ' + err.message, 'error');
    }
  };
  reader.readAsText(file, 'utf-8');
}

// ─── 파일명 자동 입력 ────────────────────────────────────────────────────────

function autoFillFilenames(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const text = e.target.result;
      let sourceGames;

      if (file.name.endsWith('.lpl')) {
        ({ games: sourceGames } = parseRetroArchLpl(text));
      } else if (file.name.endsWith('.xml')) {
        ({ games: sourceGames } = parsePowkiddyXml(text));
      } else {
        setStatus('❌ .lpl 또는 .xml 파일만 지원합니다', 'error');
        return;
      }

      // stem(확장자 제거, 소문자) → 표시 이름 매핑
      const stemMap = new Map();
      for (const g of sourceGames) {
        const stem = g.gamePath.replace(/\.[^.]+$/, '').toLowerCase();
        stemMap.set(stem, g.name);
      }

      let matched = 0;
      for (const game of state.games) {
        const stem = game.gamePath.replace(/\.[^.]+$/, '').toLowerCase();
        if (stemMap.has(stem)) {
          game.name = stemMap.get(stem);
          matched++;
        }
      }

      renderList();
      const total = state.games.length;
      setStatus(`✅ ${matched}개 / ${total}개 표시 이름 업데이트됨`, 'success');
    } catch (err) {
      setStatus('❌ ' + err.message, 'error');
    }
  };
  reader.readAsText(file, 'utf-8');
}

// ─── 폴더에서 목록 생성 ───────────────────────────────────────────────────────

const IGNORE_EXTS = new Set(['.xml', '.lpl', '.txt', '.dat', '.db', '.ini', '.cfg', '.jpg', '.png', '.gif', '.bmp', '.nfo', '.srm', '.sav', '.state']);

async function pickFolder() {
  if (!window.showDirectoryPicker) {
    setStatus('❌ 이 브라우저는 지원하지 않습니다 (Chrome / Edge 사용 권장)', 'error');
    return;
  }
  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker();
  } catch (e) {
    if (e.name !== 'AbortError') setStatus('❌ 폴더 선택 실패: ' + e.message, 'error');
    return;
  }

  const names = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind !== 'file') continue;
    if (name.startsWith('.')) continue;
    const ext = name.includes('.') ? '.' + name.split('.').pop().toLowerCase() : '';
    if (!IGNORE_EXTS.has(ext)) names.push(name);
  }

  if (names.length === 0) {
    setStatus('⚠️ 폴더에 ROM 파일이 없습니다', 'warn');
    return;
  }

  names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  state.games = names.map(name => ({
    name: name.replace(/\.[^.]+$/, ''),
    gamePath: name,
  }));
  state.importedFrom = null;
  state.retroarchMeta = {};
  // DB 이름이 비어있으면 롬 폴더명으로 자동 채우기
  if (dbNameEl && !dbNameEl.value.trim()) {
    dbNameEl.value = dirHandle.name + '.lpl';
  }
  state.selectedRows.clear();
  state.searchText = '';
  searchEl.value = '';
  setStatus(`✅ ${state.games.length}개 파일에서 게임 목록 생성됨`, 'success');
  renderList();
}

// ─── 썸네일 폴더 로드 ─────────────────────────────────────────────────────────

const THUMB_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']);

async function loadThumbnailFolder() {
  if (!window.showDirectoryPicker) {
    setStatus('❌ 이 브라우저는 지원하지 않습니다 (Chrome / Edge 사용 권장)', 'error');
    thumbCheckEl.checked = false;
    return;
  }
  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    if (e.name !== 'AbortError') setStatus('❌ 폴더 선택 실패: ' + e.message, 'error');
    thumbCheckEl.checked = false;
    return;
  }

  state.thumbDirHandle = dirHandle;
  state.thumbnailMap = new Map();

  const entries = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind !== 'file') continue;
    const ext = name.includes('.') ? '.' + name.split('.').pop().toLowerCase() : '';
    if (!THUMB_EXTS.has(ext)) continue;
    entries.push({ name, handle });
  }

  thumbInfoEl.textContent = `📁 ${dirHandle.name}  ·  로딩 중... (0 / ${entries.length})`;

  for (let i = 0; i < entries.length; i++) {
    const { name, handle } = entries[i];
    const basename = name.replace(/\.[^.]+$/, '').toLowerCase();
    const file = await handle.getFile();
    const dataUrl = await fileToDataUrl(file);
    state.thumbnailMap.set(basename, dataUrl);
    if ((i + 1) % 10 === 0 || i + 1 === entries.length) {
      thumbInfoEl.textContent = `📁 ${dirHandle.name}  ·  로딩 중... (${i + 1} / ${entries.length})`;
    }
  }

  thumbInfoEl.textContent = `📁 ${dirHandle.name}  ·  ✅ ${state.thumbnailMap.size}개 이미지`;
  renderList();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── 썸네일 새창 보기 ─────────────────────────────────────────────────────────

function openThumbWindow(dataUrl, name) {
  const win = window.open('', '_blank');
  if (!win) {
    setStatus('⚠️ 팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.', 'warn');
    return;
  }
  win.document.write(
    '<!DOCTYPE html><html><head><title>' + escHtml(name) + '</title>' +
    '<style>body{margin:0;background:#111;display:flex;justify-content:center;align-items:center;min-height:100vh;}' +
    'img{max-width:100%;max-height:100vh;object-fit:contain;}</style></head>' +
    '<body><img src="' + dataUrl + '" alt=""></body></html>'
  );
  win.document.close();
}

// ─── 썸네일 업로드 ────────────────────────────────────────────────────────────

async function uploadThumb(game) {
  if (!state.thumbDirHandle) {
    setStatus('⚠️ 썸네일 폴더가 선택되지 않았습니다.', 'warn');
    return;
  }

  const file = await pickImageFile();
  if (!file) return;

  // PNG로 변환
  let pngDataUrl;
  try {
    pngDataUrl = await toPngDataUrl(file);
  } catch (e) {
    setStatus('❌ 이미지 변환 실패: ' + e.message, 'error');
    return;
  }

  // 파일명: 표시 이름에서 ?&/ → _ 로 치환 + .png
  const safeName = game.name.replace(/[?&/]/g, '_');
  const fileName = safeName + '.png';

  try {
    const fileHandle = await state.thumbDirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    const res = await fetch(pngDataUrl);
    const blob = await res.blob();
    await writable.write(blob);
    await writable.close();
  } catch (e) {
    setStatus('❌ 파일 저장 실패: ' + e.message, 'error');
    return;
  }

  // thumbnailMap 갱신 (thumbByNameUnderscored 키와 일치)
  const key = safeName.toLowerCase();
  state.thumbnailMap.set(key, pngDataUrl);
  thumbInfoEl.textContent = `✅ ${state.thumbnailMap.size}개 이미지`;
  setStatus(`✅ ${fileName} 저장 완료`, 'success');
  renderList();
}

function pickImageFile() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => resolve(input.files[0] || null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

function toPngDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지 로드 실패'));
    };
    img.src = url;
  });
}

// ─── 렌더링 ───────────────────────────────────────────────────────────────────

function getThumbUrl(game) {
  const thumbByPath = game.gamePath.replace(/\.[^.]+$/, '').toLowerCase();
  const thumbByName = game.name.toLowerCase();
  const thumbByNameUnderscored = game.name.replace(/[?&/]/g, '_').toLowerCase();
  return state.thumbnailMap.get(thumbByPath)
    || state.thumbnailMap.get(thumbByName)
    || (thumbByNameUnderscored !== thumbByName ? state.thumbnailMap.get(thumbByNameUnderscored) : undefined);
}

function renderList() {
  let filtered = state.games.map((g, i) => ({ ...g, _origIdx: i }));

  // 텍스트 검색
  if (state.searchText) {
    filtered = filtered.filter(g =>
      g.name.toLowerCase().includes(state.searchText) ||
      g.gamePath.toLowerCase().includes(state.searchText)
    );
  }

  // 게임 필터
  if (state.gameFilter === 'no-image') {
    filtered = filtered.filter(g => !getThumbUrl(g));
  } else if (state.gameFilter === 'no-rom') {
    filtered = filtered.filter(g => !g.gamePath);
  }

  // 카운트 표시
  if (filtered.length === state.games.length) {
    countEl.textContent = `총 ${state.games.length}개 게임`;
  } else {
    countEl.textContent = `${filtered.length} / ${state.games.length}개 게임`;
  }

  const hasThumb = state.thumbnailMap.size > 0;
  document.getElementById('col-thumb-head').style.display = hasThumb ? '' : 'none';

  gameListEl.innerHTML = '';

  if (state.games.length === 0) {
    const cols = hasThumb ? 5 : 4;
    gameListEl.innerHTML = `<tr><td colspan="${cols}" class="empty-msg">파일을 불러오거나 게임을 추가하세요</td></tr>`;
    return;
  }

  filtered.forEach(game => {
    const origIdx = game._origIdx;
    const tr = document.createElement('tr');
    tr.dataset.idx = origIdx;
    if (state.selectedRows.has(origIdx)) tr.classList.add('selected');

    const thumbUrl = getThumbUrl(game);
    const thumbCell = hasThumb
      ? `<td class="col-thumb">${thumbUrl
        ? `<img class="thumb-img" src="${thumbUrl}" alt="${escHtml(game.name)}" title="${escHtml(game.name)}" style="cursor:pointer;" />`
        : `<button class="btn-icon thumb-upload-btn" title="이미지 업로드">📷</button>`
      }</td>`
      : '';

    tr.innerHTML = `
      <td class="col-num">${origIdx + 1}</td>
      <td class="col-name" title="${escHtml(game.name)}">${escHtml(game.name)}</td>
      <td class="col-path" title="${escHtml(game.gamePath)}">${escHtml(game.gamePath)}</td>
      ${thumbCell}
      <td class="col-actions">
        <button class="btn-icon" data-action="edit" data-idx="${origIdx}" title="편집">✏️</button>
      </td>
    `;

    if (thumbUrl) {
      const img = tr.querySelector('.thumb-img');
      if (img) {
        img.addEventListener('click', e => {
          e.stopPropagation();
          openThumbWindow(thumbUrl, game.name);
        });
      }
    }

    const uploadBtn = tr.querySelector('.thumb-upload-btn');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', e => {
        e.stopPropagation();
        uploadThumb(game);
      });
    }

    tr.addEventListener('click', e => {
      if (e.target.closest('[data-action]')) return;
      if (e.ctrlKey || e.metaKey) {
        toggleSelect(origIdx);
      } else if (e.shiftKey && state.selectedRows.size > 0) {
        rangeSelect(origIdx);
      } else {
        state.selectedRows.clear();
        toggleSelect(origIdx);
      }
      renderList();
    });

    tr.querySelector('[data-action="edit"]').addEventListener('click', e => {
      e.stopPropagation();
      openEditDialog(origIdx);
    });

    gameListEl.appendChild(tr);
  });
}

// ─── 선택 ─────────────────────────────────────────────────────────────────────

function toggleSelect(idx) {
  if (state.selectedRows.has(idx)) {
    state.selectedRows.delete(idx);
  } else {
    state.selectedRows.add(idx);
  }
}

function rangeSelect(toIdx) {
  const lastSelected = [...state.selectedRows].pop();
  if (lastSelected == null) {
    state.selectedRows.add(toIdx);
    return;
  }
  const min = Math.min(lastSelected, toIdx);
  const max = Math.max(lastSelected, toIdx);
  for (let i = min; i <= max; i++) {
    state.selectedRows.add(i);
  }
}

// ─── 게임 편집 다이얼로그 ──────────────────────────────────────────────────────

function openEditDialog(idx) {
  const game = state.games[idx];
  const hasThumbFeature = state.thumbDirHandle !== null;

  // 현재 썸네일 찾기
  const currentThumbUrl = getThumbUrl(game) || null;

  let pendingThumbDataUrl = null;

  // ROM 기본 경로 / 코어 경로 (게임별 또는 전역 설정)
  const gameRomBase = game._romPath ? extractDirPath(game._romPath) : '';
  const globalRomBase = romBasePathEl ? romBasePathEl.value.trim() : '';
  let romBaseVal = gameRomBase || globalRomBase;
  let coreVal = game._corePath || (corePathEl ? corePathEl.value.trim() : '');

  // 생성 모드에서 값이 비어있으면 첫 번째 게임의 값으로 채우기
  if (state.importedFrom === null && idx > 0 && state.games.length > 0) {
    const firstGame = state.games[0];
    if (!romBaseVal) romBaseVal = firstGame._romPath ? extractRomBasePath(firstGame._romPath) : '';
    if (!coreVal) coreVal = firstGame._corePath || '';
  }

  const globalDbName = dbNameEl ? dbNameEl.value.trim() : '';
  const dbNameVal = game._dbName || globalDbName;

  const thumbSection = hasThumbFeature ? `
    <div class="thumb-edit-row">
      <span class="field-label-text">썸네일</span>
      <div class="thumb-edit-zone" id="thumbEditZone">
        ${currentThumbUrl
      ? `<img class="thumb-edit-preview" id="thumbEditPreview" src="${currentThumbUrl}" alt="" />`
      : `<div class="thumb-edit-placeholder" id="thumbEditPreview"><span>이미지를 드래그하거나<br>클릭하여 선택</span></div>`
    }
      </div>
      <div class="thumb-img-info" id="thumbImgInfo"></div>
    </div>` : '';

  const dialog = document.createElement('dialog');
  dialog.className = 'edit-dialog';
  dialog.innerHTML = `
    <h3>게임 편집</h3>
    <form method="dialog">
      <label>
        <span>표시 이름</span>
        <input type="text" name="name" value="${escHtml(game.name)}" autocomplete="off" />
      </label>
      <label>
        <span>ROM 파일명</span>
        <input type="text" name="gamePath" value="${escHtml(game.gamePath)}" autocomplete="off" />
      </label>
      <label>
        <span>ROM 기본 경로 <small>(비워두면 전역 설정 사용)</small></span>
        <input type="text" name="romBase" value="${escHtml(romBaseVal)}" autocomplete="off"
               placeholder="${escHtml(globalRomBase) || '예: /sdcard/.../roms/FC/'}" />
      </label>
      <label>
        <span>코어 경로 <small>(비워두면 전역 설정 사용)</small></span>
        <input type="text" name="corePath" value="${escHtml(coreVal)}" autocomplete="off"
               placeholder="${escHtml(corePathEl ? corePathEl.value.trim() : '') || '예: /sdcard/.../fceumm_libretro.so'}" />
      </label>
      <label>
        <span>LPL 이름 <small>(비워두면 전역 설정 사용)</small></span>
        <input type="text" name="dbName" value="${escHtml(dbNameVal)}" autocomplete="off"
               placeholder="${escHtml(globalDbName) || '예: Nintendo - NES.lpl'}" />
      </label>
      ${thumbSection}
      <div class="dialog-actions">
        <button type="submit" class="btn primary">저장</button>
        <button type="button" class="btn" id="cancelEdit">취소</button>
      </div>
    </form>
  `;

  if (hasThumbFeature) {
    const zone = dialog.querySelector('#thumbEditZone');

    async function applyImageFile(file) {
      if (!file || !file.type.startsWith('image/')) return;
      try {
        pendingThumbDataUrl = await toPngDataUrl(file);
        let preview = zone.querySelector('#thumbEditPreview');
        if (preview.tagName === 'IMG') {
          preview.src = pendingThumbDataUrl;
        } else {
          const img = document.createElement('img');
          img.className = 'thumb-edit-preview';
          img.id = 'thumbEditPreview';
          img.src = pendingThumbDataUrl;
          img.alt = '';
          preview.replaceWith(img);
        }
      } catch (e) {
        setStatus('❌ 이미지 변환 실패: ' + e.message, 'error');
      }
    }

    zone.addEventListener('click', async () => {
      const file = await pickImageFile();
      applyImageFile(file);
    });

    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', e => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      applyImageFile(e.dataTransfer.files[0]);
    });
  }

  // 이미지 정보 비동기 로드
  if (currentThumbUrl && hasThumbFeature) {
    loadThumbImgInfo(dialog, currentThumbUrl);
  }

  dialog.querySelector('#cancelEdit').addEventListener('click', () => dialog.close());
  dialog.querySelector('form').addEventListener('submit', async () => {
    const nameInput = dialog.querySelector('[name="name"]').value.trim();
    const pathInput = dialog.querySelector('[name="gamePath"]').value.trim();
    const romBaseInput = dialog.querySelector('[name="romBase"]').value.trim();
    const coreInput = dialog.querySelector('[name="corePath"]').value.trim();
    const dbNameInput = dialog.querySelector('[name="dbName"]').value.trim();
    if (!nameInput || !pathInput) return;

    const updated = { ...game, name: nameInput, gamePath: pathInput };
    // 게임별 ROM 경로 / 코어 경로 / LPL 이름 갱신
    if (romBaseInput) {
      updated._romPath = romBaseInput.replace(/\/$/, '') + '/' + pathInput;
    } else {
      delete updated._romPath; // 전역 설정 사용
    }
    updated._corePath = coreInput || undefined;
    updated._dbName = dbNameInput || undefined;

    state.games[idx] = updated;

    if (pendingThumbDataUrl && state.thumbDirHandle) {
      const safeName = nameInput.replace(/[?&/]/g, '_');
      const fileName = safeName + '.png';
      try {
        const fh = await state.thumbDirHandle.getFileHandle(fileName, { create: true });
        const writable = await fh.createWritable();
        const blob = await (await fetch(pendingThumbDataUrl)).blob();
        await writable.write(blob);
        await writable.close();
        state.thumbnailMap.set(safeName.toLowerCase(), pendingThumbDataUrl);
        thumbInfoEl.textContent = `✅ ${state.thumbnailMap.size}개 이미지`;
      } catch (e) {
        setStatus('❌ 이미지 저장 실패: ' + e.message, 'error');
      }
    }

    renderList();
    setStatus(`✅ ${nameInput} 수정 완료`, 'success');
  });

  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove());
}

// 썸네일 이미지 정보 (크기·비트·확장자) 비동기 표시
async function loadThumbImgInfo(dialog, dataUrl) {
  const infoEl = dialog.querySelector('#thumbImgInfo');
  if (!infoEl) return;

  // 확장자
  const mime = dataUrl.split(';')[0].split(':')[1] || 'image/unknown';
  const ext = mime.split('/')[1].toUpperCase();

  // 크기 (Image 로드)
  const { width, height } = await new Promise(res => {
    const img = new Image();
    img.onload = () => res({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => res({ width: 0, height: 0 });
    img.src = dataUrl;
  });

  // PNG 비트 심도 파싱
  let bppText = '';
  if (ext === 'PNG') {
    try {
      const b64 = dataUrl.split(',')[1];
      const head = atob(b64.substring(0, 48));
      if (head.charCodeAt(1) === 0x50) { // PNG magic
        const bitDepth = head.charCodeAt(24);
        const colorType = head.charCodeAt(25);
        const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType] ?? 1;
        bppText = `${bitDepth * channels}bpp`;
      }
    } catch { }
  }

  infoEl.textContent = [ext, width && height ? `${width}×${height}` : '', bppText]
    .filter(Boolean).join('  ·  ');
}

// ─── 경로 일괄 수정 ──────────────────────────────────────────────────────────

function batchUpdatePaths() {
  if (state.games.length === 0) {
    setStatus('⚠️ 게임 목록이 비어 있습니다.', 'warn');
    return;
  }

  const newRomBase = romBasePathEl ? romBasePathEl.value.trim() : '';
  const newCorePath = corePathEl ? corePathEl.value.trim() : '';
  const newDbName = dbNameEl ? dbNameEl.value.trim() : '';
  let newExt = romExtEl ? romExtEl.value.trim() : '';

  // 점(.) 없으면 자동 추가
  if (newExt && !newExt.startsWith('.')) newExt = '.' + newExt;

  if (!newRomBase && !newCorePath && !newDbName && !newExt) {
    setStatus('⚠️ 수정할 값이 없습니다. ROM 기본 경로, 코어 경로, DB 이름, ROM 확장자 중 하나 이상을 입력하세요.', 'warn');
    return;
  }

  const count = state.games.length;
  for (const game of state.games) {
    // 확장자 교체: gamePath 의 확장자를 맨 먼저 수정 (이후 _romPath 재함)
    if (newExt) {
      game.gamePath = game.gamePath.replace(/\.[^./]+$/, '') + newExt;
    }

    if (newRomBase) {
      // 기존 _romPath 에서 /roms/{path4}/ 이후의 하위 경로(subDir)를 추출해 유지
      // 예) /sdcard/roms/NES/games/Mario.nes → subDir = 'games/'
      // 예) /sdcard/roms/NES/Mario.nes       → subDir = ''
      const currentPath = game._romPath || '';
      let subDir = '';
      const romsIdx = currentPath.indexOf('/roms/');
      if (romsIdx !== -1) {
        const afterRoms = currentPath.slice(romsIdx + '/roms/'.length); // "{path4}/..."
        const firstSlash = afterRoms.indexOf('/');
        if (firstSlash !== -1) {
          const rest = afterRoms.slice(firstSlash + 1); // "{path5}/{filename}" or "{filename}"
          const lastSlash = rest.lastIndexOf('/');
          if (lastSlash !== -1) {
            subDir = rest.slice(0, lastSlash + 1); // "path5/"
          }
        }
      }
      const filename = game.gamePath || extractFilename(currentPath);
      game._romPath = newRomBase.replace(/\/$/, '') + '/' + subDir + filename;
    } else if (newExt && game._romPath) {
      // 기본 경로 변경 없이 확장자만 교체
      const dir = extractDirPath(game._romPath);
      game._romPath = dir + game.gamePath;
    }
    if (newCorePath) {
      game._corePath = newCorePath;
    }
    if (newDbName) {
      game._dbName = newDbName;
    }
  }

  const updated = [
    newRomBase && 'ROM 경로',
    newExt && `확장자(${newExt})`,
    newCorePath && '코어 경로',
    newDbName && 'DB 이름',
  ].filter(Boolean).join(', ');
  setStatus(`✅ ${count}개 게임의 ${updated}을(를) 일괄 수정했습니다.`, 'success');
  renderList();
}

// ─── 게임 추가 ────────────────────────────────────────────────────────────────

function addGame() {
  const num = state.games.length + 1;
  const newGame = { name: `${num}.새 게임`, gamePath: 'game.zip' };
  state.games.push(newGame);
  renderList();
  openEditDialog(state.games.length - 1);
}

// ─── 삭제 ─────────────────────────────────────────────────────────────────────

function deleteSelected() {
  if (state.selectedRows.size === 0) {
    setStatus('⚠️ 삭제할 게임을 먼저 선택하세요', 'warn');
    return;
  }
  if (!confirm(`선택한 ${state.selectedRows.size}개 게임을 삭제하시겠습니까?`)) return;

  const toDelete = new Set(state.selectedRows);
  state.games = state.games.filter((_, i) => !toDelete.has(i));
  state.selectedRows.clear();
  setStatus(`✅ ${toDelete.size}개 게임 삭제됨`, 'success');
  renderList();
}

// ─── 순서 이동 ────────────────────────────────────────────────────────────────

function moveSelected(direction) {
  if (state.selectedRows.size === 0) return;

  const indices = [...state.selectedRows].sort((a, b) => a - b);
  if (direction === -1 && indices[0] === 0) return;
  if (direction === 1 && indices[indices.length - 1] === state.games.length - 1) return;

  const newGames = [...state.games];
  const moving = direction === 1 ? indices.reverse() : indices;

  for (const idx of moving) {
    const target = idx + direction;
    [newGames[idx], newGames[target]] = [newGames[target], newGames[idx]];
  }

  const newSelected = new Set(indices.map(i => i + direction));
  state.games = newGames;
  state.selectedRows = newSelected;
  renderList();
}

// ─── 가나다순 정렬 ────────────────────────────────────────────────────────────

function sortByName() {
  function charGroup(name) {
    const ch = (name.trim() || '')[0] || '';
    if (/\d/.test(ch)) return 0;
    if (/[a-zA-Z]/.test(ch)) return 1;
    if (/[가-힣]/.test(ch)) return 2;
    return 3;
  }
  state.games.sort((a, b) => {
    const ga = charGroup(a.name), gb = charGroup(b.name);
    if (ga !== gb) return ga - gb;
    return a.name.localeCompare(b.name, 'ko', { numeric: true, sensitivity: 'base' });
  });
  state.selectedRows.clear();
  setStatus('✅ 정렬 완료 (숫자 → 영문 → 한글)', 'success');
  renderList();
}

// ─── 번호 넣기 ────────────────────────────────────────────────────────────────

function addNumbers() {
  if (state.games.length === 0) {
    setStatus('⚠️ 게임 목록이 비어 있습니다.', 'warn');
    return;
  }
  const allNumbered = state.games.every(g => /^\d+\./.test(g.name));
  if (allNumbered) {
    state.games.forEach(game => { game.name = game.name.replace(/^\d+\./, ''); });
    setStatus(`✅ ${state.games.length}개 게임의 번호를 제거했습니다.`, 'success');
  } else {
    state.games.forEach((game, i) => { game.name = `${i + 1}.${game.name}`; });
    setStatus(`✅ ${state.games.length}개 게임에 번호를 추가했습니다.`, 'success');
  }
  renderList();
}

// ─── 프로그레스 다이얼로그 ─────────────────────────────────────────────────────

function createProgressDialog(title) {
  const d = document.createElement('dialog');
  d.className = 'progress-dialog';
  d.innerHTML = `
    <div class="progress-title" id="progTitle">${escHtml(title)}</div>
    <progress class="progress-bar" id="progBar"></progress>
    <div class="progress-status" id="progStatus"></div>
  `;
  document.body.appendChild(d);
  d.showModal();
  return {
    setTitle(t) { d.querySelector('#progTitle').textContent = t; },
    setIndeterminate() {
      const b = d.querySelector('#progBar');
      b.removeAttribute('value');
      b.removeAttribute('max');
    },
    setProgress(value, max) {
      const b = d.querySelector('#progBar');
      b.max = max;
      b.value = value;
    },
    setStatus(text) { d.querySelector('#progStatus').textContent = text; },
    close() { try { d.close(); } catch { } d.remove(); },
  };
}

// ─── 다중 폴더 선택 ───────────────────────────────────────────────────────────

// 폴더 선택 후 하위 폴더 체크박스 다이얼로그
function pickSubfolders(parentHandle, parentDisplayPath, subdirs) {
  return new Promise(resolve => {
    const items = [
      { handle: parentHandle, displayPath: parentDisplayPath, label: parentDisplayPath + ' (이 폴더 자체)' },
      ...subdirs.map(s => ({ handle: s.handle, displayPath: s.displayPath, label: s.displayPath })),
    ];
    const d = document.createElement('dialog');
    d.className = 'subfolder-select-dialog';
    d.innerHTML = `
      <h4>📁 추가할 폴더 선택</h4>
      <p class="subfolder-hint">추가할 폴더를 선택하세요. 여러 개를 동시에 선택할 수 있습니다.</p>
      <ul class="subfolder-list">
        ${items.map((item, i) => `
          <li>
            <label>
              <input type="checkbox" data-i="${i}" ${i === 0 ? '' : 'checked'}>
              <span>📁 ${escHtml(item.label)}</span>
            </label>
          </li>`).join('')}
      </ul>
      <div class="dialog-actions">
        <button class="btn primary" id="subfolderApply">추가</button>
        <button class="btn" id="subfolderCancel">취소</button>
      </div>
    `;
    d.querySelector('#subfolderApply').addEventListener('click', () => {
      const selected = [...d.querySelectorAll('input[type=checkbox]')]
        .filter(cb => cb.checked)
        .map(cb => items[parseInt(cb.dataset.i)]);
      d.close();
      resolve(selected);
    });
    d.querySelector('#subfolderCancel').addEventListener('click', () => {
      d.close();
      resolve([]);
    });
    document.body.appendChild(d);
    d.showModal();
    d.addEventListener('close', () => d.remove());
  });
}

function pickSearchFolders() {
  return new Promise(resolve => {
    const folders = []; // { handle, displayPath }
    let lastHandle = null; // startIn reference for next picker

    const dialog = document.createElement('dialog');
    dialog.className = 'folder-picker-dialog';
    dialog.innerHTML = `
      <h3>📁 검색할 폴더 선택</h3>
      <p class="folder-picker-hint">폴더를 추가하면 하위 폴더를 한 번에 여러 개 선택할 수 있습니다.<br>선택한 각 폴더의 하위 폴더까지 재귀 검색합니다.</p>
      <ul class="folder-picker-list" id="folderPickerList">
        <li class="folder-picker-empty">선택된 폴더 없음</li>
      </ul>
      <div class="folder-picker-add">
        <button type="button" class="btn" id="addFolderBtn">📁 폴더 추가</button>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn primary" id="startSearchBtn" disabled>검색 시작</button>
        <button type="button" class="btn" id="cancelFolderPicker">취소</button>
      </div>
    `;

    function render() {
      const listEl = dialog.querySelector('#folderPickerList');
      const startBtn = dialog.querySelector('#startSearchBtn');
      if (folders.length === 0) {
        listEl.innerHTML = '<li class="folder-picker-empty">선택된 폴더 없음</li>';
        startBtn.disabled = true;
      } else {
        listEl.innerHTML = folders.map((f, i) => `
          <li class="folder-picker-item">
            <span class="folder-picker-name">📁 ${escHtml(f.displayPath)}</span>
            <button class="btn-icon remove-folder-btn" data-i="${i}" title="제거">✕</button>
          </li>`).join('');
        startBtn.disabled = false;
      }
    }

    function addFolder(handle, displayPath) {
      if (!folders.find(f => f.displayPath === displayPath)) {
        folders.push({ handle, displayPath });
        render();
      }
    }

    dialog.querySelector('#addFolderBtn').addEventListener('click', async () => {
      try {
        const opts = lastHandle ? { startIn: lastHandle } : {};
        const handle = await window.showDirectoryPicker(opts);

        // Build display path: try to resolve relative path from last handle
        let displayPath = handle.name;
        if (lastHandle) {
          try {
            const rel = await lastHandle.resolve(handle);
            if (rel && rel.length > 0) {
              displayPath = lastHandle.name + '/' + rel.join('/');
            }
          } catch { }
        }
        lastHandle = handle;

        // Enumerate immediate subdirectories
        const subdirs = [];
        for await (const [name, subHandle] of handle.entries()) {
          if (subHandle.kind === 'directory') {
            subdirs.push({ handle: subHandle, displayPath: displayPath + '/' + name });
          }
        }
        subdirs.sort((a, b) => a.displayPath.localeCompare(b.displayPath, 'ko'));

        if (subdirs.length === 0) {
          // No subdirs — add folder directly
          addFolder(handle, displayPath);
        } else {
          // Let user choose parent and/or subfolders
          const selected = await pickSubfolders(handle, displayPath, subdirs);
          for (const f of selected) addFolder(f.handle, f.displayPath);
        }
      } catch (e) {
        if (e.name !== 'AbortError') setStatus('❌ 폴더 선택 실패: ' + e.message, 'error');
      }
    });

    dialog.querySelector('#folderPickerList').addEventListener('click', e => {
      const btn = e.target.closest('.remove-folder-btn');
      if (btn) {
        folders.splice(parseInt(btn.dataset.i), 1);
        render();
      }
    });

    dialog.querySelector('#cancelFolderPicker').addEventListener('click', () => {
      dialog.close();
      resolve(null);
    });

    dialog.querySelector('#startSearchBtn').addEventListener('click', () => {
      dialog.close();
      resolve(folders.map(f => f.handle));
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.addEventListener('close', () => dialog.remove());
  });
}

// ─── 이미지 자동 검색 ─────────────────────────────────────────────────────────

async function autoSearchImages() {
  if (!state.thumbDirHandle) {
    setStatus('⚠️ 먼저 썸네일 폴더를 선택하세요 (이미지 확인 체크박스)', 'warn');
    return;
  }
  if (state.games.length === 0) {
    setStatus('⚠️ 게임 목록이 없습니다', 'warn');
    return;
  }

  const srcHandles = await pickSearchFolders();
  if (!srcHandles || srcHandles.length === 0) return;

  // 검색 프로그레스
  const searchProg = createProgressDialog('🔍 이미지 검색 중...');
  searchProg.setIndeterminate();

  const fileMap = new Map(); // basename(소문자) → Array<{ handle, relativePath }>
  let foundCount = 0;

  async function collectPngs(dirHandle, path) {
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'directory') {
        await collectPngs(handle, path + name + '/');
      } else if (handle.kind === 'file' && name.toLowerCase().endsWith('.png')) {
        const basename = name.slice(0, -4).toLowerCase();
        if (!fileMap.has(basename)) fileMap.set(basename, []);
        fileMap.get(basename).push({ handle, relativePath: path + name });
        foundCount++;
        if (foundCount % 50 === 0) {
          searchProg.setStatus(`${foundCount.toLocaleString()}개 PNG 발견 중...`);
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }
  }

  try {
    for (const h of srcHandles) {
      searchProg.setTitle(`🔍 검색 중: ${h.name}`);
      await collectPngs(h, h.name + '/');
    }
  } catch (e) {
    searchProg.close();
    setStatus('❌ 폴더 검색 실패: ' + e.message, 'error');
    return;
  }

  searchProg.close();

  if (fileMap.size === 0) {
    setStatus('⚠️ PNG 파일을 찾지 못했습니다', 'warn');
    return;
  }

  // 이미 썸네일이 없는 게임 중 매칭되는 것 찾기
  const matches = [];
  for (const game of state.games) {
    if (getThumbUrl(game)) continue;

    const candidates = fileMap.get(thumbByNameUnderscored)
      || (thumbByNameUnderscored !== thumbByName ? null : fileMap.get(thumbByName));
    if (candidates) {
      matches.push({ game, candidates, saveKey: thumbByNameUnderscored });
    }
  }

  if (matches.length === 0) {
    setStatus(`⚠️ 매칭되는 이미지 없음 (PNG ${fileMap.size}개 검색됨)`, 'warn');
    return;
  }

  const confirmed = await showAutoSearchConfirm(matches);
  if (!confirmed || confirmed.length === 0) return;

  // 적용 프로그레스
  const applyProg = createProgressDialog('⏳ 이미지 적용 중...');
  applyProg.setProgress(0, confirmed.length);

  let successCount = 0;
  for (let i = 0; i < confirmed.length; i++) {
    const { game, selectedCandidate, saveKey } = confirmed[i];
    applyProg.setProgress(i + 1, confirmed.length);
    applyProg.setStatus(`${i + 1} / ${confirmed.length}  —  ${game.name}`);
    try {
      const file = await selectedCandidate.handle.getFile();
      const dataUrl = await fileToDataUrl(file);
      const safeName = game.name.replace(/[?&/]/g, '_');
      const fileName = safeName + '.png';
      const fh = await state.thumbDirHandle.getFileHandle(fileName, { create: true });
      const writable = await fh.createWritable();
      await writable.write(await file.arrayBuffer());
      await writable.close();
      state.thumbnailMap.set(saveKey, dataUrl);
      successCount++;
    } catch (e) {
      console.error(`이미지 적용 실패 (${game.name}):`, e);
    }
  }

  applyProg.close();
  thumbInfoEl.textContent = `✅ ${state.thumbnailMap.size}개 이미지`;
  setStatus(`✅ ${successCount}개 이미지 적용 완료`, 'success');
  renderList();
}

async function showAutoSearchConfirm(matches) {
  // 복수 후보 미리보기 URL 생성 (프로그레스 표시)
  const totalPreviews = matches.reduce((s, m) => s + (m.candidates.length > 1 ? m.candidates.length : 0), 0);
  let previewProg = null;
  if (totalPreviews > 0) {
    previewProg = createProgressDialog('🖼️ 미리보기 로딩 중...');
    previewProg.setProgress(0, totalPreviews);
  }

  const previewUrls = [];
  let loaded = 0;
  for (const m of matches) {
    if (m.candidates.length > 1) {
      for (const c of m.candidates) {
        try {
          const file = await c.handle.getFile();
          c.previewUrl = URL.createObjectURL(file);
          previewUrls.push(c.previewUrl);
        } catch {
          c.previewUrl = null;
        }
        loaded++;
        if (previewProg) {
          previewProg.setProgress(loaded, totalPreviews);
          previewProg.setStatus(`${loaded} / ${totalPreviews}`);
        }
      }
    }
  }
  if (previewProg) previewProg.close();

  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'auto-search-dialog';

    const listHtml = matches.map((m, i) => {
      const multi = m.candidates.length > 1;
      const candidatesHtml = multi
        ? `<ul class="candidate-list">
            ${m.candidates.map((c, ci) => `
              <li data-path="${escHtml(c.relativePath)}">
                <label class="candidate-item">
                  <input type="radio" name="cand-${i}" value="${ci}" ${ci === 0 ? 'checked' : ''} />
                  ${c.previewUrl ? `<img class="candidate-thumb" src="${c.previewUrl}" alt="" />` : ''}
                  <span class="candidate-path" title="${escHtml(c.relativePath)}">${escHtml(c.relativePath)}</span>
                </label>
              </li>`).join('')}
          </ul>`
        : '';

      return `
        <li class="match-item${multi ? ' has-candidates' : ''}"
            data-path="${escHtml(m.candidates[0].relativePath)}">
          <label class="auto-search-item">
            <input type="checkbox" name="match" data-i="${i}" checked />
            <span class="auto-search-name">${escHtml(m.game.name)}</span>
            ${multi
          ? `<span class="candidate-count-badge">${m.candidates.length}개 이미지</span>`
          : `<span class="auto-search-path" title="${escHtml(m.candidates[0].relativePath)}">${escHtml(m.candidates[0].relativePath)}</span>`
        }
          </label>
          ${candidatesHtml}
        </li>`;
    }).join('');

    dialog.innerHTML = `
      <h3>🖼️ 이미지 자동 검색 결과</h3>
      <p class="auto-search-summary">총 <strong>${matches.length}개</strong> 게임에서 이미지를 찾았습니다. 적용할 항목을 선택하세요.</p>
      <div class="auto-search-controls">
        <label class="auto-search-ctrl-label">
          <input type="checkbox" id="selectAllMatches" checked /> 전체 선택
        </label>
        <div class="filter-group">
          <label class="filter-label">
            <input type="checkbox" id="filterBoxarts" /> Boxarts
          </label>
          <label class="filter-label">
            <input type="checkbox" id="filterSnaps" /> Snaps
          </label>
        </div>
        <span class="auto-search-selected-count" id="selectedCount">${matches.length} / ${matches.length} 선택</span>
      </div>
      <ul class="auto-search-list">${listHtml}</ul>
      <div class="dialog-actions">
        <button type="button" class="btn primary" id="applyAutoSearch">적용</button>
        <button type="button" class="btn" id="cancelAutoSearch">취소</button>
      </div>
    `;

    const selectAllCb = dialog.querySelector('#selectAllMatches');
    const filterBoxarts = dialog.querySelector('#filterBoxarts');
    const filterSnaps = dialog.querySelector('#filterSnaps');
    const selectedCountEl = dialog.querySelector('#selectedCount');
    const getCheckboxes = () => [...dialog.querySelectorAll('[name="match"]')];

    function visibleCheckboxes() {
      return getCheckboxes().filter(cb =>
        cb.closest('.match-item')?.style.display !== 'none'
      );
    }

    function updateCount() {
      const vis = visibleCheckboxes();
      const n = vis.filter(cb => cb.checked).length;
      selectedCountEl.textContent = `${n} / ${vis.length} 선택`;
      selectAllCb.checked = n > 0 && n === vis.length;
      selectAllCb.indeterminate = n > 0 && n < vis.length;
    }

    function pathMatches(path) {
      const boxOn = filterBoxarts.checked;
      const snapOn = filterSnaps.checked;
      if (!boxOn && !snapOn) return true;
      return (boxOn && path.includes('Named_Boxarts'))
        || (snapOn && path.includes('Named_Snaps'));
    }

    function applyFilter() {
      dialog.querySelectorAll('.match-item').forEach((item, _idx) => {
        if (item.classList.contains('has-candidates')) {
          // 복수 후보: 각 후보 li를 show/hide
          const candLis = [...item.querySelectorAll('.candidate-list > li')];
          let anyVisible = false;
          candLis.forEach(li => {
            const visible = pathMatches(li.dataset.path || '');
            li.style.display = visible ? '' : 'none';
            if (visible) anyVisible = true;
          });
          item.style.display = anyVisible ? '' : 'none';
          // 선택된 라디오가 숨겨진 경우, 첫 번째 보이는 것으로 교체
          const matchIdx = item.querySelector('[name^="cand-"]')?.name?.replace('cand-', '');
          if (matchIdx !== undefined) {
            const checkedRadio = item.querySelector(`[name="cand-${matchIdx}"]:checked`);
            if (checkedRadio?.closest('li')?.style.display === 'none') {
              const firstVisible = candLis.find(li => li.style.display !== 'none');
              firstVisible?.querySelector('input[type="radio"]')?.click();
            }
          }
        } else {
          // 단일 후보: item 자체를 show/hide
          item.style.display = pathMatches(item.dataset.path || '') ? '' : 'none';
        }
      });
      updateCount();
    }

    selectAllCb.addEventListener('change', () => {
      visibleCheckboxes().forEach(cb => { cb.checked = selectAllCb.checked; });
      updateCount();
    });

    filterBoxarts.addEventListener('change', applyFilter);
    filterSnaps.addEventListener('change', applyFilter);

    dialog.querySelector('.auto-search-list').addEventListener('change', e => {
      if (e.target.name === 'match') updateCount();
    });

    dialog.querySelector('#cancelAutoSearch').addEventListener('click', () => {
      dialog.close();
      resolve(null);
    });

    dialog.querySelector('#applyAutoSearch').addEventListener('click', () => {
      const confirmed = visibleCheckboxes()
        .filter(cb => cb.checked)
        .map(cb => {
          const i = parseInt(cb.dataset.i);
          const m = matches[i];
          let selectedCandidate = m.candidates[0];
          if (m.candidates.length > 1) {
            const radio = dialog.querySelector(`[name="cand-${i}"]:checked`);
            selectedCandidate = m.candidates[radio ? parseInt(radio.value) : 0];
          }
          return { game: m.game, selectedCandidate, saveKey: m.saveKey };
        });
      dialog.close();
      resolve(confirmed);
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.addEventListener('close', () => {
      previewUrls.forEach(url => URL.revokeObjectURL(url));
      dialog.remove();
    });
  });
}

// ─── 이미지 자동 정리 ──────────────────────────────────────────────────────────

function showCleanupConfirm(fileNames) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'cleanup-confirm-dialog';
    dialog.innerHTML = `
      <h3>🗑 이미지 자동 정리</h3>
      <p class="cleanup-desc">게임 목록에 없는 이미지 <strong>${fileNames.length}개</strong>가 발견되었습니다.<br>삭제할 파일을 선택하세요.</p>
      <div class="cleanup-select-all">
        <label><input type="checkbox" id="cleanupCheckAll" checked> 전체 선택</label>
        <span id="cleanupCount" class="auto-search-selected-count">${fileNames.length} / ${fileNames.length} 선택</span>
      </div>
      <ul class="cleanup-file-list">
        ${fileNames.map((name, i) => `
          <li>
            <label>
              <input type="checkbox" class="cleanup-cb" data-i="${i}" checked>
              <span class="cleanup-filename">${escHtml(name)}</span>
            </label>
          </li>`).join('')}
      </ul>
      <div class="dialog-actions">
        <button class="btn danger" id="cleanupApply">삭제</button>
        <button class="btn" id="cleanupCancel">취소</button>
      </div>
    `;

    function updateCount() {
      const cbs = [...dialog.querySelectorAll('.cleanup-cb')];
      const checked = cbs.filter(cb => cb.checked).length;
      dialog.querySelector('#cleanupCount').textContent = `${checked} / ${fileNames.length} 선택`;
      dialog.querySelector('#cleanupApply').disabled = checked === 0;
    }

    dialog.querySelector('#cleanupCheckAll').addEventListener('change', e => {
      dialog.querySelectorAll('.cleanup-cb').forEach(cb => { cb.checked = e.target.checked; });
      updateCount();
    });

    dialog.querySelectorAll('.cleanup-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const all = [...dialog.querySelectorAll('.cleanup-cb')];
        const allChecked = all.every(c => c.checked);
        const someChecked = all.some(c => c.checked);
        const allCheckbox = dialog.querySelector('#cleanupCheckAll');
        allCheckbox.checked = allChecked;
        allCheckbox.indeterminate = !allChecked && someChecked;
        updateCount();
      });
    });

    dialog.querySelector('#cleanupCancel').addEventListener('click', () => {
      dialog.close();
      resolve(null);
    });

    dialog.querySelector('#cleanupApply').addEventListener('click', () => {
      const confirmed = [...dialog.querySelectorAll('.cleanup-cb')]
        .filter(cb => cb.checked)
        .map(cb => fileNames[parseInt(cb.dataset.i)]);
      dialog.close();
      resolve(confirmed);
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.addEventListener('close', () => dialog.remove());
  });
}

async function cleanupThumbs() {
  if (!state.thumbDirHandle) {
    setStatus('⚠️ 먼저 썸네일 폴더를 선택하세요 (이미지 확인 체크박스)', 'warn');
    return;
  }
  if (state.games.length === 0) {
    setStatus('⚠️ 게임 목록이 없습니다', 'warn');
    return;
  }

  // Build set of valid basenames from all games (same logic as renderList thumbnail matching)
  const validBasenames = new Set();
  for (const game of state.games) {
    const romBase = game.gamePath.replace(/\.[^.]+$/, '').toLowerCase();
    if (romBase) validBasenames.add(romBase);
    const displayName = game.name.toLowerCase();
    if (displayName) validBasenames.add(displayName);
    const displayNameUnderscored = game.name.replace(/[?&/]/g, '_').toLowerCase();
    if (displayNameUnderscored) validBasenames.add(displayNameUnderscored);
  }

  // Collect image files not matched by any game
  const toDelete = [];
  for await (const [name, handle] of state.thumbDirHandle.entries()) {
    if (handle.kind !== 'file') continue;
    const ext = name.includes('.') ? '.' + name.split('.').pop().toLowerCase() : '';
    if (!THUMB_EXTS.has(ext)) continue;
    const basename = name.replace(/\.[^.]+$/, '').toLowerCase();
    if (!validBasenames.has(basename)) {
      toDelete.push(name);
    }
  }

  if (toDelete.length === 0) {
    setStatus('✅ 삭제할 이미지가 없습니다', 'success');
    return;
  }

  const confirmed = await showCleanupConfirm(toDelete);
  if (!confirmed || confirmed.length === 0) return;

  const prog = createProgressDialog('🗑 이미지 정리 중...');
  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < confirmed.length; i++) {
    const name = confirmed[i];
    prog.setProgress(i, confirmed.length);
    prog.setStatus(name);
    try {
      await state.thumbDirHandle.removeEntry(name);
      const basename = name.replace(/\.[^.]+$/, '').toLowerCase();
      state.thumbnailMap.delete(basename);
      deleted++;
    } catch (e) {
      console.error('삭제 실패:', name, e);
      failed++;
    }
  }
  prog.setProgress(confirmed.length, confirmed.length);
  prog.close();

  thumbInfoEl.textContent = `📁 ${state.thumbDirHandle.name}  ·  ✅ ${state.thumbnailMap.size}개 이미지`;
  renderList();

  const msg = failed > 0
    ? `✅ ${deleted}개 삭제 완료 (${failed}개 실패)`
    : `✅ ${deleted}개 이미지 삭제 완료`;
  setStatus(msg, 'success');
}

// ─── 내보내기 ─────────────────────────────────────────────────────────────────

function doExport(format) {
  if (state.games.length === 0) {
    setStatus('⚠️ 내보낼 게임이 없습니다', 'warn');
    return;
  }

  let content, filename, mimeType;

  if (format === 'powkiddy') {
    content = exportPowkiddyXml(state.games);
    filename = 'game_strings_ko.xml';
    mimeType = 'application/xml';
  } else {
    const meta = {
      ...state.retroarchMeta,
      romBasePath: romBasePathEl.value.trim() || state.retroarchMeta.romBasePath || '',
      corePath: corePathEl.value.trim() || state.retroarchMeta.corePath || '',
      dbName: dbNameEl.value.trim() || state.retroarchMeta.dbName || '',
    };

    // 첫 번째 게임의 경로를 기준으로, 빈 _romPath/_corePath 채우기
    const firstGame = state.games[0];
    const firstRomDir = firstGame?._romPath ? extractDirPath(firstGame._romPath) : '';
    const firstCore = firstGame?._corePath || '';
    const exportGames = state.games.map(game => {
      if (game._romPath && game._corePath) return game;
      const g = { ...game };
      if (!g._romPath && firstRomDir) {
        g._romPath = firstRomDir.replace(/\/$/, '') + '/' + game.gamePath;
      }
      if (!g._corePath && firstCore) {
        g._corePath = firstCore;
      }
      return g;
    });

    content = exportRetroArchLpl(exportGames, meta);
    filename = 'playlist.lpl';
    mimeType = 'text/plain';
  }

  downloadText(content, filename, mimeType);
  setStatus(`✅ ${filename} 다운로드 완료`, 'success');
}

function downloadText(text, filename, mimeType) {
  const blob = new Blob([text], { type: mimeType + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setStatus(msg, type = 'info') {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + type;
  if (type === 'success' || type === 'info') {
    setTimeout(() => {
      if (statusEl.textContent === msg) statusEl.textContent = '';
    }, 4000);
  }
}

// ─── 시작 ─────────────────────────────────────────────────────────────────────

init();
