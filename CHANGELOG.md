# Changelog

## [0.2.10](https://github.com/fyodoriv/code-smells/compare/code-smells-v0.2.9...code-smells-v0.2.10) (2026-04-21)


### Bug Fixes

* ship lib/ in the tarball, resolve code-pushup bin robustly ([81d1d30](https://github.com/fyodoriv/code-smells/commit/81d1d30bc2dd87bf23ec5f4cd92887b01184bb72))

## [0.2.9](https://github.com/fyodoriv/code-smells/compare/code-smells-v0.2.8...code-smells-v0.2.9) (2026-04-21)


### Bug Fixes

* reject Node 18 up front with an actionable error message ([81910f2](https://github.com/fyodoriv/code-smells/commit/81910f26cdae5f89d3d2f7cb8aa20699272c9874))


### Documentation

* add P0 task to document every audit with reasoning ([add93ba](https://github.com/fyodoriv/code-smells/commit/add93baa53df90afef914f92b6be82698c3d9939))

## [0.2.8](https://github.com/fyodoriv/code-smells/compare/code-smells-v0.2.7...code-smells-v0.2.8) (2026-04-21)


### Bug Fixes

* rewrite markdown report links to clickable absolute file:// URLs ([5ba8a9d](https://github.com/fyodoriv/code-smells/commit/5ba8a9d8b914ebb9feeff82b6e5393b92912f455))

## [0.2.7](https://github.com/fyodoriv/code-smells/compare/code-smells-v0.2.6...code-smells-v0.2.7) (2026-04-20)


### Features

* reports land in OS cache dir, print clickable file:// URL ([4c9f3a2](https://github.com/fyodoriv/code-smells/commit/4c9f3a2752ec5e377b87ad8cdd5d7b969eb548b7))

## [0.2.6](https://github.com/fyodoriv/code-smells/compare/code-smells-v0.2.5...code-smells-v0.2.6) (2026-04-20)


### Bug Fixes

* resolve jscpd + knip bins via walk-up, not hoisted .bin/ path ([78208a1](https://github.com/fyodoriv/code-smells/commit/78208a11717572ee3d1c017b25776e75df267f60))

## [0.2.5](https://github.com/fyodoriv/code-smells/compare/code-smells-v0.2.4...code-smells-v0.2.5) (2026-04-20)


### Bug Fixes

* auto-detect monorepo pattern + land reports in target dir ([f8d6b2b](https://github.com/fyodoriv/code-smells/commit/f8d6b2b0ea1db58205563f3dbe6ebf4187d32b9a))

## [0.2.4](https://github.com/fyodoriv/code-smells/compare/code-smells-v0.2.3...code-smells-v0.2.4) (2026-04-20)


### Bug Fixes

* await jsPackagesPlugin before mutating its runner ([e47e482](https://github.com/fyodoriv/code-smells/commit/e47e482245a6b68671fc71d6cc9a00b38a828278))

## [0.2.3](https://github.com/fyodoriv/code-smells/compare/code-smells-v0.2.2...code-smells-v0.2.3) (2026-04-20)


### Bug Fixes

* degrade js-packages plugin failures instead of crashing the run ([7a89883](https://github.com/fyodoriv/code-smells/commit/7a898837f458eefc0afdd115b73daeffe633f5e4))


### Documentation

* tighten README code blocks to real one-liners ([46dc2a5](https://github.com/fyodoriv/code-smells/commit/46dc2a53bd4386d85654d38307ab7c5dfa6913b9))

## [0.2.2](https://github.com/fyodoriv/code-smells/compare/code-smells-v0.2.1...code-smells-v0.2.2) (2026-04-20)


### Documentation

* default README to cd-then-run flow ([34db4a2](https://github.com/fyodoriv/code-smells/commit/34db4a265b4e0ca9ccdad23092b94ab94602cecd))

## [0.2.1](https://github.com/fyodoriv/code-smells/compare/code-smells-v0.2.0...code-smells-v0.2.1) (2026-04-20)


### Features

* ship as `npx code-smells` + automated npm releases ([578a0a2](https://github.com/fyodoriv/code-smells/commit/578a0a27c2ef3605025801cd0427b1d7832ec211))


### Documentation

* default README to "cd in and run" flow ([cbd833a](https://github.com/fyodoriv/code-smells/commit/cbd833a8a8eaf43b54d92aa6a4cff944dfb14bed))
* rewrite README for quick-start first ([05a65cc](https://github.com/fyodoriv/code-smells/commit/05a65cc0a21381ed9eba2f3761d59a8c8a9a1768))
