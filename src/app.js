import {
  parsePowkiddyXml,
  exportPowkiddyXml,
  parseRetroArchLpl,
  exportRetroArchLpl,
} from './parsers.js';

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
  editingIdx: null,
};

// ─── DOM 참조 ─────────────────────────────────────────────────────────────────

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const gameListEl = document.getElementById('gameList');
const countEl = document.getElementById('gameCount');
const searchEl = document.getElementById('searchInput');
const addBtn = document.getElementById('addBtn');
const deleteBtn = document.getElementById('deleteBtn');
const moveUpBtn = document.getElementById('moveUpBtn');
const moveDownBtn = document.getElementById('moveDownBtn');
const renumberBtn = document.getElementById('renumberBtn');
const exportPowkiddyBtn = document.getElementById('exportPowkiddy');
const exportRetroArchBtn = document.getElementById('exportRetroArch');
const romBasePathEl = document.getElementById('romBasePath');
const dbNameEl = document.getElementById('dbName');
const exportOptionsEl = document.getElementById('exportOptions');
const statusEl = document.getElementById('status');

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
  dropzone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', e => {
    if (e.target.files.length) handleFile(e.target.files[0]);
  });

  // 검색
  searchEl.addEventListener('input', () => {
    state.searchText = searchEl.value.toLowerCase();
    renderList();
  });

  // 버튼
  addBtn.addEventListener('click', addGame);
  deleteBtn.addEventListener('click', deleteSelected);
  moveUpBtn.addEventListener('click', () => moveSelected(-1));
  moveDownBtn.addEventListener('click', () => moveSelected(1));
  renumberBtn.addEventListener('click', renumberGames);
  exportPowkiddyBtn.addEventListener('click', () => doExport('powkiddy'));
  exportRetroArchBtn.addEventListener('click', () => doExport('retroarch'));

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
        // ROM 기본 경로 추측
        if (games.length && games[0]._path) {
          const parts = games[0]._path.split('/');
          parts.pop();
          romBasePathEl.value = parts.join('/') + '/';
        }
        if (games.length && games[0]._dbName) {
          dbNameEl.value = games[0]._dbName;
        }
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

// ─── 렌더링 ───────────────────────────────────────────────────────────────────

function renderList() {
  const filter = state.searchText;
  const filtered = filter
    ? state.games
        .map((g, i) => ({ ...g, _origIdx: i }))
        .filter(g => g.name.toLowerCase().includes(filter) || g.gamePath.toLowerCase().includes(filter))
    : state.games.map((g, i) => ({ ...g, _origIdx: i }));

  countEl.textContent = `총 ${state.games.length}개 게임`;

  gameListEl.innerHTML = '';

  if (state.games.length === 0) {
    gameListEl.innerHTML = '<tr><td colspan="4" class="empty-msg">파일을 불러오거나 게임을 추가하세요</td></tr>';
    return;
  }

  filtered.forEach(game => {
    const origIdx = game._origIdx;
    const tr = document.createElement('tr');
    tr.dataset.idx = origIdx;
    if (state.selectedRows.has(origIdx)) tr.classList.add('selected');

    tr.innerHTML = `
      <td class="col-num">${origIdx + 1}</td>
      <td class="col-name" title="${escHtml(game.name)}">${escHtml(game.name)}</td>
      <td class="col-path" title="${escHtml(game.gamePath)}">${escHtml(game.gamePath)}</td>
      <td class="col-actions">
        <button class="btn-icon" data-action="edit" data-idx="${origIdx}" title="편집">✏️</button>
      </td>
    `;

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
      <div class="dialog-actions">
        <button type="submit" class="btn primary">저장</button>
        <button type="button" class="btn" id="cancelEdit">취소</button>
      </div>
    </form>
  `;

  dialog.querySelector('#cancelEdit').addEventListener('click', () => dialog.close());
  dialog.querySelector('form').addEventListener('submit', () => {
    const nameInput = dialog.querySelector('[name="name"]').value.trim();
    const pathInput = dialog.querySelector('[name="gamePath"]').value.trim();
    if (nameInput && pathInput) {
      state.games[idx] = { ...game, name: nameInput, gamePath: pathInput };
      renderList();
      setStatus(`✅ ${nameInput} 수정 완료`, 'success');
    }
    dialog.close();
  });

  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.addEventListener('close', () => dialog.remove());
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

// ─── 번호 재정렬 ──────────────────────────────────────────────────────────────

function renumberGames() {
  state.games = state.games.map((g, i) => {
    // "N.게임명" 형식에서 숫자 부분만 교체
    const match = g.name.match(/^\d+\.(.*)/);
    const baseName = match ? match[1] : g.name;
    return { ...g, name: `${i + 1}.${baseName}` };
  });
  setStatus('✅ 번호 재정렬 완료', 'success');
  renderList();
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
    const romBase = romBasePathEl.value.trim();
    const db = dbNameEl.value.trim();
    content = exportRetroArchLpl(state.games, state.retroarchMeta, romBase, db);
    filename = 'playlist.lpl';
    mimeType = 'application/json';
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
