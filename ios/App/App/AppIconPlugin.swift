import UIKit
import Capacitor

@objc(AppIconPlugin)
public class AppIconPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppIconPlugin"
    public let jsName = "AppIcon"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setIcon", returnType: CAPPluginReturnPromise)
    ]

    @objc func setIcon(_ call: CAPPluginCall) {
        let iconName = call.getString("iconName")

        DispatchQueue.main.async {
            guard UIApplication.shared.supportsAlternateIcons else {
                call.reject("Alternate app icons are not supported on this device.")
                return
            }

            UIApplication.shared.setAlternateIconName(iconName) { error in
                if let error = error {
                    call.reject(error.localizedDescription)
                    return
                }

                call.resolve([
                    "iconName": iconName ?? NSNull()
                ])
            }
        }
    }
}
