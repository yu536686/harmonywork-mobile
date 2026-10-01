#[cfg(target_os = "android")]
mod platform {
    use jni::objects::{JClass, JObject, JString, JValue};

    fn with_vault<T>(
        call: impl FnOnce(&mut jni::JNIEnv<'_>, JObject<'_>, JClass<'_>) -> jni::errors::Result<T>,
    ) -> Result<T, String> {
        let context = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) }
            .map_err(|_| "无法打开 Android 安全存储")?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|_| "无法连接 Android 安全存储")?;
        let app_context = unsafe { JObject::from_raw(context.context().cast()) };
        let result = (|| {
            let loader = env.call_method(&app_context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?.l()?;
            let name = env.new_string("com.harmonywork.mobile.SessionVault")?;
            let class = env.call_method(
                loader,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;",
                &[JValue::Object(&name)],
            )?.l()?;
            call(&mut env, app_context, JClass::from(class))
        })();
        result.map_err(|_| "Android 安全存储操作失败".to_string())
    }

    pub fn save(value: &str) -> Result<(), String> {
        with_vault(|env, context, class| {
            let value = env.new_string(value)?;
            env.call_static_method(
                class,
                "save",
                "(Landroid/content/Context;Ljava/lang/String;)V",
                &[JValue::Object(&context), JValue::Object(&value)],
            )?;
            Ok(())
        })
    }

    pub fn load() -> Result<Option<String>, String> {
        with_vault(|env, context, class| {
            let value = env
                .call_static_method(
                    class,
                    "load",
                    "(Landroid/content/Context;)Ljava/lang/String;",
                    &[JValue::Object(&context)],
                )?
                .l()?;
            if value.is_null() {
                Ok(None)
            } else {
                let value = JString::from(value);
                let plaintext: String = env.get_string(&value)?.into();
                Ok(Some(plaintext))
            }
        })
    }

    pub fn clear() -> Result<(), String> {
        with_vault(|env, context, class| {
            env.call_static_method(
                class,
                "clear",
                "(Landroid/content/Context;)V",
                &[JValue::Object(&context)],
            )?;
            Ok(())
        })
    }
}

#[cfg(not(target_os = "android"))]
mod platform {
    pub fn save(_: &str) -> Result<(), String> { Ok(()) }
    pub fn load() -> Result<Option<String>, String> { Ok(None) }
    pub fn clear() -> Result<(), String> { Ok(()) }
}

pub use platform::{clear, load, save};
