# 🎮 Powkiddy Playlist Editor

Powkiddy A12 게임기의 `game_strings_ko.xml`과 RetroArch `.lpl` 플레이리스트 파일을 편집하는 웹 에디터입니다.

**👉 [바로 사용하기](https://31nemo.github.io/powkiddy/)**

## 기능

- **파일 불러오기**: Powkiddy XML 또는 RetroArch .lpl 파일 드래그 앤 드롭 / 클릭 지원
- **게임 목록 편집**: 게임 추가 / 삭제 / 순서 변경 / 이름·경로·ROM기본경로·코어경로 수정
- **가나다 정렬**: 숫자 → 영문 → 한글 순으로 표시 이름 정렬
- **검색**: 게임 이름 및 파일명 실시간 검색
- **목록 필터**: 이미지 없는 게임만 / ROM 파일명이 없는 게임만 표시 (내보내기는 전체 목록 기준)
- **🖼️ 썸네일 표시**: 썸네일 폴더를 선택하면 ROM 파일명 또는 표시 이름과 일치하는 이미지를 목록에 표시
- **🔍 이미지 자동 검색**: 여러 폴더를 선택해 하위 폴더까지 재귀 검색 → 표시 이름과 일치하는 PNG를 자동 적용 (후보가 여러 개면 선택 가능, Boxarts/Snaps 필터 지원)
- **🗑 이미지 자동 정리**: 썸네일 폴더에서 게임 목록과 매칭되지 않는 이미지를 찾아 삭제
- **내보내기**: Powkiddy XML 형식 또는 RetroArch .lpl (JSON) 형식으로 저장

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
- `name`: 표시 이름
- `game_path`: ROM 파일명만 (경로 없이)

## RetroArch .lpl 포맷

RetroArch 플레이리스트는 **엔트리당 6줄** 텍스트 형식입니다:

```
/sdcard/.../roms/FC/Super Mario Bros. (Korea).zip
슈퍼 마리오 브라더스
/sdcard/.../cores/fceumm_libretro_android.so
DETECT
DETECT
Nintendo - Nintendo Entertainment System (Add-Korea).lol
```

- 줄 1: ROM 전체 경로
- 줄 2: 표시 이름
- 줄 3: 코어 경로 (`.so` 파일)
- 줄 4: CRC32 (보통 `DETECT`)
- 줄 5: 알 수 없음 (보통 `DETECT`)
- 줄 6: DB 이름 (`.lol` 파일명)

## 설치 없이 사용

이 앱은 순수 HTML/CSS/JavaScript로 만들어져 별도 설치가 필요 없습니다.
GitHub Pages에서 바로 실행되며, 모든 처리는 브라우저 내에서만 이루어집니다 (파일이 서버로 전송되지 않습니다).

> **주의**: 썸네일 폴더 선택 및 이미지 자동 검색 기능은 [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)를 사용하므로 **Chrome / Edge** 브라우저가 필요합니다.

## 로컬 실행

```bash
python -m http.server 8080
# 또는
npx serve .
```

## 라이선스

MIT
