/**
 * Powkiddy XML 파서 / 내보내기
 * RetroArch .lpl 파서 / 내보내기
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

  const games = [];
  // icon_page1, icon_page2, ... 순서대로
  const pages = doc.querySelectorAll('[class^="icon_page"], strings_resources > *');

  // icon_pageN 엘리먼트들 가져오기
  const root = doc.querySelector('strings_resources');
  if (!root) throw new Error('strings_resources 루트 엘리먼트를 찾을 수 없습니다.');

  for (const child of root.children) {
    if (!child.tagName.startsWith('icon_page')) continue;
    for (const entry of child.children) {
      const name = entry.getAttribute('name') || '';
      const gamePath = entry.getAttribute('game_path') || '';
      if (gamePath) {
        games.push({ name, gamePath });
      }
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
      const escapedName = escapeXml(name);
      const escapedPath = escapeXml(gamePath);
      xml += `    <icon${i}_para name="${escapedName}" game_path="${escapedPath}" />\n`;
    }
    xml += `  </icon_page${p + 1}>\n`;
  }

  xml += '</strings_resources>\n';
  return xml;
}

// ─── RetroArch .lpl ─────────────────────────────────────────────────────────

/**
 * RetroArch .lpl (JSON) 파일을 파싱하여 게임 목록 반환
 * @param {string} jsonText
 * @returns {{ games: Array<{name: string, gamePath: string}>, meta: object }}
 */
export function parseRetroArchLpl(jsonText) {
  const data = JSON.parse(jsonText);
  const items = data.items || [];

  const games = items.map(item => ({
    name: item.label || '',
    gamePath: extractFilename(item.path || ''),
    // 원본 데이터 보존
    _path: item.path || '',
    _corePath: item.core_path || 'DETECT',
    _coreName: item.core_name || 'DETECT',
    _crc32: item.crc32 || 'DETECT',
    _dbName: item.db_name || '',
  }));

  // items 제외한 메타 정보
  const { items: _, ...meta } = data;
  return { games, meta };
}

/**
 * 게임 목록을 RetroArch .lpl JSON 형식으로 직렬화
 * @param {Array<{name: string, gamePath: string, _path?: string, _corePath?: string, _coreName?: string, _crc32?: string, _dbName?: string}>} games
 * @param {object} meta - 원본 메타데이터 (version, default_core_path 등)
 * @param {string} romBasePath - ROM 기본 경로 (예: /storage/roms/FC/)
 * @param {string} dbName - 데이터베이스 이름 (예: Nintendo - Nintendo Entertainment System.lpl)
 * @returns {string} JSON 문자열
 */
export function exportRetroArchLpl(games, meta = {}, romBasePath = '', dbName = '') {
  const items = games.map(game => {
    const path = game._path
      ? game._path
      : romBasePath
        ? romBasePath.replace(/\/$/, '') + '/' + game.gamePath
        : game.gamePath;

    return {
      path,
      label: game.name,
      core_path: game._corePath || 'DETECT',
      core_name: game._coreName || 'DETECT',
      crc32: game._crc32 || 'DETECT',
      db_name: game._dbName || dbName || '',
    };
  });

  const output = {
    version: '1.5',
    default_core_path: '',
    default_core_name: '',
    label_display_mode: 0,
    right_thumbnail_mode: 0,
    left_thumbnail_mode: 0,
    sort_mode: 0,
    ...meta,
    items,
  };

  return JSON.stringify(output, null, 2);
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function extractFilename(path) {
  return path.split('/').pop() || path;
}
