-- Deliberately deferred callbacks expose overlap and sequential-read bugs.
local widget, logs, commands, reads = {}, {}, {}, {}
local files, directories, decoded = {}, {}, {}
local runtimeRoot = "/run/user/1000"
local rejectCommands, rejectReads, listError = false, false, nil
barWidget = {
  setVisible = function(value) widget.visible = value end,
  setText = function(value) widget.text = value end,
  setColor = function(value) widget.color = value end,
  setTooltip = function(value) widget.tooltip = value end,
  clearTooltip = function() widget.tooltip = nil end,
  setGlyph = function(value) widget.glyph = value end,
}
noctalia = {
  setUpdateInterval = function(value) widget.interval = value end,
  log = function(message) table.insert(logs, message) end,
  runAsync = function(argv, callback)
    if rejectCommands then return false end
    table.insert(commands, { argv = argv, callback = callback })
    return true
  end,
  json = { decode = function(raw)
    if decoded[raw] == nil then return nil, "Invalid JSON" end
    return decoded[raw]
  end },
  getenv = function(name)
    assert(name == "XDG_RUNTIME_DIR")
    return runtimeRoot
  end,
  fileExists = function(name) return directories[name] ~= nil end,
  listDir = function(name)
    if listError then return nil, listError end
    return directories[name]
  end,
  readFile = function(name) return files[name] end,
  readFileAsync = function(name, callback)
    if rejectReads then return false end
    table.insert(reads, { path = name, callback = callback })
    return true
  end,
}
local function completeCommand(result)
  assert(#commands == 1, "Expected exactly one outstanding command")
  table.remove(commands, 1).callback(result)
end
local function success(stdout)
  completeCommand({ exitCode = 0, stdout = stdout })
end
local function completeRead(expected, content, err)
  assert(#reads == 1, "Expected exactly one outstanding read")
  local request = table.remove(reads, 1)
  assert(request.path == expected, "Unexpected read: " .. request.path)
  request.callback(content, err)
end
