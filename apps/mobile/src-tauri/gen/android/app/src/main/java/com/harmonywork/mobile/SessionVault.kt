package com.harmonywork.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Keeps the account cookie and model key encrypted with a key that never leaves Android Keystore. */
object SessionVault {
  private const val alias = "harmony_work_mobile_session_v1"
  private const val preferences = "harmony_work_session"
  private const val entry = "encrypted_session"

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build()
    )
    return generator.generateKey()
  }

  @JvmStatic
  fun save(context: Context, plaintext: String) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val encrypted = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
    val bytes = cipher.iv + encrypted
    check(context.getSharedPreferences(preferences, Context.MODE_PRIVATE).edit()
      .putString(entry, Base64.encodeToString(bytes, Base64.NO_WRAP)).commit())
  }

  @JvmStatic
  fun load(context: Context): String? {
    val prefs = context.getSharedPreferences(preferences, Context.MODE_PRIVATE)
    val encoded = prefs.getString(entry, null) ?: return null
    return try {
      val bytes = Base64.decode(encoded, Base64.NO_WRAP)
      require(bytes.size > 12 + 16)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
      String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    } catch (_: Exception) {
      prefs.edit().remove(entry).commit()
      null
    }
  }

  @JvmStatic
  fun clear(context: Context) {
    check(context.getSharedPreferences(preferences, Context.MODE_PRIVATE).edit().remove(entry).commit())
  }
}
