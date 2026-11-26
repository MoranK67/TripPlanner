import { act, renderHook } from '@testing-library/react';
import { IMPORT_TYPE_STORAGE_KEY, readImportType, useImportType } from './useImportType';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useImportType (FEAT-3)', () => {
  it('defaults to tags and remembers the choice on this device', () => {
    const { result } = renderHook(() => useImportType());
    expect(result.current[0]).toBe('tags');
    act(() => result.current[1]('placement'));
    expect(result.current[0]).toBe('placement');
    expect(localStorage.getItem(IMPORT_TYPE_STORAGE_KEY)).toBe('placement');
    expect(renderHook(() => useImportType()).result.current[0]).toBe('placement');
  });

  it('ignores an unknown stored value', () => {
    localStorage.setItem(IMPORT_TYPE_STORAGE_KEY, 'everything');
    expect(readImportType()).toBe('tags');
  });

  it('works when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useImportType());
    expect(result.current[0]).toBe('tags');
    act(() => result.current[1]('basic'));
    expect(result.current[0]).toBe('basic');
  });
});
