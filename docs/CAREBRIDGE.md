# 케어브릿지 화면·추가 구현 전달

기준일: 2026-10-27. 로그인 후 **케어브릿지** 메뉴에서 사용할 수 있다.
기존 인증·그룹 선택과 같은 백엔드를 이용한다.

화면 기능은 [PR #10](https://github.com/FamilyCareCloud/fcc-frontend/pull/10),
모바일 메뉴·긴 검토 화면 개선은 [PR #11](https://github.com/FamilyCareCloud/fcc-frontend/pull/11)로
develop에 병합됐다. 이후 화면 수정은 최신 develop을 기준으로 진행한다.

[팀 전달 문서: 프론트·백엔드·AI 전체 현황](https://github.com/FamilyCareCloud/fcc-backend/blob/6ad017d93a68eeb192b2dcae74df2fb549b802ab/docs/FRONTEND_HANDOFF.md)에
API·권한·버전 처리·배포 주소와 확인 순서를 정리했다.

## 추가한 화면·동작

- 메모 작성: 가상·비식별 확인, 입력 언어 선택, 텍스트·마이크·음성 파일 입력.
- 전사 확인: 30초 이하 음성을 텍스트로 먼저 확인·수정한 뒤 초안 생성.
  마이크 녹음은 28초에 자동 전사하며, 화면을 나가면 마이크를 중지한다.
- 검토함: 원문·한국어 번역·관찰·원문 인용·QA 보류 사유를 함께 표시.
- 수정/검토: 번역·분류·추가 확인 여부 수정, 사유 입력, 재검사, 담당자 승인 또는 보류.
- 이력: 변경자·시간·사유와 불변 버전 열람. 과거 버전에서는 승인할 수 없음.
- 가족 미리보기: 승인된 현재 버전의 관찰 문장만 직접 눌러 열람.
- 역할 설정: 그룹 소유자가 보호자를 작성자·검토자·가족으로 지정.
- 모바일: 주 메뉴에 케어브릿지 노출. 긴 검토 화면을 세로로 스크롤하며 읽도록 개선.

내가 작성한 메모, 저장하지 않은 수정, QA 보류, 원문 확인 미완료 상태에서는 승인 버튼이 막힌다.
서버가 권한·버전·승인 여부를 다시 검사한다.
수정/재검사 후에는 가족 미리보기가 닫히며 재승인이 필요하다.
API 충돌·장애 때 현재 화면의 입력과 수정 사유를 보존한다.
초안/원문은 브라우저 영구 저장소에 저장하지 않는다.

## 수정할 때 참고할 파일

| 파일 | 역할 |
| --- | --- |
| src/CarebridgePage.tsx | 작성·전사 확인·검토·가족 미리보기·역할 설정 |
| src/carebridge-api.ts | 백엔드 호출, 타입, 상태·역할·분류 명칭 |
| src/RealApp.tsx | 로그인·그룹 문맥과 메뉴 연결 |
| src/Shell.tsx | 모바일 주 메뉴, 케어브릿지 스크롤 영역 |
| src/carebridge.css | 검토 화면·역할별 배치와 반응형 스타일 |
| tests/carebridge.test.tsx | 권한·승인 제한·충돌·마이크 해제·모바일 메뉴 기능 검사 |
| .github/workflows/checks.yml, amplify.yml | Node 22 기반 검사·테스트·빌드 |

## 백엔드 연결 기준

- 프론트 배포: https://develop.db2l4u9y804jp.amplifyapp.com/
- 백엔드 API: https://uwv0zhujxf.execute-api.ap-northeast-2.amazonaws.com
- 배포 환경변수: VITE_API_BASE_URL을 위 백엔드 주소로 지정.
- 인증: 기존 로그인 accessToken을 Authorization: Bearer 헤더로 전달.
- API 기본 경로: /groups/{groupId}/carebridge.
- AI 주소/서비스 키는 백엔드가 관리하며 프론트 변수에 넣지 않는다.

화면의 승인 상태는 note 최상위 status(review_required/hold/approved)를 사용한다.
draft.status는 AI 초안 상태이며 담당자 승인 상태와 다를 수 있다.
편집·재검사·승인·보류에는 현재 note.version을 expectedVersion으로 전달한다.
409 충돌이면 현재 내용을 유지한 채 최신 버전을 다시 확인한다.
502/503은 성공·승인으로 바꾸지 않고 오류와 재시도를 안내한다.
가족 열람은 승인된 현재 버전을 확인하는 preview API를 사용한다.

## 실행·검증

세 저장소를 같은 부모 폴더에 두고 백엔드의
[시작/중지·역할별 로컬 데모·AWS 설정 안내](https://github.com/FamilyCareCloud/fcc-backend/blob/develop/docs/CAREBRIDGE.md)를 따른다.
AI GPU 기능은 fcc-ai main의 PR #4 이후 버전이 필요하다.

로컬 프론트는 Vite의 VITE_DEV_PROXY_TARGET을 http://127.0.0.1:3002로 지정하고,
VITE_API_BASE_URL은 비우거나 /로 지정한다. 기본 프론트 주소는 http://127.0.0.1:5174다.

```text
npm ci
npm run lint
npm test
npm run build
```

GitHub PR 검사와 Amplify 빌드에 화면 동작 테스트를 포함했다.
검사 대상은 가족의 원문 API 미호출, 비식별 확인, 원문 대조/사유/저장 안 한 수정에 따른 승인 제한,
자가 승인 제한, 충돌 시 입력 보존, 마이크 해제, 모바일 메뉴·스크롤 구성이다.
실제 브라우저의 시각 점검은 도구가 URL을 확인하지 못해 중단했으며, 스크린샷 검증으로 보고하지 않는다.
실제 기기에서의 최종 시각 검수는 프론트 팀 확인이 필요하다.

## 번역 품질 상태

영어·베트남어·인도네시아어 합성 메모 36건의 AI 기준문 대조에서 의미 보존 29건,
의미 오류/모호한 한국어 5건, 생성 실패 2건을 확인했다.
별도의 의도적 오역 27건 중 사실 누락 3건을 QA가 놓쳤고, 생성된 번역의 보류 오탐도 있었다.

[AI 평가 PR #5](https://github.com/FamilyCareCloud/fcc-ai/pull/5)와
[전체 평가 보고서](https://github.com/FamilyCareCloud/fcc-ai/blob/6fb89e2/docs/TRANSLATION_EVALUATION.md)를 참고한다.
이는 작은 합성 집합의 AI 평가이며 원어민 검수나 일반 정확도 성적이 아니다.
UI의 모든 언어 선택지가 품질 검증 완료를 뜻하지 않는다.
원문·번역·QA와 검토 전 초안 표시를 유지하며 사람 검토 후 승인 흐름을 사용한다.
