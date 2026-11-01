import SwiftUI

struct ContentView: View {
    @State private var host = "192.168.1.10"
    @State private var port = "49122"
    @State private var status = "Idle. This app never uploads face data."
    @State private var running = false
    private let streamer = FaceTrackingStreamer()

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("PoseLab Face Bridge")
                .font(.title2.bold())
            Text("Streams ARKit's 52 TrueDepth blendshapes + head pose to PoseLab over your LAN. Nothing is sent to the cloud.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            TextField("PoseLab computer LAN IP", text: $host)
                .textInputAutocapitalization(.never)
                .keyboardType(.decimalPad)
            TextField("Port", text: $port)
                .keyboardType(.numberPad)

            Button(running ? "Stop Face Tracking" : "Start Face Tracking") {
                if running {
                    streamer.stop()
                    running = false
                } else {
                    guard let url = URL(string: "ws://\(host):\(port)") else {
                        status = "Invalid LAN URL"
                        return
                    }
                    streamer.onStatus = { status = $0 }
                    streamer.start(destination: url)
                    running = true
                }
            }
            .buttonStyle(.borderedProminent)

            Text(status)
                .font(.footnote)
                .foregroundStyle(.secondary)

            Spacer()
        }
        .padding()
        .onAppear {
            streamer.onStatus = { status = $0 }
        }
    }
}
