decoded.default = { name = "default" }
decoded.resize = { name = "resize" }
decoded.missing = {}
decoded.numeric = { name = 42 }
decoded.scalar = "resize"
loadWidget()
assert(widget.interval == 1000 and not widget.visible)
assert(table.concat(commands[1].argv, " ") == "swaymsg -r -t get_binding_state")
success("default")
assert(widget.text == "default" and not widget.visible)
update()
success("resize")
assert(widget.text == "resize" and widget.visible)
for _, response in ipairs({ "missing", "numeric", "scalar", "invalid JSON" }) do
  update()
  success(response)
  assert(widget.text == "?" and widget.visible and #logs == 1)
end
update()
success("default")
assert(widget.text == "default" and not widget.visible)
update()
completeCommand({ exitCode = 1, stderr = "Sway unavailable" })
assert(widget.text == "?" and widget.visible and #logs == 2)
update()
success("resize")
assert(widget.text == "resize" and widget.visible and #commands == 0)
