// @vitest-environment jsdom
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const root = resolve('landing')
const html = readFileSync(resolve(root, 'index.html'), 'utf8')

describe('public landing page', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = html
  })

  it('keeps the warm-up explanation available without JavaScript', () => {
    expect(document.querySelector('.answer-options')?.hasAttribute('hidden')).toBe(true)
    expect(document.querySelector('#puzzle-solution')?.textContent).toContain('21')
    expect(document.querySelector('#puzzle-solution')?.textContent).toContain('previous two')
  })

  it('lets a visitor try again and explains the correct number', () => {
    // Execute only our fixed, repository-owned UI script in the test DOM.
    new Function(readFileSync(resolve(root, 'app.js'), 'utf8'))()
    expect(document.querySelector('.answer-options')?.hasAttribute('hidden')).toBe(false)
    document.querySelector<HTMLButtonElement>('[data-answer="18"]')!.click()
    expect(document.querySelector('#puzzle-feedback')?.textContent).toContain('Try again')
    document.querySelector<HTMLButtonElement>('[data-answer="21"]')!.click()
    expect(document.querySelector('#puzzle-feedback')?.textContent).toContain('8 + 13 = 21')
    expect(document.querySelector('[data-answer="21"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1)
    document.querySelector<HTMLButtonElement>('[data-answer="26"]')!.click()
    expect(document.querySelector('#puzzle-feedback')?.textContent).toContain('Try again')
    expect(document.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1)
  })

  it('ships local assets and valid section links without linking nonexistent source repositories', () => {
    for (const element of document.querySelectorAll('[src], [href]')) {
      const path = element.getAttribute('src') ?? element.getAttribute('href')!
      if (path.startsWith('#')) expect(document.querySelector(path)).not.toBeNull()
      if (path.startsWith('./') && path !== './') expect(existsSync(resolve(root, path))).toBe(true)
      expect(path).not.toContain('github.com/wondping0/ayas-playground')
    }
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://wondping0.github.io/ayas-playground/')
  })
})
