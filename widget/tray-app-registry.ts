import { Gtk, Gdk } from "ags/gtk4"

/**
 * Central app registry for the tray: maps WM class (or part of it) to icon and optional launch command.
 * Add entries here to customize icons and quick-launch for running apps.
 */
export type TrayAppEntry = {
  icon: string
  /** Executable to run if not already running; leave empty to only focus. */
  exec?: string
}

/** Match by lowercase WM class containing this string; value is icon + optional exec. */
export const TRAY_APP_REGISTRY: Record<string, TrayAppEntry> = {
  spotify: { icon: "spotify", exec: "spotify" },
  // Docker Desktop (Hyprland class "Docker Desktop"). Use the icon name
  // that actually exists in your theme (Papirus ships docker-desktop).
  docker: { icon: "docker-desktop", exec: "docker-desktop" },
  "docker desktop": { icon: "docker-desktop", exec: "docker-desktop" },
  code: { icon: "code", exec: "code" },
  firefox: { icon: "firefox", exec: "firefox" },
  chromium: { icon: "chromium", exec: "chromium" },
  "google-chrome": { icon: "google-chrome", exec: "google-chrome" },
  kitty: { icon: "kitty", exec: "kitty" },
  alacritty: { icon: "Alacritty", exec: "alacritty" },
  wezterm: { icon: "org.wezfurlong.wezterm", exec: "wezterm" },
  nautilus: { icon: "org.gnome.Nautilus", exec: "nautilus" },
  thunar: { icon: "thunar", exec: "thunar" },
}

export const FALLBACK_ICON = "application-x-executable-symbolic"

function getIconTheme(): Gtk.IconTheme | null {
  try {
    const display = Gdk.Display.get_default()
    if (!display) return null
    return Gtk.IconTheme.get_for_display(display)
  } catch {
    return null
  }
}

export function iconExists(iconName: string | null | undefined): boolean {
  if (!iconName) return false
  const theme = getIconTheme()
  if (!theme) return false
  try {
    return theme.has_icon(iconName)
  } catch {
    return false
  }
}

/** Try primary icon, then fallbacks; return first that exists or FALLBACK_ICON. */
export function resolveIcon(primary: string, fallbacks: string[] = []): string {
  if (iconExists(primary)) return primary
  for (const name of fallbacks) {
    if (iconExists(name)) return name
  }
  return FALLBACK_ICON
}

/** Icon name alternatives for apps where themes differ. Try app names first, then folder/places as last resort (MoreWaita has folder-docker only). */
export const DOCKER_ICON_CANDIDATES = [
  "docker",
  "docker-desktop",
  "com.docker.docker",
  "com.docker.desktop",
  "folder-docker",
  "folder-docker-symbolic",
]

const ICON_FALLBACKS: Record<string, string[]> = {
  "docker": DOCKER_ICON_CANDIDATES,
  "docker desktop": DOCKER_ICON_CANDIDATES,
}

export function getTrayEntryForClass(wmClass: string): TrayAppEntry {
  const key = Object.keys(TRAY_APP_REGISTRY).find(
    (k) => wmClass && wmClass.toLowerCase().includes(k.toLowerCase())
  )
  const base = key ? TRAY_APP_REGISTRY[key] : { icon: FALLBACK_ICON }
  const fallbacks = key ? ICON_FALLBACKS[key] : undefined
  const icon = fallbacks
    ? resolveIcon(base.icon, fallbacks)
    : resolveIcon(base.icon)
  if (icon === FALLBACK_ICON && base.icon !== FALLBACK_ICON) {
    return { ...base, icon: FALLBACK_ICON }
  }
  return { ...base, icon }
}
