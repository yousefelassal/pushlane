import XCTest
@testable import Pushlane

final class PushlaneTests: XCTestCase {
    func testRegistrationAndLogoutUseOnlyInstallationCredentials() async throws {
        RecordingProtocol.requests = []

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RecordingProtocol.self]

        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        let url = try XCTUnwrap(URL(string: "https://push.example.com"))
        let client = try Pushlane(
            baseURL: url,
            installationId: "0b629250-bc86-431c-93ac-27f066ea0cfe",
            session: session
        )

        try await client.register(
            deviceToken: Data(repeating: 0xab, count: 32),
            registrationToken: "installation-session",
            sandbox: true
        )
        try await client.unregister()

        XCTAssertEqual(RecordingProtocol.requests.count, 2)

        let registration = try XCTUnwrap(RecordingProtocol.requests.first)
        XCTAssertEqual(registration.httpMethod, "PUT")
        XCTAssertEqual(registration.url?.path, "/v1/installations/0b629250-bc86-431c-93ac-27f066ea0cfe")
        XCTAssertEqual(registration.value(forHTTPHeaderField: "Authorization"), "Bearer installation-session")

        let body = try XCTUnwrap(registration.httpBody)
        let endpoint = try JSONDecoder().decode(RegisteredEndpoint.self, from: body)

        XCTAssertEqual(endpoint.kind, "apns")
        XCTAssertEqual(endpoint.token, String(repeating: "ab", count: 32))
        XCTAssertTrue(endpoint.sandbox)
        XCTAssertEqual(RecordingProtocol.requests.last?.httpMethod, "DELETE")
    }

    func testOverlappingRegistrationsCannotReplaceTheCurrentLogoutToken() async throws {
        let gate = RegistrationGate()
        GatedProtocol.gate = gate

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [GatedProtocol.self]

        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        let url = try XCTUnwrap(URL(string: "https://push.example.com"))
        let client = try Pushlane(baseURL: url, session: session)
        let first = Task {
            try await client.register(deviceToken: Data(repeating: 0xab, count: 32), registrationToken: "first-session")
        }

        await fulfillment(of: [gate.firstStarted], timeout: 2)

        let second = Task {
            try await client.register(deviceToken: Data(repeating: 0xcd, count: 32), registrationToken: "second-session")
        }

        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(gate.authorizations, ["PUT Bearer first-session"])

        gate.releaseFirst()

        try await first.value
        try await second.value
        try await client.unregister(registrationToken: "first-session")
        try await client.unregister()

        XCTAssertEqual(gate.authorizations, [
            "PUT Bearer first-session",
            "PUT Bearer second-session",
            "DELETE Bearer first-session",
            "DELETE Bearer second-session"
        ])
    }

    func testInstallationIdPersistsAcrossClientCreation() throws {
        let name = "pushlane-tests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }

        let url = try XCTUnwrap(URL(string: "https://push.example.com"))
        let first = try Pushlane(baseURL: url, defaults: defaults)
        let second = try Pushlane(baseURL: url, defaults: defaults)

        XCTAssertEqual(first.installationId, second.installationId)
        XCTAssertNotNil(UUID(uuidString: first.installationId))
    }

    func testPlaintextRemoteAPIsAreRejected() throws {
        let url = try XCTUnwrap(URL(string: "http://push.example.com"))

        XCTAssertThrowsError(try Pushlane(baseURL: url))
    }

    func testLogoutRequiresRegistrationCredentials() async throws {
        let url = try XCTUnwrap(URL(string: "https://push.example.com"))
        let client = try Pushlane(baseURL: url)

        do {
            try await client.unregister()
            XCTFail("Logout must not proceed without an installation token.")
        } catch PushlaneError.missingRegistrationToken {
            return
        }
    }
}

private struct RegisteredEndpoint: Decodable {
    let kind: String
    let token: String
    let sandbox: Bool
}

private final class RecordingProtocol: URLProtocol {
    static var requests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var recorded = request

        if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }

            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 1024)

            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)

                if count <= 0 { break }

                data.append(buffer, count: count)
            }

            recorded.httpBody = data
        }

        Self.requests.append(recorded)

        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: 204, httpVersion: nil, headerFields: nil) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private final class RegistrationGate: @unchecked Sendable {
    let firstStarted = XCTestExpectation(description: "The first registration reached the transport")
    private let lock = NSLock()
    private var pending: GatedProtocol?
    private var requests: [String] = []

    var authorizations: [String] {
        lock.lock()
        defer { lock.unlock() }

        return requests
    }

    func receive(_ transport: GatedProtocol) {
        lock.lock()
        requests.append("\(transport.request.httpMethod ?? "") \(transport.request.value(forHTTPHeaderField: "Authorization") ?? "")")
        let isFirst = requests.count == 1

        if isFirst { pending = transport }

        lock.unlock()

        if isFirst {
            firstStarted.fulfill()
        } else {
            transport.complete()
        }
    }

    func releaseFirst() {
        lock.lock()
        let transport = pending
        pending = nil
        lock.unlock()

        transport?.complete()
    }
}

private final class GatedProtocol: URLProtocol {
    static var gate: RegistrationGate?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() { Self.gate?.receive(self) }
    override func stopLoading() {}

    func complete() {
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: 204, httpVersion: nil, headerFields: nil) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocolDidFinishLoading(self)
    }
}
