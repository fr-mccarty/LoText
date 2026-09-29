// The folder the app is holding open, and every file operation on it.
//
// This is the native half of src/mobile/mobile-store.js: that file decides *what* to do — names,
// numbering, the rules — and this one does it, on disk, with the file coordination a folder
// another app vends (iCloud Drive, a file provider) expects. Paths arrive store-relative
// (src/shared/file-path.js) and are resolved here against the root, and nowhere else; a path
// that would leave the root is refused.
//
// Errors carry the codes the JS store turns into its own vocabulary: notFound, nameTaken,
// conflict (with the stamp the file has now), denied, folderUnavailable.

import Foundation

struct StoreFailure: Error {
    let code: String
    let message: String
    var data: [String: Any]? = nil

    static let unavailable = StoreFailure(code: "folderUnavailable", message: "The folder is unavailable.")
    static func notFound(_ path: String) -> StoreFailure {
        StoreFailure(code: "notFound", message: "“\(path)” is no longer there.")
    }
}

/** Modified time in milliseconds since the epoch, and size in bytes: a file's stamp. */
struct Stamp {
    let modified: Double
    let size: Int

    var dictionary: [String: Any] { ["modified": modified, "size": size] }

    /** Whole seconds and bytes, exactly as src/shared/file-stamp.js compares them. */
    func matches(modified other: Double, size otherSize: Int) -> Bool {
        floor(modified / 1000) == floor(other / 1000) && size == otherSize
    }
}

final class FolderStore {
    let root: URL
    private let isSecurityScoped: Bool

    init(root: URL, securityScoped: Bool) {
        self.root = root
        self.isSecurityScoped = securityScoped && root.startAccessingSecurityScopedResource()
    }

    deinit {
        if isSecurityScoped { root.stopAccessingSecurityScopedResource() }
    }

    // MARK: - Resolving

    /** The one place a store-relative path becomes a URL. */
    func resolve(_ relative: String) throws -> URL {
        var url = root
        for component in relative.split(separator: "/", omittingEmptySubsequences: true) {
            if component == ".." || component == "." { throw StoreFailure.notFound(relative) }
            url.appendPathComponent(String(component))
        }
        return url
    }

    var isAvailable: Bool {
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: root.path, isDirectory: &isDirectory) && isDirectory.boolValue
    }

    private func requireRoot() throws {
        if !isAvailable { throw StoreFailure.unavailable }
    }

    // MARK: - Listing

    /**
     * One level: name, folder or not, and whether it is a link and leaves the folder. Nothing
     * else is read, so listing a synced folder faults nothing down. A not-yet-downloaded iCloud
     * file can be listed under a `.name.icloud` placeholder; it is listed under its own name.
     */
    func list(_ relative: String) throws -> [[String: Any]] {
        try requireRoot()
        let directory = try resolve(relative)
        let names: [String]
        do {
            names = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        } catch {
            throw translate(error, relative)
        }
        let rootReal = root.resolvingSymlinksInPath().path
        var seen = Set<String>()
        var entries: [[String: Any]] = []
        for raw in names {
            var name = raw
            var placeholder = false
            if raw.hasPrefix("."), raw.hasSuffix(".icloud"), raw.count > 8 {
                name = String(raw.dropFirst().dropLast(7))
                placeholder = true
            }
            if seen.contains(name) { continue }
            seen.insert(name)
            let url = directory.appendingPathComponent(placeholder ? raw : name)
            let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            let isLink = values?.isSymbolicLink ?? false
            var isFolder = !placeholder && (values?.isDirectory ?? false)
            var leavesTheFolder = false
            if isLink {
                let target = url.resolvingSymlinksInPath()
                var targetIsDirectory: ObjCBool = false
                isFolder = FileManager.default.fileExists(atPath: target.path, isDirectory: &targetIsDirectory)
                    && targetIsDirectory.boolValue
                leavesTheFolder = !(target.path == rootReal || target.path.hasPrefix(rootReal + "/"))
            }
            entries.append(["name": name, "isFolder": isFolder, "isLink": isLink, "leavesTheFolder": leavesTheFolder])
        }
        return entries
    }

    // MARK: - Reading and writing

    func read(_ relative: String) throws -> (Data, Stamp) {
        try requireRoot()
        let url = try resolve(relative)
        var result: Result<(Data, Stamp), Error> = .failure(StoreFailure.notFound(relative))
        try coordinate { coordinator, error in
            coordinator.coordinate(readingItemAt: url, options: [], error: error) { url in
                result = Result {
                    let data = try Data(contentsOf: url)
                    return (data, try self.stamp(of: url, relative))
                }
            }
        }
        do { return try result.get() } catch { throw translate(error, relative) }
    }

    /**
     * **The only native function that writes a user's file.** The stamp is checked and the file
     * written inside one coordinated write, so nothing lands between the two. The write is in
     * place — the same file, truncated and rewritten — because a file swapped for a new one reads
     * to a sync engine as a delete and a create.
     */
    func write(_ data: Data, to relative: String, expected: (modified: Double, size: Int)?) throws -> Stamp {
        try requireRoot()
        let url = try resolve(relative)
        var result: Result<Stamp, Error> = .failure(StoreFailure.notFound(relative))
        try coordinate { coordinator, error in
            coordinator.coordinate(writingItemAt: url, options: [], error: error) { url in
                result = Result {
                    let exists = FileManager.default.fileExists(atPath: url.path)
                    if let expected {
                        guard exists else { throw StoreFailure.notFound(relative) }
                        let current = try self.stamp(of: url, relative)
                        if !current.matches(modified: expected.modified, size: expected.size) {
                            throw StoreFailure(code: "conflict", message: "The file changed on disk.", data: current.dictionary)
                        }
                    }
                    if exists {
                        let handle = try FileHandle(forWritingTo: url)
                        defer { try? handle.close() }
                        try handle.truncate(atOffset: 0)
                        try handle.write(contentsOf: data)
                        try? handle.synchronize()
                    } else {
                        try data.write(to: url)
                    }
                    return try self.stamp(of: url, relative)
                }
            }
        }
        do { return try result.get() } catch { throw translate(error, relative) }
    }

    func stamp(_ relative: String) throws -> (Stamp, Bool) {
        try requireRoot()
        let url = try resolve(relative)
        do {
            let values = try url.resourceValues(forKeys: [.isDirectoryKey])
            return (try stamp(of: url, relative), values.isDirectory ?? false)
        } catch {
            throw translate(error, relative)
        }
    }

    /** A stat each, and no contents: a dataless file is not faulted down for its date. */
    func modifiedTimes(_ paths: [String]) -> [Any] {
        paths.map { relative in
            guard let url = try? resolve(relative),
                  let date = try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
            else { return NSNull() }
            return (date.timeIntervalSince1970 * 1000).rounded()
        }
    }

    /** Whether anything is at `relative` — a broken link counts, as `lstat` counts it on the Mac. */
    func exists(_ relative: String) -> Bool {
        guard let url = try? resolve(relative) else { return false }
        return (try? FileManager.default.attributesOfItem(atPath: url.path)) != nil
    }

    // MARK: - Mutations

    /** A new file holding `data`. One already under that name is left alone, and is `nameTaken`. */
    func writeNew(_ data: Data, to relative: String) throws {
        try requireRoot()
        let url = try resolve(relative)
        try coordinatedWrite(url, relative) { url in
            try data.write(to: url, options: [.withoutOverwriting])
        }
    }

    func createFile(_ relative: String) throws {
        try requireRoot()
        let url = try resolve(relative)
        if exists(relative) { throw StoreFailure(code: "nameTaken", message: "Something called “\(url.lastPathComponent)” is already there.") }
        try coordinatedWrite(url, relative) { url in
            guard FileManager.default.createFile(atPath: url.path, contents: Data()) else {
                throw StoreFailure.unavailable
            }
        }
    }

    func createFolder(_ relative: String) throws {
        try requireRoot()
        let url = try resolve(relative)
        if exists(relative) { throw StoreFailure(code: "nameTaken", message: "Something called “\(url.lastPathComponent)” is already there.") }
        try coordinatedWrite(url, relative) { url in
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
        }
    }

    /** Renames and moves alike. Never over anything: the JS store picks a free name first. */
    func move(_ from: String, to destination: String) throws {
        try requireRoot()
        let source = try resolve(from)
        let target = try resolve(destination)
        let caseOnly = from.lowercased() == destination.lowercased()
        if !caseOnly && exists(destination) {
            throw StoreFailure(code: "nameTaken", message: "Something called “\(target.lastPathComponent)” is already there.")
        }
        var failure: Error?
        try coordinate { coordinator, error in
            coordinator.coordinate(writingItemAt: source, options: .forMoving,
                                   writingItemAt: target, options: .forReplacing, error: error) { source, target in
                do {
                    coordinator.item(at: source, willMoveTo: target)
                    try FileManager.default.moveItem(at: source, to: target)
                    coordinator.item(at: source, didMoveTo: target)
                } catch {
                    failure = error
                }
            }
        }
        if let failure { throw translate(failure, from) }
    }

    func copy(_ from: String, to destination: String) throws {
        try requireRoot()
        let source = try resolve(from)
        let target = try resolve(destination)
        var failure: Error?
        try coordinate { coordinator, error in
            coordinator.coordinate(readingItemAt: source, options: [],
                                   writingItemAt: target, options: .forReplacing, error: error) { source, target in
                do { try FileManager.default.copyItem(at: source, to: target) } catch { failure = error }
            }
        }
        if let failure { throw translate(failure, from) }
    }

    /** To Recently Deleted where the location keeps one; otherwise, gone. */
    func trash(_ relative: String) throws {
        try requireRoot()
        let url = try resolve(relative)
        try coordinatedWrite(url, relative, options: .forDeleting) { url in
            do {
                try FileManager.default.trashItem(at: url, resultingItemURL: nil)
            } catch {
                try FileManager.default.removeItem(at: url)
            }
        }
    }

    /**
     * The file, downloaded if it is not yet, for something that reads it by URL — Quick Look,
     * or the web view's player.
     */
    func materialize(_ relative: String) throws -> URL {
        try requireRoot()
        let url = try resolve(relative)
        var resolved: URL?
        try coordinate { coordinator, error in
            coordinator.coordinate(readingItemAt: url, options: [], error: error) { url in resolved = url }
        }
        guard let resolved, FileManager.default.fileExists(atPath: resolved.path) else {
            throw StoreFailure.notFound(relative)
        }
        return resolved
    }

    // MARK: - Helpers

    private func stamp(of url: URL, _ relative: String) throws -> Stamp {
        let values = try url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        guard let date = values.contentModificationDate else { throw StoreFailure.notFound(relative) }
        return Stamp(modified: (date.timeIntervalSince1970 * 1000).rounded(), size: values.fileSize ?? 0)
    }

    private func coordinate(_ body: (NSFileCoordinator, NSErrorPointer) -> Void) throws {
        let coordinator = NSFileCoordinator(filePresenter: nil)
        var error: NSError?
        body(coordinator, &error)
        if let error { throw error }
    }

    private func coordinatedWrite(_ url: URL, _ relative: String,
                                  options: NSFileCoordinator.WritingOptions = [],
                                  _ work: (URL) throws -> Void) throws {
        var failure: Error?
        try coordinate { coordinator, error in
            coordinator.coordinate(writingItemAt: url, options: options, error: error) { url in
                do { try work(url) } catch { failure = error }
            }
        }
        if let failure { throw translate(failure, relative) }
    }

    private func translate(_ error: Error, _ relative: String) -> StoreFailure {
        if let failure = error as? StoreFailure { return failure }
        let nsError = error as NSError
        if !isAvailable { return .unavailable }
        if nsError.domain == NSCocoaErrorDomain {
            switch nsError.code {
            case NSFileNoSuchFileError, NSFileReadNoSuchFileError:
                return .notFound(relative)
            case NSFileWriteFileExistsError:
                return StoreFailure(code: "nameTaken", message: "Something called “\((relative as NSString).lastPathComponent)” is already there.")
            case NSFileReadNoPermissionError, NSFileWriteNoPermissionError:
                return StoreFailure(code: "denied", message: "That cannot be read here.")
            default: break
            }
        }
        if nsError.domain == NSPOSIXErrorDomain && nsError.code == Int(ENOENT) { return .notFound(relative) }
        return StoreFailure(code: "failed", message: nsError.localizedDescription)
    }
}
