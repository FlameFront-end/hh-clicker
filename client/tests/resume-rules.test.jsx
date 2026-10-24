import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Link } from 'react-router-dom';
import { ResumeRules } from '../src/features/settings/ResumeRules';
import { UrlBody, Letter } from '../src/features/main/panels/Local';
import { UnsavedGuard } from '../src/lib/unsaved';
import { useApp } from '../src/store/app';
import { patch, post } from '../src/lib/api';

vi.mock('../src/lib/api', () => ({ patch: vi.fn(), post: vi.fn(), get: vi.fn(), put: vi.fn(), apiKey: '' }));
vi.mock('../src/ui/radix', () => ({
  Select: ({ children, ...props }) => <select {...props}>{children}</select>,
  Toggle: ({ checked, disabled, onChange, label }) => <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />,
}));
const account = (extra = {}) => ({ idx: 0, name: 'Test', short: 'T', resume_hash: 'r', resume_filters: {},
  urls: ['https://hh.ru/search/vacancy?text=react'], profile_filter_keys: [], all_resumes: [{ hash: 'r', title: 'Frontend' }], ...extra });
beforeEach(() => { vi.clearAllMocks(); useApp.setState({ connected: true, lang: 'ru', snapshot: { config: { title_include_keywords: ['frontend'], title_exclude_keywords: ['junior'], url_pool: ['https://hh.ru/search/vacancy?text=react'] } } }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('safe resume filter editing', () => {
  it('saving experience alone does not clear inherited title rules', async () => {
    patch.mockResolvedValue({ ok: true, filters: { experience: ['between3And6'] } });
    render(<ResumeRules acc={account()} hash="r" />);
    fireEvent.change(screen.getByLabelText('Опыт: источник'), { target: { value: 'own' } });
    fireEvent.click(screen.getByRole('button', { name: '3–6 лет' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить правила резюме' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1].filters).toEqual({ experience: ['between3And6'] });
  });
  it('two rapid word edits remain a draft and are submitted together once', async () => {
    const acc = account({ resume_filters: { r: { title_include_keywords: ['frontend'] } } });
    patch.mockResolvedValue({ ok: true, filters: { title_include_keywords: ['frontend', 'react', 'next'] } });
    render(<ResumeRules acc={acc} hash="r" />);
    const input = screen.getByPlaceholderText('Введите слово и нажмите Enter');
    for (const word of ['react', 'next']) {
      fireEvent.change(input, { target: { value: word } }); fireEvent.keyDown(input, { key: 'Enter' });
    }
    expect(patch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить правила резюме' }));
    await waitFor(() => expect(screen.getByText(/Сохранено\. Применится/)).toBeTruthy());
    expect(patch.mock.calls[0][1].filters).toEqual({ title_include_keywords: ['frontend', 'react', 'next'] });
    expect(screen.getByText('next')).toBeTruthy(); // old WS props must not undo the acknowledgement
  });
  it('failed save keeps the draft and makes the failure explicit', async () => {
    patch.mockRejectedValue(new Error('network'));
    render(<ResumeRules acc={account()} hash="r" />);
    fireEvent.change(screen.getByLabelText('Опыт: источник'), { target: { value: 'own' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить правила резюме' }));
    await waitFor(() => expect(screen.getByText(/Сохранение не подтверждено/)).toBeTruthy());
    expect(screen.getByLabelText('Опыт: источник').value).toBe('own');
    expect(screen.getByRole('button', { name: 'Сохранить правила резюме' }).disabled).toBe(false);
  });
  it('restoring inheritance sends null, not an empty list', async () => {
    patch.mockResolvedValue({ ok: true, filters: {} });
    render(<ResumeRules acc={account({ resume_filters: { r: { title_include_keywords: ['react'] } } })} hash="r" />);
    fireEvent.change(screen.getByLabelText('Разрешить в названии: источник'), { target: { value: 'inherit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить правила резюме' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1].filters).toEqual({ title_include_keywords: null });
  });
  it('leaving a dirty page can be cancelled without losing the edit', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const router = createMemoryRouter([{ path: '/', element: <><UnsavedGuard /><ResumeRules acc={account()} hash="r" /><Link to="/other">Другая страница</Link></> }, { path: '/other', element: <p>Другая</p> }]);
    render(<RouterProvider router={router} />);
    fireEvent.change(screen.getByLabelText('Опыт: источник'), { target: { value: 'own' } });
    fireEvent.click(screen.getByText('Другая страница'));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByLabelText('Опыт: источник').value).toBe('own');
    await act(async () => { router.dispose(); });
  });
});

it('clean filter form adopts remote changes skipped while editing', () => {
  const initial = account();
  const { rerender } = render(<ResumeRules acc={initial} hash="r" />);
  fireEvent.change(screen.getByLabelText('Опыт: источник'), { target: { value: 'own' } });
  rerender(<ResumeRules acc={account({ resume_filters: { r: { experience: ['moreThan6'] } } })} hash="r" />);
  fireEvent.change(screen.getByLabelText('Опыт: источник'), { target: { value: 'inherit' } });
  expect(screen.getByLabelText('Опыт: источник').value).toBe('own');
  expect(screen.getByRole('button', { name: '6+ лет' }).getAttribute('aria-pressed')).toBe('true');
});

it('clean search form adopts remote values and stale dirty saves carry their base', async () => {
  post.mockResolvedValue({ ok: false, conflict: true, error: 'Поиски изменены в другом окне' });
  const { rerender } = render(<UrlBody acc={account({ include_saved_searches: true })} />);
  const saved = () => screen.getByRole('checkbox', { name: 'Добавлять сохранённые поиски из аккаунта HH' });
  rerender(<UrlBody acc={account({ include_saved_searches: false })} />);
  expect(saved().checked).toBe(false);
  fireEvent.click(saved());
  rerender(<UrlBody acc={account({ include_saved_searches: false, search_source_mode: 'inherit' })} />);
  fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0][1].base_settings.include_saved_searches).toBe(false);
  expect(post.mock.calls[0][1].base_settings.search_source_mode).toBe('selected');
  await waitFor(() => expect(screen.getAllByText(/Поиски изменены в другом окне/).length).toBeGreaterThan(0));
});

it('letter adopts a deferred remote change when the user reverts their draft', async () => {
  const { container, rerender } = render(<Letter acc={account({ letter: 'Original' })} />);
  const details = container.querySelector('details');
  await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')); });
  const text = () => screen.getByRole('textbox', { name: 'Сопроводительное письмо' });
  fireEvent.change(text(), { target: { value: 'Draft' } });
  rerender(<Letter acc={account({ letter: 'Remote update' })} />);
  expect(text().value).toBe('Draft');
  fireEvent.change(text(), { target: { value: 'Original' } });
  expect(text().value).toBe('Remote update');
  expect(post).not.toHaveBeenCalled();
});

it('a successful letter save is not undone by old socket props', async () => {
  post.mockResolvedValue({ ok: true });
  const { container } = render(<Letter acc={account({ letter: 'Original' })} />);
  const details = container.querySelector('details');
  await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')); });
  fireEvent.change(screen.getByRole('textbox', { name: 'Сопроводительное письмо' }), { target: { value: 'Saved new letter' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(screen.getByText('Сохранено')).toBeTruthy());
  expect(screen.getByRole('textbox', { name: 'Сопроводительное письмо' }).value).toBe('Saved new letter');
});

it('empty explicit search selection stays empty instead of using the global pool', async () => {
  post.mockResolvedValue({ ok: true, count: 0 });
  render(<UrlBody acc={account({ search_source_mode: 'selected', include_saved_searches: false })} />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'react' }));
  expect(screen.getByText(/поиск и отправка откликов этого профиля остановятся/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0][1]).toMatchObject({ urls: [], search_source_mode: 'selected', include_saved_searches: false });
});

it('letter is not silently saved when editing or closing', async () => {
  render(<Letter acc={account({ letter: 'Original' })} />);
  const details = screen.getByText('Сопроводительное письмо').closest('details');
  act(() => { details.open = true; details.dispatchEvent(new Event('toggle')); });
  await waitFor(() => expect(screen.getByLabelText('Сопроводительное письмо')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('Сопроводительное письмо'), { target: { value: 'Draft only' } });
  expect(screen.getByText('Есть несохранённые изменения')).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
});
