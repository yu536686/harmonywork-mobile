use crate::account::AppState;
use reqwest::{header::COOKIE, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

const BRIDGE_ORIGIN: &str = "https://remote.harmonywatch.cn";
static DEVICE_AUTH: OnceLock<Mutex<Option<(String, String)>>> = OnceLock::new();
static CHANGE_STREAM: OnceLock<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>> = OnceLock::new();

#[tauri::command]
pub fn bridge_set_device(device_id: String, device_token: String) -> Result<(), String> {
    let mut current = DEVICE_AUTH.get_or_init(|| Mutex::new(None)).lock().map_err(|_| "设备状态不可用")?;
    if device_id.is_empty() && device_token.is_empty() { *current = None; return Ok(()); }
    pairing_id(&device_id)?;
    if device_token.len() != 43 || !device_token.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') {
        return Err("设备凭证无效".into());
    }
    *current = Some((device_id, device_token));
    Ok(())
}

fn bridge_url(path: &str) -> String {
    format!("{BRIDGE_ORIGIN}{path}")
}

fn pairing_id(raw: &str) -> Result<Uuid, String> {
    Uuid::parse_str(raw).map_err(|_| "配对编号格式无效".to_string())
}

fn current_cookie(state: &State<'_, AppState>) -> Result<String, String> {
    state
        .session
        .lock()
        .map_err(|_| "账户状态不可用".to_string())?
        .as_ref()
        .map(|session| session.cookie.clone())
        .ok_or_else(|| "请先登录个人账户".to_string())
}

async fn request(
    state: &State<'_, AppState>,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let cookie = current_cookie(state)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "无法初始化手机连接".to_string())?;
    let mut builder = client.request(method, bridge_url(path)).header(COOKIE, cookie);
    if let Some((device_id, token)) = DEVICE_AUTH.get_or_init(|| Mutex::new(None))
        .lock().map_err(|_| "设备状态不可用")?.clone() {
        builder = builder.header("X-Harmony-Device-Id", device_id)
            .header("X-Harmony-Device-Kind", "mobile")
            .header("X-Harmony-Device-Token", token);
    }
    if let Some(body) = body {
        builder = builder.json(&body);
    }
    let response = builder
        .send()
        .await
        .map_err(|_| "无法连接电脑协调服务，请检查网络".to_string())?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|_| "电脑协调服务返回的数据无效".to_string())?;
    if !status.is_success() {
        let message = value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("电脑协调服务暂不可用");
        return Err(format!("{message}（HTTP {status}）"));
    }
    Ok(value)
}

#[derive(Deserialize, Serialize)]
struct BridgeMessage {
    id: String,
    role: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSession {
    id: String,
    title: String,
    updated_at: i64,
    messages: Vec<BridgeMessage>,
}

#[tauri::command]
pub async fn bridge_devices(state: State<'_, AppState>) -> Result<Value, String> {
    request(&state, Method::GET, "/api/mobile/devices", None).await
}

#[tauri::command]
pub async fn bridge_claim_pairing(
    state: State<'_, AppState>,
    pairing_id: String,
    secret: String,
    mobile_name: String,
) -> Result<Value, String> {
    let id = pairing_id_fn(&pairing_id)?;
    request(
        &state,
        Method::POST,
        &format!("/api/mobile/pairings/{id}/claim"),
        Some(json!({"secret":secret,"mobileName":mobile_name})),
    )
    .await
}

fn pairing_id_fn(raw: &str) -> Result<Uuid, String> {
    pairing_id(raw)
}

#[tauri::command]
pub async fn bridge_sync_session(
    state: State<'_, AppState>,
    session: BridgeSession,
) -> Result<Value, String> {
    let id = pairing_id(&session.id)?;
    if session.messages.len() > 100
        || session.title.trim().is_empty()
        || session.title.chars().count() > 120
        || session.updated_at < 0
    {
        return Err("会话内容超出同步范围".into());
    }
    for message in &session.messages {
        pairing_id(&message.id)?;
        if !matches!(message.role.as_str(), "user" | "assistant")
            || message.content.is_empty()
            || message.content.chars().count() > 8_000
        {
            return Err("会话消息格式无效".into());
        }
    }
    request(
        &state,
        Method::PUT,
        &format!("/api/mobile/sessions/{id}"),
        Some(json!({
            "title":session.title,
            "updatedAt":session.updated_at,
            "messages":session.messages
        })),
    )
    .await
}

#[tauri::command]
pub async fn bridge_create_session(state: State<'_, AppState>, session_id: String, title: String) -> Result<Value, String> {
    pairing_id(&session_id)?;
    if title.trim().is_empty() || title.chars().count() > 120 { return Err("会话标题无效".into()); }
    request(&state, Method::POST, "/api/mobile/sessions", Some(json!({"id":session_id,"title":title}))).await
}

#[tauri::command]
pub async fn bridge_list_sessions(
    state: State<'_, AppState>, mobile_device_id: String,
    before_cursor: Option<String>, before_id: Option<String>,
) -> Result<Value, String> {
    let id = pairing_id(&mobile_device_id)?;
    let mut path = format!("/api/mobile/sessions?mobileDeviceId={id}");
    match (before_cursor, before_id) {
        (Some(cursor), Some(before_id)) => {
            pairing_id(&before_id)?;
            if cursor.len() > 40 || !cursor.bytes().all(|byte|
                byte.is_ascii_digit() || matches!(byte, b'-' | b':' | b'T' | b'.' | b'Z')) {
                return Err("会话分页位置无效".into());
            }
            path.push_str(&format!("&before={cursor}&beforeId={before_id}"));
        }
        (None, None) => {}
        _ => return Err("会话分页位置不完整".into()),
    }
    request(&state, Method::GET, &path, None).await
}

#[tauri::command]
pub async fn bridge_append_message(
    state: State<'_, AppState>, session_id: String, message_id: String,
    role: String, content: String, turn_id: Option<String>,
) -> Result<Value, String> {
    let id = pairing_id(&session_id)?;
    pairing_id(&message_id)?;
    if let Some(ref turn) = turn_id { pairing_id(turn)?; }
    if !matches!(role.as_str(), "user" | "assistant") || content.is_empty() || content.chars().count() > 8_000 {
        return Err("会话消息格式无效".into());
    }
    let mut body = json!({"id":message_id,"role":role,"content":content});
    if let Some(turn) = turn_id { body["turnId"] = json!(turn); }
    request(&state, Method::POST, &format!("/api/mobile/sessions/{id}/messages"), Some(body)).await
}

#[tauri::command]
pub async fn bridge_messages(state: State<'_, AppState>, session_id: String, after_seq: u64) -> Result<Value, String> {
    let id = pairing_id(&session_id)?;
    request(&state, Method::GET, &format!("/api/mobile/sessions/{id}/messages?afterSeq={after_seq}"), None).await
}

#[tauri::command]
pub async fn bridge_task_events(state: State<'_, AppState>, session_id: String, after_seq: u64) -> Result<Value, String> {
    let id = pairing_id(&session_id)?;
    request(&state, Method::GET, &format!("/api/mobile/sessions/{id}/task-events?afterSeq={after_seq}"), None).await
}

#[tauri::command]
pub async fn bridge_changes(state: State<'_, AppState>, after_seq: u64) -> Result<Value, String> {
    request(&state, Method::GET, &format!("/api/mobile/changes?afterSeq={after_seq}"), None).await
}

#[tauri::command]
pub fn bridge_start_change_stream(app: AppHandle, state: State<'_, AppState>, after_seq: u64) -> Result<(), String> {
    let cookie = current_cookie(&state)?;
    let (device_id, token) = DEVICE_AUTH.get_or_init(|| Mutex::new(None))
        .lock().map_err(|_| "设备状态不可用".to_string())?
        .clone().ok_or_else(|| "请先绑定电脑".to_string())?;
    let mut active = CHANGE_STREAM.get_or_init(|| Mutex::new(None))
        .lock().map_err(|_| "变更连接状态不可用".to_string())?;
    if let Some(handle) = active.take() { handle.abort(); }
    *active = Some(tauri::async_runtime::spawn(async move {
        loop {
            let client = match reqwest::Client::builder().connect_timeout(Duration::from_secs(10)).build() {
                Ok(client) => client,
                Err(_) => break,
            };
            let response = client.get(bridge_url(&format!("/api/mobile/changes/stream?afterSeq={after_seq}")))
                .header(COOKIE, &cookie)
                .header("X-Harmony-Device-Id", &device_id)
                .header("X-Harmony-Device-Kind", "mobile")
                .header("X-Harmony-Device-Token", &token)
                .send().await;
            if let Ok(mut response) = response {
                if response.status().as_u16() == 401 || response.status().as_u16() == 403 { break; }
                if response.status().is_success() {
                    let mut buffer = Vec::<u8>::new();
                    while let Ok(Some(chunk)) = response.chunk().await {
                        buffer.extend_from_slice(&chunk);
                        while let Some(end) = buffer.windows(2).position(|window| window == b"\n\n") {
                            let frame: Vec<u8> = buffer.drain(..end + 2).collect();
                            if let Ok(text) = std::str::from_utf8(&frame) {
                                if let Some(data) = text.lines().find_map(|line| line.strip_prefix("data: ")) {
                                    if let Ok(value) = serde_json::from_str::<Value>(data) {
                                        if let Some(seq) = value["latestSeq"].as_u64() {
                                            let _ = app.emit("mobile_bridge_change_hint", seq);
                                        }
                                    }
                                }
                            }
                        }
                        if buffer.len() > 8_192 { buffer.clear(); }
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }));
    Ok(())
}

#[tauri::command]
pub fn bridge_stop_change_stream() {
    if let Ok(mut active) = CHANGE_STREAM.get_or_init(|| Mutex::new(None)).lock() {
        if let Some(handle) = active.take() { handle.abort(); }
    }
}

#[tauri::command]
pub async fn bridge_claim_turn(
    state: State<'_, AppState>, session_id: String, turn_id: String, initiating_message_id: String,
) -> Result<Value, String> {
    let id = pairing_id(&session_id)?;
    pairing_id(&turn_id)?;
    pairing_id(&initiating_message_id)?;
    request(&state, Method::POST, &format!("/api/mobile/sessions/{id}/turns"),
        Some(json!({"id":turn_id,"initiatingMessageId":initiating_message_id}))).await
}

#[tauri::command]
pub async fn bridge_start_turn(
    state: State<'_, AppState>, session_id: String, turn_id: String,
    message_id: String, content: String,
) -> Result<Value, String> {
    let id = pairing_id(&session_id)?;
    pairing_id(&turn_id)?;
    pairing_id(&message_id)?;
    if content.trim().is_empty() || content.chars().count() > 8_000 {
        return Err("会话消息格式无效".into());
    }
    request(&state, Method::POST, &format!("/api/mobile/sessions/{id}/turns/start"),
        Some(json!({"turnId":turn_id,"message":{"id":message_id,"content":content}}))).await
}

#[tauri::command]
pub async fn bridge_active_turn(state: State<'_, AppState>, session_id: String) -> Result<Value, String> {
    let id = pairing_id(&session_id)?;
    request(&state, Method::GET, &format!("/api/mobile/sessions/{id}/turns/active"), None).await
}

#[tauri::command]
pub async fn bridge_turn_heartbeat(state: State<'_, AppState>, session_id: String, turn_id: String) -> Result<Value, String> {
    let id = pairing_id(&session_id)?;
    let turn = pairing_id(&turn_id)?;
    request(&state, Method::POST, &format!("/api/mobile/sessions/{id}/turns/{turn}/heartbeat"), Some(json!({}))).await
}

#[tauri::command]
pub async fn bridge_complete_turn(state: State<'_, AppState>, session_id: String, turn_id: String, status: String) -> Result<Value, String> {
    let id = pairing_id(&session_id)?;
    let turn = pairing_id(&turn_id)?;
    if !matches!(status.as_str(), "completed" | "failed") { return Err("轮次状态无效".into()); }
    request(&state, Method::POST, &format!("/api/mobile/sessions/{id}/turns/{turn}/complete"), Some(json!({"status":status}))).await
}

#[tauri::command]
pub async fn bridge_tasks(state: State<'_, AppState>, mobile_device_id: String) -> Result<Value, String> {
    let id = pairing_id(&mobile_device_id)?;
    request(&state, Method::GET, &format!("/api/mobile/tasks?mobileDeviceId={id}"), None).await
}

#[tauri::command]
pub async fn bridge_signals(state: State<'_, AppState>, device_id: String, after: u64) -> Result<Value, String> {
    let id = pairing_id(&device_id)?;
    request(&state, Method::GET, &format!("/api/mobile/signals?deviceId={id}&after={after}"), None).await
}

#[tauri::command]
pub async fn bridge_send_signal(
    state: State<'_, AppState>, desktop_device_id: String, mobile_device_id: String,
    sender_device_id: String, recipient_device_id: String, kind: String, payload: Value,
) -> Result<Value, String> {
    for value in [&desktop_device_id, &mobile_device_id, &sender_device_id, &recipient_device_id] { pairing_id(value)?; }
    if !matches!(kind.as_str(), "offer" | "answer" | "candidate") || !payload.is_object() {
        return Err("信令格式无效".into());
    }
    request(&state, Method::POST, "/api/mobile/signals", Some(json!({
        "desktopDeviceId": desktop_device_id, "mobileDeviceId": mobile_device_id,
        "senderDeviceId": sender_device_id, "recipientDeviceId": recipient_device_id,
        "kind": kind, "payload": payload,
    }))).await
}

#[tauri::command]
pub async fn bridge_create_task(
    state: State<'_, AppState>,
    session_id: String,
    desktop_device_id: String,
    mobile_device_id: String,
    idempotency_key: String,
    prompt: String,
    turn_id: Option<String>,
    tool_call_id: Option<String>,
) -> Result<Value, String> {
    pairing_id(&session_id)?;
    pairing_id(&desktop_device_id)?;
    pairing_id(&mobile_device_id)?;
    if prompt.trim().is_empty() || prompt.chars().count() > 8_000 {
        return Err("远端任务内容须为 1–8000 字".into());
    }
    if turn_id.is_some() != tool_call_id.is_some() { return Err("电脑任务轮次信息不完整".into()); }
    if let Some(ref turn) = turn_id { pairing_id(turn)?; }
    if let Some(ref call) = tool_call_id { if call.is_empty() || call.len() > 128 { return Err("工具调用编号无效".into()); } }
    let mut body = json!({
        "sessionId":session_id,
        "desktopDeviceId":desktop_device_id,
        "mobileDeviceId":mobile_device_id,
        "idempotencyKey":idempotency_key,
        "prompt":prompt
    });
    if let (Some(turn), Some(call)) = (turn_id, tool_call_id) {
        body["turnId"] = json!(turn);
        body["toolCallId"] = json!(call);
    }
    request(
        &state,
        Method::POST,
        "/api/mobile/tasks",
        Some(body),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{bridge_url, pairing_id};

    #[test]
    fn bridge_requests_use_direct_public_host_and_validated_ids() {
        assert_eq!(bridge_url("/api/mobile/devices"), "https://remote.harmonywatch.cn/api/mobile/devices");
        assert!(pairing_id("3ecc3126-67a5-4e33-bfad-f1fe2308ef9e").is_ok());
        assert!(pairing_id("../api/auth/me").is_err());
    }
}
