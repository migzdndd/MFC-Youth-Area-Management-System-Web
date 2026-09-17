/**
 * Basic in-memory rate limiter for serverless endpoints.
 * Tracks requests per IP using a sliding window to mitigate brute force & simple DDoS.
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 100; // Max requests per window

const ipMap = new Map();

/**
 * Checks if the request should be rate limited.
 * @param {string} ip - The client IP address
 * @param {number} limit - Max requests in window
 * @param {number} windowMs - Window size in ms
 * @returns {boolean} true if limited (too many requests), false if allowed
 */
export function isRateLimited(ip, limit = MAX_REQUESTS, windowMs = WINDOW_MS) {
  if (!ip) return false;

  const now = Date.now();
  const windowStart = now - windowMs;

  let requestStamps = ipMap.get(ip) || [];
  
  // Filter out requests outside the sliding window
  requestStamps = requestStamps.filter(timestamp => timestamp > windowStart);

  if (requestStamps.length >= limit) {
    ipMap.set(ip, requestStamps); // Update map to prevent memory leak
    return true; // Rate limited
  }

  requestStamps.push(now);
  ipMap.set(ip, requestStamps);

  // Periodically clean up map to prevent unbound memory growth in long-running processes
  if (ipMap.size > 10000) {
    const cutoff = now - windowMs;
    for (const [key, stamps] of ipMap.entries()) {
      const validStamps = stamps.filter(ts => ts > cutoff);
      if (validStamps.length === 0) {
        ipMap.delete(key);
      } else {
        ipMap.set(key, validStamps);
      }
    }
  }

  return false;
}
