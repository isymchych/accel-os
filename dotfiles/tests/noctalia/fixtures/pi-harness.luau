-- The service has no widget dependency; all widgets share the same channel.
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
noctalia.state = state

local function emitStatus(value)
  decoded.status = value
  streams[1].callback("status")
end
