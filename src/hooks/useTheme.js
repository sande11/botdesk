import { useState, useEffect } from 'react'

export const THEMES = [
  { id: 'dark',                  label: 'Dark',                   icon: '🌙' },
  { id: 'dark-medium-contrast',  label: 'Dark — Medium Contrast', icon: '🌙' },
  { id: 'dark-high-contrast',    label: 'Dark — High Contrast',   icon: '🌙' },
  { id: 'light',                 label: 'Light',                  icon: '☀️' },
  { id: 'light-medium-contrast', label: 'Light — Medium Contrast',icon: '☀️' },
  { id: 'light-high-contrast',   label: 'Light — High Contrast',  icon: '☀️' },
]

const ALL_IDS = THEMES.map((t) => t.id)

export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('bd-theme') || 'dark')

  useEffect(() => {
    const root = document.documentElement
    ALL_IDS.forEach((id) => root.classList.remove(id))
    root.classList.add(theme)
    localStorage.setItem('bd-theme', theme)
  }, [theme])

  return { theme, setTheme, themes: THEMES }
}
