local poll = require("./poll.luau")

barWidget.setGlyph("robot")

local function collect(runtimeRoot, done)
  local stateDir = runtimeRoot .. "/accel-os/pi-agents"
  local state = { working = 0, waiting = 0 }
  if not noctalia.fileExists(stateDir) then
    done(state)
    return
  end
  local files, err = noctalia.listDir(stateDir)
  if files == nil then
    done(nil, err)
    return
  end

  local index = 0
  local function nextFile()
    index = index + 1
    local name = files[index]
    while name ~= nil and not string.match(name, "^%d+%.state$") do
      index = index + 1
      name = files[index]
    end
    if name == nil then
      done(state)
      return
    end
    local pid = string.match(name, "^(%d+)%.state$")
    -- Read procfs asynchronously, one process at a time, within the runtime's bounded queue.
    local started = noctalia.readFileAsync("/proc/" .. pid .. "/cmdline", function(cmdline)
      if cmdline ~= nil and string.find(string.gsub(cmdline, "%z", " "), "/ai/pi/ai.ts", 1, true) then
        local content = noctalia.readFile(stateDir .. "/" .. name)
        -- The producer writes newline-terminated states; ignore malformed or vanished files.
        local activity = content and string.match(content, "^([^\n]*)\n")
        if activity == "working" then
          state.working = state.working + 1
        elseif activity == "idle" then
          state.waiting = state.waiting + 1
        end
      end
      nextFile()
    end)
    if not started then
      done(nil, "Could not queue Pi process read")
    end
  end
  nextFile()
end

local function query(done)
  local runtimeRoot = noctalia.getenv("XDG_RUNTIME_DIR")
  if runtimeRoot ~= nil and runtimeRoot ~= "" then
    collect(runtimeRoot, done)
    return
  end
  -- Bash provided $UID in the old helper even when it was not exported.
  local started = noctalia.readFileAsync("/proc/self/status", function(status, err)
    local uid = status and string.match(status, "\nUid:%s+%d+%s+(%d+)")
    if uid == nil then
      done(nil, err or "Could not determine Pi runtime directory")
      return
    end
    collect("/tmp/accel-os-" .. uid, done)
  end)
  if not started then
    done(nil, "Could not queue user ID read")
  end
end

local refresh = poll.create(query, 3000, function(state)
  barWidget.setText(string.format("%d/%d", state.working, state.waiting))
  barWidget.setColor(state.working > 0 and "#ebcb8b" or "#90b1b1")
  barWidget.setTooltip(string.format("%d working, %d waiting", state.working, state.waiting))
  barWidget.setVisible(state.working + state.waiting > 0)
  return true
end)

function update()
  refresh()
end

update()
