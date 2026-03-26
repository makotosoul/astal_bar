import app from "ags/gtk4/app"
import GLib from "gi://GLib" // <-- Add this import so we can use the timeout!
import style from "./style.scss"
import barStyle from "./bar.scss"
import quickmenuStyle from "./quickmenu.scss"
import Bar from "./widget/Bar"
import systemEventNotiStyle from "./systemEventNoti.scss"
import systemEventNoti from "./widget/systemEventNoti"

// Set libadwaita color scheme before any GTK code reads gtk-application-prefer-dark-theme
try {
  const Adw = (await import("gi://Adw?version=1")).default
  Adw.StyleManager.get_default().color_scheme = Adw.ColorScheme.PREFER_DARK
} catch {
  // libadwaita not available
}

// Strip @ rules that GTK 4 CSS parser doesn't support
function stripUnsupportedAtRules(css: string): string {
  return css
    .replace(/^@charset\s+[^;]*;\s*$/gm, "")
    .replace(/^@import\s+[^;]*;\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const combinedCss = stripUnsupportedAtRules(
  `${style}\n${barStyle}\n${quickmenuStyle}\n${systemEventNotiStyle}`
)

app.start({
  css: combinedCss,
  main() {
    let hasInitialized = false

    const setupUI = () => {
      // If we already successfully drew the widgets, stop checking.
      if (hasInitialized) return

      const monitors = app.get_monitors()

      if (monitors.length > 0) {
        // Wayland finally announced the monitors! Lock it in.
        hasInitialized = true
        
        // Grab the primary monitor (your laptop screen)
        const primaryMonitor = monitors[0]
        
        try {
          Bar(primaryMonitor)
          systemEventNoti(primaryMonitor)
        } catch (err) {
          console.error("Failed to create UI:", err)
        }
      } else {
        // Wayland is still calculating the mirror layout. 
        // Wait 50ms and check again!
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
          setupUI()
          return GLib.SOURCE_REMOVE // Tells GTK to stop this specific timeout tick
        })
      }
    }

    // Start the checking loop
    setupUI()
  },
})