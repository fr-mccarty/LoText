// Cut and Send to DayCap: the name a sent selection is saved under. DayCap (DayCapture) drops
// what it captures as files into one folder, and whatever sweeps that folder reads each file for
// what it holds, so the name only has to be new, say where it came from, and sort by time.

const pad = (number) => String(number).padStart(2, '0')

/**
 * `LoText 2026-09-28 10.45.12.md` for the first try at `date`, then `…-2.md`, `…-3.md` for the
 * next ones, when a name is already taken. Dots, not colons, between the hours, minutes and
 * seconds: Finder shows a colon in a file name as a slash.
 */
export function dayCapFileName (date, attempt = 1) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`
  return `LoText ${day} ${time}${attempt > 1 ? `-${attempt}` : ''}.md`
}
