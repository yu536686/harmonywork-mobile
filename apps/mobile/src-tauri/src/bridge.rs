use crate::account::AppState;
use reqwest::{header::COOKIE, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;
use uuid::Uuid;

const BRIDGE_ORIGIN: &str = "https://remote.harmonywatch.cn";

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
pub async fn bridge_tasks(state: State<'_, AppState>) -> Result<Value, String> {
    request(&state, Method::GET, "/api/mobile/tasks", None).await
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
) -> Result<Value, String> {
    pairing_id(&session_id)?;
    pairing_id(&desktop_device_id)?;
    pairing_id(&mobile_device_id)?;
    if prompt.trim().is_empty() || prompt.chars().count() > 8_000 {
        return Err("远端任务内容须为 1–8000 字".into());
    }
    request(
        &state,
        Method::POST,
        "/api/mobile/tasks",
        Some(json!({
            "sessionId":session_id,
            "desktopDeviceId":desktop_device_id,
            "mobileDeviceId":mobile_device_id,
            "idempotencyKey":idempotency_key,
            "prompt":prompt
        })),
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
