import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TestsTab } from '../src/features/data/TestsTab';
import { useApp } from '../src/store/app';
import { post } from '../src/lib/api';
const { reload } = vi.hoisted(() => ({ reload: vi.fn() }));
vi.mock('../src/lib/api', () => ({ post: vi.fn() }));
vi.mock('../src/lib/useFetch', () => ({ useFetch: () => ({ data: [{ vacancy_id: '123', title: 'Frontend', company: 'Test', account_name: 'A', resume_hash: 'r', at: '2026-10-24T00:00:00+00:00', status: 'review', applied_by: [], url: 'https://hh.ru/vacancy/123' }], loading: false, reload }) }));
beforeEach(() => { vi.clearAllMocks(); useApp.setState({ lang: 'ru', snapshot: { accounts: [] } }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('does not release a hold when confirmation is cancelled', () => {
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<TestsTab />);
  fireEvent.click(screen.getByRole('button', { name: 'Проверил HH: отклика нет' }));
  expect(post).not.toHaveBeenCalled();
});

it('releases only the confirmed record, never starts or resumes an account', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  post.mockResolvedValue({ ok: true });
  render(<TestsTab />);
  fireEvent.click(screen.getByRole('button', { name: 'Проверил HH: отклика нет' }));
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(post).toHaveBeenCalledOnce();
  expect(post).toHaveBeenCalledWith('/api/tests/123/resolve', { account_name: 'A', resume_hash: 'r', expected_at: '2026-10-24T00:00:00+00:00', confirmed_not_sent: true });
});
