local poll = loadPoll()
local received, failure, calls
local function done(value, err)
  received, failure = value, err
  calls = calls + 1
end
local query = poll.command({ "query", "--json" })
decoded.good = { name = "resize" }
calls = 0
query(done)
assert(calls == 0, "Query completed before the callback")
assert(commands[1].argv[1] == "query" and commands[1].argv[2] == "--json")
success("good")
assert(calls == 1 and received == decoded.good and failure == nil)

for _, result in ipairs({
  { exitCode = 1, stdout = "good", stderr = "denied" },
  { exitCode = 0, stdout = "good", timedOut = true },
  { exitCode = 0, stdout = "good", stdoutTruncated = true },
  { exitCode = 0, stdout = "bad" },
}) do
  calls = 0
  query(done)
  completeCommand(result)
  assert(calls == 1 and received == nil and type(failure) == "string" and #failure > 0)
end
rejectCommands = true
calls = 0
query(done)
assert(calls == 1 and received == nil and failure == "Could not start status query")
assert(#commands == 0)
rejectCommands = false
calls = 0
local custom = poll.command({ "count" }, function(raw)
  assert(raw == "three")
  return 3
end)
custom(done)
success("three")
assert(calls == 1 and received == 3 and failure == nil)
