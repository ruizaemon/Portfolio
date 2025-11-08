/**
 * Calculates the estimated reading time for a markdown content string.
 * Supports both English (word-based) and Japanese (character-based) calculations.
 * 
 * @param content - The markdown content string
 * @param lang - Language code ('en' or 'ja') to determine calculation method
 * @param wordsPerMinute - Average reading speed for English (default: 200 words per minute)
 * @param charsPerMinute - Average reading speed for Japanese (default: 500 characters per minute)
 * @returns The estimated reading time in minutes (rounded up to at least 1 minute)
 */
export function calculateReadingTime(
  content: string,
  lang: 'en' | 'ja' = 'en',
  wordsPerMinute: number = 200,
  charsPerMinute: number = 500
): number {
  // Remove frontmatter (content between --- markers)
  let text = content.replace(/^---[\s\S]*?---\n/, '');
  
  // Remove markdown syntax:
  // - Headers (# ## ###)
  // - Links [text](url) -> text
  // - Images ![alt](url) -> alt
  // - Bold/italic **text** or *text* -> text
  // - Code blocks ```code``` -> removed
  // - Inline code `code` -> code
  // - Lists (-, *, +, 1.)
  // - Blockquotes (>)
  // - Horizontal rules (---, ***)
  // - HTML tags
  text = text
    .replace(/^#{1,6}\s+/gm, '') // Headers
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Links
    .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '$1') // Images
    .replace(/\*\*([^\*]+)\*\*/g, '$1') // Bold
    .replace(/\*([^\*]+)\*/g, '$1') // Italic
    .replace(/`([^`]+)`/g, '$1') // Inline code
    .replace(/```[\s\S]*?```/g, '') // Code blocks
    .replace(/^[-*+]\s+/gm, '') // Unordered list items
    .replace(/^\d+\.\s+/gm, '') // Ordered list items
    .replace(/^>\s+/gm, '') // Blockquotes
    .replace(/^[-*]{3,}$/gm, '') // Horizontal rules
    .replace(/<[^>]+>/g, '') // HTML tags
    .trim();
  
  let minutes: number;
  
  if (lang === 'ja') {
    // For Japanese, count characters (including CJK characters, hiragana, katakana, kanji)
    // Remove whitespace for character count as it's not meaningful in Japanese
    const charCount = text.replace(/\s+/g, '').length;
    minutes = Math.max(1, Math.ceil(charCount / charsPerMinute));
  } else {
    // For English and other languages, count words (split by whitespace)
    const words = text.split(/\s+/).filter(word => word.length > 0);
    const wordCount = words.length;
    minutes = Math.max(1, Math.ceil(wordCount / wordsPerMinute));
  }
  
  return minutes;
}

