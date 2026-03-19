## What this is
This is a bar configuration made with [Astal](https://github.com/Aylur/astal) and [AGS](https://github.com/Aylur/ags).

## AI-written notice
The README sections **"What this is"**, **"How to modify"**, and **"License"** were written by AI. The text under **"Notes (please read)"** is written by me.

## Credits / inspiration
Heavily inspired (mostly meaning “copied”) from:
- https://github.com/caelestia-dots/shell/tree/main
- https://github.com/ezerinz/epik-shell/tree/main

Also using `epik-shell` as a reference:
- https://github.com/ezerinz/epik-shell/tree/main

## Where to edit what (quick map)
File structure (high level):
- `app.ts` (entry point)
- `widget/` (UI/widgets)
  - `widget/QuickMenu.tsx`
  - `widget/WorkspaceCircles.tsx`
  - `widget/systemEventNoti.tsx`
- `*.scss` (styling)
  - `bar-palettes.scss` (colors/palettes)
  - `systemEventNoti.scss`

Common changes:
- **If you want to change the QuickMenu button / QuickMenu UI**: go to `widget/QuickMenu.tsx` and search for `QuickMenu` / the button component and its `onClicked`/handler.
- **If you want to change workspace indicator behavior/looks**: go to `widget/WorkspaceCircles.tsx`.
- **If you want to change system event notifications (layout/logic)**: go to `widget/systemEventNoti.tsx`.
- **If you want to change system event notification styling**: go to `systemEventNoti.scss`.
- **If you want to change or add more color options for the bar**: go to `bar-palettes.scss` and edit/add palette variables/blocks there.
- **If you’re unsure where something is wired up**: start at `app.ts`, then follow the widget imports/usages into `widget/`.

## Notes (please read)
the whole bar is vibe coded(100% not 99% not 80%, 100% vibe coded) as i just don't want to watse what is left of my Cursor pro plan since im going to cancel it, so not entirely sure if everything is correct or how to fix it for that matter so it would be better if you fork it and change it for yourself rather than making a issue.

yeah just making sure you know what you’re getting yourself into. will this be updated? most likely yes. I want to use the caelestia quickshell, but the nightly version is too unstable (mostly because of qt, not the creator’s fault tbh). and since the stable version only comes with the full config, and all I want is the bar, so i want something more stable. im still trying to learn (if you can call this learning) how to use Linux. So my knowledge is quite thin.
I’ll try to keep it as-is; the whole point of this is to have a more stable bar when updating the system :). 

also, in case this got popular(you never know) if you’re wondering “why the f*ck would you vibe code this?”, i’m just putting this here:
- I don’t have enough time to learn everything. the earlier version I made was horrible—I almost quit before using AI.
- I don’t care if you think the docs are superb and the devs did the best they could(in your opinion). I couldn’t understand it, so should I stop there? nope. I’m trying with whatever knowledge I have. this is a side project at the end of the day.


Thanks for reading ;)

## License
Everything should be MIT licensed.


