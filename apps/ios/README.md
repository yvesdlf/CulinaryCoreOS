# iOS / iPadOS (Capacitor)

This folder is intentionally near-empty. The actual Xcode project
(`apps/ios/App/App.xcworkspace`) is generated on **your Mac**, not here —
Capacitor's CLI needs Xcode itself to scaffold it.

## To generate it (Terminal, on your Mac)

```bash
cd apps/ios
npm init -y                     # first time only
npm install @capacitor/core @capacitor/ios
npx cap init "CulinaryCoreOS" "com.yourcompany.culinarycoreos" --web-dir="../web/dist"
npx cap add ios
npx cap open ios                # opens Xcode
```

After that, `apps/ios/App/` contains the real Xcode project — open
`App.xcworkspace` (not `.xcodeproj`) in Xcode from then on, since
CocoaPods dependencies hook in via the workspace.

Every time the web app changes:
```bash
cd apps/web && pnpm build
cd ../ios && npx cap sync ios
```
