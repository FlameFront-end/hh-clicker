import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UrlPool } from '../src/features/settings/UrlPool';
import { UrlBody } from '../src/features/main/panels/Local';
import { useApp } from '../src/store/app';
import { post, get } from '../src/lib/api';
vi.mock('../src/lib/api', () => ({ post: vi.fn(), get: vi.fn(), put: vi.fn() }));
vi.mock('../src/ui/radix', () => ({ Select: ({ children, ...props }) => <select {...props}>{children}</select> }));
const oldUrl = 'https://hh.ru/search/vacancy?text=react';
const newUrl = 'https://hh.ru/search/vacancy?text=next';
const sendCmd = vi.fn();
beforeEach(() => { vi.clearAllMocks(); useApp.setState({ connected: true, lang: 'ru', sendCmd, snapshot: { accounts: [], config: { pages_per_url: 40, url_pool: [{ url: oldUrl, pages: 20 }] } } }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('disconnected pool cannot claim to save or discard a draft', async () => {
  render(<UrlPool />);
  fireEvent.change(screen.getByPlaceholderText('https://hh.ru/search/vacancy?…'), { target: { value: newUrl } });
  await act(async () => { useApp.setState({ connected: false }); });
  fireEvent.click(screen.getByRole('button', { name: /Сохранить пул/ }));
  expect(post).not.toHaveBeenCalled(); expect(sendCmd).not.toHaveBeenCalled();
  expect(screen.queryByText(/^Сохранено/)).toBeNull();
  expect(screen.getByDisplayValue(newUrl)).toBeTruthy();
});

it('pool success waits for acknowledgement and keeps it over old socket props', async () => {
  let finish;
  post.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<UrlPool />);
  fireEvent.change(screen.getByPlaceholderText('https://hh.ru/search/vacancy?…'), { target: { value: newUrl } });
  fireEvent.click(screen.getByRole('button', { name: /Сохранить пул/ }));
  expect(screen.queryByText(/^Сохранено/)).toBeNull();
  expect(post.mock.calls[0]).toEqual(['/api/search-pool', { action: 'replace', urls: [{ url: newUrl, pages: 20 }], base_urls: [{ url: oldUrl, pages: 20 }] }]);
  await act(async () => { finish({ ok: true, urls: [{ url: newUrl, pages: 20 }] }); });
  expect(screen.getByText('Сохранено (1 URL)')).toBeTruthy();
  expect(screen.getByDisplayValue(newUrl)).toBeTruthy();
});

it('rejected or unconfirmed pool save keeps the editable draft', async () => {
  post.mockResolvedValue({ ok: false, error: 'Пул изменён в другом окне' });
  render(<UrlPool />);
  fireEvent.change(screen.getByPlaceholderText('https://hh.ru/search/vacancy?…'), { target: { value: newUrl } });
  fireEvent.click(screen.getByRole('button', { name: /Сохранить пул/ }));
  await waitFor(() => expect(screen.getByText(/Сохранение не подтверждено/)).toBeTruthy());
  expect(screen.getByDisplayValue(newUrl)).toBeTruthy();
  expect(screen.queryByText(/^Сохранено/)).toBeNull();
});

it('quick add uses an atomic single-link addition, not a read-replace of the pool', async () => {
  post.mockImplementation(async (path) => path === '/api/search-pool' ? { ok: true, added: 1 } : { ok: true, count: 1 });
  const acc = { idx: 0, name: 'A', short: 'A', resume_hash: 'r', urls: [], search_source_mode: 'selected', include_saved_searches: false };
  render(<UrlBody acc={acc} />);
  fireEvent.change(screen.getByPlaceholderText('https://hh.ru/search/vacancy?text=…'), { target: { value: newUrl } });
  fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls[0]).toEqual(['/api/search-pool', { action: 'add', urls: [{ url: newUrl, pages: 40 }] }]);
  expect(get).not.toHaveBeenCalled();
});
