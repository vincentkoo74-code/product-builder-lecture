import Capacitor

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(AppIconPlugin())
        bridge?.registerPluginInstance(QRScannerPlugin())
    }
}
