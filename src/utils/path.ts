/**
 * Removes the locale prefix from a path for proper routing
 * @param path - The current pathname
 * @returns The path without the locale prefix
 * 
 * @example
 * getPathWithoutLocale('/en/projects/') // returns 'projects/'
 * getPathWithoutLocale('/ja/') // returns ''
 * getPathWithoutLocale('/') // returns ''
 */
export function getPathWithoutLocale(path: string): string {
  return path.replace(/^\/[a-z]{2}\//, '') || '';
}
