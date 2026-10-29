// Display labels only: the server's audit action remains unchanged.
const labels: Record<string, string> = {
  'create-workspace': '작업 그룹 생성',
  'request-join': '참여 요청',
  approve: '참여 승인',
  reject: '참여 거절',
  'remove-member': '구성원 퇴출',
  'register-subject': '돌봄 대상 등록',
  submit: '메모 제출',
  'review-edit': '검토 내용 수정',
  'review-hold': '검토 보류',
  'review-confirm': '검토 완료',
  'check-review': '검토 내용 AI 검사',
  'prepare-publication': '공개 내용·수신자 저장',
  'correct-publication': '공개 내용·수신자 수정',
  publish: '기록 공개',
  revoke: '기록 공개 차단',
  'start-transfer': '관리 권한 이전 요청',
  'complete-transfer': '관리 권한 이전 완료',
  'cancel-transfer': '관리 권한 이전 취소',
};

export function auditLabel(action: string): string {
  return Object.hasOwn(labels, action) ? labels[action] : '기타 활동';
}
