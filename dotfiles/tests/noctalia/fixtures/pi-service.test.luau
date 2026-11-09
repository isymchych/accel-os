-- The service starts exactly one helper with no widgets present.
pluginDir = "/plugins/it's desktop"
loadService()
assert(#streams == 1 and interval == 3000)
assert(streams[1].command == "exec accel-node '/plugins/it'\\''s desktop/pi-activity.ts'")
update()
update()
assert(#streams == 1)
emitStatus({ working = 2, waiting = 1, inhibited = true })
assert(shared["pi-agents"].working == 2 and shared["pi-agents"].inhibited)

widget = loadWidget()
local second = loadWidget()
assert(widget.glyph == "robot" and widget.text == "2/1" and widget.visible)
assert(second.text == "2/1" and second.visible)
assert(widget.tooltip == "2 working, 1 waiting" and widget.color == "primary")

emitStatus({ working = 0, waiting = 3, inhibited = false })
assert(widget.text == "0/3" and widget.visible and widget.color == "on_surface_variant")
assert(second.text == "0/3" and second.visible)
assert(widget.tooltip == "0 working, 3 waiting")
emitStatus({ working = 0, waiting = 0, inhibited = false })
assert(widget.text == "0/0" and not widget.visible and not second.visible)
assert(#streams == 1 and #logs == 0)
