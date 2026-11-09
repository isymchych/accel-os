-- The service has no widget dependency; all widgets share the same channel.
local shared, watchers = {}, {}
local logs, decoded = {}, {}
local interval, now = nil, 0
local streams = {}
local rejectStreams = false
local pluginDir = "/plugins/desktop-status"
noctalia = {
  log = function(message) table.insert(logs, message) end,
  json = { decode = function(raw)
    if decoded[raw] == nil then return nil, "Invalid JSON" end
    return decoded[raw]
  end },
}
noctalia.setUpdateInterval = function(value) interval = value end
noctalia.nowMs = function() return now end
noctalia.pluginDir = function() return pluginDir end
noctalia.runStream = function(command, callback)
  if rejectStreams then return false end
  table.insert(streams, { command = command, callback = callback })
  return true
end
noctalia.state = {
  set = function(key, value)
    shared[key] = value
    for _, callback in ipairs(watchers[key] or {}) do callback(value) end
  end,
  get = function(key) return shared[key] end,
  watch = function(key, callback)
    watchers[key] = watchers[key] or {}
    table.insert(watchers[key], callback)
  end,
}

local function emitStatus(value)
  decoded.status = value
  streams[1].callback("status")
end

local function makeWidget()
  local current = {}
  return current, {
    setGlyph = function(value) current.glyph = value end,
    setText = function(value) current.text = value end,
    setColor = function(value) current.color = value end,
    setTooltip = function(value) current.tooltip = value end,
    setVisible = function(value) current.visible = value end,
  }
end
