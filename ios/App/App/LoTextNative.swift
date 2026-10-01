// LoTextNative — the one plugin, and everything the iOS app asks of the platform.
//
// The JS side is src/mobile/native.js; its callers are src/mobile/bridge.js, mobile-store.js,
// prefs.js, recovery.js, printing.js and ui.js. The methods, by what they are for:
//
//   the folder     pickFolder  openFolder  forgetFolder  folderAvailable
//   its files      list  read  write  stat  modifiedTimes  exists  createFile  createFolder
//                  move  copy  trash  fileURL                       (FolderStore.swift)
//   app data       readData  writeData  removeData      — Application Support, never the folder
//   DayCap         dayCapFolder  pickDayCapFolder  writeToDayCap — Cut and Send to DayCap's folder
//   iCloud         cloudAvailable  cloudList  cloudRead  cloudWrite    (LoTextNative+Cloud.swift)
//   servers        sshPublicKey  sshRun  sshClose                       (LoTextNative+SSH.swift)
//   the screen     alert  menu  exportFile  importFile  quickLook  print  (LoTextNative+UI.swift)
//   events         appState { active }                  — background is the Mac's focus loss
//
// A folder is remembered as a bookmark under an id the JS side keeps in its recent list, so it
// reopens after a relaunch without being picked again. The id `app` is the app's own Documents
// directory, which the Files app shows as On My iPhone ▸ LoText.

import Foundation
import Capacitor
import UIKit

@objc(LoTextNativePlugin)
public class LoTextNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LoTextNativePlugin"
    public let jsName = "LoTextNative"
    public let pluginMethods: [CAPPluginMethod] = [
        "pickFolder", "openFolder", "forgetFolder", "folderAvailable",
        "list", "read", "write", "stat", "modifiedTimes", "exists",
        "createFile", "createFolder", "move", "copy", "trash", "fileURL",
        "readData", "writeData", "removeData",
        "dayCapFolder", "pickDayCapFolder", "writeToDayCap",
        "cloudAvailable", "cloudList", "cloudRead", "cloudWrite",
        "sshPublicKey", "sshRun", "sshClose",
        "alert", "menu", "exportFile", "importFile", "quickLook", "print",
        "answer",
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    static let appFolderID = "app"
    private static let bookmarksKey = "folderBookmarks"

    private let lock = NSLock()
    private var currentStore: FolderStore?
    /** Held while a picker or a sheet is on screen: UIKit keeps its delegate weakly. */
    var presentedHelper: AnyObject?
    /** Debug builds: how the harness answers the alert or sheet on screen. */
    var debugAnswer: ((Int) -> Void)?
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    var store: FolderStore? {
        get { lock.lock(); defer { lock.unlock() }; return currentStore }
        set { lock.lock(); currentStore = newValue; lock.unlock() }
    }

    public override func load() {
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(willResignActive), name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    // MARK: - Coming and going

    /**
     * The JS side saves the open file as the app goes, and a save is a round trip through here —
     * so the app asks for a few seconds more before iOS suspends it.
     */
    @objc private func willResignActive() {
        if backgroundTask == .invalid {
            backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Save") { [weak self] in
                self?.endBackgroundTask()
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.endBackgroundTask() }
        }
        notifyListeners("appState", data: ["active": false])
    }

    @objc private func didBecomeActive() {
        endBackgroundTask()
        notifyListeners("appState", data: ["active": true])
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    // MARK: - The folder

    @objc func pickFolder(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.presentFolderPicker { url in
                guard let url else { call.resolve([:]); return }
                do {
                    let id = try self.remember(url)
                    call.resolve(try self.open(id: id))
                } catch {
                    self.reject(call, error)
                }
            }
        }
    }

    @objc func openFolder(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("No folder was named.", "failed"); return }
        do {
            call.resolve(try open(id: id))
        } catch {
            reject(call, error)
        }
    }

    @objc func forgetFolder(_ call: CAPPluginCall) {
        if let id = call.getString("id") {
            var bookmarks = storedBookmarks()
            bookmarks.removeValue(forKey: id)
            UserDefaults.standard.set(bookmarks, forKey: Self.bookmarksKey)
        }
        call.resolve()
    }

    @objc func folderAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": store?.isAvailable ?? false])
    }

    /** Opens the folder under `id` and makes it the one every file operation resolves against. */
    private func open(id: String) throws -> [String: Any] {
        let url: URL
        let name: String
        var scoped = false
        if id == Self.appFolderID {
            url = try Self.appFolder()
            name = "LoText"
        } else {
            guard let bookmark = storedBookmarks()[id] else {
                throw StoreFailure(code: "notFound", message: "That folder is no longer known to LoText. Choose it again.")
            }
            var stale = false
            do {
                url = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
            } catch {
                throw StoreFailure(code: "folderUnavailable", message: "The folder could not be found. It may have moved, or its location may be offline.")
            }
            scoped = true
            if stale, url.startAccessingSecurityScopedResource() {
                defer { url.stopAccessingSecurityScopedResource() }
                if let fresh = try? url.bookmarkData() {
                    var bookmarks = storedBookmarks()
                    bookmarks[id] = fresh
                    UserDefaults.standard.set(bookmarks, forKey: Self.bookmarksKey)
                }
            }
            name = url.lastPathComponent
        }
        let folder = FolderStore(root: url, securityScoped: scoped)
        store = folder
        return [
            "id": id,
            "name": name,
            "detail": id == Self.appFolderID ? "" : url.deletingLastPathComponent().lastPathComponent,
            // Only for filing reading positions: a folder in iCloud Drive is under `Mobile
            // Documents` here and on the Mac, so both name its files the same way.
            "path": url.path,
            "available": folder.isAvailable,
        ]
    }

    /** A picked folder, remembered — under the id it already had, if it was picked before. */
    private func remember(_ url: URL) throws -> String {
        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }
        let bookmark = try url.bookmarkData()
        var bookmarks = storedBookmarks()
        for (id, data) in bookmarks {
            var stale = false
            if let known = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale),
               known.standardizedFileURL.path == url.standardizedFileURL.path {
                bookmarks[id] = bookmark
                UserDefaults.standard.set(bookmarks, forKey: Self.bookmarksKey)
                return id
            }
        }
        let id = UUID().uuidString
        bookmarks[id] = bookmark
        UserDefaults.standard.set(bookmarks, forKey: Self.bookmarksKey)
        return id
    }

    private func storedBookmarks() -> [String: Data] {
        UserDefaults.standard.dictionary(forKey: Self.bookmarksKey) as? [String: Data] ?? [:]
    }

    static func appFolder() throws -> URL {
        let url = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return url
    }

    // MARK: - Its files

    private func withStore(_ call: CAPPluginCall, _ work: (FolderStore) throws -> Void) {
        guard let store else {
            call.reject("No folder is open.", "folderUnavailable")
            return
        }
        do { try work(store) } catch { reject(call, error) }
    }

    @objc func list(_ call: CAPPluginCall) {
        withStore(call) { store in call.resolve(["entries": try store.list(call.getString("path") ?? "")]) }
    }

    @objc func read(_ call: CAPPluginCall) {
        withStore(call) { store in
            let (data, stamp) = try store.read(call.getString("path") ?? "")
            call.resolve(["data": data.base64EncodedString(), "modified": stamp.modified, "size": stamp.size])
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        withStore(call) { store in
            guard let encoded = call.getString("data"), let data = Data(base64Encoded: encoded) else {
                throw StoreFailure(code: "failed", message: "Nothing was sent to write.")
            }
            var expected: (Double, Int)?
            if let stamp = call.getObject("expected"),
               let modified = (stamp["modified"] as? NSNumber)?.doubleValue,
               let size = (stamp["size"] as? NSNumber)?.intValue {
                expected = (modified, size)
            }
            let stamp = try store.write(data, to: call.getString("path") ?? "", expected: expected)
            call.resolve(stamp.dictionary)
        }
    }

    @objc func stat(_ call: CAPPluginCall) {
        withStore(call) { store in
            let (stamp, isFolder) = try store.stamp(call.getString("path") ?? "")
            call.resolve(["modified": stamp.modified, "size": stamp.size, "isFolder": isFolder])
        }
    }

    @objc func modifiedTimes(_ call: CAPPluginCall) {
        withStore(call) { store in
            let paths = call.getArray("paths", String.self) ?? []
            call.resolve(["times": store.modifiedTimes(paths)])
        }
    }

    @objc func exists(_ call: CAPPluginCall) {
        withStore(call) { store in call.resolve(["exists": store.exists(call.getString("path") ?? "")]) }
    }

    @objc func createFile(_ call: CAPPluginCall) {
        withStore(call) { store in try store.createFile(call.getString("path") ?? ""); call.resolve() }
    }

    @objc func createFolder(_ call: CAPPluginCall) {
        withStore(call) { store in try store.createFolder(call.getString("path") ?? ""); call.resolve() }
    }

    @objc func move(_ call: CAPPluginCall) {
        withStore(call) { store in
            try store.move(call.getString("from") ?? "", to: call.getString("to") ?? "")
            call.resolve()
        }
    }

    @objc func copy(_ call: CAPPluginCall) {
        withStore(call) { store in
            try store.copy(call.getString("from") ?? "", to: call.getString("to") ?? "")
            call.resolve()
        }
    }

    @objc func trash(_ call: CAPPluginCall) {
        withStore(call) { store in try store.trash(call.getString("path") ?? ""); call.resolve() }
    }

    /** A file URL for the web view's player, which reads the file itself as it plays. */
    @objc func fileURL(_ call: CAPPluginCall) {
        withStore(call) { store in
            call.resolve(["url": try store.materialize(call.getString("path") ?? "").absoluteString])
        }
    }

    // MARK: - App data

    /** Application Support/LoText/<name>: preferences and the working saves. */
    private func dataURL(_ call: CAPPluginCall) throws -> URL {
        guard let name = call.getString("name"), !name.isEmpty,
              !name.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }) else {
            throw StoreFailure(code: "failed", message: "That is not a name the app keeps data under.")
        }
        let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("LoText", isDirectory: true)
        return base.appendingPathComponent(name)
    }

    @objc func readData(_ call: CAPPluginCall) {
        do {
            let url = try dataURL(call)
            if let text = try? String(contentsOf: url, encoding: .utf8) {
                call.resolve(["text": text])
            } else {
                call.resolve(["text": NSNull()])
            }
        } catch {
            reject(call, error)
        }
    }

    @objc func writeData(_ call: CAPPluginCall) {
        do {
            let url = try dataURL(call)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data((call.getString("text") ?? "").utf8).write(to: url, options: [.atomic])
            call.resolve()
        } catch {
            reject(call, error)
        }
    }

    @objc func removeData(_ call: CAPPluginCall) {
        if let url = try? dataURL(call) { try? FileManager.default.removeItem(at: url) }
        call.resolve()
    }

    // MARK: - DayCap

    // The folder Cut and Send to DayCap saves into, remembered as a bookmark of its own: it is
    // never the folder the app is holding open, and never among the recent folders.
    private static let dayCapBookmarkKey = "dayCapBookmark"

    private func dayCapURL() -> URL? {
        guard let bookmark = UserDefaults.standard.data(forKey: Self.dayCapBookmarkKey) else { return nil }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else {
            return nil
        }
        if stale, url.startAccessingSecurityScopedResource() {
            defer { url.stopAccessingSecurityScopedResource() }
            if let fresh = try? url.bookmarkData() { UserDefaults.standard.set(fresh, forKey: Self.dayCapBookmarkKey) }
        }
        return url
    }

    /**
     * The remembered folder: its name, whether it is still there, and whether one was ever
     * chosen — a bookmark that no longer resolves was chosen, but has no name left to give.
     */
    @objc func dayCapFolder(_ call: CAPPluginCall) {
        let chosen = UserDefaults.standard.data(forKey: Self.dayCapBookmarkKey) != nil
        guard let url = dayCapURL() else { call.resolve(["present": false, "chosen": chosen]); return }
        let present = FolderStore(root: url, securityScoped: true).isAvailable
        call.resolve(["name": url.lastPathComponent, "present": present, "chosen": chosen])
    }

    @objc func pickDayCapFolder(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.presentFolderPicker { url in
                guard let url else { call.resolve([:]); return }
                let accessing = url.startAccessingSecurityScopedResource()
                defer { if accessing { url.stopAccessingSecurityScopedResource() } }
                do {
                    UserDefaults.standard.set(try url.bookmarkData(), forKey: Self.dayCapBookmarkKey)
                    call.resolve(["name": url.lastPathComponent])
                } catch {
                    self.reject(call, error)
                }
            }
        }
    }

    /**
     * `data` as a new file called `name` in the DayCap folder; `nameTaken` if one is there,
     * `notFound` if no folder was chosen or the chosen one has gone, so the JS side asks again.
     */
    @objc func writeToDayCap(_ call: CAPPluginCall) {
        guard let url = dayCapURL() else {
            call.reject("No DayCap folder has been chosen.", "notFound")
            return
        }
        let store = FolderStore(root: url, securityScoped: true)
        guard store.isAvailable else {
            call.reject("The DayCap folder, \(url.lastPathComponent), is not there any more.", "notFound")
            return
        }
        guard let name = call.getString("name"), !name.contains("/"),
              let encoded = call.getString("data"), let data = Data(base64Encoded: encoded) else {
            call.reject("Nothing was sent to write.", "failed")
            return
        }
        do {
            try store.writeNew(data, to: name)
            call.resolve()
        } catch {
            reject(call, error)
        }
    }

    // MARK: - The simulator harness

    /** Debug builds only: choose button `index` on the alert or sheet on screen (-1 is Cancel). */
    @objc func answer(_ call: CAPPluginCall) {
        #if DEBUG
        let index = call.getInt("index") ?? 0
        DispatchQueue.main.async {
            guard let answer = self.debugAnswer else { call.resolve(["answered": false]); return }
            self.debugAnswer = nil
            answer(index)
            call.resolve(["answered": true])
        }
        #else
        call.resolve(["answered": false])
        #endif
    }

    // MARK: - Errors

    func reject(_ call: CAPPluginCall, _ error: Error) {
        if let failure = error as? StoreFailure {
            call.reject(failure.message, failure.code, nil, failure.data)
        } else {
            call.reject(error.localizedDescription, "failed")
        }
    }
}
