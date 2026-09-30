mod account;
mod chat;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(account::AppState::default())
        .invoke_handler(tauri::generate_handler![
            account::mobile_login,
            account::mobile_account,
            account::mobile_logout,
            chat::mobile_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
