# 🎮 Powkiddy Playlist Editor

Powkiddy A12 게임기의 `game_strings_ko.xml`과 RetroArch `.lpl` 플레이리스트 파일을 편집하는 웹 에디터입니다.

**👉 [바로 사용하기](https://YOUR_GITHUB_USERNAME.github.io/powkiddy/)**

## 기능

- **파일 불러오기**: Powkiddy XML 또는 RetroArch .lpl 파일 드래그 앤 드롭 지원
- **게임 목록 편집**: 게임 추가 / 삭제 / 순서 변경 / 이름·경로 수정
- **번호 자동 재정렬**: 순서 변경 후 이름의 번호를 자동 업데이트
- **내보내기**: Powkiddy XML 형식 또는 RetroArch .lpl (JSON) 형식으로 저장
- **검색**: 게임 이름 및 파일명 실시간 검색

## Powkiddy XML 파일 위치

Powkiddy A12 기기에서 XML 파일은 다음 경로에 있습니다:

```
settings/res/[시스템]/string/game_strings_ko.xml
```

예: `settings/res/FC/string/game_strings_ko.xml` (패미컴)

지원 시스템 폴더: `FC`, `GBA`, `SFC`, `GB`, `GBC`, `GG`, `MD`, `PS`, `NEOGEO`, `FBA`, `CPS`

## XML 포맷 구조

```xml
<?xml version="1.0"?>
<strings_resources>
  <icon_para game_list_total="433" />
  <icon_page1>
    <icon0_para name="1.슈퍼 마리오" game_path="Super Mario Bros. (Korea).zip" />
    <icon1_para name="2.록맨" game_path="Rockman (Korea).zip" />
    <!-- ... 최대 8개 -->
  </icon_page1>
  <icon_page2>
    <!-- ... -->
  </icon_page2>
</strings_resources>
```

- 페이지당 8개 게임 (`icon0_para` ~ `icon7_para`)
- `name`: 표시 이름 (번호 포함)
- `game_path`: ROM 파일명만 (경로 없이)

## RetroArch .lpl 포맷

RetroArch 플레이리스트는 JSON 형식입니다:

```json
{
  "version": "1.5",
  "items": [
    {
      "path": "/storage/roms/FC/Super Mario Bros. (Korea).zip",
      "label": "슈퍼 마리오 브라더스",
      "core_path": "DETECT",
      "core_name": "DETECT",
      "crc32": "DETECT",
      "db_name": "Nintendo - Nintendo Entertainment System.lpl"
    }
  ]
}
```

## 설치 없이 사용

이 앱은 순수 HTML/CSS/JavaScript로 만들어져 별도 설치가 필요 없습니다.
GitHub Pages에서 바로 실행되며, 모든 처리는 브라우저 내에서만 이루어집니다 (파일이 서버로 전송되지 않습니다).

## 로컬 실행

```bash
# HTTP 서버 없이도 동작하나, 일부 브라우저에서는 로컬 서버 필요
python -m http.server 8080
# 또는
npx serve .
```

## 라이선스

MIT
