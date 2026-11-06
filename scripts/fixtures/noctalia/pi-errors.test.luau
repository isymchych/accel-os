local stateDir = runtimeRoot .. "/accel-os/pi-agents"
loadWidget()
assert(widget.text == "0/0" and not widget.visible and #logs == 0)

directories[stateDir] = { "10.state" }
listError = "Permission denied"
update()
assert(widget.text == "?" and widget.visible and #logs == 1 and #reads == 0)
update()
assert(#logs == 1)
listError = nil
files[stateDir .. "/10.state"] = "working\n"
update()
completeRead("/proc/10/cmdline", "/home/user/accel-os/ai/pi/ai.ts\0")
assert(widget.text == "1/0" and widget.visible)
rejectReads = true
update()
assert(widget.text == "?" and widget.visible and #logs == 2 and #reads == 0)
rejectReads = false
directories[stateDir] = nil
update()
assert(widget.text == "0/0" and not widget.visible)

-- Without XDG_RUNTIME_DIR, use the effective UID, not the real UID.
runtimeRoot = nil
local fallback = "/tmp/accel-os-1001/accel-os/pi-agents"
directories[fallback] = { "11.state" }
files[fallback .. "/11.state"] = "idle\n"
update()
update()
completeRead("/proc/self/status", "Name:\tnode\nUid:\t1000\t1001\t1001\t1001\n")
completeRead("/proc/11/cmdline", "/home/user/accel-os/ai/pi/ai.ts\0")
assert(widget.text == "0/1" and widget.visible and #reads == 0)

-- An empty environment variable also falls back, but unreadable or malformed
-- procfs must not look like zero agents.
runtimeRoot = ""
update()
completeRead("/proc/self/status", nil, "Permission denied")
assert(widget.text == "?" and widget.visible and #logs == 3)
update()
completeRead("/proc/self/status", "Name:\tnode\n")
assert(widget.text == "?" and widget.visible and #logs == 3)
runtimeRoot = "/run/user/1000"
update()
assert(widget.text == "0/0" and not widget.visible)
runtimeRoot = nil
rejectReads = true
update()
assert(widget.text == "?" and widget.visible and #logs == 4 and #reads == 0)
rejectReads = false
update()
completeRead("/proc/self/status", "Name:\tnode\nUid:\t1000\t1001\t1001\t1001\n")
completeRead("/proc/11/cmdline", "/home/user/accel-os/ai/pi/ai.ts\0")
assert(widget.text == "0/1" and widget.visible and #reads == 0)
