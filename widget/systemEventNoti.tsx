import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState, createComputed, onMount, onCleanup } from "gnim"
import AstalWp from "gi://AstalWp"
import GLib from "gi://GLib"
import Gio from "gi://Gio"

// --- Brightness Helpers ---
let cachedBacklightBase: string | null = null

function findBacklightBase(): string | null {
  if (cachedBacklightBase !== null) return cachedBacklightBase
  try {
    const iter = Gio.File.new_for_path("/sys/class/backlight").enumerate_children(
      "standard::name",
      Gio.FileQueryInfoFlags.NONE,
      null,
    )
    const info = iter.next_file(null)
    iter.close(null)
    if (!info) return null
    cachedBacklightBase = `/sys/class/backlight/${info.get_name()}`
    return cachedBacklightBase
  } catch {
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

export default function SystemNoti(gdkmonitor: Gdk.Monitor) {
  const { BOTTOM } = Astal.WindowAnchor
  
  // State for the OSD
  const [visible, setVisible] = createState(false)
  const [value, setValue] = createState(0)
  const [icon, setIcon] = createState("audio-volume-high-symbolic")
  
  let hideTimeoutId: number | null = null
  let isInitialLoad = true // Prevents OSD from popping up on system boot

  // The main function to trigger the OSD popup
  function showOsd(newValue: number, newIcon: string) {
    if (isInitialLoad) return

    setValue(newValue)
    setIcon(newIcon)
    setVisible(true)

    // Reset the hide timer every time a key is pressed
    if (hideTimeoutId !== null) {
      GLib.source_remove(hideTimeoutId)
    }
    
    // Hide after 2 seconds
    hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
      setVisible(false)
      hideTimeoutId = null
      return GLib.SOURCE_REMOVE
    })
  }

  // --- Audio Listener ---
  onMount(() => {
    let audio: AstalWp.Audio | null = null
    try {
      const wp = AstalWp.get_default()
      audio = wp.get_audio()
    } catch {}

    if (!audio) return

    const speaker = audio.get_default_speaker()
    if (!speaker) return

    const updateAudioOsd = () => {
      const vol = speaker.volume ?? 0
      const muted = speaker.mute ?? false
      
      let volIcon = "audio-volume-high-symbolic"
      if (muted || vol === 0) volIcon = "audio-volume-muted-symbolic"
      else if (vol < 0.34) volIcon = "audio-volume-low-symbolic"
      else if (vol < 0.67) volIcon = "audio-volume-medium-symbolic"

      showOsd(vol, volIcon)
    }

    // Listen to both volume and mute toggles
    const volId = speaker.connect("notify::volume", updateAudioOsd)
    const muteId = speaker.connect("notify::mute", updateAudioOsd)

    onCleanup(() => {
      speaker.disconnect(volId)
      speaker.disconnect(muteId)
    })
  })

  // --- Brightness Listener ---
  onMount(() => {
    const base = findBacklightBase()
    if (!base) return

    // Monitor the hardware file directly so it reacts to keyboard shortcuts
    const file = Gio.File.new_for_path(`${base}/brightness`)
    const monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null)
    
    const id = monitor.connect("changed", () => {
      showOsd(readBrightness(), "display-brightness-symbolic")
    })

    onCleanup(() => {
      monitor.disconnect(id)
      monitor.cancel()
    })
  })

  // After listeners are attached, disable the initial load lock
  onMount(() => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
      isInitialLoad = false
      return GLib.SOURCE_REMOVE
    })
  })

  return (
    <window
      visible={true}
      name="system-noti"
      class="system-noti"
      gdkmonitor={gdkmonitor}
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.NORMAL}
      keymode={Astal.Keymode.NONE} // OSD shouldn't steal keyboard focus
      anchor={BOTTOM} // Centered at the bottom
      marginBottom={60} // Distance from bottom edge
      application={app}
    >
      <revealer
        transition_type={Gtk.RevealerTransitionType.SLIDE_UP}
        transition_duration={300}
        reveal_child={createComputed(() => visible())}
      >
        <box class="osd-pill" orientation={Gtk.Orientation.HORIZONTAL} valign={Gtk.Align.CENTER}>
          <image class="osd-icon" icon_name={createComputed(() => icon())} />
          {/* We use a GTK progressbar for that thick, non-interactive Windows 11 look */}
          <levelbar 
            class="osd-progress" 
            hexpand 
            valign={Gtk.Align.CENTER}
            min_value={0}
            max_value={1}
            value={createComputed(() => value())} 
          />
        </box>
      </revealer>
    </window>
  )
}