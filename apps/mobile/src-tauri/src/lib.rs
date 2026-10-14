mod account;
mod bridge;
mod mobile_attachment;
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
            bridge::bridge_attachments,
            bridge::bridge_attachment_ticket,
            bridge::bridge_unlink,
            bridge::bridge_set_device,
            bridge::bridge_claim_pairing,
            bridge::bridge_sync_session,
            bridge::bridge_create_session,
            bridge::bridge_delete_session,
            bridge::bridge_deleted_sessions,
            bridge::bridge_list_sessions,
            bridge::bridge_append_message,
            bridge::bridge_messages,
            bridge::bridge_task_events,
            bridge::bridge_changes,
            bridge::bridge_start_change_stream,
            bridge::bridge_stop_change_stream,
            bridge::bridge_claim_turn,
            bridge::bridge_start_turn,
            bridge::bridge_active_turn,
            bridge::bridge_turn_heartbeat,
            bridge::bridge_complete_turn,
            bridge::bridge_tasks,
            bridge::bridge_create_task,
            bridge::bridge_signals,
            bridge::bridge_send_signal,
            bridge::bridge_attachment_relay_download,
            mobile_attachment::mobile_attachment_receive_start,
            mobile_attachment::mobile_attachment_receive_chunk,
            mobile_attachment::mobile_attachment_receive_finish,
            mobile_attachment::mobile_attachment_receive_abort,
            mobile_attachment::mobile_attachment_preview,
            mobile_attachment::mobile_attachment_save,
            mobile_attachment::mobile_attachment_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
