-- Collect once for every bar. Keep the last successful snapshot through query
-- errors and service reloads so neither produces duplicate failure alerts.
local poll = require("./poll.luau")
local status = noctalia.state.get("failed-units") or { units = {}, generation = 0 }
local pending = false
local reportedError = false

local function units(output)
  local result = {}
  for line in string.gmatch(output, "[^\n]+") do
    local name = string.match(line, "^%s*(%S+)")
    if name ~= nil then
      table.insert(result, name)
    end
  end
  return result
end

local system = poll.command({ "systemctl", "--failed", "--no-legend", "--plain", "--no-pager" }, units)
local user = poll.command({ "systemctl", "--user", "--failed", "--no-legend", "--plain", "--no-pager" }, units)

local function fail(message)
  pending = false
  status = { units = status.units, generation = status.generation, error = message }
  noctalia.state.set("failed-units", status)
  if not reportedError then
    noctalia.log(message)
  end
  reportedError = true
end

local function notify(unit)
  local started = noctalia.runAsync({
    "notify-send", "--app-name=Systemd failures", "--urgency=critical",
    "Systemd unit failed", unit,
  }, function(result)
    if result.exitCode ~= 0 or result.timedOut then
      noctalia.log("Failed to send systemd notification: " .. (result.stderr or ""))
    end
  end)
  if not started then
    noctalia.log("Could not start systemd failure notification")
  end
end

local function present(systemUnits, userUnits)
  local previous, current, added = {}, {}, {}
  for _, unit in ipairs(status.units) do
    previous[unit] = true
  end
  for _, group in ipairs({ { "system", systemUnits }, { "user", userUnits } }) do
    for _, name in ipairs(group[2]) do
      local unit = group[1] .. ": " .. name
      table.insert(current, unit)
      if not previous[unit] then
        table.insert(added, unit)
      end
    end
  end
  status = {
    units = current,
    generation = status.generation + (#added > 0 and 1 or 0),
  }
  pending = false
  reportedError = false
  noctalia.state.set("failed-units", status)
  for _, unit in ipairs(added) do
    notify(unit)
  end
end

function update()
  if pending then
    return
  end
  pending = true
  system(function(systemUnits, err)
    if systemUnits == nil then
      fail("System failed-unit query unavailable: " .. tostring(err))
      return
    end
    user(function(userUnits, userErr)
      if userUnits == nil then
        fail("User failed-unit query unavailable: " .. tostring(userErr))
        return
      end
      present(systemUnits, userUnits)
    end)
  end)
end

noctalia.setUpdateInterval(10000)
noctalia.state.set("failed-units", {
  units = status.units, generation = status.generation, error = "Waiting for failed-unit status",
})
update()
