# Plugin Check

Drop an Ableton Live session (`.als`) or a project folder into the app and it lists every third-party plugin (VST2, VST3, AU) and Max for Live device per track.
Export the list (`.pluginlist.json`) and send it to a collaborator. They drop it into the app, which compares it with their installed plugins and shows **which tracks have to be frozen** because plugins are missing.

Ableton-Session (`.als`) oder Projektordner ins Fenster ziehen → alle Plugins pro Spur werden gelesen. Die exportierte Plugin-Liste kann jemand anderes in seine App ziehen: Die App vergleicht mit den installierten Plugins und zeigt, **welche Spuren gefroren werden müssen**.

## Download (macOS, Apple Silicon)

Grab `Plugin-Check-mac-arm64.zip` from the [latest release](../../releases/latest), unzip it and move `Plugin Check.app` to Applications.
The app is not signed: right-click → Open on first launch, or run

```bash
xattr -dr com.apple.quarantine "/Applications/Plugin Check.app"
```

## How it works

- Only the one who has the plugins can freeze, so send the exported freeze list back to the session owner.
- Group, return and main tracks cannot be frozen in Live; they are flagged separately.
- Already frozen tracks and tracks whose missing plugins are all disabled are not counted as problems.
- Plugins are scanned from the standard plugin folders (macOS: `/Library` and `~/Library/Audio/Plug-Ins`). Add more folders with "Ordner hinzufügen"; click a plugin chip to mark it as installed manually.

## Develop

```bash
npm install
npm start          # run the app
npm run package    # build dist/Plugin Check-darwin-arm64/Plugin Check.app
```
