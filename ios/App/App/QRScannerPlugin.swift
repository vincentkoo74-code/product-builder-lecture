import AVFoundation
import Capacitor
import UIKit

@objc(QRScannerPlugin)
public class QRScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "QRScannerPlugin"
    public let jsName = "QRScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    private weak var scannerViewController: QRScannerViewController?

    @objc func isSupported(_ call: CAPPluginCall) {
        call.resolve(["supported": UIImagePickerController.isSourceTypeAvailable(.camera)])
    }

    @objc public override func checkPermissions(_ call: CAPPluginCall) {
        call.resolve(["camera": permissionState()])
    }

    @objc public override func requestPermissions(_ call: CAPPluginCall) {
        AVCaptureDevice.requestAccess(for: .video) { granted in
            call.resolve(["camera": granted ? "granted" : "denied"])
        }
    }

    @objc func scan(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
                call.reject("Camera is not available on this device.")
                return
            }
            guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
                call.reject("Camera permission is not granted.")
                return
            }
            guard let presenter = self.bridge?.viewController else {
                call.reject("Unable to present QR scanner.")
                return
            }

            let scanner = QRScannerViewController()
            scanner.modalPresentationStyle = .fullScreen
            scanner.onResult = { value in
                call.resolve(["barcodes": [["rawValue": value, "displayValue": value]]])
            }
            scanner.onCancel = {
                call.resolve(["barcodes": []])
            }
            scanner.onError = { message in
                call.reject(message)
            }
            self.scannerViewController = scanner
            presenter.present(scanner, animated: true)
        }
    }

    @objc func stopScan(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.scannerViewController?.finishWithoutResult()
            call.resolve()
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("Unable to open app settings.")
                return
            }
            UIApplication.shared.open(url) { opened in
                opened ? call.resolve() : call.reject("Unable to open app settings.")
            }
        }
    }

    private func permissionState() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            return "granted"
        case .denied, .restricted:
            return "denied"
        case .notDetermined:
            return "prompt"
        @unknown default:
            return "prompt"
        }
    }
}

private final class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onResult: ((String) -> Void)?
    var onCancel: (() -> Void)?
    var onError: ((String) -> Void)?

    private let captureSession = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configureCamera()
        configureOverlay()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        DispatchQueue.global(qos: .userInitiated).async {
            self.captureSession.startRunning()
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              object.type == .qr,
              let value = object.stringValue else { return }
        finish(value: value)
    }

    func finishWithoutResult() {
        finish(value: nil, notifyCancel: true)
    }

    @objc private func cancelTapped() {
        finish(value: nil, notifyCancel: true)
    }

    private func configureCamera() {
        guard let camera = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: camera),
              captureSession.canAddInput(input) else {
            onError?("Unable to access the camera.")
            dismiss(animated: true)
            return
        }
        captureSession.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard captureSession.canAddOutput(output) else {
            onError?("Unable to configure QR scanning.")
            dismiss(animated: true)
            return
        }
        captureSession.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let preview = AVCaptureVideoPreviewLayer(session: captureSession)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)
        previewLayer = preview
    }

    private func configureOverlay() {
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = "QR 코드를 카메라 중앙에 맞춰주세요"
        label.textColor = .white
        label.font = .boldSystemFont(ofSize: 18)
        label.textAlignment = .center
        label.numberOfLines = 0

        let cancel = UIButton(type: .system)
        cancel.translatesAutoresizingMaskIntoConstraints = false
        cancel.setTitle("취소", for: .normal)
        cancel.setTitleColor(.white, for: .normal)
        cancel.titleLabel?.font = .boldSystemFont(ofSize: 17)
        cancel.backgroundColor = UIColor.black.withAlphaComponent(0.55)
        cancel.layer.cornerRadius = 20
        cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)

        view.addSubview(label)
        view.addSubview(cancel)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            label.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
            cancel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            cancel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            cancel.widthAnchor.constraint(equalToConstant: 120),
            cancel.heightAnchor.constraint(equalToConstant: 44)
        ])
    }

    private func finish(value: String?, notifyCancel: Bool = false) {
        guard !finished else { return }
        finished = true
        captureSession.stopRunning()
        dismiss(animated: true) {
            if let value {
                self.onResult?(value)
            } else if notifyCancel {
                self.onCancel?()
            }
        }
    }
}
