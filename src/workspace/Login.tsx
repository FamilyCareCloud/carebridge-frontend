import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, gateway, isMock } from "./gateway";
import { demoUsers, MockGateway } from "./mock";
import { roleNames } from "./model";
import type { Role, Session } from "./model";
import { Brand, Modal } from "./ui";
export default function Login({
  onSession,
  sessionError = "",
}: {
  onSession: (s: Session) => void;
  sessionError?: string;
}) {
  const [resetScenario, setResetScenario] = useState<boolean | null>(null);
  const [signup, setSignup] = useState(false);
  const [id, setId] = useState(isMock ? "reviewer" : "");
  const [password, setPassword] = useState(isMock ? "demo" : "");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("author");
  const [error, setError] = useState(sessionError);
  const [busy, setBusy] = useState(false);
  const [verification, setVerification] = useState(false);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (verification) {
        await gateway.confirmEmail?.(id, code);
        setVerification(false);
        setSignup(false);
        setNotice("이메일 인증을 완료했습니다. 로그인해 주세요.");
        return;
      }
      onSession(
        await (signup
          ? gateway.register(name, id, password, role)
          : gateway.login(id, password)),
      );
    } catch (e) {
      if (e instanceof ApiError && (e.code === "EMAIL_NOT_VERIFIED" || e.details?.confirmationRequired)) {
        setVerification(true);
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cb-login">
      <section className="cb-login-story">
        <Brand />
        <div>
          <span className="cb-eyebrow">함께 만드는 돌봄 기록</span>
          <h1>
            관찰을 기록으로,
            <br />
            기록을 신뢰로.
          </h1>
          <p>
            작은 관찰이 빠짐없이 전달되도록.
            <br />
            작성자의 메모와 담당자의 검토를 연결합니다.
          </p>
          <div className="cb-story-steps">
            <span>01 관찰 메모</span>
            <span>02 담당자 검토</span>
            <span>03 승인 기록 공유</span>
          </div>
        </div>
        <small>사람이 확인하고 완성하는 돌봄 기록</small>
      </section>
      <section className="cb-login-form">
        <form onSubmit={submit}>
          <span className="cb-eyebrow">CAREBRIDGE WORKSPACE</span>
          <h2>{signup ? "함께 기록을 시작해요" : "다시 만나 반가워요"}</h2>
          <p>기관의 돌봄 기록을 한곳에서 확인하세요.</p>
          {notice && <p role="status" className="cb-notice">{notice}</p>}
          {isMock && (
            <div className="cb-notice">
              로컬 화면 QA · 합성 데이터만 사용합니다.
              <br />
              모의 비밀번호는 <b>demo</b>입니다. 실제 계정과 무관합니다.
            </div>
          )}
          {signup && !verification && (
            <label>
              이름
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
          )}
          <label>
            {isMock ? "로그인 ID" : "이메일"}
            <input
              autoComplete="username"
              value={id}
              onChange={(e) => setId(e.target.value)}
              required
            />
          </label>
          {verification ? <label>이메일 인증코드<input value={code} onChange={e=>setCode(e.target.value)} autoComplete="one-time-code" required /></label> : <label>
            비밀번호
            <input
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>}
          {signup && !verification && (
            <label>
              가입 역할
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                {Object.entries(roleNames).map(([r, n], i) => (
                  <option key={r} value={r}>
                    {i + 1}그룹 · {n}
                  </option>
                ))}
              </select>
              <small>가입 후 역할을 변경하거나 겸임할 수 없습니다.</small>
            </label>
          )}
          {error && (
            <p className="cb-error" role="alert">
              {error}
            </p>
          )}
          <button className="cb-primary cb-wide" disabled={busy}>
            {busy ? "확인 중…" : verification ? "이메일 인증" : signup ? "가입하기" : "로그인 →"}
          </button>
          {!isMock && <button type="button" className="cb-link cb-wide" disabled={busy || !id.includes('@')} onClick={async()=>{
            setBusy(true);setError("");
            try { await gateway.resendConfirmation?.(id);setVerification(true);setNotice("인증메일 재전송을 요청했습니다."); }
            catch(e){setError((e as Error).message);} finally {setBusy(false);}
          }}>인증코드 재전송</button>}
          <button
            type="button"
            className="cb-link cb-wide"
            onClick={() => {
              setSignup(!signup);
              setVerification(false);
              setNotice("");
              setError("");
            }}
          >
            {signup ? "이미 계정이 있어요" : "처음 오셨나요? 회원가입"}
          </button>
          {isMock && !signup && (
            <div className="cb-demo-accounts">
              <small>모의 계정 선택</small>
              {demoUsers.map((u) => (
                <button
                  type="button"
                  key={u.id}
                  className={id === u.id ? "selected" : ""}
                  onClick={() => {
                    setId(u.id);
                    setPassword("demo");
                  }}
                >
                  {u.admin
                    ? "admin · 전체 역할"
                    : `${u.name} · ${roleNames[u.role]}`}
                </button>
              ))}
            </div>
          )}
          {isMock && (
            <div className="cb-demo-accounts">
              <small>QA 시나리오 초기화 · 기존 합성 작업이 지워집니다</small>
              <button type="button" onClick={() => setResetScenario(false)}>
                기록이 있는 기관
              </button>
              <button type="button" onClick={() => setResetScenario(true)}>
                빈 기관부터 시작
              </button>
            </div>
          )}
        </form>
      </section>
      {resetScenario !== null && (
        <Modal
          title="합성 데이터를 초기화할까요?"
          close={() => setResetScenario(null)}
        >
          <p>
            이 브라우저에서 만든 모의 계정과 기록이 초기화됩니다. 실제 서버에는
            영향을 주지 않습니다.
          </p>
          <div className="cb-modal-actions">
            <button
              className="cb-secondary"
              onClick={() => setResetScenario(null)}
            >
              취소
            </button>
            <button
              className="cb-primary"
              onClick={() => {
                (gateway as MockGateway).reset(resetScenario);
                setResetScenario(null);
                setId("reviewer");
                setPassword("demo");
                setError("");
              }}
            >
              초기화
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
