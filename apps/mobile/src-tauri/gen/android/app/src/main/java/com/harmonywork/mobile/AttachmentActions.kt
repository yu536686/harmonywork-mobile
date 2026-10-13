package com.harmonywork.mobile

/** Called only with a verified cache path supplied by the native receiver. */
object AttachmentActions {
  @JvmStatic fun preview(path: String, name: String, mime: String) {
    val activity = MainActivity.current?.get() ?: throw IllegalStateException("Activity unavailable")
    activity.runOnUiThread {
      try { activity.previewAttachment(path, mime) }
      catch (_: Exception) { android.widget.Toast.makeText(activity, "没有可用的附件预览应用", android.widget.Toast.LENGTH_LONG).show() }
    }
  }

  @JvmStatic fun save(path: String, name: String, mime: String) {
    val activity = MainActivity.current?.get() ?: throw IllegalStateException("Activity unavailable")
    activity.runOnUiThread {
      try { activity.saveAttachment(path, name, mime) }
      catch (_: Exception) { android.widget.Toast.makeText(activity, "无法打开系统保存界面", android.widget.Toast.LENGTH_LONG).show() }
    }
  }
}
