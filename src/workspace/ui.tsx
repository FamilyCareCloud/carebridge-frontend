import { t, useLocale } from './i18n';
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { statusNames } from "./model";
export function Brand() {
  useLocale();
  return (
    <div className="cb-brand">
      <svg viewBox="0 0 42 40" fill="none" aria-hidden="true">
        <path
          d="M4 31h34M9 31V20m24 11V20M20.5 7v24M5 22C14 22 19 13 20.5 7 23 14 28 22 37 22M9 25h24"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
      </svg>
      <span>
        CareBridge<small>{t("케어브릿지")}</small>
      </span>
    </div>
  );
}
export function Badge({ status }: { status: string }) {
  useLocale();
  return (
    <span className={`cb-badge ${status}`}>
      {t((
        {
          ...statusNames,
          active: t("참여 중"),
          rejected: t("거절"),
          removed: t("퇴출"),
          published: t("공개 중"),
          revoked: t("열람 차단"),
          unpublished: t("공개 준비"),
          blocked: t("정정 중 · 열람 차단"),
        } as Record<string, string>
      )[status] || status)}
    </span>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="cb-empty">
      <span>▤</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Heading({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="cb-page-heading">
      <div>
        <span className="cb-eyebrow">{t(eyebrow)}</span>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="cb-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="cb-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          if (e.key === "Tab") {
            const nodes = ref.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary",
            );
            if (!nodes?.length) return;
            const first = nodes[0],
              last = nodes[nodes.length - 1];
            if (
              e.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === ref.current)
            ) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="cb-modal-title">
          <h2>{title}</h2>
          <button className="cb-icon" aria-label={t("닫기")} onClick={close}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
