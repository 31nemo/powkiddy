/**
 * Powkiddy XML 파서 / 내보내기
 * RetroArch .lpl (6줄 텍스트 포맷) 파서 / 내보내기
 */

// ─── Powkiddy XML ───────────────────────────────────────────────────────────

/**
 * Powkiddy game_strings_ko.xml 파일을 파싱하여 게임 목록 반환
 * @param {string} xmlText
 * @returns {{ games: Array<{name: string, gamePath: string}> }}
 */
export function parsePowkiddyXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');

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

/**
 * 게임 목록을 Powkiddy XML 형식으로 직렬화
 * @param {Array<{name: string, gamePath: string}>} games
 * @returns {string} XML 문자열
 */
export function exportPowkiddyXml(games) {
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

// ─── RetroArch .lpl (6줄 텍스트 포맷) ──────────────────────────────────────
//
// 엔트리당 6줄 구조:
//   줄1: ROM 전체 경로  (/sdcard/.../roms/[폴더]/[파일명].nes)
//   줄2: 표시 이름
//   줄3: 코어 경로     (/sdcard/.../cores/[코어].so)
//   줄4: CRC32         (보통 DETECT)
//   줄5: 알 수 없음    (보통 DETECT)
//   줄6: DB 이름       (예: Nintendo - Nintendo Entertainment System (Add-Korea).lol)

const LINES_PER_ENTRY = 6;

/**
 * RetroArch .lpl (6줄 텍스트) 파일을 파싱하여 게임 목록 반환
 * @param {string} text
 * @returns {{ games: Array<{name: string, gamePath: string, _romPath: string, _corePath: string, _crc32: string, _field5: string, _dbName: string}>, meta: {romBasePath: string, corePath: string, dbName: string} }}
 */
export function parseRetroArchLpl(text) {
  const lines = text.split(/\r?\n/);

  // 마지막 빈 줄 제거
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();

  if (lines.length % LINES_PER_ENTRY !== 0) {
    console.warn(`줄 수 ${lines.length}가 ${LINES_PER_ENTRY}의 배수가 아닙니다. 불완전한 마지막 항목은 무시됩니다.`);
  }

  const games = [];
  const entryCount = Math.floor(lines.length / LINES_PER_ENTRY);

  for (let i = 0; i < entryCount; i++) {
    const base = i * LINES_PER_ENTRY;
    const romPath  = lines[base + 0] || '';
    const label    = lines[base + 1] || '';
    const corePath = lines[base + 2] || '';
    const crc32    = lines[base + 3] || 'DETECT';
    const field5   = lines[base + 4] || 'DETECT';
    const dbName   = lines[base + 5] || '';

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

  // 공통 경로 추출 (ROM 기본 폴더, 코어 경로, DB 이름)
  const meta = {
    romBasePath: games.length ? extractDirPath(games[0]._romPath) : '',
    corePath:    games.length ? games[0]._corePath : '',
    dbName:      games.length ? games[0]._dbName   : '',
  };

  return { games, meta };
}

/**
 * 게임 목록을 RetroArch .lpl (6줄 텍스트) 형식으로 직렬화
 * @param {Array<{name: string, gamePath: string, _romPath?: string, _corePath?: string, _crc32?: string, _field5?: string, _dbName?: string}>} games
 * @param {{ romBasePath: string, corePath: string, dbName: string }} meta
 * @returns {string}
 */
export function exportRetroArchLpl(games, meta = {}) {
  const { romBasePath = '', corePath = '', dbName = '' } = meta;

  return games.map(game => {
    const romPath = game._romPath
      ? game._romPath  // 원본 경로 보존
      : romBasePath
        ? romBasePath.replace(/\/$/, '') + '/' + game.gamePath
        : game.gamePath;

    const core   = game._corePath || corePath || 'DETECT';
    const crc32  = game._crc32  || 'DETECT';
    const field5 = game._field5 || 'DETECT';
    const db     = game._dbName || dbName || '';

    return [romPath, game.name, core, crc32, field5, db].join('\n');
  }).join('\n') + '\n';
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function extractFilename(path) {
  return path.split('/').pop() || path;
}

function extractDirPath(path) {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/') + '/';
}
