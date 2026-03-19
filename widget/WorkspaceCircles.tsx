import { Gtk } from "ags/gtk4"
import {
  createState,
  createMemo,
  For,
  onMount,
  onCleanup,
} from "gnim"
import AstalHyprland from "gi://AstalHyprland"
import GLib from "gi://GLib"
import Gtk4 from "gi://Gtk"

const WORKSPACE_COUNT = 10

export default function WorkspaceCircles() {
  let hypr: ReturnType<typeof AstalHyprland.get_default> | null = null
  try {
    hypr = AstalHyprland.get_default()
  } catch {}
  const [activeIndex, setActiveIndex] = createState(0)

if (hypr) {
    onMount(() => {
      const h = hypr as any

      const updateWorkspace = () => {
        try {
          // Track the workspace directly instead of the client
          const fw = h.focused_workspace
          if (!fw || typeof fw.id === "undefined") return

          const wsId = Number(fw.id)

          if (Number.isFinite(wsId) && wsId > 0) {
            // Calculate index and update state
            const idx = (wsId - 1) % WORKSPACE_COUNT
            setActiveIndex(idx)
          }
        } catch {
          // If something fails, do nothing. 
          // (Removing the fallback to 0 prevents the snapping bug!)
        }
      }

      // Initial sync
      updateWorkspace()

      // Change the listener to watch the workspace instead of the client
      const id = h.connect?.("notify::focused-workspace", updateWorkspace)

      onCleanup(() => {
        if (id) h.disconnect(id)
      })
    })
  }

  const indices = createMemo(() =>
    Array.from({ length: WORKSPACE_COUNT }, (_, i) => i),
  )

  return (
    <box
      class="ws-rect"
      orientation={Gtk.Orientation.VERTICAL}
      valign={Gtk.Align.START}
      $={(self) => {
        // GTK4 uses event controllers for scroll; this is the recommended pattern in AGS/Astal.
        const scrollController = Gtk4.EventControllerScroll.new(
          Gtk4.EventControllerScrollFlags.VERTICAL,
        )
        scrollController.connect("scroll", (_c, _dx, dy) => {
          let current = activeIndex()
          if (dy < 0) {
            // scroll up
            if (current <= 0) return
            current -= 1
          } else if (dy > 0) {
            // scroll down
            if (current >= WORKSPACE_COUNT - 1) return
            current += 1
          } else {
            return
          }

          const targetWs = current + 1
          try {
            GLib.spawn_command_line_async(`hyprctl dispatch workspace ${targetWs}`)
          } catch {}
        })
        self.add_controller(scrollController)
      }}
    >
      <box
        class="ws-circles"
        orientation={Gtk.Orientation.VERTICAL}
        spacing={0}
        halign={Gtk.Align.CENTER}
      >
        <For each={indices}>
          {(i) => (
            <box
              class="ws-dot"
              halign={Gtk.Align.CENTER}
            >
              <box
                class={activeIndex((idx) =>
                  idx === i ? "ws-dot-inner ws-dot-inner-active" : "ws-dot-inner",
                )}
              />
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

