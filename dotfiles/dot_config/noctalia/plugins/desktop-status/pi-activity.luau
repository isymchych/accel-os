-- One headless helper owns collection and inhibition, independently of widgets.
local started = false
local lastOutput = noctalia.nowMs()
local reportedError = false
local status = { working = 0, waiting = 0, inhibited = false }

local function publish(value)
  status = value
  noctalia.state.set("pi-agents", value)
  if value.error ~= nil and not reportedError then
    noctalia.log(value.error)
  end
  reportedError = value.error ~= nil
end

local function fail(message)
  publish({
    working = status.working,
    waiting = status.waiting,
    inhibited = status.inhibited,
    error = message,
  })
end

local function valid(value)
  return type(value) == "table"
    and type(value.working) == "number" and value.working >= 0 and value.working % 1 == 0
    and type(value.waiting) == "number" and value.waiting >= 0 and value.waiting % 1 == 0
    and type(value.inhibited) == "boolean"
    and (value.error == nil or type(value.error) == "string")
end

function update()
  if not started then
    local helper = noctalia.pluginDir() .. "/pi-activity.ts"
    -- runStream accepts a shell string. Quote the plugin path, then let native
    -- stream teardown cancel the helper's whole process group on reload/stop.
    local command = "exec accel-node '" .. string.gsub(helper, "'", "'\\''") .. "'"
    started = noctalia.runStream(command, function(line)
      local value, err = noctalia.json.decode(line)
      if not valid(value) then
        fail("Invalid Pi activity status: " .. tostring(err or "unexpected value"))
        return
      end
      lastOutput = noctalia.nowMs()
      publish(value)
    end)
    if not started then
      fail("Could not start Pi activity helper")
      return
    end
    lastOutput = noctalia.nowMs()
  end
  -- runStream has no exit callback. A heartbeat detects failed startup or an
  -- unexpected exit without PID polling or risking a duplicate helper.
  -- Deliberately report helper exit without automatic restart: a missing heartbeat
  -- cannot distinguish an exited helper from a stalled one. Restart Noctalia to
  -- recover; avoid supervision complexity unless failures become recurrent.
  if noctalia.nowMs() - lastOutput >= 10000 then
    fail("Pi activity helper stopped reporting")
  end
end

noctalia.setUpdateInterval(3000)
noctalia.state.set("pi-agents", {
  working = 0, waiting = 0, inhibited = false, error = "Waiting for Pi activity helper",
})
update()
