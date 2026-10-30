# CareBridge Frontend

다국어 음성·텍스트 기반 돌봄 기록 생성 및 검토 지원 AI **CareBridge**의 웹 프론트엔드입니다. 작성자의 관찰 메모를 한국어 초안으로 정리하고, 담당자가 원문을 대조해 수정·확정한 뒤 공개 범위를 선택합니다.

- **팀:** 영남대학교 YU42 · 임현승(프론트엔드), 전채영(백엔드), 김우주(AI)
- **서비스:** https://develop.db2l4u9y804jp.amplifyapp.com/
- **제출 코드:** `main` · **서비스 자동 배포:** `develop`

## 주요 기능

| 역할 | 할 수 있는 일 |
|---|---|
| 작성자 | 대상자 선택, 음성·텍스트 메모 입력, 전사 원문 확인, AI 초안 생성·편집·제출, 검토 결과 확인 |
| 검토자 | 기관 참여 승인·구성원 관리, 대상자 등록, 원문 대조·수정·AI 검사·보류·확정, 공개 내용·수신자 선택 |
| 열람자 | 자신에게 공개된 기록과 기록 시각·공개 시각 확인 |

로그인·회원가입과 업무 화면은 한국어·영어·베트남어·인도네시아어를 지원합니다. 화면 언어와 메모 작성 언어는 별개이며, 화면 언어를 바꿔도 작성 중 내용은 유지됩니다.

새로고침 시 같은 탭의 저장된 세션을 서버에서 재검증해 복원합니다. 일반 백그라운드 갱신은 편집 화면과 입력을 유지하며, 뒤로가기와 수정 중 이탈 확인을 지원합니다. 공개 수신자 전체 선택 및 공개 차단 후 저장된 내용·활성 수신자 설정 복원을 제공합니다.

일반 계정은 가입 역할이 고정되고 활성 기관 한 곳에 참여합니다. 기록 확정과 공개는 별도 동작입니다. AI 경고는 사람이 검토하며, 유효한 최종 검사 없이 확정하지 않습니다. 퇴출·철회·접근 확인 만료 시 열람을 제한합니다.

## 로컬 화면 체험

Node.js 22.22.2 이상인 22.x 또는 24.15.0 이상인 24.x와 npm을 사용합니다.

```sh
npm ci
npm run dev:carebridge
```

기본 주소는 `http://127.0.0.1:5174`입니다. 이 모드는 브라우저의 합성 QA 데이터로 동작하며 실제 API를 호출하지 않습니다.

| 모의 계정 | 역할 |
|---|---|
| `author` | 작성자 |
| `reviewer` | 검토자·현재 관리자 |
| `reader` | 열람자 |
| `successor` | 관리 권한 이전 후보 |
| `admin` | QA 역할 전환 |
| `pending-author`, `pending-reader` | 참여 승인 대기 |

모의 비밀번호는 모두 `demo`입니다. 배포 서비스의 로그인 정보와는 별개입니다. 로그인 화면에서 기록이 있는 기관 또는 빈 기관 시나리오를 초기화할 수 있습니다.

## 실제 API 연결

`.env.example`을 `.env.local`로 복사하고 설정합니다.

```dotenv
VITE_CAREBRIDGE_API_URL=/backend
VITE_DEV_PROXY_TARGET=http://127.0.0.1:3000
```

```sh
npm run dev
```

위 설정은 별도 실행한 로컬 백엔드를 사용합니다. 배포 API를 연결하려면 프록시 목적지를 해당 HTTPS 주소로 지정합니다. 실제 API 모드의 쓰기 요청은 연결한 서버의 데이터에 반영됩니다.

배포 빌드에서는 `VITE_CAREBRIDGE_API_URL`에 전체 HTTPS API 주소를 지정합니다. `/backend`는 Vite 개발 프록시 경로입니다. `npm run dev`, `npm run build`, `npm run preview`는 실제 API 모드이며 실패 시 모의 데이터로 대체하지 않습니다. `VITE_` 변수는 브라우저에 공개되므로 서비스 키·비밀번호를 넣지 않습니다.

로컬 WebSocket 프록시는 시작 시 백엔드 `/health`에서 주소를 읽습니다. 필요하면 `VITE_DEV_WS_TARGET`과 백엔드 허용 출처에 맞는 `VITE_DEV_FRONTEND_ORIGIN`을 설정합니다.

## 구성과 검증

React 19 · TypeScript · Vite · CSS · Vitest · Testing Library를 사용합니다.

| 경로 | 역할 |
|---|---|
| `src/main.tsx`, `src/App.tsx` | 앱 진입점 |
| `src/workspace/` | 인증·역할별 화면·다국어·탐색·공개 흐름 |
| `src/workspace/gateway.ts` | 기관 API 연결과 세션 복원 |
| `src/workspace/realtime.ts` | SSE·WebSocket 접근 재검증 |
| `src/voice.ts` | 음성 녹음·입력 처리 |
| `tests/` | 화면·권한·세션·전송·언어 회귀 검사 |

```sh
npm run lint
npm test
npm run build
```

제출 버전 기준 자동 테스트 **98개**, lint와 build를 통과했습니다. 빌드 결과는 `dist/`입니다. GitHub Actions가 PR을 검사하며, `develop` 변경은 Amplify에서 자동 배포합니다. `main`은 현재 Amplify에 연결돼 있지 않습니다.

AI 초안은 합성·비식별 사례의 검토 보조용입니다. 자동 공식기록·의료 판단이나 현장 효과를 보증하지 않습니다. 배포 서비스의 AI 기능은 백엔드와 별도 AI 서버의 가동 상태에 의존합니다.

## 상세 안내

- [화면·실행·API 연결](docs/CAREBRIDGE-WORKSPACE.md)
- [AI 연결 계약](docs/AI-CONNECTION.md)
- [화면 언어 설정](docs/UI_LANGUAGES.md)
- [백엔드](https://github.com/FamilyCareCloud/carebridge-backend) · [AI](https://github.com/FamilyCareCloud/carebridge-ai)

세부 문서에는 작성 당시의 구현 기준과 검증 시점이 함께 기재돼 있습니다.
