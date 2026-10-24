import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useFetch } from '../src/lib/useFetch';
import { get } from '../src/lib/api';
vi.mock('../src/lib/api', () => ({ get: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

it('polling does not abort a request slower than the polling interval', async () => {
  vi.useFakeTimers();
  let finish;
  get.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { result } = renderHook(() => useFetch('/slow', undefined, 15000));
  await act(async () => { vi.advanceTimersByTime(45000); });
  expect(get).toHaveBeenCalledTimes(1);
  expect(get.mock.calls[0][2].aborted).toBe(false);
  await act(async () => { finish(['done']); });
  expect(result.current.data).toEqual(['done']);
  await act(async () => { vi.advanceTimersByTime(15000); });
  expect(get).toHaveBeenCalledTimes(2);
});

it('manual refresh cancels only the superseded request', async () => {
  const resolvers = [];
  get.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
  const { result } = renderHook(() => useFetch('/manual'));
  await act(async () => { void result.current.reload(); });
  expect(get.mock.calls[0][2].aborted).toBe(true);
  await act(async () => { resolvers[1](['fresh']); resolvers[0](['stale']); });
  expect(result.current.data).toEqual(['fresh']);
});
