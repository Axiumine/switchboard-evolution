// Main → client events. The desktop window is one destination; another client
// (a remote-access connection) adds its own with addSink. Modules call emit()
// instead of sending to the window themselves, so every client receives the
// same events.

const sinks = new Set();

/** Add a destination: sink(channel, args). Returns a function that removes it. */
function addSink(sink) {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

/** Send an event to every destination. A destination that throws does not stop the others. */
function emit(channel, ...args) {
  for (const sink of sinks) {
    try {
      sink(channel, args);
    } catch (err) {
      console.error(`[broadcast] ${channel}: ${err?.message || err}`);
    }
  }
}

module.exports = { addSink, emit };
