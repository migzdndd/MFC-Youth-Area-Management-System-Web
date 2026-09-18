import { sendJson } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    const response = await fetch('https://www.ewtn.com/catholicism/daily-readings');
    
    if (!response.ok) {
      throw new Error(`Failed to fetch from EWTN: ${response.status} ${response.statusText}`);
    }
    
    const html = await response.text();
    
    // Extract the JSON-LD script tag from the HTML
    const match = html.match(/<script\s+id="json-ld"\s+type="application\/ld\+json">(.*?)<\/script>/is);
    
    if (!match) {
      throw new Error('Could not find daily readings payload (JSON-LD) on EWTN page.');
    }
    
    const data = JSON.parse(match[1]);
    
    // Fallback if data is unexpectedly empty
    const title = data?.headline || "Today's Daily Readings";
    const body = data?.articleBody || "Reading data is currently unavailable.";
    
    return sendJson(res, 200, { ok: true, title, body });
  } catch (error) {
    console.error('Daily Readings Fetch Error:', error);
    return sendJson(res, 500, { ok: false, error: 'Failed to retrieve daily readings.', details: error.message });
  }
}
