Inter 4.1, copyright The Inter Project Authors.
Source: https://github.com/rsms/inter/releases/tag/v4.1
License: Inter-LICENSE.txt (SIL Open Font License 1.1).

Original fonts:
https://rsms.me/inter/font-files/InterVariable.woff2?v=4.1
https://rsms.me/inter/font-files/InterVariable-Italic.woff2?v=4.1

Both files are subset with fontTools pyftsubset and Brotli:
pyftsubset INPUT --output-file=OUTPUT --flavor=woff2 --unicodes='U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2212,U+2215,U+FEFF,U+FFFD'

Includes Latin, extended Latin, punctuation, currency, letterlike symbols,
and arrows. Other scripts use the system sans-serif fallback.
