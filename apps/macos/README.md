# macOS (Tauri)

Same idea as `apps/ios` — the real Tauri/Rust project is generated on your
Mac, since it needs Rust's toolchain (Cargo) installed locally.

## To generate it (Terminal, on your Mac)

```bash
# One-time: install Rust if you don't have it
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

cd apps/macos
cargo install create-tauri-app --locked
npm create tauri-app@latest .   # point it at ../web as the frontend
cargo tauri dev                 # runs it
cargo tauri build               # produces the .app / .dmg
```
