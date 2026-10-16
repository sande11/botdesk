import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import { strToU8, zipSync } from 'fflate'
import {
  csvToText,
  detectKind,
  extractDocx,
  extractHtml,
  extractPdfPages,
  parseCsv,
  pdfItemsToText,
  sitemapUrls,
  stripRepeatedLines,
} from './extract.ts'
import { assertPublicUrl, isPrivateIp } from './fetch.ts'

Deno.test('detects document kinds from type or name', () => {
  assertEquals(detectKind('application/pdf'), 'pdf')
  assertEquals(detectKind('', 'Act.DOCX'), 'docx')
  assertEquals(detectKind('text/html; charset=utf-8'), 'html')
  assertEquals(detectKind('application/octet-stream', 'faq.csv'), 'csv')
  assertEquals(detectKind('image/png', 'x.png'), null)
})

Deno.test('HTML: keeps main content and headings, drops chrome', () => {
  const html = `<html><head><title>Returns | Shop</title><script>var x</script></head><body>
    <nav><a href="/a">Menu</a></nav>
    <main><h1>Returns</h1><p>You can return items within <b>30 days</b>.</p>
      <ul><li>Unused</li><li>With receipt</li></ul>
      <table><tr><th>Item</th><th>Days</th></tr><tr><td>Shoes</td><td>14</td></tr></table>
      <a href="/policy#x">Policy</a></main>
    <footer>© 2026</footer></body></html>`
  const r = extractHtml(html, 'https://shop.example/returns')
  assertEquals(r.title, 'Returns | Shop')
  assert(r.text.startsWith('# Returns'))
  assert(r.text.includes('You can return items within 30 days.'))
  assert(r.text.includes('- Unused'))
  assert(r.text.includes('| Shoes | 14 |'))
  assert(!r.text.includes('Menu'))
  assert(!r.text.includes('2026'))
  assert(r.links.includes('https://shop.example/policy'))
})

Deno.test('sitemaps and sitemap indexes', () => {
  const s = sitemapUrls('<urlset><url><loc> https://a.com/x?a=1&amp;b=2 </loc></url><url><loc>https://a.com/y</loc></url></urlset>')
  assertEquals(s.pages, ['https://a.com/x?a=1&b=2', 'https://a.com/y'])
  assertEquals(sitemapUrls('<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>').sitemaps, [
    'https://a.com/s1.xml',
  ])
})

Deno.test('DOCX: paragraphs, headings, lists and tables', () => {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Leave policy</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Staff get </w:t></w:r><w:r><w:t>21 days &amp; holidays.</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Ask early</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Role</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Days</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`
  const bytes = zipSync({ 'word/document.xml': strToU8(xml), '[Content_Types].xml': strToU8('<Types/>') })
  const text = extractDocx(bytes)
  assert(text.startsWith('# Leave policy'))
  assert(text.includes('Staff get 21 days & holidays.'))
  assert(text.includes('- Ask early'))
  assert(text.includes('| Role | Days |'))
  assertThrows(() => extractDocx(new Uint8Array([1, 2, 3])))
})

Deno.test('CSV: quoted cells, FAQ columns become Q&A blocks', () => {
  assertEquals(parseCsv('a,"b, c","say ""hi"""\n1,2,3'), [['a', 'b, c', 'say "hi"'], ['1', '2', '3']])
  const faq = csvToText('Question,Answer\n"Do you ship?","Yes, in 3 days."\nReturns?,30 days')
  assertEquals(faq, '## Do you ship?\n\nYes, in 3 days.\n\n## Returns?\n\n30 days')
  assertEquals(csvToText('name;price\nTea;2'), 'name: Tea\nprice: 2')
})

Deno.test('PDF: text items become lines; repeated headers are removed', () => {
  const t = pdfItemsToText([
    { str: 'Hello', transform: [0, 0, 0, 0, 0, 700] },
    { str: ' world', transform: [0, 0, 0, 0, 40, 700] },
    { str: 'Next line', transform: [0, 0, 0, 0, 0, 680] },
  ])
  assertEquals(t, 'Hello world\nNext line')
  const pages = ['LAWS OF MALAWI\nSection 1 text\nPage 1', 'LAWS OF MALAWI\nSection 2 text\nPage 2', 'LAWS OF MALAWI\nSection 3\nPage 3', 'LAWS OF MALAWI\nSection 4\nPage 4']
  const cleaned = stripRepeatedLines(pages)
  assertEquals(cleaned[0], 'Section 1 text')
})

Deno.test('PDF: a real file is read page by page', async () => {
  // Minimal one-page PDF with the text "Notice is required".
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 52>>stream
BT /F1 18 Tf 20 100 Td (Notice is required) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`
  const r = await extractPdfPages(new TextEncoder().encode(pdf), 0, 10)
  assertEquals(r.totalPages, 1)
  assert(r.pages[0].includes('Notice is required'))
  await assertRejects(() => extractPdfPages(new TextEncoder().encode('not a pdf'), 0, 1))
})

Deno.test('private and internal addresses are refused', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
    assert(isPrivateIp(ip), ip)
  }
  assert(!isPrivateIp('8.8.8.8'))
  for (const u of ['http://localhost:54321', 'http://169.254.169.254/latest', 'file:///etc/passwd', 'http://a:b@example.com', 'http://db.internal/']) {
    await assertRejects(() => assertPublicUrl(u), Error, undefined, u)
  }
})
