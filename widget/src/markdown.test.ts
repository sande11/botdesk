import { describe, expect, it } from 'vitest'
import { escapeHtml, renderMarkdown } from './markdown.ts'

describe('renderMarkdown', () => {
  it('escapes HTML before formatting', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> **bold**')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
    expect(html).toContain('<strong>bold</strong>')
  })

  it('only allows http(s) links, opened safely', () => {
    expect(renderMarkdown('[ok](https://a.com)')).toContain('href="https://a.com" target="_blank" rel="noopener noreferrer nofollow"')
    expect(renderMarkdown('[bad](javascript:alert(1))')).not.toContain('href')
  })

  it('turns valid citation markers into buttons', () => {
    const html = renderMarkdown('You get notice [1]. Also [3].', 2)
    expect(html).toContain('data-cite="1"')
    expect(html).not.toContain('data-cite="3"')
    expect(html).toContain('[3]')
  })

  it('renders lists and paragraphs', () => {
    const html = renderMarkdown('Intro\n\n- one\n- two\n\n1. first')
    expect(html).toBe('<p>Intro</p><ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>')
  })

  it('escapeHtml covers quotes', () => {
    expect(escapeHtml(`"'<>&`)).toBe('&quot;&#39;&lt;&gt;&amp;')
  })
})
