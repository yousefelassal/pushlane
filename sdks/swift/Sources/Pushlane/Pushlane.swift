import Foundation

#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Failures callers can handle without depending on server error messages.
public enum PushlaneError: Error {
    case invalidBaseURL
    case invalidInstallationId
    case missingRegistrationToken
    case invalidResponse
    case api(status: Int)
}

/// Registers one APNs installation. Notification permission remains under the app's control.
public actor Pushlane {
    public nonisolated let installationId: String

    private let baseURL: URL
    private let session: URLSession
    private var registrationToken: String?
    private var lifecycleInProgress = false
    private var lifecycleWaiters: [CheckedContinuation<Void, Never>] = []

    /// Reuses an app-local installation ID across launches without storing user credentials.
    public init(
        baseURL: URL,
        installationId: String? = nil,
        defaults: UserDefaults = .standard,
        session: URLSession = .shared
    ) throws {
        let local = ["localhost", "127.0.0.1", "::1", "[::1]"].contains(baseURL.host ?? "")

        guard baseURL.scheme == "https" || (baseURL.scheme == "http" && local),
              baseURL.user == nil, baseURL.password == nil,
              baseURL.query == nil, baseURL.fragment == nil else {
            throw PushlaneError.invalidBaseURL
        }

        self.baseURL = baseURL
        self.session = session

        if let installationId, UUID(uuidString: installationId) == nil {
            throw PushlaneError.invalidInstallationId
        }

        let stored = installationId ?? defaults.string(forKey: "pushlane.installation-id")

        if let stored, UUID(uuidString: stored) != nil {
            self.installationId = stored.lowercased()
        } else {
            self.installationId = UUID().uuidString.lowercased()
        }

        if installationId == nil {
            defaults.set(self.installationId, forKey: "pushlane.installation-id")
        }
    }

    /// Call after APNs supplies or refreshes its device token and your backend issues a session token.
    public func register(deviceToken: Data, registrationToken: String, sandbox: Bool = false) async throws {
        await acquireLifecycle()
        defer { releaseLifecycle() }

        try Task.checkCancellation()

        let payload = APNsEndpoint(
            token: deviceToken.map { String(format: "%02x", $0) }.joined(),
            sandbox: sandbox
        )

        try await request(method: "PUT", token: registrationToken, body: JSONEncoder().encode(payload))

        self.registrationToken = registrationToken
    }

    /// Revokes the installation before the app signs out. Supply a fresh token after an app restart if no session token remains in memory.
    public func unregister(registrationToken: String? = nil) async throws {
        await acquireLifecycle()
        defer { releaseLifecycle() }

        try Task.checkCancellation()

        guard let token = registrationToken ?? self.registrationToken else {
            throw PushlaneError.missingRegistrationToken
        }

        try await request(method: "DELETE", token: token, body: nil)

        if self.registrationToken == token { self.registrationToken = nil }
    }

    private func acquireLifecycle() async {
        if !lifecycleInProgress {
            lifecycleInProgress = true
            return
        }

        await withCheckedContinuation { lifecycleWaiters.append($0) }
    }

    private func releaseLifecycle() {
        if lifecycleWaiters.isEmpty {
            lifecycleInProgress = false
        } else {
            lifecycleWaiters.removeFirst().resume()
        }
    }

    private func request(method: String, token: String, body: Data?) async throws {
        guard let url = URL(string: "/v1/installations/\(installationId)", relativeTo: baseURL) else {
            throw PushlaneError.invalidBaseURL
        }

        var request = URLRequest(url: url, timeoutInterval: 15)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (_, response) = try await session.data(for: request, delegate: RejectRedirects())

        guard let response = response as? HTTPURLResponse else {
            throw PushlaneError.invalidResponse
        }

        guard (200..<300).contains(response.statusCode) else {
            throw PushlaneError.api(status: response.statusCode)
        }
    }
}

private final class RejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

private struct APNsEndpoint: Encodable {
    let kind = "apns"
    let token: String
    let sandbox: Bool
}
