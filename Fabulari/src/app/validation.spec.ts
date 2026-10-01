import { ageLimitError, birthdateError, isValidEmail, today, usernameError } from './validation';

describe('form validation', () => {
  it('accepts normal emails and refuses anything without an @ and a domain', () => {
    expect(isValidEmail('user1@com.au')).toBe(true);
    expect(isValidEmail('user1')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
  });

  it('requires a username of at most 30 characters without "@"', () => {
    expect(usernameError('user1')).toBe('');
    expect(usernameError('   ')).toBe('Please enter a username.');
    expect(usernameError('x'.repeat(31))).toContain('at most 30');
    expect(usernameError('me@home')).toContain('"@"');
  });

  it('requires a real birthdate that is not in the future', () => {
    expect(birthdateError('2000-01-01')).toBe('');
    expect(birthdateError(today())).toBe('');
    expect(birthdateError('')).toBe('Please enter your date of birth.');
    expect(birthdateError('2999-01-01')).toContain('cannot be in the future');
    expect(birthdateError('1850-01-01')).toContain('after 1900');
    expect(birthdateError('banana')).toBe('Please enter a valid date.');
  });

  it('only allows whole age limits from 0 to 120', () => {
    expect(ageLimitError(0)).toBe('');
    expect(ageLimitError('18')).toBe('');
    expect(ageLimitError(120)).toBe('');
    for (const bad of [-1, 121, 13.5, '', null, 'abc']) {
      expect(ageLimitError(bad)).toBe('Age limit must be a whole number from 0 to 120.');
    }
  });
});
