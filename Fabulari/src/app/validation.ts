// Form checks shared by the pages. The server makes the same checks again (server/index.js),
// so these only exist to give the user a clear message before anything is sent.

// Longest allowed text for each kind of field. These match the server's limits.
export const LIMITS = {
  email: 254,
  username: 30,
  password: 100,
  name: 50,
  description: 500,
  reason: 500,
  message: 2000,
};

// Today's date as "YYYY-MM-DD", the latest birthdate a date picker should offer.
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// A simple email shape check: no spaces, one @, and a dot in the part after it.
export function isValidEmail(email: string): boolean {
  return email.length <= LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Why a username can't be used, or '' if it is fine. Usernames can't contain "@" because
// logging in treats anything with an "@" as an email.
export function usernameError(username: string): string {
  const name = username.trim();
  if (!name) return 'Please enter a username.';
  if (name.length > LIMITS.username)
    return `Usernames can be at most ${LIMITS.username} characters.`;
  if (name.includes('@')) return 'Usernames cannot contain "@".';
  return '';
}

// Why a birthdate can't be used, or '' if it is fine.
export function birthdateError(birthdate: string): string {
  if (!birthdate) return 'Please enter your date of birth.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || Number.isNaN(Date.parse(birthdate)))
    return 'Please enter a valid date.';
  if (birthdate > today()) return 'Your date of birth cannot be in the future.';
  if (birthdate < '1900-01-01') return 'Please enter a date of birth after 1900.';
  return '';
}

// Why an age limit can't be used, or '' if it is a whole number from 0 to 120.
export function ageLimitError(value: unknown): string {
  const limit = Number(value);
  return value === '' || value === null || !Number.isInteger(limit) || limit < 0 || limit > 120
    ? 'Age limit must be a whole number from 0 to 120.'
    : '';
}
