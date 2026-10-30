#if canImport(AuthenticationServices) && os(iOS)
import AuthenticationServices
import UIKit

/// eqosys's sign-in sheet: Apple's web authentication session on the app's own scheme (iOS 12 and later, so no
/// associated-domains setup). Not ephemeral, so eqosys's cookie is shared by every Q app on the phone and a second
/// app's sign-in is one tap on Continue. Hand `EqosysSignIn.present` to `EqosysAuth.signIn(present:)`.
@MainActor
public final class EqosysSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    private static let shared = EqosysSignIn()
    private var session: ASWebAuthenticationSession?

    public static let present: Present = { url, scheme in try await shared.run(url, scheme) }

    private func run(_ url: URL, _ scheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { (go: CheckedContinuation<URL, Error>) in
            let s = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { back, error in
                if let back { go.resume(returning: back) }
                else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin { go.resume(throwing: EqosysError.cancelled) }
                else { go.resume(throwing: EqosysError.offline) }
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false
            session = s
            if !s.start() { go.resume(throwing: EqosysError.refused("the sign-in sheet didn't open")) }
        }
    }

    public nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
        }
    }
}
#endif
