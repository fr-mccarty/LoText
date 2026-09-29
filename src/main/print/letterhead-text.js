// The `{{…}}` tokens a letterhead slot may contain. Unknown tokens are left exactly as typed,
// so a stray brace prints rather than disappearing.
//
// The date and time are captured once when the job begins, so every page of a long document
// carries the same timestamp rather than the moment each page was drawn.

export function resolveLetterhead (template, context, page, pages) {
  if (!template.includes('{{')) return template
  const values = {
    '{{file}}': context.fileName ?? '',
    '{{folder}}': context.folderName ?? '',
    '{{page}}': String(page),
    '{{pages}}': String(pages),
    '{{date}}': context.date ?? '',
    '{{time}}': context.time ?? '',
  }
  let text = template
  for (const [token, value] of Object.entries(values)) {
    text = text.split(token).join(value)
  }
  return text
}
