use crate::account::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;
use zeroize::Zeroize;

const RESPONSES_URL: &str = "https://api.harmonywatch.cn/v1/responses";
const MOBILE_INSTRUCTIONS: &str = "你是 Harmony Work 手机端的小亨。用中文清楚、简洁地帮助用户完成对话。若提供 execute_on_desktop 工具且用户需求需要访问电脑文件、软件或较复杂的本地执行，可调用一次，goal 要具体、可执行。不要声称尚未完成的工作已经完成。电脑结果返回后由你在当前会话给出最终答复。";
const DESKTOP_TOOL: &str = "execute_on_desktop";

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChatDecision {
    Text { text: String },
    Desktop { call_id: String, goal: String, response_items: Vec<Value> },
}

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

fn parse_chat_decision(value: &Value, desktop_available: bool) -> Result<ChatDecision, String> {
    let output = value.get("output").and_then(Value::as_array);
    let calls: Vec<&Value> = output.into_iter().flatten()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("function_call"))
        .collect();
    if calls.len() > 1 { return Err("模型一次只能请求一项电脑工作".into()); }
    if let Some(call) = calls.first() {
        if !desktop_available { return Err("电脑尚未绑定，无法执行此操作".into()); }
        if call.get("name").and_then(Value::as_str) != Some(DESKTOP_TOOL) {
            return Err("模型请求了不支持的工具".into());
        }
        let call_id = call.get("call_id").and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 128)
            .ok_or("模型工具调用编号无效")?;
        let arguments: Value = serde_json::from_str(call.get("arguments").and_then(Value::as_str).ok_or("模型工具参数无效")?)
            .map_err(|_| "模型工具参数无效")?;
        let goal = arguments.get("goal").and_then(Value::as_str)
            .map(str::trim).filter(|goal| !goal.is_empty() && goal.chars().count() <= 8_000)
            .ok_or("电脑任务目标须为 1–8000 字")?;
        return Ok(ChatDecision::Desktop {
            call_id: call_id.into(), goal: goal.into(),
            response_items: output.cloned().unwrap_or_default(),
        });
    }
    visible_text(value).map(|text| ChatDecision::Text { text })
        .ok_or_else(|| "模型没有返回可显示的文字，请重试".into())
}

fn model_credentials(state: &State<'_, AppState>) -> Result<(String, String), String> {
    let guard = state.session.lock().map_err(|_| "账户状态不可用")?;
    let session = guard.as_ref().ok_or("请先登录个人账户")?;
    Ok((session.account.model.clone(), session.api_key.clone()))
}

async fn send_response(mut api_key: String, body: Value) -> Result<Value, String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(90)).build()
        .map_err(|_| "无法初始化模型连接")?;
    let result = client.post(RESPONSES_URL).bearer_auth(&api_key).json(&body).send().await;
    api_key.zeroize();
    let response = result.map_err(|_| "模型网关连接失败或超时，请检查网络后重试")?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "Harmony API Key 已失效，请在桌面端更新并重新同步".into(),
            429 => "模型请求较多，请稍后重试".into(),
            _ => format!("模型网关暂不可用（HTTP {}）", response.status()),
        });
    }
    response.json().await.map_err(|_| "模型网关返回的数据无效".into())
}

fn message_input(messages: Vec<ChatMessage>) -> Vec<Value> {
    messages.into_iter().map(|message| json!({"role":message.role,"content":message.content})).collect()
}

#[tauri::command]
pub async fn mobile_chat(
    state: State<'_, AppState>,
    messages: Vec<ChatMessage>,
    desktop_available: bool,
) -> Result<ChatDecision, String> {
    validate_messages(&messages)?;
    let (model, api_key) = model_credentials(&state)?;
    let mut body = json!({"model": model, "instructions": MOBILE_INSTRUCTIONS,
        "input": message_input(messages), "store": false, "max_output_tokens": 1200,
        "include": ["reasoning.encrypted_content"]});
    if desktop_available {
        body["tools"] = json!([{"type":"function","name":DESKTOP_TOOL,
            "description":"在已绑定的 Windows 电脑上完成需要本地文件、软件或复杂执行的工作，并返回执行结果。",
            "parameters":{"type":"object","properties":{"goal":{"type":"string","description":"明确的电脑执行目标"}},"required":["goal"],"additionalProperties":false},"strict":true}]);
    }
    let value = send_response(api_key, body).await?;
    parse_chat_decision(&value, desktop_available)
}

#[tauri::command]
pub async fn mobile_chat_continue(
    state: State<'_, AppState>, messages: Vec<ChatMessage>,
    call_id: String, response_items: Vec<Value>, desktop_result: String,
) -> Result<String, String> {
    validate_messages(&messages)?;
    if call_id.is_empty() || call_id.len() > 128 || desktop_result.chars().count() > 10_000
        || response_items.len() > 20 || serde_json::to_string(&response_items).map_or(true, |s| s.len() > 100_000)
        || response_items.iter().filter(|item| item.get("type").and_then(Value::as_str) == Some("function_call")
            && item.get("call_id").and_then(Value::as_str) == Some(call_id.as_str())
            && item.get("name").and_then(Value::as_str) == Some(DESKTOP_TOOL)).count() != 1 {
        return Err("电脑任务恢复信息无效".into());
    }
    let (model, api_key) = model_credentials(&state)?;
    let mut input = message_input(messages);
    input.extend(response_items);
    input.push(json!({"type":"function_call_output","call_id":call_id,"output":desktop_result}));
    let value = send_response(api_key, json!({"model":model,"instructions":MOBILE_INSTRUCTIONS,
        "input":input,"store":false,"max_output_tokens":1200})).await?;
    match parse_chat_decision(&value, false)? {
        ChatDecision::Text { text } => Ok(text),
        ChatDecision::Desktop { .. } => Err("电脑任务已执行，本轮不能再次调用电脑".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_chat_decision, validate_messages, visible_text, ChatDecision, ChatMessage};
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

    #[test]
    fn parses_desktop_tool_call_without_showing_reasoning() {
        let response = json!({"output":[
            {"type":"reasoning","encrypted_content":"opaque"},
            {"type":"function_call","name":"execute_on_desktop","call_id":"call_123","arguments":"{\"goal\":\"检查 Windows 项目并汇总结果\"}"}
        ]});
        match parse_chat_decision(&response, true).unwrap() {
            ChatDecision::Desktop { call_id, goal, response_items } => {
                assert_eq!(call_id, "call_123");
                assert_eq!(goal, "检查 Windows 项目并汇总结果");
                assert_eq!(response_items.len(), 2);
            }
            _ => panic!("expected desktop tool call"),
        }
    }

    #[test]
    fn rejects_unknown_or_oversized_desktop_tool_calls() {
        for response in [
            json!({"output":[{"type":"function_call","name":"unknown","call_id":"call_1","arguments":"{}"}]}),
            json!({"output":[{"type":"function_call","name":"execute_on_desktop","call_id":"call_1","arguments":json!({"goal":"x".repeat(8001)}).to_string()}]}),
        ] {
            assert!(parse_chat_decision(&response, true).is_err());
        }
        let valid = json!({"output":[{"type":"function_call","name":"execute_on_desktop","call_id":"call_1","arguments":"{\"goal\":\"work\"}"}]});
        assert!(parse_chat_decision(&valid, false).is_err());
    }

    #[test]
    fn text_reply_remains_visible_decision() {
        let response = json!({"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"已完成"}]}]});
        assert!(matches!(parse_chat_decision(&response, true), Ok(ChatDecision::Text { text }) if text == "已完成"));
    }
}
