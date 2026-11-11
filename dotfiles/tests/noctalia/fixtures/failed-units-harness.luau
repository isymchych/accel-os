-- Deferred systemctl/notification callbacks; each widget closes over its own UI.
local commands, notices, launches, logs, errors = {}, {}, {}, {}, {}
local interval = nil
local rejectCommands, rejectNotices, rejectLaunches = false, false, false
noctalia = {
  setUpdateInterval = function(value) interval = value end,
  log = function(message) table.insert(logs, message) end,
  notifyError = function(message) table.insert(errors, message) end,
  runAsync = function(argv, callback)
    if argv[1] == "systemctl" then
      if rejectCommands then return false end
      table.insert(commands, { argv = argv, callback = callback })
    elseif argv[1] == "notify-send" then
      if rejectNotices then return false end
      table.insert(notices, { argv = argv, callback = callback })
    elseif argv[1] == "xterm" then
      if rejectLaunches then return false end
      table.insert(launches, argv)
    else
      error("Unexpected command: " .. tostring(argv[1]))
    end
    return true
  end,
}
noctalia.state = state

local function assertArgs(actual, expected)
  assert(#actual == #expected, "Unexpected argument count")
  for i, value in ipairs(expected) do
    assert(actual[i] == value, "Unexpected argument " .. i)
  end
end

local function completeCommand(result)
  assert(#commands == 1, "Expected exactly one outstanding systemctl query")
  table.remove(commands, 1).callback(result)
end
local function success(stdout)
  completeCommand({ exitCode = 0, stdout = stdout })
end
