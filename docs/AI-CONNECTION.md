# 기관 AI 연결 — 2026-10-29

기준 프론트는 develop@0c2cc52다. 팀원이 구현한 기관 REST·실시간 접근 제어 위에 AI 호출을 연결했다. UI/CSS 개편은 포함하지 않는다. AI 서비스 키는 백엔드에만 둔다.

## 작성·음성

현재 기관의 이벤트 권한을 확인한 작성자만 아래 경로를 사용한다.

| 경로 | 요청·응답 연결 |
|---|---|
| POST /workspaces/{id}/drafts | memo/sourceLanguage/dataUse → generationId/draft. 원문 일치 확인 후 번역·경고·ID 보존 |
| POST /workspaces/{id}/transcriptions | PCM WAV의 audioBase64/sourceLanguage/dataUse → 편집 가능한 text. 직접 확인 후 생성 |
| POST /workspaces/{id}/submissions | 원문과 생성 ID, 작성자 편집본을 함께 제출. 원문 변경 시 재생성 |

현재 서버 계약은 synthetic_deidentified만 지원하므로 작성 화면에서 개인정보 없는 연습용 입력임을 명시적으로 확인한다. 음성은 30초 이하다. 녹음·파일 변환은 기존 voice.ts를 사용한다. 실패 시 원문·편집본을 지우거나 모의 결과를 만들지 않는다. 계정 변경·권한 재인증·원문/언어 변경 중 도착한 이전 생성 결과는 버린다.

## 최종 검사·확정

검토자는 원문·작성자 초안과 최종 검토본을 대조한다. ‘최종 내용 저장 · AI 검사’는 review decision=edit로 저장한 **응답 버전**에 /submissions/{id}/check를 요청한다. QA 경고를 화면에 그대로 표시하고, 원문·경고 확인 후 별도의 확정 버튼을 활성화한다. 검사 후 내용을 바꾸면 검사 상태를 폐기한다. 저장 성공 후 검사 실패 시 새 저장 버전을 보존해 재시도한다.

기관 정책상 유효한 hold 경고도 사람이 명시적으로 확인하고 확정할 수 있다. 실제 업무 보류는 보류 버튼과 사유로 결정한다. 확정만으로 공개하지 않는다. QA 미실행·장애·형식 오류·구간 수 변경은 통과로 대체하지 않는다. EDITED_EVIDENCE_REQUIRED는 원문의 근거 구간과 편집본 줄 수가 달라진 경우의 서버 제약이며 원문 또는 내용을 자동으로 삭제해 맞추지 않는다.

## 실행·검증

npm run dev:carebridge는 계속 모의 모드다. 실제 검증은 VITE_CAREBRIDGE_API_URL을 지정한 npm run dev/build를 사용한다. 백엔드에는 carebridge-ai qa.v2 사전 보류 및 구간별 검사 계약 호환 변경(PR #8)이 필요하다. AI 연결은 기존 CAREBRIDGE_SERVICE_URL/API_KEY를 사용하고 공개 브라우저 변수에 키를 넣지 않는다.

프론트 자동 검증은 실제 API 어댑터의 생성 ID·원문·인증·전사·검사 버전·실패 재시도, 실제 모드 화면의 입력 확인·생성·경고·검사 후 편집·메모 보존을 포함한다. 자동 화면 테스트의 서버는 모의 응답이다. 실제 GPU 결과와 로컬 기관 종단 검증, AWS 배포·Cognito 수용 검증은 각각 별도로 기록한다.
