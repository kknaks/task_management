//! Tauri 셸.
//!
//! 셸이 맡는 것은 **마이크 권한 · OS 키체인 · 파일 선택창**뿐이다
//! (`40-architecture/system/README.md` §Components). 데이터 저장·비즈니스 로직·화면은 없다 —
//! 화면은 전부 정적 번들(`../out`)이 그리고, dev 는 `devUrl` 의 개발 서버를 그대로 문다.
//!
//! WORK-001 에서 이 파일은 **창을 띄우는 것 말고 아무것도 하지 않는다.**
//! `keyring` 의존성은 Cargo.toml 에 걸려 있고, 커맨드로 노출하는 것은 WORK-002 다.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
