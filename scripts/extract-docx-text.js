const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'tmp-forms');
for (const name of ['overtime', 'it-repair']) {
  const xmlPath = path.join(dir, name, 'word', 'document.xml');
  if (!fs.existsSync(xmlPath)) {
    console.log('missing', xmlPath);
    continue;
  }
  let xml = fs.readFileSync(xmlPath, 'utf8');
  let t = xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  t = t
    .replace(/[ \t]+/g, ' ')
    .replace(/\n +/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  fs.writeFileSync(path.join(dir, name + '-utf8.txt'), t, 'utf8');
  console.log('====', name, '====');
  console.log(t);
  console.log('');
}
