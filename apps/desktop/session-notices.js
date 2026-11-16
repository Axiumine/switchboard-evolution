// Unread and needs-you marks, shared with paired phones.
//
// The marks live in the window (public/app.js), which publishes them here
// whenever they change; phones receive them as an event and can ask for them
// when they connect. A phone can mark a session read or unread, and says which
// session it has on screen: a session open on a phone counts as seen, like
// the one open in the window.

const MAX_IDS = 500;

const ids = (list) => (Array.isArray(list)
  ? [...new Set(list.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 200))].slice(-MAX_IDS)
  : []);

function createSessionNotices({ emit }) {
  let notices = { ready: [], attention: [] };
  let published = JSON.stringify(notices);
  const viewing = new Map(); // phone → the session on its screen

  /** The window's marks changed. Returns whether phones were told. */
  function publish(next) {
    const clean = { ready: ids(next?.ready), attention: ids(next?.attention) };
    const text = JSON.stringify(clean);
    if (text === published) return false;
    notices = clean;
    published = text;
    emit('session-notices-changed', notices);
    return true;
  }

  function viewingIds() {
    return [...new Set(viewing.values())].sort();
  }

  /** Tell the window when the set of sessions on a phone screen changes. */
  function changeViewing(change) {
    const before = viewingIds().join('\n');
    change();
    const after = viewingIds();
    if (after.join('\n') !== before) emit('remote-viewing', after);
  }

  function setViewing(client, sessionId) {
    changeViewing(() => {
      if (sessionId) viewing.set(client, sessionId);
      else viewing.delete(client);
    });
    return true;
  }

  function clientClosed(client) {
    if (viewing.has(client)) setViewing(client, null);
  }

  // The window owns the marks: it applies this and publishes the result.
  function setRead(sessionId, read) {
    emit('remote-mark-read', sessionId, read);
    return true;
  }

  /** A broadcast.js destination: follow sessions whose id changes. */
  function eventSink(channel, args) {
    if (channel !== 'session-detected' && channel !== 'session-forked') return;
    const [oldId, newId] = args;
    if (!newId || ![...viewing.values()].includes(oldId)) return;
    changeViewing(() => {
      for (const [client, id] of viewing) if (id === oldId) viewing.set(client, newId);
    });
  }

  return { publish, snapshot: () => notices, setRead, setViewing, clientClosed, viewingIds, eventSink };
}

module.exports = { createSessionNotices };
