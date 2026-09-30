use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use reqwest::header::{COOKIE, SET_COOKIE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{sync::Mutex, time::Duration};
use tauri::State;
use zeroize::Zeroize;

const ACCOUNT_API: &str = "https://portal.harmonywatch.cn";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    pub id: String,
    pub name: String,
    pub email: String,
    pub model: String,
}

pub(crate) struct MobileSession {
    pub account: AccountView,
    pub cookie: String,
    pub api_key: String,
}

impl Drop for MobileSession {
    fn drop(&mut self) {
        self.cookie.zeroize();
        self.api_key.zeroize();
    }
}

#[derive(Default)]
pub(crate) struct AppState {
    pub session: Mutex<Option<MobileSession>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KdfParams {
    algorithm: String,
    salt: String,
    memory_ki_b: u32,
    iterations: u32,
    parallelism: u32,
}

#[derive(Deserialize)]
struct CipherBlob {
    nonce: String,
    ciphertext: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsEnvelope {
    version: u32,
    kdf: KdfParams,
    wrapped_data_key: CipherBlob,
    payload: CipherBlob,
}

struct ModelConfig {
    model: String,
    api_key: String,
}

fn decrypt(key: &[u8; 32], blob: &CipherBlob) -> Result<Vec<u8>, String> {
    let nonce = BASE64
        .decode(&blob.nonce)
        .map_err(|_| "云端加密随机数格式无效")?;
    let nonce: [u8; 24] = nonce.try_into().map_err(|_| "云端加密随机数长度无效")?;
    let ciphertext = BASE64
        .decode(&blob.ciphertext)
        .map_err(|_| "云端密文格式无效")?;
    XChaCha20Poly1305::new(key.into())
        .decrypt(XNonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| "无法解锁云端个人设置，请确认密码与桌面端备份一致".to_string())
}

fn decrypt_cloud_settings(snapshot: &Value, password: &str) -> Result<ModelConfig, String> {
    let envelope: SettingsEnvelope = serde_json::from_value(
        snapshot
            .get("envelope")
            .cloned()
            .ok_or("云端设置快照缺少加密封套")?,
    )
    .map_err(|_| "云端设置快照格式无效")?;
    if envelope.version != 2 || envelope.kdf.algorithm != "argon2id" {
        return Err("云端个人设置使用了当前手机端不支持的加密版本".into());
    }
    let kdf = &envelope.kdf;
    if !(8_192..=131_072).contains(&kdf.memory_ki_b)
        || !(1..=10).contains(&kdf.iterations)
        || !(1..=4).contains(&kdf.parallelism)
    {
        return Err("云端密钥派生参数无效".into());
    }
    let salt = BASE64.decode(&kdf.salt).map_err(|_| "云端加密盐格式无效")?;
    if !(16..=64).contains(&salt.len()) {
        return Err("云端加密盐长度无效".into());
    }
    let params = Params::new(kdf.memory_ki_b, kdf.iterations, kdf.parallelism, Some(32))
        .map_err(|_| "云端密钥派生参数无效")?;
    let mut password_key = [0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), &salt, &mut password_key)
        .map_err(|_| "无法使用登录密码解锁云端设置")?;
    let data_key = decrypt(&password_key, &envelope.wrapped_data_key);
    password_key.zeroize();
    let mut data_key: [u8; 32] = data_key?.try_into().map_err(|_| "云端数据密钥长度无效")?;
    let payload = decrypt(&data_key, &envelope.payload);
    data_key.zeroize();
    let mut plaintext = payload?;
    let value: Value = serde_json::from_slice(&plaintext).map_err(|_| "云端设置内容无效")?;
    plaintext.zeroize();
    let settings = match value.get("version").and_then(Value::as_u64) {
        Some(1) => value.get("settings"),
        Some(2) => value.get("categories").and_then(|v| v.get("aiProvider")),
        _ => return Err("云端设置内容版本不受支持".into()),
    }
    .ok_or("云端设置缺少模型配置")?;
    if settings.get("provider").and_then(Value::as_str) != Some("harmony") {
        return Err("当前云端默认模型并非 Harmony 网关，请先在桌面端设置并同步".into());
    }
    let model = settings
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let api_key = settings
        .get("harmony_api_key")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if model.is_empty() || api_key.is_empty() {
        return Err("云端 Harmony 模型或 API Key 未配置，请先在桌面端完成加密同步".into());
    }
    Ok(ModelConfig {
        model: model.to_string(),
        api_key: api_key.to_string(),
    })
}

fn session_cookie(headers: &reqwest::header::HeaderMap) -> Result<String, String> {
    headers
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(|value| value.split(';').next())
        .find(|value| value.starts_with("portal_token="))
        .map(str::to_string)
        .ok_or_else(|| "账户登录成功但未取得会话凭证".to_string())
}

#[tauri::command]
pub async fn mobile_login(
    state: State<'_, AppState>,
    email: String,
    mut password: String,
) -> Result<AccountView, String> {
    *state.session.lock().map_err(|_| "账户状态不可用")? = None;
    let result = login_inner(&email, &password).await;
    password.zeroize();
    let session = result?;
    let account = session.account.clone();
    *state.session.lock().map_err(|_| "账户状态不可用")? = Some(session);
    Ok(account)
}

async fn login_inner(email: &str, password: &str) -> Result<MobileSession, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "无法初始化网络连接")?;
    let response = client
        .post(format!("{ACCOUNT_API}/api/auth/login"))
        .json(&json!({"email": email.trim(), "password": password}))
        .send()
        .await
        .map_err(|_| "无法连接账户服务，请检查网络")?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 => "邮箱或密码不正确".into(),
            403 => "账户尚未激活或已停用".into(),
            _ => format!("账户服务暂不可用（HTTP {}）", response.status()),
        });
    }
    let cookie = session_cookie(response.headers())?;
    let body: Value = response
        .json()
        .await
        .map_err(|_| "账户服务返回的数据无效")?;
    let user = body.get("user").ok_or("账户资料缺失")?;
    let id = user
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or("账户 ID 缺失")?;
    let name = user
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Harmony Work 用户");
    let account_email = user.get("email").and_then(Value::as_str).unwrap_or(email);
    let response = client
        .get(format!("{ACCOUNT_API}/api/workbuddy/settings/snapshot"))
        .header(COOKIE, &cookie)
        .send()
        .await
        .map_err(|_| "无法获取加密个人设置，请检查网络")?;
    if !response.status().is_success() {
        return Err(format!(
            "加密个人设置暂不可用（HTTP {}）",
            response.status()
        ));
    }
    let snapshot: Value = response.json().await.map_err(|_| "加密个人设置响应无效")?;
    let snapshot = snapshot
        .get("snapshot")
        .filter(|v| !v.is_null())
        .ok_or("该账户尚无加密设置备份，请先在桌面端同步")?;
    let config = decrypt_cloud_settings(snapshot, password)?;
    Ok(MobileSession {
        account: AccountView {
            id: id.to_string(),
            name: name.to_string(),
            email: account_email.to_string(),
            model: config.model,
        },
        cookie,
        api_key: config.api_key,
    })
}

#[tauri::command]
pub fn mobile_account(state: State<'_, AppState>) -> Result<Option<AccountView>, String> {
    Ok(state
        .session
        .lock()
        .map_err(|_| "账户状态不可用")?
        .as_ref()
        .map(|session| session.account.clone()))
}

#[tauri::command]
pub fn mobile_logout(state: State<'_, AppState>) -> Result<(), String> {
    *state.session.lock().map_err(|_| "账户状态不可用")? = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{decrypt_cloud_settings, ACCOUNT_API};
    use argon2::{Algorithm, Argon2, Params, Version};
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
    use chacha20poly1305::{
        aead::{Aead, KeyInit},
        XChaCha20Poly1305, XNonce,
    };
    use serde_json::{json, Value};

    #[test]
    fn account_requests_use_portal_service_origin() {
        assert_eq!(ACCOUNT_API, "https://portal.harmonywatch.cn");
        assert_eq!(
            format!("{ACCOUNT_API}/api/auth/login"),
            "https://portal.harmonywatch.cn/api/auth/login"
        );
        assert_eq!(
            format!("{ACCOUNT_API}/api/workbuddy/settings/snapshot"),
            "https://portal.harmonywatch.cn/api/workbuddy/settings/snapshot"
        );
    }

    fn fixture(password: &str, payload: Value) -> Value {
        let salt = [3u8; 32];
        let mut password_key = [0u8; 32];
        Argon2::new(
            Algorithm::Argon2id,
            Version::V0x13,
            Params::new(65_536, 3, 1, Some(32)).unwrap(),
        )
        .hash_password_into(password.as_bytes(), &salt, &mut password_key)
        .unwrap();
        let data_key = [7u8; 32];
        let wrap_nonce = [4u8; 24];
        let payload_nonce = [5u8; 24];
        let wrapped = XChaCha20Poly1305::new((&password_key).into())
            .encrypt(XNonce::from_slice(&wrap_nonce), data_key.as_ref())
            .unwrap();
        let encrypted = XChaCha20Poly1305::new((&data_key).into())
            .encrypt(
                XNonce::from_slice(&payload_nonce),
                serde_json::to_vec(&payload).unwrap().as_ref(),
            )
            .unwrap();
        json!({"revision":1,"schemaVersion":2,"envelope":{
            "version":2,
            "kdf":{"algorithm":"argon2id","salt":BASE64.encode(salt),"memoryKiB":65536,"iterations":3,"parallelism":1},
            "wrappedDataKey":{"nonce":BASE64.encode(wrap_nonce),"ciphertext":BASE64.encode(wrapped)},
            "payload":{"nonce":BASE64.encode(payload_nonce),"ciphertext":BASE64.encode(encrypted)}
        }})
    }

    #[test]
    fn decrypts_desktop_v2_harmony_provider_without_exposing_other_settings() {
        let snapshot = fixture(
            "correct-password",
            json!({"version":2,"categories":{
                "aiProvider":{"provider":"harmony","model":"gpt-5","harmony_api_key":"secret-key"},
                "agent":{"xiaoheng_personal_prompt":"private"}
            }}),
        );
        let model = decrypt_cloud_settings(&snapshot, "correct-password").unwrap();
        assert_eq!(model.model, "gpt-5");
        assert_eq!(model.api_key, "secret-key");
    }

    #[test]
    fn accepts_desktop_v1_payload_and_rejects_wrong_password() {
        let snapshot = fixture(
            "correct-password",
            json!({"version":1,"settings":{
                "provider":"harmony","model":"gpt-5","harmony_api_key":"secret-key"
            }}),
        );
        assert!(decrypt_cloud_settings(&snapshot, "correct-password").is_ok());
        assert!(decrypt_cloud_settings(&snapshot, "wrong-password").is_err());
    }
}
