mod account;
mod bridge;
mod chat;
mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "android")]
            app.handle().plugin(tauri_plugin_barcode_scanner::init())?;
            Ok(())
        })
        .manage(account::AppState::default())
        .invoke_handler(tauri::generate_handler![
            account::mobile_login,
            account::mobile_account,
            account::mobile_logout,
            chat::mobile_chat,
            bridge::bridge_devices,
            bridge::bridge_set_device,
            bridge::bridge_claim_pairing,
            bridge::bridge_sync_session,
            bridge::bridge_tasks,
            bridge::bridge_create_task,
            bridge::bridge_signals,
            bridge::bridge_send_signal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
