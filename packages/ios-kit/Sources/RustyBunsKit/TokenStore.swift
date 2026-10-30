import Foundation
import Security

/// Where a session lives between launches.
public protocol TokenStore: Sendable {
    func load() -> EqosysSession?
    func save(_ s: EqosysSession?)
}

/// In memory only: tests, previews, and a guest who never signs in.
public final class MemoryStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var held: EqosysSession?
    public init(_ s: EqosysSession? = nil) { held = s }
    public func load() -> EqosysSession? { lock.lock(); defer { lock.unlock() }; return held }
    public func save(_ s: EqosysSession?) { lock.lock(); held = s; lock.unlock() }
}

/// The Keychain, this device only, readable after the first unlock (so a game woken in the background can refresh).
public struct KeychainStore: TokenStore {
    public let account: String
    public init(account: String) { self.account = account }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "eqosys", kSecAttrAccount as String: account]
    }

    public func load() -> EqosysSession? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(EqosysSession.self, from: data)
    }

    public func save(_ s: EqosysSession?) {
        SecItemDelete(query as CFDictionary)
        guard let s, let data = try? JSONEncoder().encode(s) else { return }
        var q = query
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }
}
