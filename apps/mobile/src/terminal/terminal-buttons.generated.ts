// Generated from terminal-buttons.yml by scripts/build-terminal-keys.mjs.
// Do not edit: change the YAML and run npm run build-terminal-keys.

import type { TerminalButtons } from './keys';

export const TERMINAL_BUTTONS: TerminalButtons = {
  "look": {
    "height": 44,
    "keyText": 13,
    "swipeText": {
      "size": 9,
      "opacity": 0.4
    }
  },
  "rows": [
    [
      {
        "label": "ESC",
        "action": "Esc",
        "up": {
          "label": "UNDO",
          "action": "Undo"
        }
      },
      {
        "label": "FN",
        "action": "Fn",
        "up": {
          "label": "^A",
          "action": "select-all"
        }
      },
      {
        "label": "PASTE",
        "action": "paste",
        "up": {
          "label": "COPY",
          "action": "copy"
        }
      },
      {
        "label": "/",
        "action": "/",
        "up": {
          "label": "$",
          "action": "$"
        }
      },
      {
        "label": "~",
        "action": "~",
        "up": {
          "label": "|",
          "action": "|"
        }
      },
      {
        "label": "↑",
        "action": "Up",
        "up": {
          "label": "PGUP",
          "action": "PgUp"
        }
      },
      {
        "label": "⌫",
        "action": "Backspace",
        "up": {
          "label": "INS",
          "action": "Insert"
        }
      },
      {
        "label": "DEL",
        "action": "Delete",
        "up": {
          "label": "⋯",
          "action": "more"
        }
      }
    ],
    [
      {
        "label": "⇥",
        "action": "Tab",
        "up": {
          "label": "⇧⇥",
          "action": "Shift+Tab"
        }
      },
      {
        "label": "CTRL",
        "action": "Ctrl",
        "up": {
          "label": "^C",
          "action": "Ctrl+C"
        }
      },
      {
        "label": "ALT",
        "action": "Alt",
        "up": {
          "label": "`",
          "action": "`"
        }
      },
      {
        "label": "⌘",
        "action": "Super",
        "up": {
          "label": "REDO",
          "action": "Redo"
        }
      },
      {
        "label": "←",
        "action": "Left",
        "up": {
          "label": "HOME",
          "action": "Home"
        }
      },
      {
        "label": "↓",
        "action": "Down",
        "up": {
          "label": "PGDN",
          "action": "PgDn"
        }
      },
      {
        "label": "→",
        "action": "Right",
        "up": {
          "label": "END",
          "action": "End"
        }
      },
      {
        "label": "↵",
        "action": "Enter",
        "up": {
          "label": "⇧↵",
          "action": "Shift+Enter"
        }
      }
    ]
  ],
  "fn": {
    "0": "F10",
    "1": "F1",
    "2": "F2",
    "3": "F3",
    "4": "F4",
    "5": "F5",
    "6": "F6",
    "7": "F7",
    "8": "F8",
    "9": "F9",
    "A": "F11",
    "B": "F12",
    "Up": "PgUp",
    "Down": "PgDn",
    "Left": "Home",
    "Right": "End"
  },
  "repeat": [
    "Up",
    "Down",
    "Left",
    "Right",
    "Backspace",
    "Delete"
  ],
  "more": [
    {
      "label": "^D",
      "action": "Ctrl+D"
    },
    {
      "label": "^L",
      "action": "Ctrl+L"
    },
    {
      "label": "^R",
      "action": "Ctrl+R"
    },
    {
      "label": "^Z",
      "action": "Ctrl+Z"
    },
    {
      "label": "\\",
      "action": "\\"
    },
    {
      "label": "//",
      "action": "//"
    }
  ]
};
