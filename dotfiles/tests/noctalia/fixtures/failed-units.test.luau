local function assertSystem()
  local argv = commands[1].argv
  assert(table.concat(argv, " ") == "systemctl --failed --no-legend --plain --no-pager")
end
local function assertUser()
  local argv = commands[1].argv
  assert(table.concat(argv, " ") == "systemctl --user --failed --no-legend --plain --no-pager")
end
widget.tooltip = "stale"
loadWidget()
assert(widget.interval == 10000 and not widget.visible and widget.tooltip == nil)
assertSystem()
update()
assert(#commands == 1)
success("alpha.service loaded failed failed Alpha\n\n  \t\nbeta.service loaded failed failed Beta\n")
assertUser()
success("gamma.service loaded failed failed Gamma\n")
assert(widget.text == "3" and widget.visible and #logs == 0)

update()
success("\n  \t\n")
success("")
assert(widget.text == "0" and not widget.visible)
update()
completeCommand({ exitCode = 1, stderr = "System unavailable" })
assert(widget.text == "?" and widget.visible and #commands == 0 and #logs == 1)
update()
success("alpha.service loaded failed failed Alpha\n")
completeCommand({ exitCode = 1, stderr = "User unavailable" })
assert(widget.text == "?" and widget.visible and #logs == 1)
update()
success("")
success("")
assert(widget.text == "0" and not widget.visible)
rejectCommands = true
update()
assert(widget.text == "?" and widget.visible and #logs == 2)
rejectCommands = false
update()
success("")
success("gamma.service loaded failed failed Gamma\n")
assert(widget.text == "1" and widget.visible and #commands == 0)
