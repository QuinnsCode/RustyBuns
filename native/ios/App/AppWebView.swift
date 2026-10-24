import SwiftUI
import WebKit
import RustyBunsKit

struct AppWebView: UIViewRepresentable {
    let link: AppLink

    func makeCoordinator() -> Coordinator { Coordinator(link) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.load(URLRequest(url: link.url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        if context.coordinator.link != link {
            context.coordinator.link = link
            view.load(URLRequest(url: link.url))
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var link: AppLink
        init(_ link: AppLink) { self.link = link }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = action.request.url, action.navigationType == .linkActivated, !link.keeps(target) else {
                return decisionHandler(.allow)
            }
            UIApplication.shared.open(target)
            decisionHandler(.cancel)
        }
    }
}
