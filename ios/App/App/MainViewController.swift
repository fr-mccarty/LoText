// The app's one screen: Capacitor's web view, with LoTextNative registered on its bridge.
//
// In a Debug build it also runs the harness that lets a terminal drive the app in the
// simulator: a script dropped at tmp/lotext-eval.js in the
// app's container is run in the page, and what it returns is written to tmp/lotext-eval.out.
// A Release build has none of it.

import UIKit
import Capacitor
import WebKit

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LoTextNativePlugin())
        webView?.isOpaque = false
        webView?.backgroundColor = .systemBackground
        webView?.scrollView.backgroundColor = .systemBackground
        #if DEBUG
        if #available(iOS 16.4, *) { webView?.isInspectable = true }
        startEvalHarness()
        #endif
    }

    #if DEBUG
    private var evalTimer: Timer?

    private func startEvalHarness() {
        let directory = FileManager.default.temporaryDirectory
        let script = directory.appendingPathComponent("lotext-eval.js")
        let output = directory.appendingPathComponent("lotext-eval.out")
        evalTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            guard let self, let webView = self.webView,
                  let body = try? String(contentsOf: script, encoding: .utf8) else { return }
            try? FileManager.default.removeItem(at: script)
            let wrapped = """
                try {
                  const value = await (async () => { \(body) })()
                  return JSON.stringify({ ok: true, value: value === undefined ? null : value })
                } catch (error) {
                  return JSON.stringify({ ok: false, error: String(error && error.stack || error) })
                }
                """
            webView.callAsyncJavaScript(wrapped, arguments: [:], in: nil, in: .page) { result in
                let text: String
                switch result {
                case .success(let value): text = value as? String ?? "null"
                case .failure(let error): text = "{\"ok\":false,\"error\":\(String(reflecting: error.localizedDescription))}"
                }
                try? text.write(to: output, atomically: true, encoding: .utf8)
            }
        }
    }
    #endif
}
