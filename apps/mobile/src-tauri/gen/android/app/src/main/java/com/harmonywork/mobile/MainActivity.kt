package com.harmonywork.mobile

import android.os.Bundle
import android.view.WindowManager
import android.content.Intent
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import java.io.File
import java.lang.ref.WeakReference

class MainActivity : TauriActivity() {
  companion object {
    @Volatile var current: WeakReference<MainActivity>? = null
  }

  private var pendingSave: File? = null
  private val saveLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
    val source = pendingSave
    pendingSave = null
    val target = result.data?.data
    if (result.resultCode == RESULT_OK && source != null && target != null) {
      Thread {
        val saved = try {
          contentResolver.openOutputStream(target, "w")?.use { output -> source.inputStream().use { it.copyTo(output) } }
            ?: throw IllegalStateException("Cannot open destination")
          true
        } catch (_: Exception) { false }
        runOnUiThread { Toast.makeText(this, if (saved) "附件已保存" else "附件保存失败",
          if (saved) Toast.LENGTH_SHORT else Toast.LENGTH_LONG).show() }
      }.start()
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    current = WeakReference(this)
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
  }

  override fun onDestroy() {
    if (current?.get() === this) current = null
    super.onDestroy()
  }

  private fun checkedAttachment(path: String): File {
    val root = cacheDir.canonicalFile
    val file = File(path).canonicalFile
    if (!file.path.startsWith(root.path + File.separator) || file.parentFile?.name != "mobile_attachments" || !file.isFile) {
      throw IllegalArgumentException("Attachment cache is unavailable")
    }
    return file
  }

  fun previewAttachment(path: String, mime: String) {
    val file = checkedAttachment(path)
    val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, mime)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    startActivity(Intent.createChooser(intent, "预览附件"))
  }

  fun saveAttachment(path: String, name: String, mime: String) {
    pendingSave = checkedAttachment(path)
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = mime.ifBlank { "application/octet-stream" }
      putExtra(Intent.EXTRA_TITLE, name)
    }
    saveLauncher.launch(intent)
  }
}
