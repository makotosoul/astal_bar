import app from "ags/gtk4/app"
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

// Strip @ rules that GTK 4 CSS parser doesn't support (e.g. @charset from compiled SCSS)
function stripUnsupportedAtRules(css: string): string {
  return css
    .replace(/^@charset\s+[^;]*;\s*$/gm, "")
    .replace(/^@import\s+[^;]*;\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// 3. Add the new SCSS variable to your combined string
const combinedCss = stripUnsupportedAtRules(
  `${style}\n${barStyle}\n${quickmenuStyle}\n${systemEventNotiStyle}`
)

app.start({
  css: combinedCss,
  main() {
    app.get_monitors().map(Bar)
    app.get_monitors().map(systemEventNoti)
  },
})
