// The documents named on the command line.
//
// The Finder does not come this way — it sends `open-file` events, which is why the queue in
// `open-queue.js` exists — but a shell does, and so does anything that spawns the binary with a
// path. A cold `lotext notes.md` used to open an empty window and drop the file on the floor,
// because only `open-file` and the second-instance hand-off ever put anything in the queue.
//
// This is kept apart from the queue, and kept pure, so it can be tested without Electron.

/**
 * The arguments that are documents to open, in the order they were given.
 *
 * Everything else on the line is an argument *about* the run rather than a file to open it on:
 * a flag, a value belonging to one, and — in development — the `.` that `electron .` passes to
 * say which app to run. Rather than enumerate those, this keeps only what is actually a file on
 * disk, which is the property that matters and the one that cannot be spoofed by a name.
 *
 * `exists` is injected because the decision is pure and the file system is not.
 */
export function filesFromArgv (argv, { isPackaged, exists }) {
  // Unpackaged, argv[1] is the app directory Electron was pointed at, never a document.
  return argv
    .slice(isPackaged ? 1 : 2)
    .filter((argument) => !argument.startsWith('-') && exists(argument))
}
