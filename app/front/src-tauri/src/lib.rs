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

/// Windows(WebView2) 마이크 권한.
///
/// WebView2 는 `PermissionRequested` 를 아무도 처리하지 않으면 `getUserMedia` 가 프롬프트 없이 실패한다 —
/// 마이크 트랙이 0 이라 회의 화면이 곧바로 `paused/mic` 로 떨어진다. wry 0.55 는 이 이벤트에서
/// **CLIPBOARD_READ 만** 허용하므로(`wry/src/webview2/mod.rs`), 마이크는 셸이 직접 허용한다.
///
/// macOS 는 여기서 할 일이 없다 — wry 의 `WKUIDelegate` 가 WebKit 단계 요청을 Grant 하고,
/// OS 프롬프트는 `Info.plist` 의 `NSMicrophoneUsageDescription` 이 띄운다.
#[cfg(windows)]
fn allow_microphone_on_webview2(webview: &tauri::Webview) -> tauri::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;

    webview.with_webview(|platform| {
        let result = unsafe {
            let core = platform.controller().CoreWebView2();
            core.and_then(|core| {
                let mut token: i64 = 0;
                core.add_PermissionRequested(
                    &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                        let Some(args) = args else { return Ok(()) };
                        let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                        args.PermissionKind(&mut kind)?;
                        if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                            args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                        }
                        Ok(())
                    })),
                    &mut token,
                )
            })
        };
        if let Err(error) = result {
            log::error!("WebView2 PermissionRequested 등록 실패 — 마이크가 열리지 않는다: {error}");
        }
    })
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
            #[cfg(windows)]
            {
                use tauri::Manager;
                for webview in app.webviews().values() {
                    allow_microphone_on_webview2(webview)?;
                }
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
