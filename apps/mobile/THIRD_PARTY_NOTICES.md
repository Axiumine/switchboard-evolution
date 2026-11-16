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
