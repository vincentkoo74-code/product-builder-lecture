# Cold-launch Home P0 local validation

Root cause: raw markup made both `#screenAuth` and `#screenHome` visible. Cold launch entered `initFromUrl()` and awaited Auth/session/owner-room recovery before its first route. Settings → Back instead immediately invoked `goHome() -> showScreen('screenHome')`, whose `hideAllScreens()` removed the competing card and restored the Home hit target.

Fix: `screenHome` is hidden in raw markup. Before async startup work, `bootAppWhenReady()` invokes `normalizeColdLaunchScreen()`, which chooses Auth or Home from cached auth state and uses the same `showScreen()` path as Settings Back. It clears confirm/menu/countdown layers and never creates a room.

Finding: this was simultaneous visible screen containers, not duplicate DOM insertion. The competing Auth card accounted for the stacked visual and intercepted/obscured the expected Home controls. No separate invisible overlay was required to explain recovery.

Validation: Home/reconnect/exit/identity focused 43/43; release gate Normal 360/360 and correctness 100%; full non-timing 96 files, 1,561 passed, 10 skipped; RC3 63/63 in 1769.88s; HTML syntax and diff check PASS.

Device retest: cold launch authenticated app; dismiss guide if shown; verify one Home card and all controls; force-quit/relaunch; repeat; Settings Back must leave identical Home. No Seoul operation occurred.
