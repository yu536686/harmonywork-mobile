use crate::account::AppState;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;
use zeroize::Zeroize;

const RESPONSES_URL: &str = "https://api.harmonywatch.cn/v1/responses";
const MOBILE_INSTRUCTIONS: &str = "你是 Harmony Work 手机端的小亨。用中文清楚、简洁地帮助用户完成轻量对话、信息整理和规划。你当前不能访问用户电脑、本地文件或桌面软件；需要这些能力时，明确说明尚需交给已绑定电脑执行，不要假装已经执行。";

#[derive(Deserialize)]
pub struct ChatMessage {
    role: String,
    content: String,
}

fn validate_messages(messages: &[ChatMessage]) -> Result<(), String> {
    if messages.is_empty() || messages.len() > 24 {
        return Err("单次对话须包含 1–24 条消息".into());
    }
    if messages.last().is_none_or(|message| message.role != "user") {
        return Err("最后一条消息必须是用户输入".into());
    }
    let mut total = 0usize;
    for message in messages {
        if message.role != "user" && message.role != "assistant" {
            return Err("消息角色无效".into());
        }
        let length = message.content.chars().count();
        if length == 0 || length > 8_000 {
            return Err("单条消息长度须为 1–8000 字".into());
        }
        total += length;
    }
    if total > 48_000 {
        return Err("本次对话上下文过长，请开始新会话".into());
    }
    Ok(())
}

fn visible_text(value: &Value) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(output) = value.get("output").and_then(Value::as_array) {
        for item in output {
            if item.get("type").and_then(Value::as_str) != Some("message")
                || item.get("role").and_then(Value::as_str) != Some("assistant")
            {
                continue;
            }
            if let Some(content) = item.get("content").and_then(Value::as_array) {
                for part in content {
                    if part.get("type").and_then(Value::as_str) == Some("output_text") {
                        if let Some(text) = part.get("text").and_then(Value::as_str) {
                            if !text.trim().is_empty() {
                                parts.push(text.trim());
                            }
                        }
                    }
                }
            }
        }
    }
    if !parts.is_empty() {
        return Some(parts.join("\n"));
    }
    value
        .get("output_text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

#[tauri::command]
pub async fn mobile_chat(
    state: State<'_, AppState>,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    validate_messages(&messages)?;
    let (model, mut api_key) = {
        let guard = state.session.lock().map_err(|_| "账户状态不可用")?;
        let session = guard.as_ref().ok_or("请先登录个人账户")?;
        (session.account.model.clone(), session.api_key.clone())
    };
    let input: Vec<Value> = messages
        .into_iter()
        .map(|message| json!({"role":message.role,"content":message.content}))
        .collect();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|_| "无法初始化模型连接")?;
    let result = client
        .post(RESPONSES_URL)
        .bearer_auth(&api_key)
        .json(&json!({
            "model": model,
            "instructions": MOBILE_INSTRUCTIONS,
            "input": input,
            "store": false,
            "max_output_tokens": 1200
        }))
        .send()
        .await;
    api_key.zeroize();
    let response = result.map_err(|_| "模型网关连接失败或超时，请检查网络后重试")?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "Harmony API Key 已失效，请在桌面端更新并重新同步".into(),
            429 => "模型请求较多，请稍后重试".into(),
            _ => format!("模型网关暂不可用（HTTP {}）", response.status()),
        });
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| "模型网关返回的数据无效")?;
    visible_text(&value).ok_or_else(|| "模型没有返回可显示的文字，请重试".to_string())
}

#[cfg(test)]
mod tests {
    use super::{validate_messages, visible_text, ChatMessage};
    use serde_json::json;

    #[test]
    fn shows_only_assistant_output_text() {
        let response = json!({"output":[
            {"type":"reasoning","content":[{"type":"reasoning_text","text":"hidden"}]},
            {"type":"message","role":"assistant","content":[{"type":"output_text","text":"你好，我是小亨"}]}
        ]});
        assert_eq!(visible_text(&response).as_deref(), Some("你好，我是小亨"));
    }

    #[test]
    fn never_uses_reasoning_as_answer() {
        let response = json!({"output":[{"type":"reasoning","content":[{"type":"reasoning_text","text":"hidden"}]}]});
        assert!(visible_text(&response).is_none());
    }

    #[test]
    fn rejects_unbounded_or_non_user_final_input() {
        let invalid = vec![ChatMessage {
            role: "assistant".into(),
            content: "hello".into(),
        }];
        assert!(validate_messages(&invalid).is_err());
        let long = vec![ChatMessage {
            role: "user".into(),
            content: "x".repeat(8_001),
        }];
        assert!(validate_messages(&long).is_err());
    }
}
