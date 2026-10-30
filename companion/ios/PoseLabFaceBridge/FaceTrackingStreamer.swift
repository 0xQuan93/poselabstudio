import ARKit
import Foundation

/// Streams ARKit's 52 face blendshapes and head pose over a LAN WebSocket.
/// This is the native TrueDepth path. Safari cannot do this.
final class FaceTrackingStreamer: NSObject, ARSessionDelegate {
    private let session = ARSession()
    private var webSocket: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var destination: URL?
    private var running = false

    var onStatus: ((String) -> Void)?

    func start(destination: URL) {
        guard ARFaceTrackingConfiguration.isSupported else {
            onStatus?("This iPhone does not support ARKit Face Tracking (TrueDepth).")
            return
        }

        stop()
        self.destination = destination
        running = true

        let config = ARFaceTrackingConfiguration()
        config.maximumNumberOfTrackedFaces = 1
        session.delegate = self
        session.run(config, options: [.resetTracking, .removeExistingAnchors])

        connectSocket()
        onStatus?("Face tracking started. Connecting \(destination.absoluteString)…")
    }

    func stop() {
        running = false
        session.pause()
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        onStatus?("Stopped. Camera released.")
    }

    private func connectSocket() {
        guard let destination else { return }
        let session = URLSession(configuration: .default)
        urlSession = session
        let task = session.webSocketTask(with: destination)
        webSocket = task
        task.resume()
        sendHello()
        listen()
    }

    private func sendHello() {
        let hello: [String: Any] = [
            "type": "hello",
            "v": 1,
            "device": "ios-arkit",
            "shapes": 52
        ]
        sendJSON(hello)
    }

    private func listen() {
        webSocket?.receive { [weak self] _ in
            self?.listen()
        }
    }

    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        guard running, let face = anchors.compactMap({ $0 as? ARFaceAnchor }).first else { return }

        var blendshapes: [String: Double] = [:]
        for (location, value) in face.blendShapes {
            blendshapes[location.rawValue] = value.doubleValue
        }

        let rotation = simd_quatf(face.transform)
        let payload: [String: Any] = [
            "type": "arkit-face-frame",
            "v": 1,
            "t": Int(Date().timeIntervalSince1970 * 1000),
            "blendshapes": blendshapes,
            "head": [
                "x": Double(rotation.imag.x),
                "y": Double(rotation.imag.y),
                "z": Double(rotation.imag.z),
                "w": Double(rotation.real)
            ]
        ]
        sendJSON(payload)
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        onStatus?("ARSession failed: \(error.localizedDescription)")
    }

    private func sendJSON(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: []),
              let text = String(data: data, encoding: .utf8) else { return }
        webSocket?.send(.string(text)) { [weak self] error in
            if let error {
                self?.onStatus?("WebSocket send failed: \(error.localizedDescription)")
            }
        }
    }
}
