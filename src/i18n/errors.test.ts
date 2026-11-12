import i18n from 'i18next';
import { APP_ERROR_KINDS, AppError } from '@/data';
import he from './he.json';
import { errorMessage, isAbortedError } from './errors';

const t = i18n.t.bind(i18n);

describe('errorMessage', () => {
  it.each(APP_ERROR_KINDS)('has a Hebrew message for kind %s', (kind) => {
    const message = errorMessage(new AppError(kind), t);
    expect(message).toBe(he.errors.kinds[kind]);
    expect(message).toMatch(/[א-ת]/);
  });

  it('prefers a reason-specific message', () => {
    expect(
      errorMessage(new AppError('invalid_credentials', { reason: 'email_not_confirmed' }), t),
    ).toBe(he.errors.reasons.email_not_confirmed);
    expect(
      errorMessage(new AppError('rate_limited', { reason: 'over_email_send_rate_limit' }), t),
    ).toBe(he.errors.reasons.over_email_send_rate_limit);
  });

  it('does not reveal whether an account exists (user_not_found = wrong credentials)', () => {
    expect(errorMessage(new AppError('invalid_credentials', { reason: 'user_not_found' }), t)).toBe(
      he.errors.kinds.invalid_credentials,
    );
  });

  it('never shows raw text from unknown errors', () => {
    expect(errorMessage(new Error('duplicate key value violates…'), t)).toBe(
      he.errors.kinds.unknown,
    );
    expect(errorMessage('boom', t)).toBe(he.errors.kinds.unknown);
  });
});

describe('isAbortedError', () => {
  it('recognizes cancelled requests only', () => {
    expect(isAbortedError(new AppError('network', { reason: 'aborted' }))).toBe(true);
    expect(isAbortedError(new AppError('network', { retryable: true }))).toBe(false);
    expect(isAbortedError(new Error('aborted'))).toBe(false);
  });
});
