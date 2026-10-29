import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WorkspaceApp from '../src/workspace/WorkspaceApp';
import { gateway } from '../src/workspace/gateway';

vi.mock('../src/workspace/gateway', async () => {
  const actual = await vi.importActual('../src/workspace/gateway');
  const { MockGateway } = await import('../src/workspace/mock');
  return { ...actual, gateway: new MockGateway(), isMock: false };
});
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.stubGlobal('scrollTo', vi.fn()); });
afterEach(() => { cleanup(); delete gateway.checkReview; delete gateway.restoreSession; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function login(id: string) {
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: id } });
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'demo' } });
  fireEvent.click(screen.getByRole('button', { name: '로그인 →' }));
  await screen.findByRole('navigation', { name: '주 메뉴' });
}
it('restores authenticated identity before showing the workspace',async()=>{
  const session=await gateway.login('author','demo');
  let resolve!:(value:typeof session)=>void;
  gateway.restoreSession=vi.fn(()=>new Promise(r=>{resolve=r;}));
  render(<WorkspaceApp />);
  expect(screen.queryByRole('navigation')).toBeNull();
  expect(screen.queryByLabelText('이메일')).toBeNull();
  const {act}=await import('@testing-library/react');
  await act(async()=>resolve(session));
  expect(await screen.findByLabelText('원문 메모')).toBeTruthy();
});
it('lets a temporary restore failure retry without exposing stale records',async()=>{
  gateway.restoreSession=vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(await gateway.login('reader','demo'));
  render(<WorkspaceApp />);
  fireEvent.click(await screen.findByRole('button',{name:'다시 확인'}));
  expect(await screen.findByRole('heading',{name:'나에게 전달된 기록'})).toBeTruthy();
});
it('public login has no admin or QA guidance and still submits the literal ID', async () => {
  const spy = vi.spyOn(gateway, 'login');
  const { container } = render(<WorkspaceApp />);
  expect(container.textContent).not.toMatch(/admin|QA|모의|테스트/i);
  expect(screen.getByLabelText('이메일').getAttribute('type')).not.toBe('email');
  await login('admin');
  expect(spy).toHaveBeenCalledWith('admin', 'demo');
});
it('returns to login with an explanation when realtime authentication is rejected', async () => {
  let disconnect!: (message?: string, status?: number) => void;
  const subscribe=gateway.subscribe.bind(gateway);
  vi.spyOn(gateway,'subscribe').mockImplementation((s,change,failed,ready)=>{
    disconnect=failed;return subscribe(s,change,failed,ready);
  });
  render(<WorkspaceApp />);await login('author');
  const { act }=await import('@testing-library/react');
  act(()=>disconnect('로그인이 종료되었습니다. 다시 로그인해 주세요.',401));
  expect(await screen.findByRole('button',{name:'로그인 →'})).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('로그인이 종료');
  expect(screen.queryByRole('navigation',{name:'주 메뉴'})).toBeNull();
});
it('ordinary users never receive a role selector in settings', async () => {
  render(<WorkspaceApp />); await login('author');
  fireEvent.click(screen.getByRole('button', { name: '설정' }));
  expect(await screen.findByText('계정 정보')).toBeTruthy();
  expect(screen.queryByLabelText('사용 역할')).toBeNull();
  expect(screen.queryByLabelText('테스트 역할')).toBeNull();
});
it('authenticated admin sees role selection only in settings without a public developer banner', async () => {
  const { container } = render(<WorkspaceApp />); await login('admin');
  expect(screen.queryByLabelText('사용 역할')).toBeNull();
  expect(container.querySelector('.cb-devbar')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '설정' }));
  const selector = await screen.findByLabelText('사용 역할');
  expect(within(selector).getAllByRole('option')).toHaveLength(3);
  expect(screen.queryByText('admin · QA 역할 예외')).toBeNull();
  fireEvent.change(selector, { target: { value: 'reader' } });
  expect(await screen.findByRole('heading', { name: '나에게 전달된 기록' })).toBeTruthy();
});
it('enables real generation after input confirmation and keeps its ID and warnings for submission', async () => {
  vi.spyOn(gateway,'generate').mockResolvedValue({text:'주스를 마셨습니다.',source:'Drank juice.',generationId:'gpu-generation',warnings:['원문을 확인해 주세요.']});
  const execute=vi.spyOn(gateway,'execute');
  render(<WorkspaceApp />);await login('author');
  await screen.findByLabelText('원문 메모');
  fireEvent.change(screen.getByLabelText('돌봄 대상'),{target:{value:'s1'}});
  fireEvent.change(screen.getByLabelText('원문 메모'),{target:{value:'Drank juice.'}});
  fireEvent.change(screen.getByLabelText('작성 언어'),{target:{value:'en'}});
  const generate=screen.getByRole('button',{name:'✧ 초안 만들기'}) as HTMLButtonElement;
  expect(generate.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox',{name:/연습용 메모/}));expect(generate.disabled).toBe(false);
  fireEvent.click(generate);
  await screen.findByLabelText('제출할 최종 초안');
  expect(screen.getByText('원문을 확인해 주세요.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'확인했어요 · 검토 요청 →'}));
  await waitFor(()=>expect(execute).toHaveBeenCalledWith(expect.anything(),'author',expect.objectContaining({type:'submit',generationId:'gpu-generation',source:'Drank juice.'})));
});
it('preserves a typed memo when actual generation fails', async()=>{
  vi.spyOn(gateway,'generate').mockRejectedValue(new Error('AI 서버에 연결하지 못했습니다.'));
  render(<WorkspaceApp />);await login('author');
  await screen.findByLabelText('원문 메모');
  fireEvent.change(screen.getByLabelText('원문 메모'),{target:{value:'원문을 보존합니다.'}});
  fireEvent.click(screen.getByRole('checkbox',{name:/연습용 메모/}));
  fireEvent.click(screen.getByRole('button',{name:'✧ 초안 만들기'}));
  await screen.findByText('AI 서버에 연결하지 못했습니다.');
  expect((screen.getByLabelText('원문 메모') as HTMLTextAreaElement).value).toBe('원문을 보존합니다.');
  expect(screen.queryByLabelText('제출할 최종 초안')).toBeNull();
});
it('requires final QA and explicit warning confirmation again after editing', async()=>{
  gateway.checkReview=vi.fn(async(_session,_role,_id,version,content)=>({version,content,status:'hold',warnings:['주스와 수프를 대조해 주세요.']}));
  render(<WorkspaceApp />);await login('reviewer');
  fireEvent.click((await screen.findAllByRole('button',{name:'내용 보기 ↗'}))[0]);
  const confirm=screen.getByRole('button',{name:'검토 완료 · 확정'}) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'최종 내용 저장 · AI 검사'}));
  await screen.findByText('주스와 수프를 대조해 주세요.');
  expect(confirm.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox',{name:'원문을 대조했습니다.'}));
  fireEvent.click(screen.getByRole('checkbox',{name:/확인사항과 경고를 확인했습니다/}));
  expect(confirm.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('검토 내용'),{target:{value:'수정 후 다시 검사할 내용'}});
  expect(confirm.disabled).toBe(true);
  expect(screen.queryByText('주스와 수프를 대조해 주세요.')).toBeNull();
});
