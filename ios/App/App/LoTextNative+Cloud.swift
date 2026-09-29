// iCloud sync's folder on iPhone and iPad (src/mobile/cloud.js, src/shared/sync/cloud-sync.js):
// `Sync/` in the app's iCloud container, one small JSON file per device.
//
//   cloudAvailable   whether iCloud is signed in and the container can be reached
//   cloudList        the files in the folder, by name — asking iCloud for any not yet downloaded
//   cloudRead        one file's text, or null while it is still on its way down
//   cloudWrite       this device's file, coordinated and atomic
//   cloudChanged     an event: a metadata query saw the folder change, so read it again
//
// The container is reached with `url(forUbiquityContainerIdentifier:)`, which can block, so all
// of this runs on one serial queue and never on the main thread. The Mac writes the same folder
// through `~/Library/Mobile Documents` (src/main/cloud.js).

import Foundation
import Capacitor

final class CloudFolder: NSObject {
    static let shared = CloudFolder()
    static let containerID = "iCloud.com.lolekproductions.lotext"

    private let queue = DispatchQueue(label: "LoText.cloud")
    /** Touched on `queue` only. */
    private var folderURL: URL?
    /** Touched on the main thread only. */
    private var query: NSMetadataQuery?
    var onChange: (() -> Void)?

    /** Runs `body` on the cloud queue with the folder, or nil when iCloud cannot be reached. */
    func run(_ body: @escaping (URL?) -> Void) {
        queue.async { body(self.folder()) }
    }

    private func folder() -> URL? {
        // Signed out, or iCloud Drive off: no token, and nothing below would answer.
        guard FileManager.default.ubiquityIdentityToken != nil else { folderURL = nil; return nil }
        if let folderURL { return folderURL }
        guard let container = FileManager.default.url(forUbiquityContainerIdentifier: Self.containerID) else {
            return nil
        }
        let url = container.appendingPathComponent("Sync", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        folderURL = url
        DispatchQueue.main.async { self.startQuery() }
        return url
    }

    // MARK: - Watching

    /** Hears every device's file arrive or change, and has iCloud download what is not here. */
    private func startQuery() {
        guard query == nil else { return }
        let query = NSMetadataQuery()
        query.searchScopes = [NSMetadataQueryUbiquitousDataScope]
        query.predicate = NSPredicate(format: "%K LIKE '*.json'", NSMetadataItemFSNameKey)
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(queryChanged), name: .NSMetadataQueryDidFinishGathering, object: query)
        center.addObserver(self, selector: #selector(queryChanged), name: .NSMetadataQueryDidUpdate, object: query)
        self.query = query
        query.start()
    }

    @objc private func queryChanged(_ notification: Notification) {
        guard let query else { return }
        query.disableUpdates()
        for case let item as NSMetadataItem in query.results {
            guard let url = item.value(forAttribute: NSMetadataItemURLKey) as? URL else { continue }
            let status = item.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String
            if status != NSMetadataUbiquitousItemDownloadingStatusCurrent {
                try? FileManager.default.startDownloadingUbiquitousItem(at: url)
            }
        }
        query.enableUpdates()
        onChange?()
    }

    // MARK: - Files

    /**
     * The names in the folder. A file iCloud has not downloaded is a placeholder,
     * `.name.json.icloud`; it is listed under its real name and its download is started.
     */
    func list(_ folder: URL) throws -> [String] {
        let manager = FileManager.default
        var names: [String] = []
        for name in try manager.contentsOfDirectory(atPath: folder.path) {
            if name.hasPrefix("."), name.hasSuffix(".icloud") {
                let real = String(name.dropFirst().dropLast(".icloud".count))
                try? manager.startDownloadingUbiquitousItem(at: folder.appendingPathComponent(real))
                names.append(real)
            } else if !name.hasPrefix(".") {
                names.append(name)
            }
        }
        return names
    }

    /** nil while the file is still in iCloud and not yet here. */
    func read(_ folder: URL, _ name: String) throws -> String? {
        let url = folder.appendingPathComponent(name)
        let values = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
        if let status = values?.ubiquitousItemDownloadingStatus, status != .current {
            try? FileManager.default.startDownloadingUbiquitousItem(at: url)
            if !FileManager.default.fileExists(atPath: url.path) { return nil }
        }
        var text: String?
        var failure: Error?
        var coordination: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &coordination) { url in
            do { text = try String(contentsOf: url, encoding: .utf8) } catch { failure = error }
        }
        if let coordination { throw coordination }
        if let failure {
            let nsError = failure as NSError
            if nsError.domain == NSCocoaErrorDomain,
               nsError.code == NSFileReadNoSuchFileError || nsError.code == NSFileNoSuchFileError { return nil }
            throw failure
        }
        return text
    }

    func write(_ folder: URL, _ name: String, _ text: String) throws {
        let url = folder.appendingPathComponent(name)
        var failure: Error?
        var coordination: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: [.forReplacing], error: &coordination) { url in
            do { try Data(text.utf8).write(to: url, options: [.atomic]) } catch { failure = error }
        }
        if let coordination { throw coordination }
        if let failure { throw failure }
    }
}

extension LoTextNativePlugin {

    @objc func cloudAvailable(_ call: CAPPluginCall) {
        CloudFolder.shared.onChange = { [weak self] in self?.notifyListeners("cloudChanged", data: [:]) }
        CloudFolder.shared.run { folder in call.resolve(["available": folder != nil]) }
    }

    @objc func cloudList(_ call: CAPPluginCall) {
        CloudFolder.shared.run { folder in
            guard let folder else { self.rejectUnavailable(call); return }
            do {
                call.resolve(["names": try CloudFolder.shared.list(folder)])
            } catch {
                self.reject(call, error)
            }
        }
    }

    @objc func cloudRead(_ call: CAPPluginCall) {
        guard let name = Self.syncFileName(call) else { call.reject("That is not a sync file.", "failed"); return }
        CloudFolder.shared.run { folder in
            guard let folder else { self.rejectUnavailable(call); return }
            do {
                if let text = try CloudFolder.shared.read(folder, name) {
                    call.resolve(["text": text])
                } else {
                    call.resolve(["text": NSNull()])
                }
            } catch {
                self.reject(call, error)
            }
        }
    }

    @objc func cloudWrite(_ call: CAPPluginCall) {
        guard let name = Self.syncFileName(call) else { call.reject("That is not a sync file.", "failed"); return }
        let text = call.getString("text") ?? ""
        CloudFolder.shared.run { folder in
            guard let folder else { self.rejectUnavailable(call); return }
            do {
                try CloudFolder.shared.write(folder, name, text)
                call.resolve()
            } catch {
                self.reject(call, error)
            }
        }
    }

    /** One plain file name in the folder: nothing that could reach outside it. */
    private static func syncFileName(_ call: CAPPluginCall) -> String? {
        guard let name = call.getString("name"), !name.isEmpty, !name.contains("/"),
              !name.hasPrefix(".") else { return nil }
        return name
    }

    private func rejectUnavailable(_ call: CAPPluginCall) {
        call.reject("iCloud is not available.", "unavailable")
    }
}
