// Cut and Send to DayCap: the name a sent selection is saved under. DayCap (DayCapture) drops
// what it captures as files into one folder, and a sent selection joins them under DayCap's own
// naming (`DropzoneHelper.makeFilename` in ~/Documents/DayCap): the local time, ISO 8601, then
// `-daycap-` and the kind. Date first, fixed width, so an alphabetical listing is chronological
// across everything in the folder. DayCap's kinds are audio, photo and video; text is a note.

const pad = (number) => String(number).padStart(2, '0')

/**
 * `2026-09-28T10:45:12-daycap-note.md` for the first try at `date`, then `…-note-01.md`,
 * `…-note-02.md` for the next ones when a name is already taken — DayCap's
 * `DropzoneHelper.uniqueURL`. Colons, as DayCap writes them: they are legal on APFS and survive
 * iCloud, and Finder only shows them as slashes.
 */
export function dayCapFileName (date, attempt = 1) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return `${day}T${time}-daycap-note${attempt > 1 ? `-${pad(attempt - 1)}` : ''}.md`
}
