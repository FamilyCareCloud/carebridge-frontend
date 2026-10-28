import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WorkspaceApp from '../src/workspace/WorkspaceApp';
import { gateway } from '../src/workspace/gateway';

vi.mock('../src/workspace/gateway', async () => {
  const actual = await vi.importActual('../src/workspace/gateway');
  const { MockGateway } = await import('../src/workspace/mock');
  return { ...actual, gateway: new MockGateway(), isMock: false };
});
beforeEach(() => { localStorage.clear(); vi.stubGlobal('scrollTo', vi.fn()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function login(id: string) {
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: id } });
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'demo' } });
  fireEvent.click(screen.getByRole('button', { name: '로그인 →' }));
  await screen.findByRole('navigation', { name: '주 메뉴' });
}
it('public login has no admin or QA guidance and still submits the literal ID', async () => {
  const spy = vi.spyOn(gateway, 'login');
  const { container } = render(<WorkspaceApp />);
  expect(container.textContent).not.toMatch(/admin|QA|모의|테스트/i);
  expect(screen.getByLabelText('이메일').getAttribute('type')).not.toBe('email');
  await login('admin');
  expect(spy).toHaveBeenCalledWith('admin', 'demo');
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
