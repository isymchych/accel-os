-- Deliberately deferred callbacks expose overlapping commands.
local widget, logs, commands = {}, {}, {}
local decoded = {}
local rejectCommands = false
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
}
local function completeCommand(result)
  assert(#commands == 1, "Expected exactly one outstanding command")
  table.remove(commands, 1).callback(result)
end
local function success(stdout)
  completeCommand({ exitCode = 0, stdout = stdout })
end
