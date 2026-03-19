import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createComputed, createState, For, onCleanup } from "gnim"
import GLib from "gi://GLib"

export interface PanelItem {
  id: string
  name: string
  active: boolean
  icon: string
}

export interface DevicePanelConfig {
  name: string
  title: string
  items: any
  onSelect: (id: string) => void
  onDisconnect: ((id: string) => void) | null
  onRefresh: () => void
  scanning: any
  selectingId: any
  actionIcon: any
  actionActive: any
  onAction: () => void
  actionTooltip: string
  onClose?: () => void
}

function DevicePanelBody({ config }: { config: DevicePanelConfig }) {
  return (
    <box class="dp-body" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
      <box class="dp-header" spacing={8}>
        {config.onClose && (
          <button
            class="dp-close"
            tooltip_text="Close panel"
            onClicked={config.onClose}
          >
            <image icon_name="go-previous-symbolic" />
          </button>
        )}
        <label
          class="dp-title"
          label={config.title}
          hexpand
          halign={Gtk.Align.START}
        />
        <button
          class={config.actionActive((a: boolean) =>
            a ? "dp-action active" : "dp-action",
          )}
          tooltip_text={config.actionTooltip}
          onClicked={config.onAction}
        >
          <image icon_name={config.actionIcon} />
        </button>
      </box>
      <box class="dp-divider" />
      <scrolledwindow
        class="dp-scroll"
        hscrollbar_policy={Gtk.PolicyType.NEVER}
        vscrollbar_policy={Gtk.PolicyType.AUTOMATIC}
        vexpand
      >
        <box
          class="dp-items"
          orientation={Gtk.Orientation.VERTICAL}
          spacing={2}
        >
          <For each={config.items}>
            {(item: PanelItem) => (
              <box
                class={item.active ? "dp-item active" : "dp-item"}
                spacing={4}
              >
                <button
                  class="dp-item-btn"
                  hexpand
                  tooltip_text={item.id}
                  onClicked={() => config.onSelect(item.id)}
                >
                  <box spacing={6} valign={Gtk.Align.CENTER}>
                    <image class="dp-item-icon" icon_name={item.icon} />
                    <label
                      class="dp-item-name"
                      label={config.selectingId((sid: string) =>
                        sid === item.id ? "Connecting…" : item.name,
                      )}
                      halign={Gtk.Align.START}
                      ellipsize={2}
                      max_width_chars={16}
                    />
                  </box>
                </button>
                <button
                  class="dp-disconnect"
                  visible={config.onDisconnect !== null}
                  tooltip_text={`Disconnect ${item.name}`}
                  onClicked={() => config.onDisconnect?.(item.id)}
                >
                  <image icon_name="window-close-symbolic" />
                </button>
              </box>
            )}
          </For>
        </box>
      </scrolledwindow>
      <box halign={Gtk.Align.END}>
        <button
          class={config.scanning((s: boolean) =>
            s ? "dp-refresh scanning" : "dp-refresh",
          )}
          tooltip_text="Scan for devices"
          sensitive={config.scanning((s: boolean) => !s)}
          onClicked={config.onRefresh}
        >
          <box spacing={4}>
            <image icon_name="view-refresh-symbolic" />
            <label
              label={config.scanning((s: boolean) =>
                s ? "Scanning…" : "Refresh",
              )}
            />
          </box>
        </button>
      </box>
    </box>
  )
}

/** Content-only panel (no window). Use inside QuickMenu with a revealer. */
export function DevicePanelContent(config: DevicePanelConfig) {
  return <DevicePanelBody config={config} />
}

export default function DevicePanel(
  gdkmonitor: Gdk.Monitor,
  open: () => boolean,
  config: DevicePanelConfig,
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
      hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 360, () => {
        setWindowVisible(false)
        hideTimeoutId = null
        return GLib.SOURCE_REMOVE
      })
    }

    return windowVisible()
  })

  /** Delay (ms) after map before triggering reveal so the hidden state is painted and the slide-in is smooth. */
  const OPEN_REVEAL_DELAY_MS = 66

  /** After revealer is mapped, wait a frame or two then set_reveal_child(true) so GTK runs the slide transition smoothly. */
  function onRevealerMapped(revealer: Gtk.Revealer) {
    if (revealed()) return
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, OPEN_REVEAL_DELAY_MS, () => {
      if (!open() || !windowVisible()) return GLib.SOURCE_REMOVE
      revealer.set_reveal_child(true)
      setRevealed(true)
      return GLib.SOURCE_REMOVE
    })
  }

  return (
    <window
      visible={isVisible}
      name={config.name}
      class="device-panel"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.NORMAL}
      layer={Astal.Layer.TOP}
      keymode={Astal.Keymode.NONE}
      anchor={LEFT | BOTTOM}
      marginBottom={14}
      marginLeft={304} // 314 - 10px (native margin-right)
      application={app}
    >
      <box orientation={Gtk.Orientation.HORIZONTAL} halign={Gtk.Align.START}>
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
          class={createComputed(() => isVisible() ? "dp-shell open" : "dp-shell")}
          //css={createComputed(() => 
          //  `margin-right: 5px; transform: translateX(${isVisible() ? 5 : 0}px); transition: transform 250ms ease;`
          //)}
          >
            <DevicePanelBody config={config} />
          </box>
        </revealer>
      </box>
    </window>
  )
}
