// What LoTextNative puts on screen: the system's alerts, action sheets, document pickers, Quick
// Look and the print and share sheets. Each resolves its call when the user has answered, and
// none of them is ever skipped silently — a picker that is dismissed resolves as cancelled.

import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers
import QuickLook
import WebKit
import PDFKit

extension LoTextNativePlugin {

    /** Whatever is on top, so a sheet raised from a sheet still has somewhere to go. */
    var presenter: UIViewController? {
        var top = bridge?.viewController
        while let next = top?.presentedViewController, !next.isBeingDismissed { top = next }
        return top
    }

    /** On iPad a sheet is a popover and must point at something: where the finger was. */
    private func anchor(_ controller: UIViewController, x: Double?, y: Double?) {
        guard let popover = controller.popoverPresentationController, let view = bridge?.webView else { return }
        popover.sourceView = view
        if let x, let y {
            popover.sourceRect = CGRect(x: x, y: y, width: 1, height: 1)
        } else {
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
    }

    // MARK: - Alerts and menus

    /** The Mac's message box: a title, a sentence, buttons; resolves with the chosen index. */
    @objc func alert(_ call: CAPPluginCall) {
        let buttons = call.getArray("buttons", String.self) ?? ["OK"]
        let cancelIndex = call.getInt("cancelIndex") ?? -1
        DispatchQueue.main.async {
            let controller = UIAlertController(title: call.getString("title"), message: call.getString("message"), preferredStyle: .alert)
            for (index, title) in buttons.enumerated() {
                let style: UIAlertAction.Style = index == cancelIndex ? .cancel
                    : (Self.destructiveTitles.contains(title) ? .destructive : .default)
                controller.addAction(UIAlertAction(title: title, style: style) { _ in call.resolve(["index": index]) })
            }
            self.awaitAnswer(controller) { index in call.resolve(["index": index]) }
            if let first = controller.actions.first, first.style != .cancel { controller.preferredAction = first }
            guard let presenter = self.presenter else { call.resolve(["index": max(cancelIndex, 0)]); return }
            presenter.present(controller, animated: true)
        }
    }

    /**
     * Debug builds only: lets the simulator harness answer the alert or sheet on screen, which a
     * terminal has no other way to tap (scripts/ios-sim.sh answer N).
     */
    private func awaitAnswer(_ controller: UIViewController, _ answer: @escaping (Int) -> Void) {
        #if DEBUG
        debugAnswer = { [weak controller] index in
            controller?.dismiss(animated: false)
            answer(index)
        }
        #endif
    }

    private static let destructiveTitles: Set<String> = ["Delete", "Move to Trash", "Reload from Disk"]

    /** A list of choices as an action sheet, and Cancel; resolves -1 for Cancel. */
    @objc func menu(_ call: CAPPluginCall) {
        let items = call.getArray("items", JSObject.self) ?? []
        let x = call.getDouble("x")
        let y = call.getDouble("y")
        DispatchQueue.main.async {
            let controller = UIAlertController(title: call.getString("title"), message: nil, preferredStyle: .actionSheet)
            for (index, item) in items.enumerated() {
                let destructive = item["destructive"] as? Bool ?? false
                controller.addAction(UIAlertAction(title: item["title"] as? String ?? "", style: destructive ? .destructive : .default) { _ in
                    call.resolve(["index": index])
                })
            }
            controller.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in call.resolve(["index": -1]) })
            self.awaitAnswer(controller) { index in call.resolve(["index": index]) }
            self.anchor(controller, x: x, y: y)
            guard let presenter = self.presenter else { call.resolve(["index": -1]); return }
            presenter.present(controller, animated: true)
        }
    }

    // MARK: - Pickers

    /** Choose Folder…: the system's picker, for a folder, opened in place rather than copied. */
    func presentFolderPicker(_ completion: @escaping (URL?) -> Void) {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
        picker.allowsMultipleSelection = false
        present(picker) { urls in completion(urls?.first) }
    }

    /** Save As… and Export Settings…: the text goes wherever the user points, as a copy. */
    @objc func exportFile(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), let data = Data(base64Encoded: call.getString("data") ?? "") else {
            call.reject("Nothing was sent to save.", "failed")
            return
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let file = directory.appendingPathComponent(name.replacingOccurrences(of: "/", with: "-"))
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: file)
        } catch {
            reject(call, error)
            return
        }
        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
            self.present(picker) { urls in
                try? FileManager.default.removeItem(at: directory)
                if let saved = urls?.first {
                    call.resolve(["name": saved.lastPathComponent])
                } else {
                    call.resolve(["name": NSNull()])
                }
            }
        }
    }

    /** Import Settings…: one file's bytes, read through the picker's copy. */
    @objc func importFile(_ call: CAPPluginCall) {
        let types = (call.getArray("types", String.self) ?? ["public.json"]).compactMap { UTType($0) }
        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types.isEmpty ? [.json] : types, asCopy: true)
            self.present(picker) { urls in
                guard let url = urls?.first else { call.resolve([:]); return }
                do {
                    let data = try Data(contentsOf: url)
                    call.resolve(["name": url.lastPathComponent, "data": data.base64EncodedString()])
                } catch {
                    self.reject(call, error)
                }
            }
        }
    }

    private func present(_ picker: UIDocumentPickerViewController, _ completion: @escaping ([URL]?) -> Void) {
        let helper = PickerHelper { [weak self] urls in
            self?.presentedHelper = nil
            completion(urls)
        }
        presentedHelper = helper
        picker.delegate = helper
        guard let presenter else { completion(nil); return }
        presenter.present(picker, animated: true)
    }

    // MARK: - Quick Look

    @objc func quickLook(_ call: CAPPluginCall) {
        guard let store else { call.reject("No folder is open.", "folderUnavailable"); return }
        let url: URL
        do {
            url = try store.materialize(call.getString("path") ?? "")
        } catch {
            reject(call, error)
            return
        }
        DispatchQueue.main.async {
            let source = QuickLookSource(url: url) { [weak self] in self?.presentedHelper = nil }
            self.presentedHelper = source
            let controller = QLPreviewController()
            controller.dataSource = source
            controller.delegate = source
            self.presenter?.present(controller, animated: true)
            call.resolve()
        }
    }

    // MARK: - Printing

    /**
     * The pages the JS side laid out and drew (src/mobile/printing.js), one HTML document at one
     * point per pixel. Each page's rectangle becomes one PDF page at the paper's own size, and
     * the PDF goes to AirPrint — or, for Share PDF…, to the share sheet.
     */
    @objc func print(_ call: CAPPluginCall) {
        guard let html = call.getString("html"),
              let width = call.getDouble("pageWidth"), let height = call.getDouble("pageHeight") else {
            call.reject("There was nothing to print.", "failed")
            return
        }
        let pageCount = max(1, call.getInt("pageCount") ?? 1)
        let jobName = call.getString("jobName") ?? "LoText"
        let share = call.getBool("share") ?? false
        DispatchQueue.main.async {
            let renderer = PageRenderer(html: html, pageSize: CGSize(width: width, height: height), pageCount: pageCount,
                                        host: self.bridge?.viewController?.view)
            self.presentedHelper = renderer
            renderer.render { result in
                self.presentedHelper = nil
                switch result {
                case .failure(let error):
                    call.reject("The pages could not be drawn: \(error.localizedDescription)", "failed")
                case .success(let pdf):
                    if share { self.sharePDF(pdf, named: jobName, call) } else { self.printPDF(pdf, named: jobName, call) }
                }
            }
        }
    }

    private func printPDF(_ pdf: Data, named name: String, _ call: CAPPluginCall) {
        let info = UIPrintInfo.printInfo()
        info.jobName = name
        info.outputType = .general
        let controller = UIPrintInteractionController.shared
        controller.printInfo = info
        controller.printingItem = pdf
        let done: UIPrintInteractionController.CompletionHandler = { _, completed, error in
            if let error { call.reject(error.localizedDescription, "failed") } else { call.resolve(["done": completed]) }
        }
        if UIDevice.current.userInterfaceIdiom == .pad, let view = bridge?.webView {
            controller.present(from: CGRect(x: view.bounds.maxX - 60, y: view.safeAreaInsets.top + 22, width: 1, height: 1),
                               in: view, animated: true, completionHandler: done)
        } else {
            controller.present(animated: true, completionHandler: done)
        }
    }

    private func sharePDF(_ pdf: Data, named name: String, _ call: CAPPluginCall) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let file = directory.appendingPathComponent("\(name.replacingOccurrences(of: "/", with: "-")).pdf")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try pdf.write(to: file)
        } catch {
            reject(call, error)
            return
        }
        let controller = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, completed, _, _ in
            try? FileManager.default.removeItem(at: directory)
            call.resolve(["done": completed])
        }
        anchor(controller, x: nil, y: nil)
        if let view = bridge?.webView, let popover = controller.popoverPresentationController {
            popover.sourceRect = CGRect(x: view.bounds.maxX - 60, y: view.safeAreaInsets.top + 22, width: 1, height: 1)
            popover.permittedArrowDirections = .up
        }
        presenter?.present(controller, animated: true)
    }
}

// MARK: - Helpers UIKit holds weakly

private final class PickerHelper: NSObject, UIDocumentPickerDelegate {
    private var completion: (([URL]?) -> Void)?

    init(_ completion: @escaping ([URL]?) -> Void) { self.completion = completion }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        completion?(urls)
        completion = nil
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        completion?(nil)
        completion = nil
    }
}

private final class QuickLookSource: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    let url: URL
    let onDismiss: () -> Void

    init(url: URL, onDismiss: @escaping () -> Void) {
        self.url = url
        self.onDismiss = onDismiss
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    func previewControllerDidDismiss(_ controller: QLPreviewController) { onDismiss() }
    /** A viewer shows a file and never changes a byte of it — no markup saved back over it. */
    func previewController(_ controller: QLPreviewController, editingModeFor previewItem: QLPreviewItem) -> QLPreviewItemEditingMode { .disabled }
}

/**
 * Draws the laid-out pages in a web view nobody sees, then asks it for one PDF page per page
 * rectangle and joins them. The view sits in the window, off to one side, because a web view that
 * is in no window is not guaranteed to lay anything out.
 */
private final class PageRenderer: NSObject, WKNavigationDelegate {
    private let html: String
    private let pageSize: CGSize
    private let pageCount: Int
    private weak var host: UIView?
    private var webView: WKWebView?
    private var completion: ((Result<Data, Error>) -> Void)?

    init(html: String, pageSize: CGSize, pageCount: Int, host: UIView?) {
        self.html = html
        self.pageSize = pageSize
        self.pageCount = pageCount
        self.host = host
    }

    func render(_ completion: @escaping (Result<Data, Error>) -> Void) {
        self.completion = completion
        let frame = CGRect(x: -pageSize.width - 10_000, y: 0, width: pageSize.width, height: pageSize.height * CGFloat(pageCount))
        let view = WKWebView(frame: frame, configuration: WKWebViewConfiguration())
        view.isOpaque = false
        view.navigationDelegate = self
        view.scrollView.contentInsetAdjustmentBehavior = .never
        host?.addSubview(view)
        webView = view
        view.loadHTMLString(html, baseURL: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // One more turn of the run loop, so the pages have been painted as well as laid out.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.capture(page: 0, into: PDFDocument()) }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(.failure(error)) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(.failure(error)) }

    private func capture(page: Int, into document: PDFDocument) {
        guard let webView else { return }
        if page >= pageCount {
            guard let data = document.dataRepresentation() else {
                finish(.failure(StoreFailure(code: "failed", message: "The PDF could not be written.")))
                return
            }
            finish(.success(data))
            return
        }
        let configuration = WKPDFConfiguration()
        configuration.rect = CGRect(x: 0, y: CGFloat(page) * pageSize.height, width: pageSize.width, height: pageSize.height)
        webView.createPDF(configuration: configuration) { result in
            switch result {
            case .failure(let error):
                self.finish(.failure(error))
            case .success(let data):
                if let single = PDFDocument(data: data) {
                    for index in 0..<single.pageCount {
                        if let pdfPage = single.page(at: index) { document.insert(pdfPage, at: document.pageCount) }
                    }
                }
                self.capture(page: page + 1, into: document)
            }
        }
    }

    private func finish(_ result: Result<Data, Error>) {
        webView?.removeFromSuperview()
        webView = nil
        completion?(result)
        completion = nil
    }
}
