# usage-band

Claude Code 데스크톱 앱 Code 탭의 입력창 바로 위에 지금 세션의 사용량과 작업 위치를 한 줄로 항상 보여주는 Claude Code 플러그인입니다. 마우스를 올리거나 메뉴를 열지 않아도 됩니다.

```
컨텍스트 ▬▬── 42%   5시간 ▬── 31% · 15:20 초기화   주간 ▬─ 12% · 월 09:00 초기화      워크트리 feat claude/feat [Zed에서 열기]
```

## 보여주는 것

- **컨텍스트**: 현재 세션의 컨텍스트 윈도우 사용률
- **5시간 / 주간**: 구독 플랜 사용 한도의 사용률과 초기화 시각
  - 초기화 시각은 오늘이면 `15:20`, 다른 날이면 `월 09:00`처럼 요일을 붙입니다.
- **작업 위치**: 세션이 작업 중인 폴더의 이름과 브랜치
  - git 워크트리면 `워크트리`, 메인 체크아웃이면 `메인`, git 저장소가 아니면 `폴더`로 표시합니다.
- **에디터에서 열기**: 누르면 현재 작업 위치를 설정한 에디터로 엽니다. 기본값은 Zed입니다.

## 동작

- 사용률이 70% 이상이면 주의색, 90% 이상이면 위험색으로 표시합니다.
- 5시간·주간 한도가 90%를 넘는 순간 토스트로 한 번 알립니다.
  - 90% 아래로 내려갔다가 다시 넘으면 또 알립니다.
- 사용량은 턴이 끝날 때와 한도가 1%p 움직일 때 갱신됩니다.
- 작업 위치는 세션이 시작될 때와 턴이 끝날 때마다 다시 읽습니다. 턴 중에 브랜치를 바꿔도 따라갑니다.
- 첫 응답 전에는 사용량 값이 없어서 작업 위치만 보입니다.
  - 컴팩션 직후처럼 컨텍스트 값만 비면 그 칸은 `–`로 표시합니다.
- 프롬프트에 아무것도 넣지 않아서 컨텍스트를 쓰지 않습니다.
- 터미널 CLI에서는 같은 내용을 `▰▰▱▱` 모양의 글자 막대로 보여줍니다.

## 요구사항

- Claude Code 2.1.321에서 만들고 테스트했습니다. 훅 모듈(`hooks/hooks.json`의 `modules`)을 지원하는 버전이 필요합니다.
- 5시간·주간 한도는 Pro·Max 같은 구독 계정에서만 나옵니다.
- 열기 버튼은 macOS의 `open -a <에디터>`를 실행해서 macOS에서만 동작합니다. 설정한 에디터가 설치돼 있어야 합니다.

## 설치

터미널 세션의 프롬프트에서:

```
/plugin install usage-band --marketplace b0jun/usage-band
```

셸에서:

```bash
claude plugin install usage-band --marketplace b0jun/usage-band
```

데스크톱 앱에서는 `/plugin`이 동작하지 않습니다. 입력창 옆 **+** → **Plugins** → **Add marketplace**에 `b0jun/usage-band`를 넣고 **Add plugin**을 누릅니다.

user 범위로 설치하면 이후 여는 모든 세션에 적용됩니다. 데스크톱 앱 Code 탭 세션도 포함됩니다.

## 에디터 설정

열기 버튼이 쓸 에디터는 `editor` 옵션으로 정합니다. 코드를 고칠 필요가 없고, 업데이트를 받아도 설정은 그대로 남습니다.

- 값은 macOS 앱 이름을 그대로 씁니다. 응용 프로그램 폴더에 보이는 이름에서 `.app`을 뺀 것입니다(`Zed`, `Cursor`, `Visual Studio Code`, `WebStorm` 등).
- 버튼 문구도 이 값을 따라갑니다(`Cursor에서 열기`).
- 비워 두면 열기 버튼을 숨기고 작업 위치만 보여줍니다.
- 설정하지 않으면 `Zed`를 씁니다.

설치할 때 함께 정하려면:

```bash
claude plugin install usage-band --marketplace b0jun/usage-band --config editor=Cursor
```

설치한 뒤 바꾸려면 터미널 세션에서 `/plugin configure usage-band@usage-band`를 실행하거나, 셸에서:

```bash
echo '{"editor":"Cursor"}' | claude plugin configure usage-band@usage-band --values-stdin
```

## 개발

```bash
claude plugin validate .
claude plugin test .
```

## 라이선스

MIT
