# Offline dictionary

`dictionary.json` is a filtered English-to-Chinese word list generated from
[ECDICT](https://github.com/skywind3000/ECDICT), using the MIT-licensed
`ecdict` npm package (`ecdict@0.0.4`) as the build source.

The original CSV is not committed. To regenerate the compact dictionary:

```powershell
npm pack ecdict --pack-destination $env:TEMP
tar -xzf "$env:TEMP/ecdict-0.0.4.tgz" -C "$env:TEMP/paperlens-ecdict-package"
python scripts/build-dictionary.py `
  --source "$env:TEMP/paperlens-ecdict-package/package/assets/ecdict.csv" `
  --output src/translation/dictionary.json
```

ECDICT copyright (c) 2025 Linwei and contributors, licensed under the MIT
License. The generated file keeps Chinese definitions for common, tagged, and
high-frequency English words only.
