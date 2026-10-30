import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WorkspaceApp from '../src/workspace/WorkspaceApp';
import { gateway } from '../src/workspace/gateway';
import { getLocale, setLocale, t } from '../src/workspace/i18n';
import { stamp } from '../src/workspace/model';
import { ErrorMessage } from '../src/workspace/LanguageSelector';
import translations from '../src/workspace/locales.json';
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('../src/workspace/gateway',async()=>{
  const {MockGateway}=await import('../src/workspace/mock');
  return {gateway:new MockGateway(),isMock:true};
});
beforeEach(()=>{localStorage.clear();sessionStorage.clear();vi.stubGlobal('scrollTo',vi.fn());});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function changeLanguage(code:string){fireEvent.change(screen.getByRole('combobox',{name:t('화면 언어')}),{target:{value:code}});}
async function login(id:string){
  fireEvent.change(screen.getByLabelText(t('로그인 ID')),{target:{value:id}});
  fireEvent.click(screen.getByRole('button',{name:t('로그인 →')}));
  await screen.findByRole('navigation',{name:t('주 메뉴')});
}

it('switches all four login languages without replacing entered credentials, and restores the preference',()=>{
  const view=render(<WorkspaceApp />);
  const id=screen.getByLabelText('로그인 ID') as HTMLInputElement;
  const password=screen.getByLabelText('비밀번호') as HTMLInputElement;
  fireEvent.change(id,{target:{value:'typed@example.com'}});
  fireEvent.change(password,{target:{value:'typed-password'}});
  for(const [code,title] of [['en','Welcome back'],['vi','Chào mừng trở lại'],['id','Selamat datang kembali'],['ko','다시 만나 반가워요']]){
    changeLanguage(code);expect(screen.getByRole('heading',{name:title})).toBeTruthy();
    expect(screen.getByLabelText(t('로그인 ID'))).toBe(id);expect(id.value).toBe('typed@example.com');
    expect(screen.getByLabelText(t('비밀번호'))).toBe(password);expect(password.value).toBe('typed-password');
    expect(document.documentElement.lang).toBe(code);
  }
  changeLanguage('vi');view.unmount();render(<WorkspaceApp />);
  expect(screen.getByRole('heading',{name:'Chào mừng trở lại'})).toBeTruthy();
  expect((screen.getByRole('combobox',{name:'Ngôn ngữ giao diện'}) as HTMLSelectElement).value).toBe('vi');
});

it('preserves the author editor, writing language and navigation without reloading workspace data',async()=>{
  render(<WorkspaceApp />);await login('author');
  const source=await screen.findByLabelText('원문 메모') as HTMLTextAreaElement;
  // Deliberately use a phrase that is also a UI translation key.
  fireEvent.change(source,{target:{value:'메모 작성'}});source.setSelectionRange(1,3);
  fireEvent.change(screen.getByLabelText('작성 언어'),{target:{value:'vi'}});
  const snapshot=vi.spyOn(gateway,'snapshot'),historyState=JSON.stringify(history.state);
  for(const code of ['en','vi','id']){
    changeLanguage(code);
    expect(screen.getByLabelText(t('원문 메모'))).toBe(source);
    expect(source.value).toBe('메모 작성');expect(source.selectionStart).toBe(1);
    expect((screen.getByLabelText(t('작성 언어')) as HTMLSelectElement).value).toBe('vi');
    expect(JSON.stringify(history.state)).toBe(historyState);
  }
  expect(snapshot).not.toHaveBeenCalled();
});

it('updates an open reviewer dialog while preserving edits, reason, and current search',async()=>{
  render(<WorkspaceApp />);await login('reviewer');
  fireEvent.change(await screen.findByLabelText('메모 검색'),{target:{value:'이영희'}});
  fireEvent.click(screen.getByRole('button',{name:'내용 보기 ↗'}));
  const content=screen.getByLabelText('검토 내용') as HTMLTextAreaElement;
  fireEvent.change(content,{target:{value:'검토 완료'}});
  const reason=screen.getByLabelText('검토·보류 사유') as HTMLTextAreaElement;
  fireEvent.change(reason,{target:{value:'확인 필요'}});
  act(()=>setLocale('id'));
  expect(screen.getByRole('dialog',{name:'Tinjau catatan'})).toBeTruthy();
  expect(screen.getByLabelText('Isi tinjauan')).toBe(content);expect(content.value).toBe('검토 완료');
  expect(reason.value).toBe('확인 필요');expect((screen.getByLabelText('Cari catatan') as HTMLInputElement).value).toBe('이영희');
});

it('localizes publication dates and labels without translating shared record content or names',async()=>{
  render(<WorkspaceApp />);await login('reader');
  changeLanguage('en');
  const shared=(await gateway.snapshot(await gateway.login('reader','demo'),'reader')).publications[0];
  expect(await screen.findByText(shared.content)).toBeTruthy();
  expect(screen.getByRole('heading',{name:/김철수/})).toBeTruthy();
  expect(screen.getByText(`Recorded at ${stamp(shared.recordedAt!)}`)).toBeTruthy();
  expect(stamp('2026-10-30T00:00:00Z')).not.toContain('월');
  fireEvent.click(screen.getByRole('button',{name:'Read shared content →'}));
  expect(within(screen.getByRole('dialog')).getByText(shared.content)).toBeTruthy();
});

it('uses Korean for unsupported preferences and remains usable when storage is denied',()=>{
  localStorage.setItem('carebridge.ui-language.v1','unsupported');expect(getLocale()).toBe('ko');
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('denied');});
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('denied');});
  setLocale('en');expect(getLocale()).toBe('en');
});

it('translates known errors and labels unknown originals without translating their content',()=>{
  setLocale('vi');const view=render(<ErrorMessage message="다시 로그인해 주세요." />);
  expect(screen.getByText('Vui lòng đăng nhập lại.')).toBeTruthy();
  view.rerender(<ErrorMessage message="새로운 서버 진단 123" />);
  expect(screen.getByText(/Lỗi gốc: 새로운 서버 진단 123/)).toBeTruthy();
  expect(t('홍길동 님을 퇴출하면 기록 열람·전송 권한이 종료됩니다. 이미 제출한 메모는 유지됩니다.')).toContain('Xóa 홍길동');
});

it('includes every static translation key and preserves interpolation parameters in all supported locales',()=>{
  const dictionary:Record<string,Record<string,string>>=translations;
  const missing=new Set<string>();
  for(const name of fs.readdirSync(path.resolve('src/workspace')).filter(n=>/\.tsx?$/.test(n))){
    const source=fs.readFileSync(path.resolve('src/workspace',name),'utf8');
    const file=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    function walk(node:ts.Node){
      if(ts.isCallExpression(node)&&node.expression.getText(file)==='t'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){
        const key=node.arguments[0].text;if(!Object.hasOwn(dictionary,key))missing.add(key);
      }
      ts.forEachChild(node,walk);
    }walk(file);
  }
  expect([...missing]).toEqual([]);
  for(const [key,row] of Object.entries(dictionary))for(const language of ['en','vi','id']){
    expect(row[language]?.trim(),`${language}: ${key}`).toBeTruthy();
    expect(row[language].match(/\{\w+\}/g)?.sort() ?? [],key).toEqual(key.match(/\{\w+\}/g)?.sort() ?? []);
  }
});
