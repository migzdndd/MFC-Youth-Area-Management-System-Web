import * as cheerio from 'cheerio';
import { sendJson } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  try {
    const userDate = req.query?.date;
    let targetDate = userDate;
    
    // 1. Determine Date in Asia/Manila if not provided
    if (!targetDate) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date());
      
      const y = parts.find(p => p.type === 'year').value;
      const m = parts.find(p => p.type === 'month').value;
      const d = parts.find(p => p.type === 'day').value;
      targetDate = `${y}-${m}-${d}`;
    } else {
      // Validate date format YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        return sendJson(res, 400, { ok: false, error: 'Invalid date format. Use YYYY-MM-DD.' });
      }
    }

    // 2. Fetch EWTN with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let response;
    try {
      response = await fetch(`https://www.ewtn.com/daily-readings/${targetDate}`, {
        signal: controller.signal,
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'MFC Youth Area Management System'
        }
      });
    } catch (e) {
      clearTimeout(timeout);
      console.error(`[EWTN] Fetch failed for ${targetDate}:`, e.message);
      return sendJson(res, 502, { ok: false, error: 'Daily readings are temporarily unavailable.' });
    }
    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[EWTN] HTTP ${response.status} for ${targetDate}`);
      return sendJson(res, 502, { ok: false, error: 'Daily readings are temporarily unavailable.' });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // 3. Parse using Cheerio
    let articleBody = '';
    let celebration = '';
    
    // Look for JSON-LD which contains the pristine text payload
    const jsonLdScript = $('script[type="application/ld+json"]').filter((i, el) => {
       return $(el).html().includes('"articleBody"');
    }).first().html();

    if (jsonLdScript) {
       try {
         const data = JSON.parse(jsonLdScript);
         articleBody = data.articleBody || '';
         celebration = data.headline || '';
       } catch (e) {
         console.warn(`[EWTN] JSON-LD parse warning for ${targetDate}`);
       }
    }

    // Fallback for celebration
    if (!celebration) {
       celebration = $('h1').first().text().trim();
    }

    const readings = [];
    
    if (articleBody) {
      const lines = articleBody.split('\n').map(l => l.trim());
      
      let currentType = null;
      let currentRef = null;
      let currentText = [];
      
      const typeRegex = /^(Reading 1|First Reading|Responsorial Psalm|Psalm|Reading 2|Second Reading|Gospel)$/i;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        
        if (typeRegex.test(line)) {
          // Commit previous reading section
          if (currentType && currentRef) {
             readings.push({
               type: currentType,
               reference: currentRef,
               text: currentText.join('\n\n')
             });
          }
          currentType = line;
          currentRef = null;
          currentText = [];
        } else if (currentType) {
          if (!currentRef) {
            currentRef = line;
          } else {
            // Reconstruct text blocks logically
            if (/^\d+$/.test(line)) {
               currentText.push(`[${line}]`);
            } else {
               currentText.push(line);
            }
          }
        }
      }
      
      // Commit final reading section
      if (currentType && currentRef) {
         readings.push({
           type: currentType,
           reference: currentRef,
           text: currentText.join('\n\n')
         });
      }
    }

    if (readings.length === 0) {
      console.error(`[EWTN] Failed to parse readings for ${targetDate}`);
      return sendJson(res, 502, { ok: false, error: 'Could not parse daily readings.' });
    }

    // Determine Day Name
    let dayName = 'Today';
    try {
      const dateObj = new Date(targetDate);
      dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(dateObj);
    } catch (e) {}

    // 4. Cache Headers & Response
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    return sendJson(res, 200, {
      ok: true,
      date: targetDate,
      day: dayName,
      celebration: celebration,
      translation: 'RSV-CE',
      readings: readings,
      source: {
        name: 'EWTN',
        url: `https://www.ewtn.com/daily-readings/${targetDate}`
      }
    });

  } catch (error) {
    console.error(`[EWTN] Unexpected error:`, error);
    return sendJson(res, 500, { ok: false, error: 'The server could not complete the request.' });
  }
}
