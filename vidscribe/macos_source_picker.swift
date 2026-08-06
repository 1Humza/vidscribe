import AppKit

final class PickerApplicationDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.main.async {
            NSApp.activate(ignoringOtherApps: true)

            let panel = NSOpenPanel()
            panel.canChooseFiles = true
            panel.canChooseDirectories = true
            panel.allowsMultipleSelection = false
            panel.canCreateDirectories = false
            panel.prompt = "Choose"
            panel.message = "Choose Source Media or a Completed Session Folder"

            if let initialPath = CommandLine.arguments.dropFirst().first {
                let url = URL(fileURLWithPath: initialPath)
                panel.directoryURL = url.hasDirectoryPath ? url : url.deletingLastPathComponent()
            }

            if panel.runModal() == .OK, let selected = panel.url {
                FileHandle.standardOutput.write(Data("\(selected.path)\n".utf8))
            }
            NSApp.terminate(nil)
        }
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.regular)
let delegate = PickerApplicationDelegate()
application.delegate = delegate
application.run()
