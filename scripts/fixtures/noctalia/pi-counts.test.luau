local stateDir = runtimeRoot .. "/accel-os/pi-agents"
directories[stateDir] = {
  "notes", "12.state.bak", "x.state", "1.state", "2.state", "3.state",
  "4.state", "5.state", "6.state", "7.state",
}
files[stateDir .. "/1.state"] = "working\n"
files[stateDir .. "/2.state"] = "idle\n"
files[stateDir .. "/3.state"] = "working\n"
files[stateDir .. "/4.state"] = "idle\n"
files[stateDir .. "/5.state"] = "working"
files[stateDir .. "/6.state"] = "unknown\n"
-- 7.state disappears after listing.
local pi = "node\0/home/user/accel-os/ai/pi/ai.ts\0"
loadWidget()
assert(widget.glyph == "robot" and widget.interval == 3000 and not widget.visible)
update()
completeRead("/proc/1/cmdline", pi)
completeRead("/proc/2/cmdline", pi)
completeRead("/proc/3/cmdline", nil, "No such process")
completeRead("/proc/4/cmdline", "unrelated\0process\0")
completeRead("/proc/5/cmdline", pi)
completeRead("/proc/6/cmdline", pi)
completeRead("/proc/7/cmdline", pi)
assert(#reads == 0 and widget.text == "1/1" and widget.visible)
assert(widget.tooltip == "1 working, 1 waiting" and widget.color == "#ebcb8b")
assert(#logs == 0)

files[stateDir .. "/1.state"] = "idle\n"
directories[stateDir] = { "1.state" }
update()
completeRead("/proc/1/cmdline", pi)
assert(widget.text == "0/1" and widget.visible and widget.color == "#90b1b1")
assert(widget.tooltip == "0 working, 1 waiting")
directories[stateDir] = {}
update()
assert(widget.text == "0/0" and not widget.visible and #reads == 0)
