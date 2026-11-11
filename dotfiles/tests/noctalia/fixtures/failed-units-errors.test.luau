local refresh = loadService()
local first, tickFirst, clickFirst = loadWidget()
success("alpha.service loaded failed failed Alpha\nbeta.service loaded failed failed Beta\n")
success("gamma.service loaded failed failed Gamma\n")

-- A failed partial snapshot cannot clear previous units or cause repeat alerts.
refresh()
success("")
completeCommand({ exitCode = 1, stderr = "User unavailable" })
assert(first.text == nil and first.visible and #logs == 1)
assert(string.find(first.tooltip, "User unavailable", 1, true))
tickFirst()
assert(first.glyphColor == "error", "Query errors remain steadily visible")
refresh()
completeCommand({ exitCode = 1, stderr = "System unavailable" })
assert(#logs == 1, "Repeated query errors are logged once")
refresh()
success("alpha.service loaded failed failed Alpha\nbeta.service loaded failed failed Beta\n")
success("gamma.service loaded failed failed Gamma\n")
assert(first.visible and #notices == 3)

rejectCommands = true
refresh()
assert(first.visible and #logs == 2)
rejectCommands = false
refresh()
success("")
success("")
rejectNotices = true
refresh()
success("delta.service loaded failed failed Delta\n")
success("")
assert(first.visible and #logs == 3, "Notification startup errors do not hide failures")
rejectNotices = false
notices[1].callback({ exitCode = 1, stderr = "Notification daemon unavailable" })
assert(#logs == 4)
rejectLaunches = true
clickFirst()
assert(#errors == 1 and errors[1] == "Could not open systemd manager"
  and first.glyphColor == "error", "Manager startup errors are visible")
