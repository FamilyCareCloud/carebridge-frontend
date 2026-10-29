import { getLocale, hasTranslation, languages, setLocale, t, useLocale } from './i18n';
import type { Locale } from './i18n';

export function ErrorMessage({message}:{message:string}) {
  useLocale();
  const translated=t(message);
  if(getLocale()==='ko' || translated!==message || hasTranslation(message))return <>{translated}</>;
  return <span>{t('요청을 처리하지 못했습니다. 아래 원본 오류를 확인하거나 다시 시도해 주세요.')}<br />
    <small>{t('원본 오류')}: {message}</small></span>;
}

export function LanguageSelector() {
  const locale=useLocale();
  return <label className="cb-language-picker">
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/></svg>
    <span className="cb-sr">{t('화면 언어')}</span>
    <select value={locale} onChange={e=>setLocale(e.target.value as Locale)} aria-label={t('화면 언어')}>
      {Object.entries(languages).map(([code,name])=><option key={code} value={code} lang={code}>{name}</option>)}
    </select>
  </label>;
}
