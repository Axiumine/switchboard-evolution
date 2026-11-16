# Third-party notices

Switchboard Mobile is MIT licensed (see [LICENSE](LICENSE)). It also ships
the following work by others, under its own licence.

## Adwaita Mono (font)

The terminal page (`src/terminal/terminal-html.generated.ts`, built by
`scripts/build-terminal-html.mjs` on `npm install`) embeds the Regular and
Bold weights of Adwaita Mono, taken from the
[`@fontsource/adwaita-mono`](https://fontsource.org/fonts/adwaita-mono)
package. The build cuts the fonts down to the characters a terminal shows
and drops their layout features and hinting; the copyright and licence
entries of the fonts' name tables are kept.

```text
Copyright (c) 2016, The Inter Project Authors (https://github.com/rsms/inter)
Copyright (c) 2015-2025, Renzhi Li (aka. Belleve Invis, belleve@typeof.net)
Copyright (c) 2025, Jamie Gravendeel (https://jamie.garden)
Copyright (c) 2025, Florian Müllner

This Font Software is licensed under the SIL Open Font License, Version 1.1.
```

The full licence text is in [licenses/OFL-AdwaitaMono.txt](licenses/OFL-AdwaitaMono.txt),
and is also available with a FAQ at https://openfontlicense.org.

The chat's code blocks and tool rows use the platform's monospace font, not
this one: React Native cannot load the woff2 files the package provides on
Android.

## Material Icon Theme (file icons)

The file and folder icons of the Files, Git and search lists
(`src/files/icon-theme.generated.ts`, built by `scripts/build-file-icons.mjs`)
are a subset of the SVG icons of the
[Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme)
(`material-icon-theme` 5.40.0), with the theme's rules for which name gets which
icon. The notice is also at the top of the generated file.

```text
The MIT License (MIT)
Copyright (c) 2025 Material Extensions

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
