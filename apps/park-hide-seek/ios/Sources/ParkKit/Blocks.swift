import Foundation

/// Players this install has blocked, by their public id (the id views carry). Kept in UserDefaults; a blocked
/// player's name and callouts are hidden on this phone. Block is for players met in quick play (guideline 1.2).
public struct Blocks {
    private let store: UserDefaults
    private let key = "phs.blocked"
    public init(_ store: UserDefaults = .standard) { self.store = store }

    public var ids: Set<String> { Set(store.stringArray(forKey: key) ?? []) }
    public func has(_ id: String) -> Bool { ids.contains(id) }
    public func block(_ id: String) { store.set(Array(ids.union([id])), forKey: key) }
    public func unblock(_ id: String) { store.set(Array(ids.subtracting([id])), forKey: key) }

    /// What to show for a player: their name, or a stand-in once blocked.
    public func shown(_ p: PlayerView) -> String { has(p.id) ? "Blocked player" : p.name }
}
