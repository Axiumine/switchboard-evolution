// The terminal page (build-terminal-html.mjs) carries these two functions as
// they are written here: keep them self-contained, in plain ES5.
//
// The phone shows the computer's terminal; it does not stand in for it. The
// program in a session asks its terminal questions (where is the cursor,
// which modes, which colours) and the computer's terminal answers them. An
// xterm.js on the phone answers too: every answer goes to the session as if
// typed, and on opening the terminal it answers every question in the
// replayed history at once. A Claude session asks for the cursor position
// five times a second, so its replay holds thousands: thousands of answers,
// each a message across the WebView bridge, which froze the app.

/** Stops `term` from answering the questions programs ask their terminal. */
function quietReplies(term) {
  var swallow = function () { return true; };
  var questions = [
    { final: 'c' }, // primary device attributes
    { prefix: '>', final: 'c' }, // secondary device attributes
    { final: 'n' }, // status and cursor position
    { prefix: '?', final: 'n' }, // cursor position (DECXCPR)
    { intermediates: '$', final: 'p' }, // an ANSI mode (DECRQM)
    { prefix: '?', intermediates: '$', final: 'p' }, // a private mode (DECRQM)
  ];
  for (var i = 0; i < questions.length; i++) term.parser.registerCsiHandler(questions[i], swallow);
  term.parser.registerDcsHandler({ intermediates: '$', final: 'q' }, swallow); // a setting (DECRQSS)
  // Colours: OSC 4 is pairs of index and colour, OSC 10 to 12 a list of
  // colours; "?" asks for one. Only a sequence that asks and sets nothing is
  // swallowed, so setting a colour still works.
  var onlyAsks = function (paired) {
    return function (data) {
      var parts = data.split(';');
      for (var j = paired ? 1 : 0; j < parts.length; j += paired ? 2 : 1) if (parts[j] !== '?') return false;
      return true;
    };
  };
  term.parser.registerOscHandler(4, onlyAsks(true));
  for (var ident = 10; ident <= 12; ident++) term.parser.registerOscHandler(ident, onlyAsks(false));
}

/**
 * Whether xterm's data is a focus report: the session's program would take
 * the phone's terminal gaining or losing focus for the computer's. The
 * desktop drops them too.
 */
function isFocusReport(data) {
  return data === '\x1b[I' || data === '\x1b[O';
}

module.exports = { quietReplies, isFocusReport };
