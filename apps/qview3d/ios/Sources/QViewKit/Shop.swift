// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../../LICENSE.
//
// The shop's side of QView3D, for a scan: the same three calls the admin page makes, with the org's admin key.
//
//   POST /api/orgs/<org>/uploads  {kind: "scan", type, size, sha256}   where to PUT the GLB (src/worker.ts)
//   PUT  <put.url>                                                      the bytes, unless the bucket has them already
//   POST /api/orgs/<org>/models   {name, scan}                          the product, ready now (src/samples.ts)
import CryptoKit
import Foundation

public struct Shop: Sendable {
    public var host: URL
    public var org: String
    public var adminKey: String

    public init(host: URL, org: String, adminKey: String) {
        self.host = host
        self.org = org
        self.adminKey = adminKey
    }

    public struct Sample: Decodable, Equatable, Sendable {
        public let id: String
        public let name: String
        public let status: String
        public let glb: String?
        public let product: String?
    }

    struct SignReply: Decodable {
        struct Put: Decodable { let url: URL; let headers: [String: String] }
        let key: String
        let exists: Bool
        let put: Put?
    }

    public enum Trouble: Error, Equatable, LocalizedError {
        /// What the server said, in its own words.
        case refused(Int, String)
        public var errorDescription: String? {
            switch self {
            case .refused(401, _): "That admin key isn't one of this shop's."
            case let .refused(_, why): why
            }
        }
    }

    /// The sign request for these bytes: what `POST /uploads` is sent.
    func signRequest(_ glb: Data) throws -> URLRequest {
        let sha = SHA256.hash(data: glb).map { String(format: "%02x", $0) }.joined()
        return try post("uploads", ["kind": "scan", "type": GLB.mime, "size": glb.count, "sha256": sha])
    }

    func post(_ path: String, _ body: [String: Any]) throws -> URLRequest {
        var r = URLRequest(url: host.appending(path: "api/orgs/\(org)/\(path)"))
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "content-type")
        r.setValue("Bearer \(adminKey)", forHTTPHeaderField: "authorization")
        r.httpBody = try JSONSerialization.data(withJSONObject: body)
        return r
    }

    /// Uploads a scan's GLB and files it as a product named `name`.
    public func send(glb: Data, name: String, session: URLSession = .shared) async throws -> Sample {
        let sign: SignReply = try await call(signRequest(glb), session)
        if !sign.exists, let put = sign.put {
            var r = URLRequest(url: put.url)
            r.httpMethod = "PUT"
            for (k, v) in put.headers { r.setValue(v, forHTTPHeaderField: k) }
            let (data, res) = try await session.upload(for: r, from: glb)
            try check(data, res)
        }
        return try await call(post("models", ["name": name, "scan": sign.key]), session)
    }

    private func call<T: Decodable>(_ r: URLRequest, _ session: URLSession) async throws -> T {
        let (data, res) = try await session.data(for: r)
        try check(data, res)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func check(_ data: Data, _ res: URLResponse) throws {
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        guard !(200..<300).contains(status) else { return }
        let why = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
        throw Trouble.refused(status, why ?? "The shop's server answered \(status).")
    }
}
