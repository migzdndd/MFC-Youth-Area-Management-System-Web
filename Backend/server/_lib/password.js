import crypto from 'node:crypto';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const ALL = LETTERS + DIGITS;

function pick(chars) {
  return chars[crypto.randomInt(0, chars.length)];
}

export function generateTemporaryPassword(length = 12) {
  const target = Math.max(10, Math.min(Number(length) || 12, 32));
  const chars = ['M', pick(LETTERS), pick(DIGITS)];
  while (chars.length < target) chars.push(pick(ALL));

  // Shuffle everything except the M prefix to keep the recognizable prototype format.
  for (let i = chars.length - 1; i > 1; i -= 1) {
    const j = crypto.randomInt(1, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}


export function validateStrongPassword(password) {
  const value = String(password || '');
  if (value.length < 12) return 'Password must be at least 12 characters long.';
  if (value.length > 128) return 'Password must be 128 characters or fewer.';
  if (!/[a-z]/.test(value)) return 'Password must contain at least one lowercase letter.';
  if (!/[A-Z]/.test(value)) return 'Password must contain at least one uppercase letter.';
  if (!/\d/.test(value)) return 'Password must contain at least one number.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Password must contain at least one symbol.';
  return '';
}
