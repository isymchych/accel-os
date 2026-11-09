local poll = loadPoll()
local pending, queries, presentations = nil, 0, 0
local refresh = poll.create(function(done)
  assert(pending == nil, "Overlapping query")
  queries = queries + 1
  pending = done
end, 1234, function(value)
  presentations = presentations + 1
  if type(value) ~= "number" then return false end
  widget.text = tostring(value)
  widget.visible = value > 0
  return true
end)
local function finish(value, err)
  local callback = pending
  pending = nil
  callback(value, err)
end
assert(widget.visible == false and widget.interval == 1234)
refresh()
refresh()
assert(queries == 1 and presentations == 0)
finish(nil, "offline")
assert(widget.text == "?" and widget.visible and #logs == 1)
assert(string.find(logs[1], "offline", 1, true))
refresh()
finish(nil, "still offline")
assert(#logs == 1 and presentations == 0)
refresh()
finish("bad shape")
assert(widget.text == "?" and #logs == 1)
refresh()
finish(2)
assert(widget.text == "2" and widget.visible)
refresh()
finish(nil, "offline again")
assert(widget.text == "?" and #logs == 2)
refresh()
finish(0)
assert(widget.text == "0" and not widget.visible)
refresh()
finish("bad shape again")
assert(widget.text == "?" and widget.visible and #logs == 3)
refresh()
finish(1)
assert(widget.text == "1" and widget.visible and pending == nil)
