import { useEffect, useSyncExternalStore } from 'react';
import messages from './locales.json';

export const languages = { ko: '한국어', en: 'English', vi: 'Tiếng Việt', id: 'Bahasa Indonesia' } as const;
export type Locale = keyof typeof languages;
const preferenceKey = 'carebridge.ui-language.v1';
const changedEvent = 'carebridge-language-change';
let memoryLocale: Locale = 'ko';
const validLocale = (value: unknown): value is Locale => typeof value==='string' && Object.hasOwn(languages,value);
export function getLocale(): Locale {
  try { const saved=localStorage.getItem(preferenceKey);return validLocale(saved)?saved:'ko'; }
  catch { return memoryLocale; }
}
export function setLocale(locale: Locale) {
  if(!validLocale(locale))return;
  memoryLocale=locale;
  try { localStorage.setItem(preferenceKey,locale); } catch { /* Private browsing may deny storage. */ }
  window.dispatchEvent(new Event(changedEvent));
}
function subscribe(notify:()=>void) {
  const storage=(event:StorageEvent)=>{if(event.key===preferenceKey || event.key===null)notify();};
  window.addEventListener(changedEvent,notify);window.addEventListener('storage',storage);
  return ()=>{window.removeEventListener(changedEvent,notify);window.removeEventListener('storage',storage);};
}
export function useLocale() {
  const locale=useSyncExternalStore(subscribe,getLocale,()=> 'ko' as Locale);
  useEffect(()=>{document.documentElement.lang=locale;document.title=locale==='ko'?'CareBridge · 케어브릿지':'CareBridge';},[locale]);
  return locale;
}
const dictionary: Record<string, {en:string;vi:string;id:string}> = messages;
const templates=Object.keys(dictionary).filter(key=>key.includes('{')).map(key=>{
  const names:string[]=[];
  const pattern=key.split(/(\{\w+\})/).map(part=>{
    if(/^\{\w+\}$/.test(part)){names.push(part.slice(1,-1));return '([\\s\\S]*?)';}
    return part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  }).join('');
  return {key,names,pattern:new RegExp('^'+pattern+'$')};
});
export function t(key:string, values:Record<string,string|number>={}):string {
  const locale=getLocale();
  if(!Object.hasOwn(dictionary,key)){
    for(const template of templates){
      const match=template.pattern.exec(key);
      if(match)return t(template.key,Object.fromEntries(template.names.map((name,i)=>[name,match[i+1]])));
    }
  }
  const text=locale==='ko'?key:dictionary[key]?.[locale] ?? key;
  return text.replace(/\{(\w+)\}/g,(match,name)=>values[name]===undefined?match:String(values[name]));
}
export const hasTranslation=(key:string)=>Object.hasOwn(dictionary,key);
