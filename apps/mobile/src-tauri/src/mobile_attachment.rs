//! The phone writes direct WebRTC blocks to a bounded cache file and verifies the final digest.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

const MAX_BYTES: u64 = 200 * 1024 * 1024;
const CHUNK_BYTES: usize = 16 * 1024;

struct Incoming {
    file: File,
    temporary: PathBuf,
    destination: PathBuf,
    expected_size: u64,
    expected_sha: String,
    received: u64,
    digest: Sha256,
    name: String,
    mime: String,
}

#[derive(Clone)]
struct Cached {
    path: PathBuf,
    name: String,
    mime: String,
}

static INCOMING: OnceLock<Mutex<HashMap<String, Incoming>>> = OnceLock::new();
static CACHED: OnceLock<Mutex<HashMap<String, Cached>>> = OnceLock::new();
fn incoming() -> &'static Mutex<HashMap<String, Incoming>> { INCOMING.get_or_init(|| Mutex::new(HashMap::new())) }
fn cached() -> &'static Mutex<HashMap<String, Cached>> { CACHED.get_or_init(|| Mutex::new(HashMap::new())) }

fn validate_id(id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id).map_err(|_| "附件编号无效".to_string()).map(|_| ())
}

fn start(cache_root: &Path, id: &str, name: &str, mime: &str, size: u64, sha: &str) -> Result<Incoming, String> {
    validate_id(id)?;
    if size > MAX_BYTES || sha.len() != 64 || !sha.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("附件信息无效".into());
    }
    if name.trim().is_empty() || name.chars().count() > 120 ||
        name.chars().any(|ch| ch == '/' || ch == '\\' || ch == ':' || ch.is_control()) ||
        mime.len() > 120 || !mime.is_ascii() || mime.chars().any(|ch| ch.is_control()) {
        return Err("附件名称或类型无效".into());
    }
    let extension = Path::new(name).extension().and_then(|value| value.to_str())
        .filter(|value| value.len() <= 10 && value.chars().all(|ch| ch.is_ascii_alphanumeric()))
        .unwrap_or("bin");
    let directory = cache_root.join("mobile_attachments");
    std::fs::create_dir_all(&directory).map_err(|_| "无法创建附件缓存".to_string())?;
    let temporary = directory.join(format!("{id}.part"));
    let destination = directory.join(format!("{id}.{extension}"));
    let mut file = OpenOptions::new().create(true).read(true).write(true).open(&temporary)
        .map_err(|_| "无法写入附件缓存".to_string())?;
    let mut received = file.metadata().map_err(|_| "无法读取附件缓存".to_string())?.len();
    if received > size {
        file.set_len(0).map_err(|_| "无法重建附件缓存".to_string())?;
        received = 0;
    }
    let mut digest = Sha256::new();
    file.seek(SeekFrom::Start(0)).map_err(|_| "无法读取附件缓存".to_string())?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|_| "无法读取附件缓存".to_string())?;
        if count == 0 { break; }
        digest.update(&buffer[..count]);
    }
    file.seek(SeekFrom::End(0)).map_err(|_| "无法恢复附件缓存".to_string())?;
    Ok(Incoming { file, temporary, destination, expected_size: size,
        expected_sha: sha.to_ascii_lowercase(), received,
        digest, name: name.into(), mime: mime.into() })
}

fn append(current: &mut Incoming, offset: u64, encoded: &str) -> Result<u64, String> {
    if offset != current.received || encoded.len() > (CHUNK_BYTES + 2) / 3 * 4 {
        return Err("附件分块重复或顺序错误".into());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| "附件分块编码无效".to_string())?;
    if bytes.is_empty() || bytes.len() > CHUNK_BYTES ||
        current.received + bytes.len() as u64 > current.expected_size {
        return Err("附件分块超过大小限制".into());
    }
    current.file.write_all(&bytes).map_err(|_| "无法写入附件缓存".to_string())?;
    current.digest.update(&bytes);
    current.received += bytes.len() as u64;
    Ok(current.received)
}

fn finish(mut current: Incoming) -> Result<Cached, String> {
    let valid = current.received == current.expected_size &&
        hex::encode(current.digest.finalize()) == current.expected_sha;
    if !valid {
        drop(current.file);
        let _ = std::fs::remove_file(&current.temporary);
        return Err("附件大小或 SHA-256 校验失败".into());
    }
    current.file.flush().map_err(|_| "无法完成附件缓存".to_string())?;
    current.file.sync_all().map_err(|_| "无法完成附件缓存".to_string())?;
    drop(current.file);
    std::fs::rename(&current.temporary, &current.destination)
        .map_err(|_| "无法完成附件缓存".to_string())?;
    Ok(Cached { path: current.destination, name: current.name, mime: current.mime })
}

#[tauri::command]
pub fn mobile_attachment_receive_start(
    app: AppHandle, attachment_id: String, name: String, mime_type: String, size: u64, sha256: String,
) -> Result<u64, String> {
    let cache = app.path().app_cache_dir().map_err(|_| "附件缓存不可用".to_string())?;
    let mut active = incoming().lock().map_err(|_| "附件接收状态不可用".to_string())?;
    if let Some(current) = active.get(&attachment_id) {
        if current.name == name && current.mime == mime_type && current.expected_size == size &&
            current.expected_sha == sha256.to_ascii_lowercase() { return Ok(current.received); }
    }
    if let Some(previous) = active.remove(&attachment_id) {
        drop(previous.file);
        let _ = std::fs::remove_file(previous.temporary);
    }
    for (_, previous) in active.drain() {
        drop(previous.file);
        let _ = std::fs::remove_file(previous.temporary);
    }
    let cache_directory = cache.join("mobile_attachments");
    let current_part = format!("{attachment_id}.part");
    if let Ok(entries) = std::fs::read_dir(&cache_directory) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) == Some("part") &&
                path.file_name().and_then(|value| value.to_str()) != Some(current_part.as_str()) {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    let current = start(&cache, &attachment_id, &name, &mime_type, size, &sha256)?;
    let offset = current.received;
    active.insert(attachment_id, current);
    Ok(offset)
}

#[tauri::command]
pub fn mobile_attachment_receive_chunk(attachment_id: String, offset: u64, bytes: String) -> Result<u64, String> {
    validate_id(&attachment_id)?;
    let mut active = incoming().lock().map_err(|_| "附件接收状态不可用".to_string())?;
    let current = active.get_mut(&attachment_id).ok_or("附件接收尚未开始")?;
    append(current, offset, &bytes)
}

#[tauri::command]
pub fn mobile_attachment_receive_finish(attachment_id: String) -> Result<(), String> {
    validate_id(&attachment_id)?;
    let current = incoming().lock().map_err(|_| "附件接收状态不可用".to_string())?
        .remove(&attachment_id).ok_or("附件接收尚未开始")?;
    let file = finish(current)?;
    cached().lock().map_err(|_| "附件缓存状态不可用".to_string())?.insert(attachment_id, file);
    Ok(())
}

#[tauri::command]
pub fn mobile_attachment_receive_abort(attachment_id: String) -> Result<(), String> {
    validate_id(&attachment_id)?;
    if let Some(current) = incoming().lock().map_err(|_| "附件接收状态不可用".to_string())?.remove(&attachment_id) {
        drop(current.file);
        let _ = std::fs::remove_file(current.temporary);
    }
    Ok(())
}

fn cached_file(attachment_id: &str) -> Result<Cached, String> {
    validate_id(attachment_id)?;
    let file = cached().lock().map_err(|_| "附件缓存状态不可用".to_string())?
        .get(attachment_id).cloned().ok_or("请先下载附件")?;
    if !file.path.is_file() { return Err("附件缓存已失效，请重新下载".into()); }
    Ok(file)
}

#[tauri::command]
pub fn mobile_attachment_preview(attachment_id: String) -> Result<(), String> {
    let file = cached_file(&attachment_id)?;
    platform::preview(&file.path, &file.mime)
}

#[tauri::command]
pub fn mobile_attachment_save(attachment_id: String) -> Result<(), String> {
    let file = cached_file(&attachment_id)?;
    platform::save(&file.path, &file.name, &file.mime)
}

#[tauri::command]
pub fn mobile_attachment_clear(app: AppHandle) -> Result<(), String> {
    incoming().lock().map_err(|_| "附件接收状态不可用".to_string())?.clear();
    cached().lock().map_err(|_| "附件缓存状态不可用".to_string())?.clear();
    let directory = app.path().app_cache_dir().map_err(|_| "附件缓存不可用".to_string())?
        .join("mobile_attachments");
    if directory.exists() {
        std::fs::remove_dir_all(directory).map_err(|_| "无法清除附件缓存".to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "android")]
mod platform {
    use jni::objects::{JClass, JObject, JValue};
    use std::path::Path;

    fn call(method: &str, path: &Path, name: &str, mime: &str) -> Result<(), String> {
        let context = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) }
            .map_err(|_| "无法打开 Android 附件服务")?;
        let mut env = vm.attach_current_thread().map_err(|_| "无法连接 Android 附件服务")?;
        let app_context = unsafe { JObject::from_raw(context.context().cast()) };
        let result = (|| {
            let loader = env.call_method(&app_context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?.l()?;
            let class_name = env.new_string("com.harmonywork.mobile.AttachmentActions")?;
            let class = env.call_method(loader, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;",
                &[JValue::Object(&class_name)])?.l()?;
            let path = env.new_string(path.to_string_lossy().as_ref())?;
            let name = env.new_string(name)?;
            let mime = env.new_string(mime)?;
            env.call_static_method(JClass::from(class), method,
                "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V",
                &[JValue::Object(&path), JValue::Object(&name), JValue::Object(&mime)])?;
            Ok::<_, jni::errors::Error>(())
        })();
        result.map_err(|_| "Android 附件操作失败".to_string())
    }

    pub fn preview(path: &Path, mime: &str) -> Result<(), String> { call("preview", path, "", mime) }
    pub fn save(path: &Path, name: &str, mime: &str) -> Result<(), String> { call("save", path, name, mime) }
}

#[cfg(not(target_os = "android"))]
mod platform {
    use std::path::Path;
    pub fn preview(_: &Path, _: &str) -> Result<(), String> { Err("仅 Android 支持附件预览".into()) }
    pub fn save(_: &Path, _: &str, _: &str) -> Result<(), String> { Err("仅 Android 支持附件保存".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn receive_rejects_duplicate_blocks_and_wrong_digest() {
        let root = std::env::temp_dir().join(format!("receive-{}", uuid::Uuid::new_v4()));
        let id = uuid::Uuid::new_v4().to_string();
        let mut transfer = start(&root, &id, "report.txt", "text/plain", 4, &"0".repeat(64)).unwrap();
        assert_eq!(append(&mut transfer, 0, "dGVzdA==").unwrap(), 4);
        assert!(append(&mut transfer, 0, "dGVzdA==").is_err());
        assert!(finish(transfer).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn receive_finishes_only_after_matching_size_and_sha256() {
        let root = std::env::temp_dir().join(format!("receive-{}", uuid::Uuid::new_v4()));
        let id = uuid::Uuid::new_v4().to_string();
        let sha = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
        let mut transfer = start(&root, &id, "report.txt", "text/plain", 4, sha).unwrap();
        assert!(append(&mut transfer, 1, "dGVzdA==").is_err());
        assert_eq!(append(&mut transfer, 0, "dGVzdA==").unwrap(), 4);
        let cached = finish(transfer).unwrap();
        assert_eq!(std::fs::read(&cached.path).unwrap(), b"test");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn receive_rejects_oversize_and_path_names() {
        let root = std::env::temp_dir().join(format!("receive-{}", uuid::Uuid::new_v4()));
        let id = uuid::Uuid::new_v4().to_string();
        assert!(start(&root, &id, "../private.txt", "text/plain", 1, &"0".repeat(64)).is_err());
        assert!(start(&root, &id, "report.txt", "text/plain", MAX_BYTES + 1, &"0".repeat(64)).is_err());
    }

    #[test]
    fn receive_recovers_a_partial_cache_at_the_verified_offset() {
        let root = std::env::temp_dir().join(format!("receive-{}", uuid::Uuid::new_v4()));
        let id = uuid::Uuid::new_v4().to_string();
        let sha = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
        let mut first = start(&root, &id, "report.txt", "text/plain", 4, sha).unwrap();
        assert_eq!(append(&mut first, 0, "dGU=").unwrap(), 2);
        drop(first);
        let mut resumed = start(&root, &id, "report.txt", "text/plain", 4, sha).unwrap();
        assert_eq!(resumed.received, 2);
        assert_eq!(append(&mut resumed, 2, "c3Q=").unwrap(), 4);
        let saved = finish(resumed).unwrap();
        assert_eq!(std::fs::read(saved.path).unwrap(), b"test");
        std::fs::remove_dir_all(root).unwrap();
    }
}
