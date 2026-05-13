import * as cheerio from 'cheerio';
fetch('https://ai.google.dev/gemini-api/docs/models?hl=zh-tw')
  .then(r => r.text())
  .then(t => {
    const $ = cheerio.load(t);
    $('table tr').each((i, el) => {
      console.log($(el).text().replace(/\s+/g, ' ').trim());
    });
  });
