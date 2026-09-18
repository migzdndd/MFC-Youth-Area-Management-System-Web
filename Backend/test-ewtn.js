import * as cheerio from 'cheerio';

async function test() {
  const res = await fetch('https://www.ewtn.com/catholicism/daily-readings/2026-09-19');
  const html = await res.text();
  const $ = cheerio.load(html);

  const elements = [];
  $('h1, h2, h3, h4, p, span, div').each((i, el) => {
    const text = $(el).text().trim();
    if (text === 'Reading 1' || text === 'First Reading' || text === 'Responsorial Psalm' || text === 'Gospel' || text === 'Reading 2') {
       elements.push($(el).prop('tagName') + ': ' + text);
       let next = $(el).next();
       if (next.length) elements.push('Next: ' + next.text().substring(0, 100));
    }
  });
  console.log(elements);
  
  // Also dump articleBody to see if we can just use that
  const match = html.match(/<script id="json-ld".*?>(.*?)<\/script>/is);
  if (match) {
     const data = JSON.parse(match[1]);
     console.log("JSON-LD:\n" + data.articleBody.substring(0, 200));
  }
}
test();
