views["/snapshot"] = textView("hello")
onOpen("/snapshot")
failLaunch = true
button("Save as…")()
assert(closed == 0 and #notices == 1 and #launches == 0)
failLaunch = false
button("Cancel")()
assert(closed == 1 and launches[1][2] == "discard")
onOpen("/invalid")
assert(closed == 2 and #notices == 2)
assert(launches[2][2] == "discard" and launches[2][3] == "/invalid")
