import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import {
  createState,
  createBinding,
  createComputed,
  createMemo,
  createExternal,
  For,
  onMount,
  onCleanup,
} from "gnim"
import AstalBattery from "gi://AstalBattery"
import AstalBluetooth from "gi://AstalBluetooth"
import AstalNetwork from "gi://AstalNetwork"
import AstalTray from "gi://AstalTray"
import AstalWp from "gi://AstalWp"
import AstalHyprland from "gi://AstalHyprland"
import GLib from "gi://GLib"
import QuickMenu from "./QuickMenu"
import { getTrayEntryForClass, iconExists, FALLBACK_ICON, resolveIcon, DOCKER_ICON_CANDIDATES } from "./tray-app-registry"
import WorkspaceCircles from "./WorkspaceCircles"

function getTimeParts(): { hour: string; minute: string } {
  const now = new Date()
  return {
    hour: now.getHours().toString().padStart(2, "0"),
    minute: now.getMinutes().toString().padStart(2, "0"),
  }
}


export default function Bar(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT, BOTTOM } = Astal.WindowAnchor
  const [trayOpen, setTrayOpen] = createState(false)
  const [quickMenuOpen, setQuickMenuOpen] = createState(false)
  const [timeParts, setTimeParts] = createState(getTimeParts())
  const hourLabel = createMemo(() => timeParts().hour)
  const minuteLabel = createMemo(() => timeParts().minute)

  onMount(() => {
    const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
      setTimeParts(getTimeParts())
      return true
    })
    onCleanup(() => GLib.source_remove(id))

    QuickMenu(gdkmonitor, quickMenuOpen, () => setQuickMenuOpen(false))
  })

  let battery: ReturnType<typeof AstalBattery.get_default> | null = null
  let network: ReturnType<typeof AstalNetwork.get_default> | null = null
  let bluetooth: ReturnType<typeof AstalBluetooth.get_default> | null = null
  let tray: ReturnType<typeof AstalTray.get_default> | null = null
  let speaker: AstalWp.Endpoint | null = null
  let hypr: ReturnType<typeof AstalHyprland.get_default> | null = null
  try { battery = AstalBattery.get_default() } catch {}
  try { network = AstalNetwork.get_default() } catch {}
  try { bluetooth = AstalBluetooth.get_default() } catch {}
  try { tray = AstalTray.get_default() } catch {}
  try {
    const wp = AstalWp.get_default()
    speaker = wp.get_audio().get_default_speaker()
  } catch {}
  try {
    hypr = AstalHyprland.get_default()
  } catch {}

  type AppEntry = {
    id: string
    name: string
    icon: string
  }

  const [focusedAppKey, setFocusedAppKey] = createState<string>("")

  // Bump a counter whenever Hyprland's client list changes so appEntries recomputes.
  const clientsTick = createExternal(0, (set) => {
    if (!hypr) return () => {}
    const h = hypr as any
    const bump = () => set((v: number) => v + 1)
    const idClients = h.connect?.("notify::clients", bump)
    const idAdded = h.connect?.("client-added", bump)
    const idRemoved = h.connect?.("client-removed", bump)
    // Initial tick so we read the current clients once.
    bump()
    return () => {
      if (idClients) h.disconnect(idClients)
      if (idAdded) h.disconnect(idAdded)
      if (idRemoved) h.disconnect(idRemoved)
    }
  })

  const appEntries = createMemo<AppEntry[]>(() => {
    // Depend on clientsTick so changes in Hyprland clients trigger recompute.
    clientsTick()
    if (!hypr) return []
    const rawClients = (hypr as any).clients as AstalHyprland.Client[] | undefined
    if (!Array.isArray(rawClients)) return []

    // Hide only obvious utilities; everything else that has a registry entry shows.
    const excludedClassFragments = [
      "kitty",
      "alacritty",
      "wezterm",
      "foot",
      "fcitx",
      "pavucontrol",
      "blueman",
      "nm-applet",
      "network-manager",
      "copyq",
    ]

    const byKey = new Map<string, AppEntry>()

    for (const c of rawClients) {
      try {
        if (!c.get_mapped || !c.get_mapped()) continue
        if (c.get_hidden && c.get_hidden()) continue

        const klass = (c.get_class?.() || (c as any).class || "").trim()
        const initialClass = (c.get_initial_class?.() || (c as any).initial_class || "").trim()
        const title = (c.get_title?.() || (c as any).title || "").trim()

        const bestClass = klass || initialClass || ""
        const key = bestClass.toLowerCase()
        if (!key) continue

        if (excludedClassFragments.some((frag) => key.includes(frag))) continue
        if (byKey.has(key)) continue

        const trayEntry = getTrayEntryForClass(bestClass)
        if (!trayEntry) continue
        // Allow tray-only apps (docker, spotify) to show even with fallback icon
        const isTrayOnly = key.includes("docker") || key.includes("spotify")
        if (!isTrayOnly && trayEntry.icon === "application-x-executable-symbolic") continue

        byKey.set(key, {
          id: key,
          name: title || bestClass || "App",
          icon: trayEntry.icon,
        })
      } catch {
        continue
      }
    }

    return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name))
  })

  // App subsets for tray vs bar
  const dockerAppEntries = createComputed(() =>
    appEntries().filter((app) => app.id.includes("docker")),
  )
  const spotifyAppEntries = createComputed(() =>
    appEntries().filter((app) => app.id.includes("spotify")),
  )
  const barAppEntries = createComputed(() =>
    appEntries().filter(
      (app) => !app.id.includes("docker") && !app.id.includes("spotify"),
    ),
  )

  if (hypr) {
    try {
      const updateFocused = () => {
        try {
          const fc = (hypr as any).focused_client as AstalHyprland.Client | null | undefined
          if (!fc) {
            setFocusedAppKey("")
            return
          }
          const klass = (fc.get_class?.() || (fc as any).class || "").trim()
          const initialClass = (fc.get_initial_class?.() || (fc as any).initial_class || "").trim()
          const bestClass = klass || initialClass || ""
          setFocusedAppKey(bestClass.toLowerCase())
        } catch {
          setFocusedAppKey("")
        }
      }
      updateFocused()
      ;(hypr as any).connect?.("notify::focused-client", updateFocused)
    } catch {}
  }

  const wifiStrength = network
    ? (() => {
        const strengthBinding = createBinding(network!, "wifi", "strength")
        return createComputed(() => Number(strengthBinding() ?? 0))
      })()
    : createMemo(() => 0)
  const wifiEnabled = network
    ? (() => {
        const enabledBinding = createBinding(network!, "wifi", "enabled")
        return createComputed(() => Boolean(enabledBinding()))
      })()
    : createMemo(() => false)

  const wifiIcon = createComputed(() => {
    if (!wifiEnabled()) return "network-wireless-disabled-symbolic"
    const strength = wifiStrength()
    if (strength < 15) return "network-wireless-signal-none-symbolic"
    if (strength < 40) return "network-wireless-signal-weak-symbolic"
    if (strength < 65) return "network-wireless-signal-ok-symbolic"
    if (strength < 85) return "network-wireless-signal-good-symbolic"
    return "network-wireless-signal-excellent-symbolic"
  })
  const wifiIconClass = createComputed(() =>
    wifiEnabled() ? "bar-status-icon wifi-enabled-icon" : "bar-status-icon wifi-disabled-icon"
  )

  const wifiSsid = network
    ? (() => {
        const wifiBinding = createBinding(network!, "wifi")
        return createComputed(() => (wifiBinding() as { ssid?: string } | null)?.ssid ?? "—")
      })()
    : createMemo(() => "—")

  const btConnected = bluetooth
    ? createBinding(bluetooth, "is_connected").as(Boolean)
    : createMemo(() => false)
  const btPowered = bluetooth
    ? createBinding(bluetooth, "is_powered").as(Boolean)
    : createMemo(() => false)
  const bluetoothIcon = createComputed(() =>
    btPowered() ? (btConnected() ? "bluetooth-active-symbolic" : "bluetooth-symbolic") : "bluetooth-disabled-symbolic"
  )
  const bluetoothIconClass = createComputed(() =>
    btPowered()
      ? "bar-status-icon bluetooth-enabled-icon"
      : "bar-status-icon bluetooth-disabled-icon"
  )

  const volumeLevel = speaker
    ? createBinding(speaker, "volume").as((v) => Math.round(Number(v ?? 0) * 100))
    : createMemo(() => 0)
  const volumeMuted = speaker
    ? createBinding(speaker, "mute")
    : createMemo(() => false)

  const volumeIcon = createComputed(() => {
    if (volumeMuted() || volumeLevel() === 0) return "audio-volume-muted-symbolic"
    if (volumeLevel() < 34) return "audio-volume-low-symbolic"
    if (volumeLevel() < 67) return "audio-volume-medium-symbolic"
    return "audio-volume-high-symbolic"
  })
  const volumeIconClass = createComputed(() =>
    volumeMuted() || volumeLevel() < 34
      ? "bar-status-icon sound-low-icon"
      : "bar-status-icon sound-enabled-icon"
  )
  const volumeTooltip = createComputed(() =>
    volumeMuted() ? "Muted" : `${volumeLevel()}%`
  )

  const batteryPercent = battery
    ? createBinding(battery, "percentage").as((v) => {
        const raw = Number(v ?? 0)
        return Number.isFinite(raw) ? (raw <= 1 ? Math.round(raw * 100) : Math.round(raw)) : 0
      })
    : createMemo(() => 0)
  const batteryCharging = battery
    ? createBinding(battery, "charging")
    : createMemo(() => false)
  const batteryIcon = createComputed(() => {
    const pct = batteryPercent()
    const charging = batteryCharging()
    if (charging) return "battery-full-charging-symbolic"
    if (pct <= 10) return "battery-empty-symbolic"
    if (pct <= 30) return "battery-caution-symbolic"
    if (pct <= 50) return "battery-low-symbolic"
    if (pct <= 80) return "battery-good-symbolic"
    return "battery-full-symbolic"
  })
  const batteryIconClass = createComputed(() => {
    const pct = batteryPercent()
    if (pct <= 20) return "bar-status-icon battery-low-icon"
    return "bar-status-icon battery-icon"
  })

  const trayItems = tray
    ? createBinding(tray, "items")
    : createMemo(() => [] as InstanceType<typeof AstalTray.TrayItem>[])

  const visibleTrayItems = createMemo(() => {
    const list = trayItems()
    if (!Array.isArray(list)) return []
    const filtered = list.filter((item) => {
      if (item.status === AstalTray.Status.PASSIVE) return false
      const sig = `${item.id} ${item.title} ${item.icon_name} ${item.tooltip_text}`.toLowerCase()
      // Hide known duplicates / system items we represent from Hyprland
      if (
        sig.includes("nm-applet") ||
        sig.includes("networkmanager") ||
        sig.includes("network") ||
        sig.includes("wireless") ||
        sig.includes("wifi") ||
        sig.includes("wlan") ||
        sig.includes("spotify") ||
        sig.includes("fcitx") ||
        sig.includes("docker")
      ) {
        return false
      }
      // Hide any item that looks like Docker (native tray Docker – we show Hyprland Docker only)
      const label = `${item.id} ${item.title} ${item.tooltip_text}`.toLowerCase()
      if (label.includes("docker")) return false
      return true
    })
    return filtered
  })

  return (
    <window
      visible
      name="bar"
      class="bar"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      anchor={LEFT | TOP | BOTTOM}
      application={app}
    >
      <box
        class="bar-body"
        orientation={Gtk.Orientation.VERTICAL}
        halign={Gtk.Align.START}
        valign={Gtk.Align.FILL}
        width_request={40}
        vexpand
      >
        <box
          class="inner-bar"
          orientation={Gtk.Orientation.VERTICAL}
          valign={Gtk.Align.FILL}
          width_request={36}
          vexpand
        >
          <WorkspaceCircles />
          <box class="bar-spacer" orientation={Gtk.Orientation.VERTICAL} vexpand />
          <box
            class="bar-bottom"
            orientation={Gtk.Orientation.VERTICAL}
            valign={Gtk.Align.END}
          >
            <box class="bar-tray-toggle-row" orientation={Gtk.Orientation.VERTICAL}>
              <revealer
                class="bar-tray-revealer"
                transition_type={Gtk.RevealerTransitionType.SLIDE_UP}
                transition_duration={220}
                reveal_child={trayOpen}
              >
                <box class="bar-tray-popup" orientation={Gtk.Orientation.VERTICAL}>
                  {/* Spotify and Docker apps represented as tray apps, sourced from Hyprland appEntries. */}
                  <For each={spotifyAppEntries}>
                    {(app) => (
                      <box
                        class="bar-tray-item"
                        orientation={Gtk.Orientation.VERTICAL}
                      >
                        <button
                          class="bar-tray-app-btn"
                          tooltip_text={app.name}
                          onClicked={() => {}}
                        >
                          <image class="bar-tray-app-icon" icon_name={app.icon} />
                        </button>
                      </box>
                    )}
                  </For>

                  <For each={dockerAppEntries}>
                    {(app) => {
                      // Resolve Docker icon at render time; try all known candidate names
                      const dockerIcon = resolveIcon("docker", DOCKER_ICON_CANDIDATES.filter((c) => c !== "docker"))
                      return (
                        <box
                          class="bar-tray-item"
                          orientation={Gtk.Orientation.VERTICAL}
                        >
                          <button
                            class="bar-tray-app-btn"
                            tooltip_text={app.name}
                            onClicked={() => {}}
                          >
                            <image class="bar-tray-app-icon" icon_name={dockerIcon} />
                          </button>
                        </box>
                      )
                    }}
                  </For>

                  {/* Native system tray items (excluding fcitx, docker, etc). */}
                  <For each={visibleTrayItems}>
                    {(item) => {
                      const sig = `${item.id} ${item.title} ${item.icon_name}`.toLowerCase()
                      let iconName: string

                      iconName =
                        iconExists(item.icon_name) && item.icon_name
                          ? item.icon_name
                          : FALLBACK_ICON

                      return (
                        <box
                          class="bar-tray-item"
                          orientation={Gtk.Orientation.VERTICAL}
                        >
                          <button
                            class="bar-tray-app-btn"
                            tooltip_text={item.tooltip_text || item.title || item.id}
                            onClicked={() => {
                              if (item.is_menu) {
                                item.about_to_show()
                                item.secondary_activate(0, 0)
                                return
                              }
                              item.activate(0, 0)
                            }}
                          >
                            <image
                              class="bar-tray-app-icon"
                              icon_name={iconName}
                            />
                          </button>
                        </box>
                      )
                    }}
                  </For>
                </box>
              </revealer>
              <button
                class="bar-tray-toggle"
                label={trayOpen((o) => (o ? "‹" : "›"))}
                onClicked={() => setTrayOpen((o) => !o)}
              />
            </box>
            <box class="bar-apps" orientation={Gtk.Orientation.VERTICAL}>
              <For each={barAppEntries}>
                {(app) => (
                  <button
                    class={focusedAppKey((key) =>
                      key === app.id ? "bar-app-btn focused" : "bar-app-btn",
                    )}
                    tooltip_text={app.name}
                    onClicked={() => {}}
                  >
                    <image class="bar-app-icon" icon_name={app.icon} />
                  </button>
                )}
              </For>
            </box>
            <box class="bar-time" orientation={Gtk.Orientation.VERTICAL}>
              <label class="bar-time-hour" label={hourLabel} />
              <label class="bar-time-minute" label={minuteLabel} />
            </box>
            <button
              class="bar-status-group"
              onClicked={() => setQuickMenuOpen((o) => !o)}
            >
              <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
                <image class={wifiIconClass} icon_name={wifiIcon} />
                <image class={bluetoothIconClass} icon_name={bluetoothIcon} />
                <image class={volumeIconClass} icon_name={volumeIcon} />
                <image class={batteryIconClass} icon_name={batteryIcon} />
              </box>
            </button>
          </box>
        </box>
      </box>
    </window>
  )
}
