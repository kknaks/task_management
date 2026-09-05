//! Tauri 셸.
//!
//! 셸이 맡는 것은 **마이크 권한 · OS 키체인 · 파일 선택창**뿐이다
//! (`40-architecture/system/README.md` §Components). 데이터 저장·비즈니스 로직·화면은 없다 —
//! 화면은 전부 정적 번들(`../out`)이 그리고, dev 는 `devUrl` 의 개발 서버를 그대로 문다.
//!
//! WORK-002 가 **OS 키체인 커맨드 셋**을 연다. 프론트에서 이 커맨드를 부르는 파일은
//! `src/lib/auth/tokenStore.ts` **하나뿐**이다(FE §4-1 — 그 밖에서 부르면 리뷰 반려).

use keyring::Entry;

/// 키체인 항목 좌표. `tauri.conf.json` 의 `identifier` 와 같은 값을 서비스명으로 쓴다.
const KEYCHAIN_SERVICE: &str = "com.kknaks.task-management";
/// 담는 것은 **refresh 토큰 하나**다. access 토큰은 저장소에 넣지 않는다(DEC-001 §4).
const KEYCHAIN_ACCOUNT: &str = "refresh-token";

fn entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|error| error.to_string())
}

/// 보관된 refresh 토큰. 항목이 없으면 `None` — **없는 것은 실패가 아니다**(첫 실행·로그아웃 뒤).
#[tauri::command]
fn keychain_get_refresh_token() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

/// refresh 토큰을 덮어쓴다. **회전마다 새 값으로 갈아탄다**(SPEC-001 §5 토큰 취급).
#[tauri::command]
fn keychain_set_refresh_token(token: String) -> Result<(), String> {
    entry()?
        .set_password(&token)
        .map_err(|error| error.to_string())
}

/// 로그아웃·갱신 실패 때 지운다. 이미 없으면 성공으로 본다 — 지워진 상태가 목표다.
#[tauri::command]
fn keychain_clear_refresh_token() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

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
        .invoke_handler(tauri::generate_handler![
            keychain_get_refresh_token,
            keychain_set_refresh_token,
            keychain_clear_refresh_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
