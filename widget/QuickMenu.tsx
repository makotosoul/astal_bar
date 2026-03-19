import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import {
  createState,
  createBinding,
  createComputed,
  createMemo,
  For,
  onMount,
  onCleanup,
} from "gnim"
import AstalNetwork from "gi://AstalNetwork"
import AstalBluetooth from "gi://AstalBluetooth"
import AstalWp from "gi://AstalWp"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import DevicePanel from "./DevicePanel"

function WifiPasswordDialog(
  gdkmonitor: Gdk.Monitor,
  visible: () => boolean,
  ssidLabel: () => string | null,
  onConnect: (password: string) => void,
  onCancel: () => void,
) {
  const { LEFT, BOTTOM } = Astal.WindowAnchor
  const isVisible = createComputed(visible)
  let entryRef: Gtk.Entry | null = null
  return (
    <window
      visible={isVisible}
      name="wifi-password-dialog"
      class="device-panel wifi-password-dialog"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.NORMAL}
      layer={Astal.Layer.TOP}
      keymode={Astal.Keymode.NONE}
      anchor={LEFT | BOTTOM}
      marginBottom={14}
      marginLeft={314}
      application={app}
    >
      <box class="dp-shell">
        <box
          class="dp-body"
          orientation={Gtk.Orientation.VERTICAL}
          spacing={8}
        >
          <label
            class="dp-title"
            label={createComputed(() => `Connect to ${ssidLabel() ?? ""}`)}
            halign={Gtk.Align.START}
          />
          <box class="dp-divider" />
          <entry
            visibility={false}
            placeholder_text="Password"
            hexpand
            $={(self) => {
              entryRef = self
              self.set_input_purpose(Gtk.InputPurpose.PASSWORD)
            }}
          />
          <box orientation={Gtk.Orientation.HORIZONTAL} spacing={8}>
            <button
              label="Cancel"
              onClicked={() => {
                if (entryRef) entryRef.set_text("")
                onCancel()
              }}
            />
            <button
              label="Connect"
              onClicked={() => {
                if (entryRef) {
                  const pass = entryRef.get_text() ?? ""
                  entryRef.set_text("")
                  onConnect(pass)
                }
                onCancel()
              }}
            />
          </box>
        </box>
      </box>
    </window>
  )
}

const INPUT_METHODS = [
  { name: "EN", xkb: "us", fcitxIm: null, label: "English US" },
  { name: "VN", xkb: "us", fcitxIm: "unikey", label: "Vietnamese (Unikey)" },
  { name: "FI", xkb: "fi", fcitxIm: null, label: "Finnish" },
] as const

function applyInputMethod(entry: (typeof INPUT_METHODS)[number]) {
  try {
    GLib.spawn_command_line_async(`hyprctl keyword input:kb_layout ${entry.xkb}`)
    if (entry.fcitxIm) {
      GLib.spawn_command_line_async(`fcitx5-remote -s ${entry.fcitxIm}`)
      GLib.spawn_command_line_async("fcitx5-remote -o")
    } else {
      GLib.spawn_command_line_async("fcitx5-remote -c")
    }
  } catch (e) {
    console.error("[keyboard] applyInputMethod failed:", e)
  }
}

let cachedBacklightBase: string | null | undefined = undefined

function findBacklightBase(): string | null {
  if (cachedBacklightBase !== undefined) return cachedBacklightBase
  try {
    const iter = Gio.File.new_for_path("/sys/class/backlight").enumerate_children(
      "standard::name",
      Gio.FileQueryInfoFlags.NONE,
      null,
    )
    const info = iter.next_file(null)
    iter.close(null)
    if (!info) {
      cachedBacklightBase = null
      return null
    }
    cachedBacklightBase = `/sys/class/backlight/${info.get_name()}`
    return cachedBacklightBase
  } catch (e) {
    console.error("[brightness] findBacklightBase failed:", e)
    cachedBacklightBase = null
    return null
  }
}

function readBrightness(): number {
  try {
    const base = findBacklightBase()
    if (!base) return 0.5
    const readNum = (path: string): number => {
      const [ok, data] = GLib.file_get_contents(path)
      if (!ok || !data) return 0
      return parseInt(new TextDecoder().decode(data).trim())
    }
    const cur = readNum(`${base}/brightness`)
    const max = readNum(`${base}/max_brightness`)
    if (!Number.isFinite(cur) || !Number.isFinite(max) || max <= 0) return 0.5
    return Math.max(0, Math.min(1, cur / max))
  } catch {
    return 0.5
  }
}

function applyBrightness(fraction: number): void {
  try {
    const pct = Math.round(5 + Math.max(0, Math.min(1, fraction)) * 95)
    GLib.spawn_command_line_async(`brightnessctl set ${pct}%`)
  } catch (e) {
    console.error("[brightness] applyBrightness failed:", e)
  }
}

interface BtDevice {
  mac: string
  name: string
  connected: boolean
}

function runBtCmd(args: string): string {
  try {
    const [ok, stdout] = GLib.spawn_command_line_sync(`bluetoothctl ${args}`)
    if (!ok || !stdout) return ""
    return new TextDecoder().decode(stdout).trim()
  } catch (e) {
    console.error("[bluetooth] command failed:", args, e)
    return ""
  }
}

function listBtDevices(): BtDevice[] {
  const output = runBtCmd("devices")
  if (!output) return []
  const devices: BtDevice[] = []
  for (const line of output.split("\n")) {
    const match = line.match(/^Device\s+([0-9A-Fa-f:]{17})\s+(.+)$/)
    if (!match) continue
    const mac = match[1]
    const info = runBtCmd(`info ${mac}`)
    const connected = /Connected:\s*yes/i.test(info)
    devices.push({ mac, name: match[2], connected })
  }
  return devices
}

export default function QuickMenu(
  gdkmonitor: Gdk.Monitor,
  open: () => boolean,
  close: () => void,
) {
  const { LEFT, BOTTOM } = Astal.WindowAnchor
  const [windowVisible, setWindowVisible] = createState(false)
  const [revealed, setRevealed] = createState(false)
  let hideTimeoutId: number | null = null

  const revealChild = createComputed(() => revealed())

  const isVisible = createComputed(() => {
    const o = open()
    const visibleNow = windowVisible()

    if (o) {
      if (hideTimeoutId !== null) {
        GLib.source_remove(hideTimeoutId)
        hideTimeoutId = null
      }
      if (!visibleNow) {
        setWindowVisible(true)
        setRevealed(false)
      }
      return true
    }

    if (!o && visibleNow && hideTimeoutId === null) {
      if (revealed()) setRevealed(false)
      hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 280, () => {
        setWindowVisible(false)
        hideTimeoutId = null
        return GLib.SOURCE_REMOVE
      })
    }

    return windowVisible()
  })

  /** Delay (ms) after map before triggering reveal so the hidden state is painted and the slide-in is smooth. */
  const OPEN_REVEAL_DELAY_MS = 66

  /** After revealer is mapped, wait a bit then set_reveal_child(true) so GTK runs the slide transition smoothly. */
  function onRevealerMapped(revealer: Gtk.Revealer) {
    if (revealed()) return
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, OPEN_REVEAL_DELAY_MS, () => {
      if (!open() || !windowVisible()) return GLib.SOURCE_REMOVE
      revealer.set_reveal_child(true)
      setRevealed(true)
      return GLib.SOURCE_REMOVE
    })
  }

  // ── Services ─────────────────────────────────────────────────────────────
  let network: ReturnType<typeof AstalNetwork.get_default> | null = null
  let bluetooth: ReturnType<typeof AstalBluetooth.get_default> | null = null
  let audio: AstalWp.Audio | null = null
  let speaker: AstalWp.Endpoint | null = null

  try { network = AstalNetwork.get_default() } catch {}
  try { bluetooth = AstalBluetooth.get_default() } catch {}
  try {
    const wp = AstalWp.get_default()
    audio = wp.get_audio()
    speaker = audio.get_default_speaker()
  } catch {}

  // ── Wi-Fi ─────────────────────────────────────────────────────────────────
  const wifi = network?.get_wifi() ?? null
  const wifiEnabled = wifi
    ? createBinding(wifi, "enabled").as(Boolean)
    : createMemo(() => false)

  const wifiIcon = createComputed(() =>
    wifiEnabled()
      ? "network-wireless-symbolic"
      : "network-wireless-disabled-symbolic"
  )

  // ── Wi‑Fi panel (libastal-network: wifi.get_access_points(), ap.activate(), wifi.scan()) ─
  const [wifiPanelOpen, setWifiPanelOpen] = createState(false)
  const [wifiApList, setWifiApList] = createState<InstanceType<typeof AstalNetwork.AccessPoint>[]>([])
  const [connectingApPath, setConnectingApPath] = createState("")
  const [passwordForApPath, setPasswordForApPath] = createState<string | null>(null)

  const wifiScanning = wifi
    ? createBinding(wifi, "scanning").as(Boolean)
    : createMemo(() => false)

  const activeWifiAp = wifi
    ? createBinding(wifi, "active_access_point").as((v: unknown) => v as InstanceType<typeof AstalNetwork.AccessPoint> | null)
    : createMemo(() => null)

  const wifiPanelItems = createComputed(() => {
    const aps = wifiApList()
    const active = activeWifiAp() ?? null
    return aps.map((ap) => {
      const path = ap.get_path()
      const ssid = ap.get_ssid() ?? "(hidden)"
      const isActive = active !== null && active.get_path() === path
      return {
        id: path,
        name: ssid,
        active: isActive,
        icon: isActive ? "network-wireless-acquiring-symbolic" : "network-wireless-signal-good-symbolic",
      }
    })
  })

  const passwordDialogSsid = createComputed(() => {
    const path = passwordForApPath()
    if (!path || !wifi) return null
    const ap = wifi.get_access_points().find((a) => a.get_path() === path)
    return ap?.get_ssid() ?? null
  })

  function refreshWifiNetworks() {
    if (wifi) setWifiApList([...wifi.get_access_points()])
  }

  function startWifiScan() {
    wifi?.scan()
  }

  function connectWifiWithPassword(password: string) {
    const path = passwordForApPath()
    setPasswordForApPath(null)
    if (!path || !wifi) return
    const ap = wifi.get_access_points().find((a) => a.get_path() === path)
    if (!ap) return
    setConnectingApPath(path)
    ap.activate(password).catch(() => {}).finally(() => {
      refreshWifiNetworks()
      setConnectingApPath("")
    })
  }

  if (wifi) {
    onMount(() => {
      const w = wifi as unknown as { connect: (s: string, c: () => void) => number; disconnect: (id: number) => void }
      const sync = () => setWifiApList([...wifi.get_access_points()])
      const idAp = w.connect("notify::access-points", sync)
      const idAdd = w.connect("access-point-added", sync)
      const idRem = w.connect("access-point-removed", sync)
      onCleanup(() => {
        w.disconnect(idAp)
        w.disconnect(idAdd)
        w.disconnect(idRem)
      })
    })
  }

  const btPowered = bluetooth
    ? createBinding(bluetooth, "is_powered").as(Boolean)
    : createMemo(() => false)

  const btIcon = createComputed(() =>
    btPowered() ? "bluetooth-active-symbolic" : "bluetooth-disabled-symbolic"
  )

  // ── Bluetooth panel ────────────────────────────────────────────────────
  const [btPanelOpen, setBtPanelOpen] = createState(false)
  const [btDevices, setBtDevices] = createState<BtDevice[]>([])
  const [btScanning, setBtScanning] = createState(false)
  const [connectingMac, setConnectingMac] = createState("")

  const btPanelItems = createComputed(() =>
    btDevices().map((d) => ({
      id: d.mac,
      name: d.name,
      active: d.connected,
      icon: d.connected ? "bluetooth-active-symbolic" : "bluetooth-symbolic",
    })),
  )

  function refreshBtDevices() {
    setBtDevices(listBtDevices())
  }

  function startBtScan() {
    setBtScanning(true)
    GLib.spawn_command_line_async("bluetoothctl --timeout 5 scan on")
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5500, () => {
      refreshBtDevices()
      setBtScanning(false)
      return GLib.SOURCE_REMOVE
    })
  }

  // ── Keyboard Layout ────────────────────────────────────────────────────
  const [kbIndex, setKbIndex] = createState(0)
  const kbLabel = createComputed(() => INPUT_METHODS[kbIndex()].name)
  const kbTooltip = createComputed(() => INPUT_METHODS[kbIndex()].label)

  // ── Volume ────────────────────────────────────────────────────────────────
  let currentSpk: AstalWp.Endpoint | null = speaker
  let volSliderRef: { min: number; max: number; value: number } | null = null

  const [vol, setVol] = createState(speaker?.volume ?? 0)
  const [muted, setMuted] = createState(speaker?.mute ?? false)

  let volUnsub: (() => void) | null = null
  let muteUnsub: (() => void) | null = null

  function bindSpeaker(spk: AstalWp.Endpoint | null) {
    volUnsub?.()
    muteUnsub?.()
    currentSpk = spk
    if (!spk) return
    const vBind = createBinding(spk, "volume")
    const mBind = createBinding(spk, "mute")
    // ── UPDATED SUBSCRIBERS ──────────────────────────────────────
    volUnsub = vBind.subscribe(() => {
      const v = vBind.peek() as number
      setVol(v)
      // Push the new volume to the slider UI!
      if (volSliderRef && Math.abs(volSliderRef.value - v) > 0.01) {
        volSliderRef.value = v
      }
    })
    muteUnsub = mBind.subscribe(() => setMuted(mBind.peek() as boolean))
    // ─────────────────────────────────────────────────────────────
    const v = spk.volume ?? 0
    setVol(v)
    setMuted(spk.mute ?? false)
    if (volSliderRef) volSliderRef.value = v
  }

  bindSpeaker(speaker)

  // ── Audio panel ─────────────────────────────────────────────────────────
  const [audioPanelOpen, setAudioPanelOpen] = createState(false)
  const [audioItems, setAudioItems] = createState<
    { id: string; name: string; active: boolean; icon: string }[]
  >([])

  function refreshAudioItems() {
    if (!audio) return
    const speakers = (audio as any).get_speakers?.() ?? []
    setAudioItems(
      speakers.map((ep: AstalWp.Endpoint) => ({
        id: String((ep as any).id ?? 0),
        name: ep.description ?? "Unknown",
        active: ep.is_default ?? false,
        icon: ep.icon || "audio-card-symbolic",
      })),
    )
  }

  function selectAudioOutput(id: string) {
    if (!audio) return
    const speakers = (audio as any).get_speakers?.() ?? []
    const target = speakers.find(
      (ep: AstalWp.Endpoint) => String((ep as any).id) === id,
    )
    if (target) {
      target.is_default = true
      if (target.mute) target.mute = false
      if ((target.volume ?? 0) === 0) target.volume = 0.5
    }
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
      refreshAudioItems()
      return GLib.SOURCE_REMOVE
    })
  }

  if (audio) {
    onMount(() => {
      const a = audio as any
      if (!currentSpk) {
        const spk: AstalWp.Endpoint | null =
          a.get_default_speaker?.() ?? a.get_speakers?.()[0] ?? null
        if (spk) bindSpeaker(spk)
      }
      const idSpk = a.connect("notify::default-speaker", () => {
        bindSpeaker(a.get_default_speaker() ?? null)
        refreshAudioItems()
      })
      const idList = a.connect("notify::speakers", () => {
        if (!currentSpk) {
          const spk: AstalWp.Endpoint | null =
            a.get_default_speaker?.() ?? a.get_speakers?.()[0] ?? null
          if (spk) bindSpeaker(spk)
        }
        refreshAudioItems()
      })
      onCleanup(() => {
        a.disconnect(idSpk)
        a.disconnect(idList)
        volUnsub?.()
        muteUnsub?.()
      })
    })
  }

  const volumeIcon = createComputed(() => {
    const v = vol()
    if (muted() || v === 0) return "audio-volume-muted-symbolic"
    if (v < 0.34) return "audio-volume-low-symbolic"
    if (v < 0.67) return "audio-volume-medium-symbolic"
    return "audio-volume-high-symbolic"
  })

// ── Brightness ────────────────────────────────────────────────────────────
  const [brightness, setBrightnessState] = createState(readBrightness())
  let brightSliderRef: any = null

  onMount(() => {
    const base = findBacklightBase()
    if (!base) return
    
    // Monitor the hardware file directly just like the OSD
    const file = Gio.File.new_for_path(`${base}/brightness`)
    const monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null)
    
    const id = monitor.connect("changed", () => {
      const newVal = readBrightness()
      setBrightnessState(newVal)
      // Push the new value to the slider UI if it exists!
      if (brightSliderRef && Math.abs(brightSliderRef.value - newVal) > 0.01) {
        brightSliderRef.value = newVal
      }
    })

    onCleanup(() => {
      monitor.disconnect(id)
      monitor.cancel()
    })
  })

  // ── Device panels (separate windows; QuickMenu is OVERLAY so › always receives clicks) ─
  function closeAllPanels() {
    setBtPanelOpen(false)
    setAudioPanelOpen(false)
    setWifiPanelOpen(false)
    setPasswordForApPath(null)
    close()
  }

  onMount(() => {
    const btVisible = createComputed(() => open() && btPanelOpen())
    DevicePanel(gdkmonitor, btVisible, {
      name: "bt-panel",
      title: "Bluetooth",
      items: btPanelItems,
      onSelect: (id: string) => {
        setConnectingMac(id)
        GLib.spawn_command_line_async(`bluetoothctl connect ${id}`)
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
          refreshBtDevices()
          setConnectingMac("")
          return GLib.SOURCE_REMOVE
        })
      },
      onDisconnect: (id: string) => {
        GLib.spawn_command_line_async(`bluetoothctl disconnect ${id}`)
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
          refreshBtDevices()
          return GLib.SOURCE_REMOVE
        })
      },
      onRefresh: () => startBtScan(),
      scanning: btScanning,
      selectingId: connectingMac,
      actionIcon: btIcon,
      actionActive: btPowered,
      onAction: () => {
        if (bluetooth) bluetooth.toggle()
      },
      actionTooltip: "Toggle Bluetooth power",
      onClose: () => setBtPanelOpen(false),
    })

    const audioVisible = createComputed(() => open() && audioPanelOpen())
    DevicePanel(gdkmonitor, audioVisible, {
      name: "audio-panel",
      title: "Audio Outputs",
      items: audioItems,
      onSelect: selectAudioOutput,
      onDisconnect: null,
      onRefresh: refreshAudioItems,
      scanning: createMemo(() => false),
      selectingId: createMemo(() => ""),
      actionIcon: volumeIcon,
      actionActive: createComputed(() => !muted()),
      onAction: () => {
        if (currentSpk) currentSpk.mute = !currentSpk.mute
      },
      actionTooltip: "Mute / Unmute",
      onClose: () => setAudioPanelOpen(false),
    })

    const wifiVisible = createComputed(() => open() && wifiPanelOpen())
    DevicePanel(gdkmonitor, wifiVisible, {
      name: "wifi-panel",
      title: "Wi‑Fi",
      items: wifiPanelItems,
      onSelect: (id: string) => {
        if (!wifi) return
        const aps = wifi.get_access_points()
        const ap = aps.find((a) => a.get_path() === id)
        if (!ap) return
        const active = wifi.get_active_access_point()
        const isActive = active !== null && active.get_path() === id
        if (isActive) {
          const ac = wifi.get_active_connection()
          if (ac) {
            (network!.get_client() as any).deactivate_connection(ac)
            refreshWifiNetworks()
          }
          return
        }
        if (ap.get_requires_password()) {
          setPasswordForApPath(id)
        } else {
          setConnectingApPath(id)
          ap.activate().catch(() => {}).finally(() => {
            refreshWifiNetworks()
            setConnectingApPath("")
          })
        }
      },
      onDisconnect: (id: string) => {
        if (!wifi) return
        const active = wifi.get_active_access_point()
        if (active !== null && active.get_path() === id) {
          const ac = wifi.get_active_connection()
          if (ac) {
            (network!.get_client() as any).deactivate_connection(ac)
            refreshWifiNetworks()
          }
        }
      },
      onRefresh: () => startWifiScan(),
      scanning: wifiScanning,
      selectingId: connectingApPath,
      actionIcon: wifiIcon,
      actionActive: wifiEnabled,
      onAction: () => {
        if (wifi) wifi.enabled = !wifiEnabled()
      },
      actionTooltip: "Toggle Wi‑Fi",
      onClose: () => setWifiPanelOpen(false),
    })

    const pwVisible = createComputed(() => open() && passwordForApPath() !== null)
    WifiPasswordDialog(
      gdkmonitor,
      pwVisible,
      passwordDialogSsid,
      connectWifiWithPassword,
      () => setPasswordForApPath(null),
    )
  })

  return (
    <window
      visible={isVisible}
      name="quickmenu"
      class="quickmenu"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.NORMAL}
      layer={Astal.Layer.OVERLAY}
      keymode={Astal.Keymode.ON_DEMAND}
      anchor={LEFT | BOTTOM}
      marginBottom={14}
      marginLeft={-2} // 18 - 20px (native margin-right)
      application={app}
      $={(self) => {
        let wasActive = false
        const id = self.connect("notify::is-active", () => {
          if (wasActive && !self.is_active && open()) closeAllPanels()
          wasActive = self.is_active
        })
        onCleanup(() => self.disconnect(id))
      }}
    >
      <box 
      orientation={Gtk.Orientation.HORIZONTAL} 
      halign={Gtk.Align.START}
      // We add a 5px margin-right so the window is 5px wider natively, 
        // preventing the right side from clipping when we shift it right.
        //css={createComputed(() => 
        //  `margin-right: 5px; transform: translateX(${revealed() ? 5 : 0}px); transition: transform 250ms ease;`
        //)}
        // ──────────────────────────────────────────────────────────────

      >
        <revealer
          transition_type={Gtk.RevealerTransitionType.SLIDE_RIGHT}
          transition_duration={400}
          reveal_child={revealChild}
          $={(self) => {
            const id = self.connect("map", () => onRevealerMapped(self))
            onCleanup(() => self.disconnect(id))
          }}
        >
          <box
            class={createComputed(() => revealed() ? "quickmenu-shell open" : "quickmenu-shell")}
            orientation={Gtk.Orientation.VERTICAL}
          >
            <box
              class="quickmenu-body"
              orientation={Gtk.Orientation.VERTICAL}
              spacing={0}
            >
            {/* ── Toggle tiles ──────────────────────────────────── */}
            <box class="qm-toggles" spacing={6} homogeneous>
              {/* Wi‑Fi (split: icon toggles power, › opens panel) */}
              <box class={wifiEnabled((e) => (e ? "qm-toggle-wrap active" : "qm-toggle-wrap"))}>
              <button
                class="qm-toggle-main"
                hexpand
                tooltip_text="Toggle Wi‑Fi"
                onClicked={() => {
                  if (wifi) wifi.enabled = !wifiEnabled()
                }}
              >
                <box
                  orientation={Gtk.Orientation.VERTICAL}
                  spacing={4}
                  halign={Gtk.Align.CENTER}
                >
                  <image class="qm-toggle-icon" icon_name={wifiIcon} />
                  <label class="qm-toggle-label" label="Wi‑Fi" />
                </box>
              </button>
              <button
                class={wifiPanelOpen((o) => (o ? "qm-toggle-expand active" : "qm-toggle-expand"))}
                tooltip_text="Wi‑Fi networks"
                onClicked={() => {
                  if (wifiPanelOpen()) {
                    setWifiPanelOpen(false)
                  } else {
                    setWifiPanelOpen(true)
                    setBtPanelOpen(false)
                    setAudioPanelOpen(false)
                    refreshWifiNetworks()
                  }
                }}
              >
                <label label="›" />
              </button>
            </box>

            {/* Bluetooth (split: icon toggles power, › opens panel) */}
            <box class={btPowered((p) => (p ? "qm-toggle-wrap active" : "qm-toggle-wrap"))}>
              <button
                class="qm-toggle-main"
                hexpand
                tooltip_text="Toggle Bluetooth"
                onClicked={() => {
                  if (bluetooth) bluetooth.toggle()
                }}
              >
                <box
                  orientation={Gtk.Orientation.VERTICAL}
                  spacing={4}
                  halign={Gtk.Align.CENTER}
                >
                  <image class="qm-toggle-icon" icon_name={btIcon} />
                  <label class="qm-toggle-label" label="Bluetooth" />
                </box>
              </button>
              <button
                class={btPanelOpen((o) => (o ? "qm-toggle-expand active" : "qm-toggle-expand"))}
                tooltip_text="Bluetooth devices"
                onClicked={() => {
                  if (btPanelOpen()) {
                    setBtPanelOpen(false)
                  } else {
                    setBtPanelOpen(true)
                    setAudioPanelOpen(false)
                    setWifiPanelOpen(false)
                    refreshBtDevices()
                  }
                }}
              >
                <label label="›" />
              </button>
            </box>

            {/* Keyboard Layout */}
            <button
              class="qm-toggle active"
              hexpand
              tooltip_text={kbTooltip}
              onClicked={() => {
                const next = (kbIndex() + 1) % INPUT_METHODS.length
                setKbIndex(next)
                applyInputMethod(INPUT_METHODS[next])
              }}
            >
              <box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={4}
                halign={Gtk.Align.CENTER}
              >
                <image class="qm-toggle-icon" icon_name="input-keyboard-symbolic" />
                <label class="qm-toggle-label" label={kbLabel} />
              </box>
            </button>
          </box>

          {/* ── Divider ───────────────────────────────────────── */}
          <box class="qm-divider" />

          {/* ── Spacer ────────────────────────────────────────── */}
          <box vexpand />

          {/* ── Sliders ───────────────────────────────────────── */}
          <box class="qm-sliders" orientation={Gtk.Orientation.VERTICAL} spacing={4}>

            {/* Brightness row */}
            <box class="qm-slider-row" spacing={8} valign={Gtk.Align.CENTER}>
              <image
                class="qm-slider-icon"
                icon_name="display-brightness-symbolic"
                tooltip_text={brightness((b) =>
                  `Brightness: ${Math.round(b * 100)}%`
                )}
              />
              <slider
                class="qm-slider"
                hexpand
                $={(self) => {
                  self.min = 0
                  self.max = 1
                  self.value = brightness()
                  brightSliderRef = self // <-- Add the ref here
                  const id = self.connect("value-changed", () => {
                    const v = Math.max(0, Math.min(1, self.value))
                    // Only apply if the user actually dragged it
                    if (Math.abs(brightness() - v) > 0.01) {
                      setBrightnessState(v)
                      applyBrightness(v)
                    }
                  })
                  onCleanup(() => {
                    brightSliderRef = null // <-- Cleanup the ref
                    self.disconnect(id)
                  })
                }}
              />
            </box>

            {/* Volume row */}
            <box class="qm-slider-row" spacing={8} valign={Gtk.Align.CENTER}>
              <image
                class="qm-slider-icon"
                icon_name={volumeIcon}
                tooltip_text={createComputed(() =>
                  muted() ? "Muted" : `Volume: ${Math.round(vol() * 100)}%`
                )}
              />
              <slider
                class="qm-slider"
                hexpand
                $={(self) => {
                  self.min = 0
                  self.max = 1
                  self.value = vol()
                  volSliderRef = self
                  const id = self.connect("value-changed", () => {
                    const v = Math.max(0, Math.min(1, self.value))
                    // Only apply if the user actually dragged it
                    if (Math.abs(vol() - v) > 0.01) {
                      setVol(v)
                      if (currentSpk) currentSpk.volume = v
                    }
                  })
                  onCleanup(() => {
                    volSliderRef = null
                    self.disconnect(id)
                  })
                }}
              />
              <button
                class={audioPanelOpen((o) =>
                  o ? "qm-audio-expand active" : "qm-audio-expand",
                )}
                tooltip_text="Audio outputs"
                onClicked={() => {
                  if (audioPanelOpen()) {
                    setAudioPanelOpen(false)
                  } else {
                    setAudioPanelOpen(true)
                    setBtPanelOpen(false)
                    setWifiPanelOpen(false)
                    refreshAudioItems()
                  }
                }}
              >
                <label label="›" />
              </button>
            </box>
          </box>
        </box>
          </box>
        </revealer>
      </box>
  </window>
  )
}
