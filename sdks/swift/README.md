# Pushlane for Swift

Add this repository's `sdks/swift` directory as a local Swift package. The package supports iOS 15 and later. It manages installation registration, not notification permission or your app's sign-in flow.

Create one client and keep its installation ID when asking your authenticated backend for a registration token.

```swift
import Pushlane

let push = try Pushlane(baseURL: URL(string: "https://push.example.com")!)
let installationId = push.installationId
```

Your backend calls `POST /v1/registration-tokens` with the signed-in user ID and `installationId`. Return only the resulting installation token to the app. Never embed a project API key in an app.

Ask for permission in response to an explicit user action. Enable the Push Notifications capability in Xcode, request authorization with `UNUserNotificationCenter`, and call `UIApplication.shared.registerForRemoteNotifications()` after permission is granted.

Pass APNs tokens to the client from `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.

```swift
try await push.register(
    deviceToken: deviceToken,
    registrationToken: tokenFromYourBackend,
    sandbox: true
)
```

Use `sandbox: false` for production APNs. Register again whenever APNs supplies a new device token. Registration tokens expire after one hour, so obtain a fresh token from your authenticated backend before refreshing after expiry. Register on app launch after sign-in to keep the endpoint current.

The actor serializes registration and logout across network waits. Keep one client per installation and await lifecycle operations before changing the app's authenticated account.

Before clearing the user's authenticated session, revoke the installation.

```swift
try await push.unregister()
```

After an app restart, obtain a fresh token and pass it to `unregister(registrationToken:)`. Registration expiry does not prevent revocation of that session. Await successful revocation before reporting logout complete. An already authorized provider request cannot be recalled. After account switching, obtain a new registration token for the new user and register the installation again.

## Notification images

Add a Notification Service Extension target. Pushlane sets `mutable-content` when an image is present. The extension must download and attach the image. The following example uses a ten-second request timeout and rejects attachments larger than five megabytes. Do not log the image URL if it contains private access tokens.

```swift
import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
    private let completionLock = NSLock()
    private var handler: ((UNNotificationContent) -> Void)?
    private var fallback: UNNotificationContent?
    private var task: URLSessionDownloadTask?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        handler = contentHandler
        fallback = request.content

        guard let image = request.content.userInfo["image"] as? String,
              let url = URL(string: image), url.scheme == "https",
              let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            finish(request.content)
            return
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 10
        configuration.timeoutIntervalForResource = 10

        task = URLSession(configuration: configuration).downloadTask(with: url) { [weak self] file, response, _ in
            guard let self, let file,
                  let response = response as? HTTPURLResponse,
                  response.statusCode == 200,
                  response.mimeType?.hasPrefix("image/") == true,
                  let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                  size <= 5 * 1024 * 1024 else {
                self?.finish(request.content)
                return
            }

            let target = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension(url.pathExtension.isEmpty ? "jpg" : url.pathExtension)

            do {
                try FileManager.default.moveItem(at: file, to: target)
                content.attachments = [try UNNotificationAttachment(identifier: "image", url: target)]
                self.finish(content)
            } catch {
                self.finish(request.content)
            }
        }

        task?.resume()
    }

    override func serviceExtensionTimeWillExpire() {
        task?.cancel()

        if let fallback { finish(fallback) }
    }

    private func finish(_ content: UNNotificationContent) {
        completionLock.lock()
        let callback = handler
        handler = nil
        completionLock.unlock()

        callback?(content)
    }
}
```

The extension example is app integration code. Verify it in your extension target and on a physical device. Package tests do not establish APNs delivery or image presentation.
