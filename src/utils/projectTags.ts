/**
 * Colors for project tag chips. Each tag gets a pair: `dark` is used on the
 * dark theme (lighter, more saturated so it pops on #1C1C22), `light` is a
 * darker variant that keeps contrast on the light background.
 *
 * Tags without an entry fall back to the muted gray chip.
 */
export interface TagColor {
  dark: string;
  light: string;
}

export const PROJECT_TAG_COLORS: Record<string, TagColor> = {
  // Roles / concepts
  'Full-stack': { dark: '#00FF99', light: '#0e9f74' },
  'PWA': { dark: '#b794f6', light: '#7c3aed' },
  'Offline-first': { dark: '#ffb454', light: '#c26a00' },

  // Frontend
  'Vue 3': { dark: '#42d392', light: '#2c7a5d' },
  'Quasar': { dark: '#4fc3f7', light: '#0277bd' },
  'TypeScript': { dark: '#6cb0f5', light: '#2f6cb0' },
  'Tailwind': { dark: '#38bdf8', light: '#0284c7' },

  // Backend / infra
  'FastAPI': { dark: '#2dd4bf', light: '#0f766e' },
  'Python': { dark: '#ffd766', light: '#946f00' },
  'PostgreSQL': { dark: '#85b4dd', light: '#336791' },
  'Docker': { dark: '#58a6ff', light: '#1d63ad' },
  'CI/CD': { dark: '#f369ae', light: '#db2777' },
};

export const FALLBACK_TAG_COLOR: TagColor = {
  dark: 'rgba(255, 255, 255, 0.7)',
  light: 'rgba(26, 26, 26, 0.6)',
};

export function tagColor(tag: string): TagColor {
  return PROJECT_TAG_COLORS[tag] ?? FALLBACK_TAG_COLOR;
}
