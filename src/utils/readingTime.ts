/**
 * Calculates the estimated reading time for a markdown content string.
 * 
 * @param content - The markdown content string
 * @param wordsPerMinute - Average reading speed (default: 200 words per minute)
 * @returns The estimated reading time in minutes (rounded up to at least 1 minute)
 */
export function calculateReadingTime(
  content: string,
  wordsPerMinute: number = 200
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
  
  // Count words (split by whitespace and filter out empty strings)
  const words = text.split(/\s+/).filter(word => word.length > 0);
  const wordCount = words.length;
  
  // Calculate reading time (round up, minimum 1 minute)
  const minutes = Math.max(1, Math.ceil(wordCount / wordsPerMinute));
  
  return minutes;
}

