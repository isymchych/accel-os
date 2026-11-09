rejectStreams = true
loadService()
widget = loadWidget()
assert(widget.text == "?" and string.find(widget.tooltip, "Could not start", 1, true))
assert(#streams == 0 and #logs == 1)
update()
assert(#logs == 1)
rejectStreams = false
update()
assert(#streams == 1)
emitStatus({ working = 1, waiting = 0, inhibited = true })
assert(widget.text == "1/0" and shared["pi-agents"].inhibited)
local second = loadWidget()

-- Collection/inhibitor errors stay visible on every monitor, without treating
-- unknown as idle or changing manual caffeine.
emitStatus({ working = 1, waiting = 0, inhibited = true, error = "Permission denied" })
assert(widget.text == "?" and second.text == "?" and shared["pi-agents"].inhibited)
assert(widget.tooltip == "Permission denied" and #logs == 2)
emitStatus({ working = 1, waiting = 0, inhibited = true, error = "Permission denied" })
assert(#logs == 2)
emitStatus({ working = 0, waiting = 1, inhibited = false })
assert(widget.text == "0/1" and second.text == "0/1")

for _, value in ipairs({
  false,
  { working = 1, waiting = 0 },
  { working = "1", waiting = 0, inhibited = true },
  { working = -1, waiting = 0, inhibited = true },
  { working = 1, waiting = 0.5, inhibited = true },
  { working = 1, waiting = 0, inhibited = true, error = false },
}) do
  emitStatus(value)
  assert(widget.text == "?" and string.find(widget.tooltip, "Invalid", 1, true))
end
streams[1].callback("bad JSON")
assert(widget.text == "?" and #logs == 3)
emitStatus({ working = 1, waiting = 0, inhibited = true })
assert(widget.text == "1/0")

-- Startup failures and unexpected helper exit must not leave a healthy-looking
-- frozen count. There is no per-stream exit/stop API, so don't spawn duplicates.
now = 10000
update()
assert(widget.text == "?" and second.text == "?")
assert(string.find(widget.tooltip, "stopped reporting", 1, true))
assert(#streams == 1 and #logs == 4)
update()
assert(#logs == 4)
emitStatus({ working = 0, waiting = 0, inhibited = false })
assert(not widget.visible and not second.visible)
now = 19999
update()
assert(not widget.visible)
now = 20000
update()
assert(widget.text == "?" and #logs == 5)
