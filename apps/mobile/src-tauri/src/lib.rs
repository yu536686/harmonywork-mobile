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
            chat::mobile_chat_continue,
            bridge::bridge_devices,
            bridge::bridge_set_device,
            bridge::bridge_claim_pairing,
            bridge::bridge_sync_session,
            bridge::bridge_create_session,
            bridge::bridge_list_sessions,
            bridge::bridge_append_message,
            bridge::bridge_messages,
            bridge::bridge_claim_turn,
            bridge::bridge_start_turn,
            bridge::bridge_active_turn,
            bridge::bridge_turn_heartbeat,
            bridge::bridge_complete_turn,
            bridge::bridge_tasks,
            bridge::bridge_create_task,
            bridge::bridge_signals,
            bridge::bridge_send_signal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
