fn main() {
    let m = tauri_build::AppManifest::new().commands(&["open"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(m))
        .expect("tauri-build");
}
