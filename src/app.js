// ─── Powkiddy XML ────────────────────────────────────────────────────────────

function parsePowkiddyXml(xmlText) {
  // BOM 제거, encoding 선언 정규화, 따옴표 없는 속성값 수정
  const cleaned = xmlText
    .replace(/^\ufeff/, '')
    .replace(/^<\?xml[^?]*\?>/, '<?xml version="1.0"?>')
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g, '&amp;')
    .replace(/=([^"'\s][^\s"=><\/]*)/g, '="$1"');

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
      xml += `    <icon${i}_para name="${escapeXml(name.replace(/&/g, '앤'))}" game_path="${escapeXml(gamePath)}" />\n`;
    }
    xml += `  </icon_page${p + 1}>\n`;
  }

  xml += '</strings_resources>\n';
  return xml;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── EmulationStation gamelist.xml ───────────────────────────────────────────

function parseGamelistXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('XML 파싱 오류: ' + parseError.textContent);
  const root = doc.querySelector('gameList');
  if (!root) throw new Error('gameList 루트 엘리먼트를 찾을 수 없습니다.');

  const serializer = new XMLSerializer();
  const HANDLED = new Set(['path', 'name', 'image']);
  const games = [];
  for (const game of root.querySelectorAll('game')) {
    const path = game.querySelector('path')?.textContent?.trim() || '';
    const name = game.querySelector('name')?.textContent?.trim() || '';
    const image = game.querySelector('image')?.textContent?.trim() || '';
    const gamePath = path.replace(/^\.\//, '');
    if (!gamePath) continue;

    // path/name/image 외 나머지 태그를 직렬화해서 보존
    const extraLines = [];
    for (const child of game.children) {
      if (!HANDLED.has(child.tagName.toLowerCase())) {
        const serialized = serializer.serializeToString(child).replace(/ xmlns="[^"]*"/g, '');
        extraLines.push('    ' + serialized);
      }
    }

    games.push({
      name: name || gamePath.replace(/\.[^.]+$/, ''),
      gamePath,
      _imagePath: image,
      _extraXml: extraLines.length ? extraLines.join('\n') + '\n' : '',
    });
  }
  return { games };
}

function exportGamelistXml(games) {
  let xml = '<?xml version="1.0"?>\n<gameList>\n';
  for (const game of games) {
    const imagePath = escapeXml(game._imagePath || `./images/${game.gamePath.replace(/\.[^.]+$/, '')}.png`);
    xml += `  <game>\n`;
    xml += `    <path>./${escapeXml(game.gamePath)}</path>\n`;
    xml += `    <name>${escapeXml(game.name)}</name>\n`;
    xml += `    <image>${imagePath}</image>\n`;
    if (game._extraXml) xml += game._extraXml;
    xml += `  </game>\n`;
  }
  xml += '</gameList>\n';
  return xml;
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
  /** @type {'powkiddy' | 'retroarch' | 'gamelist' | null} */
  importedFrom: null,
  /** @type {object} */
  retroarchMeta: {},
  selectedRows: new Set(),
  searchText: '',
  /** @type {'all'|'no-image'|'no-rom'|'has-rom'} */
  gameFilter: 'all',
  editingIdx: null,
  /** @type {Map<string, string>} basename(소문자) -> data URL (base64) */
  thumbnailMap: new Map(),
  /** @type {FileSystemDirectoryHandle|null} 썸네일 폴더 핸들 (readwrite) */
  thumbDirHandle: null,
  /** @type {FileSystemDirectoryHandle|null} ROM 폴더 핸들 (readwrite) */
  romDirHandle: null,
  /** @type {string|null} 표시이름 앞에 붙인 글자 (null이면 미적용) */
  customPrefix: null,
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
const addPrefixBtn = document.getElementById('addPrefixBtn');
const renameRomBtn = document.getElementById('renameRomBtn');
const autoSearchBtn = document.getElementById('autoSearchBtn');
const cleanupThumbBtn = document.getElementById('cleanupThumbBtn');
const resizeImgBtn = document.getElementById('resizeImgBtn');
const exportPowkiddyBtn = document.getElementById('exportPowkiddy');
const exportRetroArchBtn = document.getElementById('exportRetroArch');
const exportImgPowkiddyBtn = document.getElementById('exportImgPowkiddy');
const exportImgRetroArchBtn = document.getElementById('exportImgRetroArch');
const exportGamelistBtn = document.getElementById('exportGamelist');
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
  addPrefixBtn.addEventListener('click', addPrefix);
  renameRomBtn.addEventListener('click', renameRomFiles);
  autoSearchBtn.addEventListener('click', autoSearchImages);
  cleanupThumbBtn.addEventListener('click', cleanupThumbs);
  resizeImgBtn.addEventListener('click', resizeImages);
  exportPowkiddyBtn.addEventListener('click', () => doExport('powkiddy'));
  exportRetroArchBtn.addEventListener('click', () => doExport('retroarch'));
  exportImgPowkiddyBtn.addEventListener('click', () => exportImages('powkiddy'));
  exportImgRetroArchBtn.addEventListener('click', () => exportImages('retroarch'));
  exportGamelistBtn.addEventListener('click', () => doExport('gamelist'));
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
      const hasExistingGames = state.games.length > 0;

      if (file.name.endsWith('.xml')) {
        // detect format by root element
        const tmpDoc = new DOMParser().parseFromString(text, 'application/xml');
        const rootTag = tmpDoc.documentElement?.tagName;
        if (rootTag === 'gameList') {
          const { games } = parseGamelistXml(text);
          if (hasExistingGames) {
            state.games = state.games.concat(games);
            setStatus(`✅ gamelist.xml 병합 완료 - ${games.length}개 추가 (총 ${state.games.length}개)`, 'success');
          } else {
            state.games = games;
            state.importedFrom = 'gamelist';
            state.retroarchMeta = {};
            exportOptionsEl.style.display = 'block';
            setStatus(`✅ gamelist.xml 로드 완료 - ${games.length}개 게임`, 'success');
          }
        } else {
        const { games } = parsePowkiddyXml(text);
        if (hasExistingGames) {
          state.games = state.games.concat(games);
          setStatus(`✅ Powkiddy XML 병합 완료 - ${games.length}개 추가 (총 ${state.games.length}개)`, 'success');
        } else {
          state.games = games;
          state.importedFrom = 'powkiddy';
          state.retroarchMeta = {};
          romBasePathEl.value = '/sdcard/game/';
          exportOptionsEl.style.display = 'block';
          setStatus(`✅ Powkiddy XML 로드 완료 - ${games.length}개 게임`, 'success');
        }
        }
      } else if (file.name.endsWith('.lpl')) {
        const { games, meta } = parseRetroArchLpl(text);
        if (hasExistingGames) {
          state.games = state.games.concat(games);
          setStatus(`✅ RetroArch .lpl 병합 완료 - ${games.length}개 추가 (총 ${state.games.length}개)`, 'success');
        } else {
          state.games = games;
          state.importedFrom = 'retroarch';
          state.retroarchMeta = meta;
          // 파싱한 메타 정보를 입력 필드에 자동 반영
          romBasePathEl.value = meta.romBasePath || '';
          dbNameEl.value = meta.dbName || '';
          corePathEl.value = meta.corePath || '';
          exportOptionsEl.style.display = 'block';
          setStatus(`✅ RetroArch .lpl 로드 완료 - ${games.length}개 게임`, 'success');
        }
      } else {
        throw new Error('지원하지 않는 파일 형식입니다. (.xml 또는 .lpl 파일을 사용하세요)');
      }
      state.romDirHandle = null;
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
        const tmpDoc = new DOMParser().parseFromString(text, 'application/xml');
        if (tmpDoc.documentElement?.tagName === 'gameList') {
          ({ games: sourceGames } = parseGamelistXml(text));
        } else {
          ({ games: sourceGames } = parsePowkiddyXml(text));
        }
      } else {
        setStatus('❌ .lpl 또는 .xml 파일만 지원합니다', 'error');
        return;
      }

      // stem(확장자 제거, 소문자, &→_) → 표시 이름 매핑
      const normStem = s => s.replace(/\.[^.]+$/, '').replace(/&/g, '_').toLowerCase().slice(0, 70);
      const stemMap = new Map();
      for (const g of sourceGames) {
        stemMap.set(normStem(g.gamePath), g.name);
      }

      let matched = 0;
      for (const game of state.games) {
        const stem = normStem(game.gamePath);
        if (stemMap.has(stem)) {
          game.name = stemMap.get(stem);
          game._autoName = true;
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
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
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

  // 기존 목록이 있으면 매핑 모드
  if (state.games.length > 0) {
    const romSet = new Set(names.map(n => n.toLowerCase()));
    let matched = 0;
    for (const game of state.games) {
      game._romMatched = romSet.has((game.gamePath || '').toLowerCase());
      if (game._romMatched) matched++;
    }
    state.romDirHandle = dirHandle;
    renderList();
    setStatus(`✅ ROM 매핑 완료 - ${matched} / ${state.games.length}개 일치`, 'success');
    return;
  }

  names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  state.romDirHandle = dirHandle;
  state.games = names.map(name => ({
    name: name.replace(/\.[^.]+$/, ''),
    gamePath: name,
  }));
  state.importedFrom = null;
  state.retroarchMeta = {};
  romBasePathEl.value = `/sdcard/game/${dirHandle.name}/`;
  if (!dbNameEl.value.trim()) dbNameEl.value = dirHandle.name + '.lpl';
  exportOptionsEl.style.display = 'block';
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

  // gamelist 모드: images/ 하위 폴더 자동 탐색
  if (state.importedFrom === 'gamelist') {
    try {
      dirHandle = await dirHandle.getDirectoryHandle('images', { create: false });
    } catch {
      // images/ 없으면 선택한 폴더 그대로 사용
    }
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

  if (state.importedFrom === 'gamelist') {
    // gamelist 모드: 원본 파일명 그대로 저장, _imagePath 업데이트
    const fileName = file.name;
    try {
      const fileHandle = await state.thumbDirHandle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(await file.arrayBuffer());
      await writable.close();
    } catch (e) {
      setStatus('❌ 파일 저장 실패: ' + e.message, 'error');
      return;
    }
    game._imagePath = './images/' + fileName;
    const key = fileName.replace(/\.[^.]+$/, '').toLowerCase();
    const dataUrl = await fileToDataUrl(file);
    state.thumbnailMap.set(key, dataUrl);
    thumbInfoEl.textContent = `✅ ${state.thumbnailMap.size}개 이미지`;
    setStatus(`✅ ${fileName} 저장 완료`, 'success');
    renderList();
    return;
  }

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
  if (state.importedFrom === 'gamelist' && game._imagePath) {
    const imageBasename = game._imagePath.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
    return state.thumbnailMap.get(imageBasename);
  }
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
    filtered = filtered.filter(g => !g.gamePath || g._romMatched === false);
  } else if (state.gameFilter === 'has-rom') {
    filtered = filtered.filter(g => g.gamePath && g._romMatched !== false);
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
    if (game._romMatched === true) tr.classList.add('rom-matched');
    else if (game._romMatched === false) tr.classList.add('rom-missing');

    const thumbUrl = getThumbUrl(game);
    const thumbCell = hasThumb
      ? `<td class="col-thumb">${thumbUrl
        ? `<img class="thumb-img" src="${thumbUrl}" alt="${escHtml(game.name)}" title="${escHtml(game.name)}" style="cursor:pointer;" />`
        : `<button class="btn-icon thumb-upload-btn" title="이미지 업로드">📷</button>`
      }</td>`
      : '';

    tr.innerHTML = `
      <td class="col-num">${origIdx + 1}</td>
      <td class="col-name" title="${escHtml(game.name)}"${game._autoName ? ' style="color:#ffe066;"' : ''}>${escHtml(game.name)}</td>
      <td class="col-path" title="${escHtml(game.gamePath)}"${game.gamePath !== romNewName(game.gamePath) ? ' style="color:#ff4d4d;"' : ''}>${escHtml(game.gamePath)}</td>
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
  // 현재 썸네일 찾기
  const currentThumbUrl = getThumbUrl(game) || null;

  let pendingThumbDataUrl = null;
  let pendingThumbFile = null;

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

  // 썸네일 영역은 항상 표시 (모든 파일 형식)
  const thumbSection = `
    <div class="thumb-edit-row">
      <span class="field-label-text">썸네일</span>
      <div class="thumb-edit-zone" id="thumbEditZone">
        ${currentThumbUrl
      ? `<img class="thumb-edit-preview" id="thumbEditPreview" src="${currentThumbUrl}" alt="" />`
      : `<div class="thumb-edit-placeholder" id="thumbEditPreview"><span>이미지를 드래그하거나<br>클릭하여 선택</span></div>`
    }
      </div>
      <div class="thumb-img-info" id="thumbImgInfo"></div>
    </div>
    <div class="ss-search-row">
      <button type="button" class="btn btn-sm" id="ssSearchBtn">🌐 스크린스크레이퍼 검색</button>
      <span class="ss-search-note">이미지 우클릭 복사 후 Ctrl+V, 또는 위 영역에 드래그</span>
    </div>`;

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

  // 썸네일 드롭존 & 검색 (모든 모드에서 동작)
  {
    const zone = dialog.querySelector('#thumbEditZone');

    async function applyImageFile(file) {
      if (!file || !file.type.startsWith('image/')) return;
      try {
        pendingThumbFile = file;
        pendingThumbDataUrl = state.importedFrom === 'gamelist'
          ? await fileToDataUrl(file)
          : await toPngDataUrl(file);
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
        if (currentThumbUrl) loadThumbImgInfo(dialog, pendingThumbDataUrl);
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
    zone.addEventListener('drop', async e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (e.dataTransfer.files.length) {
        applyImageFile(e.dataTransfer.files[0]);
      } else {
        const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (url && /^https?:\/\//.test(url)) {
          try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            if (!blob.type.startsWith('image/')) throw new Error('이미지 파일이 아닙니다');
            applyImageFile(new File([blob], 'image.png', { type: blob.type }));
          } catch (err) {
            setStatus('❌ 이미지 로드 실패 (CORS 차단 가능): ' + err.message, 'error');
          }
        }
      }
    });

    // Ctrl+V 붙여넣기
    dialog.addEventListener('paste', e => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) applyImageFile(file);
          return;
        }
      }
    });

    // 스크린스크레이퍼 검색
    dialog.querySelector('#ssSearchBtn').addEventListener('click', () => {
      openSsSearch(game.gamePath.replace(/\.[^.]+$/, ''));
    });
  }

  // 이미지 정보 비동기 로드
  if (currentThumbUrl) {
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

    const updated = { ...game, name: nameInput, gamePath: pathInput, _autoName: false };
    // 게임별 ROM 경로 / 코어 경로 / LPL 이름 갱신
    if (romBaseInput) {
      updated._romPath = romBaseInput.replace(/\/$/, '') + '/' + pathInput;
    } else {
      delete updated._romPath; // 전역 설정 사용
    }
    updated._corePath = coreInput || undefined;
    updated._dbName = dbNameInput || undefined;

    state.games[idx] = updated;

    if (pendingThumbDataUrl) {
      if (state.importedFrom === 'gamelist' && pendingThumbFile) {
        const fileName = pendingThumbFile.name;
        const key = fileName.replace(/\.[^.]+$/, '').toLowerCase();
        state.thumbnailMap.set(key, pendingThumbDataUrl);
        state.games[idx]._imagePath = './images/' + fileName;
        if (state.thumbDirHandle) {
          try {
            const fh = await state.thumbDirHandle.getFileHandle(fileName, { create: true });
            const writable = await fh.createWritable();
            await writable.write(await pendingThumbFile.arrayBuffer());
            await writable.close();
          } catch (e) {
            setStatus('❌ 이미지 저장 실패: ' + e.message, 'error');
          }
        }
        if (thumbInfoEl) thumbInfoEl.textContent = `✅ ${state.thumbnailMap.size}개 이미지`;
      } else {
        const safeName = nameInput.replace(/[?&/]/g, '_');
        state.thumbnailMap.set(safeName.toLowerCase(), pendingThumbDataUrl);
        if (state.thumbDirHandle) {
          const fileName = safeName + '.png';
          try {
            const fh = await state.thumbDirHandle.getFileHandle(fileName, { create: true });
            const writable = await fh.createWritable();
            const blob = await (await fetch(pendingThumbDataUrl)).blob();
            await writable.write(blob);
            await writable.close();
          } catch (e) {
            setStatus('❌ 이미지 저장 실패: ' + e.message, 'error');
          }
        }
        if (thumbInfoEl) thumbInfoEl.textContent = `✅ ${state.thumbnailMap.size}개 이미지`;
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

// ─── 스크린스크레이퍼 이미지 검색 ────────────────────────────────────────────

function openSsSearch(romName) {
  const searchUrl = `https://www.screenscraper.fr/recherche.php?recherche=${encodeURIComponent(romName)}`;

  const dlg = document.createElement('dialog');
  dlg.className = 'ss-dialog';
  dlg.innerHTML = `
    <div class="ss-dialog-header">
      <h4>🌐 스크린스크레이퍼 이미지 검색</h4>
      <button type="button" class="ss-close-btn" id="ssDlgClose">✕</button>
    </div>
    <div class="ss-dialog-body">
      <p class="ss-rom-name">검색어: <strong>${escHtml(romName)}</strong></p>
      <a href="${escHtml(searchUrl)}" target="_blank" rel="noopener" class="btn primary ss-open-link">🔗 스크린스크레이퍼에서 검색 열기</a>
      <div class="ss-instructions">
        <ol>
          <li>위 링크를 클릭해 스크린스크레이퍼 사이트에서 게임을 검색하세요.</li>
          <li>원하는 이미지에서 <strong>우클릭 → 이미지 복사</strong>를 선택하세요.</li>
          <li>이 창을 닫고 편집 화면으로 돌아와 <strong>Ctrl+V</strong>로 붙여넣기 하세요.</li>
        </ol>
      </div>
      <p class="ss-paste-hint">또는 이미지 파일을 편집 화면의 썸네일 영역으로 드래그하세요.</p>
    </div>
  `;

  dlg.querySelector('#ssDlgClose').addEventListener('click', () => dlg.close());
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.addEventListener('close', () => dlg.remove());
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

// ─── 글자 넣기 ────────────────────────────────────────────────────────────────

function addPrefix() {
  if (state.games.length === 0) {
    setStatus('⚠️ 게임 목록이 비어 있습니다.', 'warn');
    return;
  }
  // 이미 글자가 적용된 상태면 제거
  if (state.customPrefix !== null) {
    const prefix = state.customPrefix;
    state.games.forEach(game => {
      if (game.name.startsWith(prefix)) {
        game.name = game.name.slice(prefix.length);
      }
    });
    state.customPrefix = null;
    addPrefixBtn.classList.remove('active');
    setStatus(`✅ 글자 "${prefix}"를 제거했습니다.`, 'success');
    renderList();
    return;
  }
  // 글자 입력 다이얼로그 표시
  const dialog = document.createElement('dialog');
  dialog.className = 'prefix-dialog';
  dialog.innerHTML = `
    <form method="dialog" class="prefix-form">
      <label class="prefix-label">표시이름 앞에 넣을 글자를 입력하세요</label>
      <input type="text" id="prefixInput" class="text-input" placeholder="예: [완료] " autofocus />
      <div class="prefix-buttons">
        <button type="submit" class="btn primary" id="prefixConfirm">확인</button>
        <button type="button" class="btn" id="prefixCancel">취소</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.querySelector('#prefixCancel').addEventListener('click', () => {
    dialog.close();
    dialog.remove();
  });
  dialog.querySelector('form').addEventListener('submit', e => {
    e.preventDefault();
    const prefix = dialog.querySelector('#prefixInput').value;
    if (!prefix) {
      dialog.close();
      dialog.remove();
      return;
    }
    state.games.forEach(game => { game.name = prefix + game.name; });
    state.customPrefix = prefix;
    addPrefixBtn.classList.add('active');
    setStatus(`✅ ${state.games.length}개 게임 앞에 "${prefix}"를 추가했습니다.`, 'success');
    dialog.close();
    dialog.remove();
    renderList();
  });
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
      <div class="naming-mode-row">
        <span class="naming-mode-label">저장 파일명:</span>
        <label class="naming-mode-option"><input type="radio" name="namingMode" value="display" checked> 표시 이름</label>
        <label class="naming-mode-option"><input type="radio" name="namingMode" value="rom"> ROM 파일명</label>
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
      const namingMode = dialog.querySelector('[name="namingMode"]:checked').value;
      dialog.close();
      resolve({ handles: folders.map(f => f.handle), namingMode });
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

  const searchResult = await pickSearchFolders();
  if (!searchResult) return;
  const { handles: srcHandles, namingMode } = searchResult;
  if (srcHandles.length === 0) return;

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

    // 표시 이름으로 검색
    const thumbByName = game.name.toLowerCase();
    const thumbByNameUnderscored = game.name.replace(/[?&/]/g, '_').toLowerCase();
    const candidatesByName = fileMap.get(thumbByNameUnderscored)
      || (thumbByNameUnderscored !== thumbByName ? fileMap.get(thumbByName) : null);

    // ROM 파일명으로 검색
    const romStem = game.gamePath.replace(/\.[^.]+$/, '');
    const romLookupKey = romStem.toLowerCase();
    const romLookupKeySafe = romStem.replace(/&/g, '_').toLowerCase();
    const candidatesByRom = fileMap.get(romLookupKey)
      || (romLookupKeySafe !== romLookupKey ? fileMap.get(romLookupKeySafe) : null);

    const candidates = candidatesByName || candidatesByRom;
    // saveKey는 namingMode에 따라 thumbnailMap 키 결정 (getThumbUrl과 매칭)
    const saveKey = namingMode === 'rom' ? romLookupKey : thumbByNameUnderscored;
    if (candidates) {
      matches.push({ game, candidates, saveKey });
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
      const fileName = namingMode === 'rom'
        ? game.gamePath.replace(/\.[^.]+$/, '') + '.png'
        : game.name.replace(/[?&/]/g, '_') + '.png';
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

// ─── ROM 파일명 자동 변경 ─────────────────────────────────────────────────────

function romNewName(gamePath) {
  const dotIdx = gamePath.lastIndexOf('.');
  const stem = dotIdx !== -1 ? gamePath.slice(0, dotIdx) : gamePath;
  const ext  = dotIdx !== -1 ? gamePath.slice(dotIdx) : '';
  const newStem = stem.replace(/&/g, '_').slice(0, 70);
  return newStem + ext;
}

async function renameRomFiles() {
  if (!state.romDirHandle) {
    setStatus('⚠️ ROM 파일명 변경은 폴더 불러오기로 목록을 만든 경우에만 가능합니다', 'warn');
    return;
  }

  const targets = state.games
    .map((g, i) => ({ idx: i, game: g }))
    .filter(({ game }) => game.gamePath !== romNewName(game.gamePath));

  if (targets.length === 0) {
    setStatus('✅ 변경할 ROM 파일이 없습니다', 'success');
    return;
  }

  const confirmed = await showRenameRomConfirm(targets);
  if (!confirmed) return;

  let success = 0, failed = 0;
  for (const { idx, game } of targets) {
    const oldName = game.gamePath;
    const newName = romNewName(oldName);
    try {
      const oldHandle = await state.romDirHandle.getFileHandle(oldName);
      const file = await oldHandle.getFile();
      const buffer = await file.arrayBuffer();
      const newHandle = await state.romDirHandle.getFileHandle(newName, { create: true });
      const writable = await newHandle.createWritable();
      await writable.write(buffer);
      await writable.close();
      await state.romDirHandle.removeEntry(oldName);
      state.games[idx].gamePath = newName;
      success++;
    } catch (e) {
      console.error(`파일 변경 실패: ${oldName}`, e);
      failed++;
    }
  }

  renderList();
  if (failed > 0) {
    setStatus(`⚠️ ${success}개 변경 완료, ${failed}개 실패`, 'warn');
  } else {
    setStatus(`✅ ${success}개 파일명 변경 완료`, 'success');
  }
}

function showRenameRomConfirm(targets) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'cleanup-confirm-dialog';
    const listHtml = targets.map(({ game }) => {
      const newName = romNewName(game.gamePath);
      return `<li style="padding:2px 0;"><span style="color:#ff4d4d;">${escHtml(game.gamePath)}</span> → <span style="color:#ffe066;">${escHtml(newName)}</span></li>`;
    }).join('');
    dialog.innerHTML = `
      <h3>⚠️ ROM 파일명 변경 확인</h3>
      <p class="cleanup-desc">다음 <strong>${targets.length}개</strong> 파일을 변경합니다. (&amp; → _, 70자 초과 시 잘라냄)<br>실제 파일이 변경되며 되돌릴 수 없습니다.</p>
      <ul class="cleanup-file-list">${listHtml}</ul>
      <div class="dialog-actions">
        <button class="btn danger" id="renameRomApply">변경</button>
        <button class="btn" id="renameRomCancel">취소</button>
      </div>
    `;
    dialog.querySelector('#renameRomApply').addEventListener('click', () => {
      dialog.close();
      resolve(true);
    });
    dialog.querySelector('#renameRomCancel').addEventListener('click', () => {
      dialog.close();
      resolve(false);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.addEventListener('close', () => dialog.remove());
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

// ─── 이미지 용량 줄이기 ───────────────────────────────────────────────────────

const PNG_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function pngCrc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = PNG_CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crcBuf = new Uint8Array(4 + data.length);
  crcBuf.set(typeBytes);
  crcBuf.set(data, 4);
  view.setUint32(8 + data.length, pngCrc32(crcBuf));
  return chunk;
}

async function deflateRaw(data) {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function toIndexed8bitPng(canvas) {
  const w = canvas.width, h = canvas.height;
  const pixels = canvas.getContext('2d').getImageData(0, 0, w, h).data;

  // 고정 256색 팔레트 (R:3bit, G:3bit, B:2bit)
  const palette = new Uint8Array(256 * 3);
  for (let r = 0; r < 8; r++)
    for (let g = 0; g < 8; g++)
      for (let b = 0; b < 4; b++) {
        const idx = r * 32 + g * 4 + b;
        palette[idx * 3 + 0] = Math.round(r * 255 / 7);
        palette[idx * 3 + 1] = Math.round(g * 255 / 7);
        palette[idx * 3 + 2] = Math.round(b * 255 / 3);
      }

  // 픽셀별 팔레트 인덱스 (필터 바이트 포함)
  const raw = new Uint8Array(h * (w + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      const pi = (y * w + x) * 4;
      const r = (pixels[pi]     * 7 / 255 + 0.5) | 0;
      const g = (pixels[pi + 1] * 7 / 255 + 0.5) | 0;
      const b = (pixels[pi + 2] * 3 / 255 + 0.5) | 0;
      raw[y * (w + 1) + 1 + x] = r * 32 + g * 4 + b;
    }
  }

  const compressed = await deflateRaw(raw);

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, w);
  ihdrView.setUint32(4, h);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 3; // color type: indexed

  const sig  = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = makePngChunk('IHDR', ihdrData);
  const plte = makePngChunk('PLTE', palette);
  const idat = makePngChunk('IDAT', compressed);
  const iend = makePngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(sig.length + ihdr.length + plte.length + idat.length + iend.length);
  let off = 0;
  for (const c of [sig, ihdr, plte, idat, iend]) { out.set(c, off); off += c.length; }
  return out;
}

async function resizeImages() {
  if (!state.thumbDirHandle) {
    setStatus('⚠️ 먼저 이미지 폴더를 불러오세요 (이미지 확인 체크박스)', 'warn');
    return;
  }

  // 입력 다이얼로그
  const params = await new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'prefix-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="prefix-form">
        <label class="prefix-label">이미지 변환 설정</label>
        <div style="display:flex;gap:12px;margin:12px 0;">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;">너비
            <input type="number" id="ri_w" class="text-input" value="320" min="1" style="width:80px;" />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;">높이
            <input type="number" id="ri_h" class="text-input" value="240" min="1" style="width:80px;" />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;">색상(bit)
            <input type="number" id="ri_b" class="text-input" value="8" min="1" max="32" style="width:70px;" />
          </label>
        </div>
        <div class="prefix-buttons">
          <button type="submit" class="btn primary">변환 시작</button>
          <button type="button" class="btn" id="riCancel">취소</button>
        </div>
      </form>
    `;
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector('#riCancel').addEventListener('click', () => {
      dialog.close(); dialog.remove(); resolve(null);
    });
    dialog.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      const w = parseInt(dialog.querySelector('#ri_w').value) || 320;
      const h = parseInt(dialog.querySelector('#ri_h').value) || 240;
      const b = parseInt(dialog.querySelector('#ri_b').value) || 8;
      dialog.close(); dialog.remove();
      resolve({ w, h, b });
    });
  });
  if (!params) return;
  const { w, h, b } = params;

  // 썸네일 폴더에서 이미지 목록 수집
  const entries = [];
  for await (const [name, handle] of state.thumbDirHandle.entries()) {
    if (handle.kind !== 'file') continue;
    const ext = name.includes('.') ? '.' + name.split('.').pop().toLowerCase() : '';
    if (THUMB_EXTS.has(ext)) entries.push({ name, handle });
  }

  if (entries.length === 0) {
    setStatus('⚠️ 변환할 이미지가 없습니다', 'warn');
    return;
  }

  const prog = createProgressDialog('🖼️ 이미지 변환 중...');
  prog.setProgress(0, entries.length);

  let successCount = 0;
  for (let i = 0; i < entries.length; i++) {
    const { name, handle } = entries[i];
    prog.setProgress(i + 1, entries.length);
    prog.setStatus(`${i + 1} / ${entries.length}  —  ${name}`);
    await new Promise(r => setTimeout(r, 0));
    try {
      const file = await handle.getFile();
      const canvas = await new Promise((res, rej) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          res(c);
        };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지 로드 실패')); };
        img.src = url;
      });

      let pngBytes;
      if (b <= 8) {
        pngBytes = await toIndexed8bitPng(canvas);
      } else {
        const dataUrl = canvas.toDataURL('image/png');
        pngBytes = dataUrlToUint8Array(dataUrl);
      }

      const outName = name.replace(/\.[^.]+$/, '') + '.png';
      const fh = await state.thumbDirHandle.getFileHandle(outName, { create: true });
      const writable = await fh.createWritable();
      await writable.write(pngBytes);
      await writable.close();

      // thumbnailMap 갱신
      const basename = outName.replace(/\.[^.]+$/, '').toLowerCase();
      const blob = new Blob([pngBytes], { type: 'image/png' });
      state.thumbnailMap.set(basename, await fileToDataUrl(blob));
      successCount++;
    } catch (e) {
      console.error(`변환 실패 (${name}):`, e);
    }
  }

  prog.close();
  thumbInfoEl.textContent = `📁 ${state.thumbDirHandle.name}  ·  ✅ ${state.thumbnailMap.size}개 이미지`;
  setStatus(`✅ ${successCount} / ${entries.length}개 이미지 변환 완료 (${w}×${h}, ${b}bit)`, 'success');
  renderList();
}

// ─── 이미지 내보내기 ──────────────────────────────────────────────────────────

function dataUrlToUint8Array(dataUrl) {
  const [, b64] = dataUrl.split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function exportImages(mode) {
  if (!state.thumbnailMap.size) {
    setStatus('⚠️ 이미지가 없습니다 (썸네일 폴더를 먼저 선택하세요)', 'warn');
    return;
  }
  if (state.games.length === 0) {
    setStatus('⚠️ 게임 목록이 비어있습니다', 'warn');
    return;
  }

  let destDir;
  try {
    destDir = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    if (e.name !== 'AbortError') setStatus('❌ 폴더 선택 실패: ' + e.message, 'error');
    return;
  }

  const prog = createProgressDialog('🖼️ 이미지 내보내기 중...');
  let success = 0, skip = 0;
  const total = state.games.length;

  for (let i = 0; i < total; i++) {
    const game = state.games[i];
    prog.setProgress(i + 1, total);
    prog.setStatus(game.name);

    const dataUrl = getThumbUrl(game);
    if (!dataUrl) { skip++; continue; }

    const stem = mode === 'powkiddy'
      ? game.gamePath.replace(/\.[^.]+$/, '')
      : game.name.replace(/[/\\:*?"<>|]/g, '_');
    const filename = stem + '.png';

    try {
      const bytes = dataUrlToUint8Array(dataUrl);
      const fh = await destDir.getFileHandle(filename, { create: true });
      const writable = await fh.createWritable();
      await writable.write(bytes);
      await writable.close();
      success++;
    } catch (e) {
      console.error(`이미지 내보내기 실패 (${filename}):`, e);
      skip++;
    }
  }

  prog.close();
  setStatus(`✅ ${success}개 이미지 내보내기 완료${skip ? ` (${skip}개 이미지 없음)` : ''}`, 'success');
}

// ─── 내보내기 ─────────────────────────────────────────────────────────────────

function doExport(format) {
  if (state.games.length === 0) {
    setStatus('⚠️ 내보낼 게임이 없습니다', 'warn');
    return;
  }

  let content, filename, mimeType;

  if (format === 'gamelist') {
    content = exportGamelistXml(state.games);
    filename = 'gamelist.xml';
    mimeType = 'application/xml';
  } else if (format === 'powkiddy') {
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
