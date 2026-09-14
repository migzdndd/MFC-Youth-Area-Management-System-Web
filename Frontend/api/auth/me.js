import { proxyToBackend } from '../_proxy.js';
export default function handler(req, res) {
  return proxyToBackend(req, res, '/api/auth/me');
}
