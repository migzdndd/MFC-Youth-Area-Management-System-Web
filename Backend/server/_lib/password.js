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
