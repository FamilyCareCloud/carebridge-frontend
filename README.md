# CareBridge frontend

요양기관의 작성자·검토자·수신자를 연결하는 웹 프론트엔드입니다. 현재는 **새 그룹별 화면과 모의 업무 흐름을 구현한 단계**이며, 실제 백엔드 및 AI 연동은 아직 완료하지 않았습니다.

## 개발 실행

Node.js 22.22.2 이상인 22.x 또는 24.15.0 이상인 24.x와 npm을 사용합니다. 검증 런타임은 Node 24.22.1입니다.

```sh
npm ci
npm run dev:carebridge
```

터미널의 Local 주소로 접속합니다. 기본 포트는 5174입니다. 이 모드는 브라우저에 합성 QA 데이터를 저장하며 실제 API를 호출하지 않습니다.

| 모의 계정 ID | 용도 |
|---|---|
| author | 1그룹 작성자 |
| reviewer | 2그룹 현재 관리자 |
| reader | 3그룹 수신자 |
| successor | 관리 권한 이전 후보 |
| admin | 테스트용 역할 전환 |
| pending-author / pending-reader | 참여 승인 대기 |

모의 비밀번호는 모두 `demo`입니다. 실제 admin 비밀번호는 백엔드에서 별도로 지정합니다. 로그인 화면에서 기록이 있는 기관 또는 빈 기관 시나리오를 초기화할 수 있습니다.

## 서비스 흐름

- **1그룹:** 원문 작성 → AI 초안 생성·수정 → 확인 후 제출 → 검토 결과 확인·재제출.
- **2그룹:** 참여 승인·퇴출, 대상자 관리, 제출 검토·보류·확정 → 수신자 지정 → 별도 공개.
- **3그룹:** 자신에게 공개된 내용만 열람. 철회·권한 종료 시 열린 화면에서도 내용 숨김.

일반 계정은 가입 시 역할이 고정되며 계정당 작업 그룹 하나에 소속됩니다. 작업 그룹의 관리자는 한 명입니다. admin은 지정 QA 범위에서만 역할 전환과 자기 제출 검토·확정을 허용합니다. AI 경고는 제출·확정을 막지 않으며 사람이 최종 판단합니다.

위 내용은 서비스 정책입니다. 모의 구현과 실제 API 연결의 차이 및 아직 구현하지 않은 범위는 [실행·구현·검증 안내](docs/CAREBRIDGE-WORKSPACE.md)를 확인하세요.

## 실제 API 연결 준비

`.env.example`을 참고하여 `.env.local`을 작성합니다.

| 변수 | 용도 |
|---|---|
| VITE_CAREBRIDGE_API_URL | 새 작업 공간의 실제 백엔드 기본 주소 |
| VITE_API_BASE_URL | 보존된 기존 FCC 화면용 변수. 새 진입 화면에서는 사용하지 않음 |
| VITE_DEV_PROXY_TARGET | 기존 Vite 프록시의 목적지. 새 업무 경로의 프록시는 연동 시 보완 필요 |

`npm run dev`, `npm run build`, `npm run preview`는 실제 API 모드입니다. 주소 미설정·요청 실패를 모의 데이터로 대체하지 않습니다. **현재 HttpGateway는 임시 계약이므로 주소만 입력해도 최신 백엔드에 연결되는 상태는 아닙니다.** 실제 REST 경로·인증·응답·이벤트 계약에 맞춰 후속 수정해야 합니다.

`VITE_` 변수는 브라우저에 공개됩니다. 비밀번호나 AI 서비스 키를 넣지 않습니다. 현재 새 화면의 세션은 메모리에 보관하며 새로고침하면 재로그인이 필요합니다.

## 구조

| 경로 | 역할 |
|---|---|
| src/App.tsx, src/main.tsx | CareBridge 진입점 |
| src/workspace/WorkspaceApp.tsx | 역할별 업무 화면 |
| src/workspace/Login.tsx, ui.tsx, workspace.css | 인증 화면·공통 UI·스타일 |
| src/workspace/model.ts | 화면 모델과 Gateway 인터페이스 |
| src/workspace/gateway.ts | 실제 API 어댑터와 모드 선택 |
| src/workspace/mock.ts | 개발·테스트용 합성 데이터와 모의 API |
| tests/workspace-*.test.tsx | 정책·화면·통신 테스트 |

이전 FCC 소스와 기존 테스트는 재사용 검토를 위해 보존하며 새 앱 진입점에서는 기존 화면을 사용하지 않습니다. 테스트와 모의 API는 개발에 필요하므로 소스에 포함합니다. 요청서·비교 보고서는 저장소 밖의 협업 자료로 관리합니다.

## 검증과 배포

```sh
npm run lint
npm test
npm run build
```

빌드 산출물은 `dist/`에 생성됩니다. `node_modules/`, `dist/`, `.local/`, 개인 환경설정은 Git에서 제외합니다.

기존 GitHub 검사와 Amplify 설정은 유지합니다. 새 앱은 `VITE_CAREBRIDGE_API_URL`을 사용하므로 기존 FCC 배포 변수만으로 연결되지 않습니다. 실제 배포 전 새 API 어댑터·환경변수·권한·이벤트 동작을 함께 검증해야 합니다. 프론트 빌드는 백엔드·AI 배포나 실제 연동 완료를 의미하지 않습니다.

## 담당

프론트·백엔드·AI 담당 각 1명으로 구성합니다. 백엔드 API 연동과 AI 연동은 별도로 관리하고 결과 저장·확정 조건 등의 접점만 함께 조율합니다.

- [프론트 저장소](https://github.com/FamilyCareCloud/carebridge-frontend)
- [백엔드 저장소](https://github.com/FamilyCareCloud/carebridge-backend)
- [AI 저장소](https://github.com/FamilyCareCloud/carebridge-ai)
