-- Each entry gets its own module instance and one outstanding query at most.
local M = {}

function M.command(command, decode)
  return function(done)
    local started = noctalia.runAsync(command, function(result)
      if result.exitCode ~= 0 or result.timedOut or result.stdoutTruncated then
        done(nil, "Status query failed: " .. (result.stderr or ""))
        return
      end
      local value, err = (decode or noctalia.json.decode)(result.stdout)
      done(value, err)
    end)
    if not started then
      done(nil, "Could not start status query")
    end
  end
end

function M.create(query, interval, present)
  local pending = false
  local reportedError = false

  barWidget.setVisible(false)
  noctalia.setUpdateInterval(interval)

  local function fail(message)
    -- Do not turn an unavailable query into a healthy-looking empty indicator.
    barWidget.setText("?")
    barWidget.setVisible(true)
    if not reportedError then
      noctalia.log(message)
    end
    reportedError = true
  end

  return function()
    if pending then
      return
    end
    pending = true
    query(function(value, err)
      pending = false
      if value == nil then
        fail("Status unavailable: " .. tostring(err))
        return
      end
      if not present(value) then
        fail("Unexpected status value")
        return
      end
      reportedError = false
    end)
  end
end

return M
