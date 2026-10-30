import Foundation

/// The name filter App Review asks for on names strangers see (guideline 1.2). The edge already strips control
/// characters and cuts names to 24; this refuses the rest before a name is sent, on the screen where it is typed.
public enum NameCheck: Equatable {
    case ok(String)
    case empty
    case tooLong
    case refused
}

public enum NameFilter {
    static let words = ["fuck", "shit", "cunt", "bitch", "dick", "cock", "pussy", "whore", "slut", "rape", "nazi", "hitler", "nigg", "fagg", "retard", "porn", "kkk"]

    /// Lower case, accents off, look-alike digits and symbols turned back into letters, everything else dropped,
    /// so "Sh1t", "s h i t" and "$hit" all read the same.
    static func squash(_ s: String) -> String {
        let map: [Character: Character] = ["0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "i"]
        let folded = s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased()
        var out = ""
        for ch in folded {
            if let m = map[ch] { out.append(m) } else if ch.isLetter { out.append(ch) }
        }
        return out
    }

    public static func check(_ typed: String) -> NameCheck {
        let name = typed.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }
            .map(String.init).joined().trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return .empty }
        if name.count > 24 { return .tooLong }
        let flat = squash(name)
        return words.contains { flat.contains($0) } ? .refused : .ok(name)
    }
}
